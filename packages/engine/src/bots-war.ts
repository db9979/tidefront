// KI-Spieler: Angriffe (Nester, andere Bots, Menschen nur mit Erlaubnis), Aufklärung, Probekampf und Minen.
// Alles läuft über missionPreview/launchMission; Schutzregeln (Anfängerschutz, Nachtschild, Gründungsschutz,
// Diplomatie) prüfen die Befehle selbst. Zusätzlich: Mindestabstand zwischen zwei Angriffen desselben Bots auf
// denselben Menschen (bots.humanAttackCooldownHours). Informationen nur aus öffentlicher Karte und eigenen Berichten.
import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import {
  fleetTotals,
  isNestRespawned,
  nestDefender,
  protectionStatus,
  resolveBattle,
  trainingCost,
  type AttackerInput,
  type BaseState,
  type Counts,
  type DefenderInput,
  type Modifiers,
  type ScoutReport,
} from "@tidefront/game-core";
import { hexDistanceKm, neighbors, terrainAt } from "@tidefront/world";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { launchMission, type LaunchInput } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { NPC_UNIT_VALUE } from "./scoring.ts";
import { botsConfig, type BotRow, type BotState, type ProfileConfig } from "./bots-core.ts";
import { value } from "./bots-plan.ts";
import type { BaseRow } from "./store.ts";

export interface TurnCtx {
  engine: Engine;
  bot: BotRow;
  cfg: ProfileConfig;
  nowMs: number;
  rand: () => number;
  log: string[];
  key: (what: string) => string;
  state: BotState;
}

/** Einheiten, die nicht kämpfen sollen. */
const NON_COMBAT = new Set(["spion", "kolonieschiff", "minenleger", "minenraeumer", "aufklaerungsdrohne"]);
const MAX_RANGE_KM = 900;

/** Angriffsverband: Kampfeinheiten daheim ohne die Heimwache; Truppen nur mit Transportraum. */
export function strikeForce(state: BaseState, guardShare: number): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(state.units)) {
    if (n <= 0 || NON_COMBAT.has(id) || !balance.units[id]) continue;
    // Landungsschiffe und Truppen fahren vollständig mit (die Heimwache sind Schiffe, Flugzeuge, Anlagen).
    const k = id === "landungsschiff" || balance.units[id].branch === "land" ? n : Math.floor(n * (1 - guardShare));
    if (k > 0) out[id] = k;
  }
  // Truppen kürzen, bis sie in die Landungsschiffe passen.
  const t = fleetTotals(out, balance);
  if (t.troopSize > t.troopSpace) {
    let free = t.troopSpace;
    for (const id of Object.keys(out).filter((x) => balance.units[x].branch === "land")) {
      const size = balance.units[id].size ?? 1;
      const k = Math.min(out[id], Math.floor(free / size));
      free -= k * size;
      if (k > 0) out[id] = k;
      else delete out[id];
    }
  }
  return out;
}

export function forceValue(units: Counts): number {
  let v = 0;
  for (const [id, n] of Object.entries(units)) {
    if (balance.units[id] || balance.defenses[id]) v += n * value(trainingCost(id, 1, balance));
    else v += n * (NPC_UNIT_VALUE[id] ?? 0);
  }
  return v;
}

/** Probekampf: dieselbe Kampfrechnung wie im Spiel über feste Seeds. */
export function probe(attacker: AttackerInput, defender: DefenderInput, runs: number): { winRate: number; lossValue: number; lootValue: number } {
  let wins = 0, loss = 0, loot = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(attacker, defender, balance, Math.imul(i + 1, 0x9e3779b1) >>> 0);
    if (!r.ok) return { winRate: 0, lossValue: Infinity, lootValue: 0 };
    if (r.report.winner === "attacker") wins++;
    const lost: Counts = {};
    for (const [id, n] of Object.entries(r.report.attacker.before)) lost[id] = Math.max(0, n - (r.report.attacker.final[id] ?? 0));
    loss += forceValue(lost);
    loot += value(r.report.loot);
  }
  return { winRate: wins / runs, lossValue: loss / runs, lootValue: loot / runs };
}

async function tryLaunch(c: TurnCtx, input: LaunchInput, text: string): Promise<boolean> {
  const p = await missionPreview(c.engine, c.bot.id, input);
  if (!p.ok) return false;
  const r = await launchMission(c.engine, c.bot.id, c.key(input.type), input);
  if (r.ok) c.log.push(text);
  return r.ok;
}

/** Überfall auf ein Piratennest, wenn der Verband es sicher schafft. */
export async function raidNest(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  if (!c.cfg.attackNests || c.cfg.probeRuns <= 0) return false;
  const force = strikeForce(base.state, c.cfg.homeGuardShare);
  const fv = forceValue(force);
  if (fv < 2000) return false;
  const nests = (await c.engine.db.select().from(tables.nest))
    .filter((n) => !n.defeatedAt || isNestRespawned(n.defeatedAt.getTime(), c.nowMs, balance))
    .map((n) => ({ ...n, d: hexDistanceKm(base, n) }))
    .filter((n) => n.d <= MAX_RANGE_KM)
    .sort((a, b) => b.level - a.level || a.d - b.d);
  for (const n of nests.slice(0, 12)) {
    const d = nestDefender(n.level, balance);
    if (!d.ok) continue;
    const p = probe({ units: force, modifiers: mods }, d.defender, c.cfg.probeRuns);
    if (p.winRate < c.cfg.probeWinRate || p.lootValue < 0.8 * p.lossValue) continue;
    if (await tryLaunch(c, { type: "ueberfall", units: force, col: n.col, row: n.row, baseId: base.id }, `Überfall auf Piratennest Stufe ${n.level} (${Math.round(n.d)} km).`)) return true;
  }
  return false;
}

/** Hat der Bot denselben Menschen in der Sperrfrist schon angegriffen (Bericht oder Verband unterwegs)? */
export async function humanCooldownActive(c: TurnCtx, humanId: number): Promise<boolean> {
  const since = new Date(c.nowMs - botsConfig().humanAttackCooldownHours * 3600000);
  const [rep] = await c.engine.db.select({ id: tables.battleReport.id }).from(tables.battleReport).where(and(
    eq(tables.battleReport.kind, "ueberfall"), eq(tables.battleReport.attackerPlayerId, c.bot.id),
    eq(tables.battleReport.defenderPlayerId, humanId), gt(tables.battleReport.createdAt, since),
  )).limit(1);
  if (rep) return true;
  const theirBases = (await c.engine.db.select({ id: tables.base.id }).from(tables.base).where(eq(tables.base.playerId, humanId))).map((b) => b.id);
  if (theirBases.length === 0) return false;
  const [m] = await c.engine.db.select({ id: tables.mission.id, createdAt: tables.mission.createdAt }).from(tables.mission).where(and(
    eq(tables.mission.playerId, c.bot.id), eq(tables.mission.type, "ueberfall"), eq(tables.mission.targetKind, "base"),
    inArray(tables.mission.targetId, theirBases), inArray(tables.mission.status, ["outbound", "returning"]),
  )).orderBy(desc(tables.mission.id)).limit(1);
  return !!m;
}

/** Mögliche Spielerziele: fremde Häfen in Reichweite ohne Schutz; Menschen nur mit Erlaubnis und außerhalb der Sperrfrist. */
export async function playerTargets(c: TurnCtx, base: BaseRow) {
  const rows = await c.engine.db
    .select({ id: tables.base.id, playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row, state: tables.base.state, bot: tables.player.botProfile })
    .from(tables.base).innerJoin(tables.player, eq(tables.player.id, tables.base.playerId))
    .where(ne(tables.base.playerId, c.bot.id));
  const out: { id: number; playerId: number; col: number; row: number; human: boolean; d: number }[] = [];
  for (const r of rows) {
    const human = r.bot === null;
    if (human && !c.bot.settings.attackHumans) continue;
    if (protectionStatus((r.state as BaseState).protection, c.nowMs, balance).protected) continue;
    const d = hexDistanceKm(base, r);
    if (d > MAX_RANGE_KM) continue;
    if (human && (await humanCooldownActive(c, r.playerId))) continue;
    out.push({ id: r.id, playerId: r.playerId, col: r.col, row: r.row, human, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

async function lastScout(c: TurnCtx, targetBaseId: number): Promise<ScoutReport | null> {
  const since = new Date(c.nowMs - botsConfig().reconMaxAgeHours * 3600000);
  const [r] = await c.engine.db.select({ report: tables.battleReport.report }).from(tables.battleReport).where(and(
    eq(tables.battleReport.kind, "aufklaerung"), eq(tables.battleReport.attackerPlayerId, c.bot.id),
    eq(tables.battleReport.defenderBaseId, targetBaseId), gt(tables.battleReport.createdAt, since),
  )).orderBy(desc(tables.battleReport.id)).limit(1);
  return (r?.report as { scout?: ScoutReport } | undefined)?.scout ?? null;
}

/** Angriff auf einen Spielerhafen: erst Aufklärung, dann Probekampf gegen das Lagebild (Durchläufe je Spielweise). */
export async function raidPlayer(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  if (c.cfg.attackPlayers <= 0 || c.cfg.probeRuns <= 0 || c.rand() > c.cfg.attackPlayers) return false;
  const force = strikeForce(base.state, c.cfg.homeGuardShare);
  if (forceValue(force) < 3000) return false;
  const targets = await playerTargets(c, base);
  for (const t of targets.filter((x) => (c.state.avoid?.[String(x.id)] ?? 0) <= c.nowMs).slice(0, 4)) {
    const scout = await lastScout(c, t.id);
    if (!scout) {
      // Aufklärung schicken (nur, wenn nicht schon eine unterwegs ist).
      const sent = c.state.recon?.[String(t.id)];
      if (sent && c.nowMs - sent < botsConfig().reconMaxAgeHours * 3600000) continue;
      const scoutUnit = (base.state.units.aufklaerungsdrohne ?? 0) > 0 ? "aufklaerungsdrohne" : (base.state.units.korvette ?? 0) > 0 ? "korvette" : null;
      if (!scoutUnit) continue;
      if (await tryLaunch(c, { type: "aufklaerung", units: { [scoutUnit]: 1 }, col: t.col, row: t.row, baseId: base.id }, `Aufklärung gegen Hafen ${t.col}/${t.row}${t.human ? " (Mensch)" : ""}.`)) {
        c.state.recon = { ...(c.state.recon ?? {}), [String(t.id)]: c.nowMs };
        return true;
      }
      continue;
    }
    const defender: DefenderInput = { units: scout.units, defenses: scout.defenses, resources: scout.resources, protectedPerResource: scout.protectedPerResource };
    const p = probe({ units: force, modifiers: mods }, defender, c.cfg.probeRuns);
    if (p.winRate < c.cfg.probeWinRate || p.lootValue < 0.5 * p.lossValue) {
      // Zu stark oder lohnt nicht: dieses Ziel eine Weile meiden (keine Aufklärung im Dauertakt).
      c.state.avoid = { ...(c.state.avoid ?? {}), [String(t.id)]: c.nowMs + 2 * botsConfig().reconMaxAgeHours * 3600000 };
      continue;
    }
    if (await tryLaunch(c, { type: "ueberfall", units: force, col: t.col, row: t.row, baseId: base.id }, `Überfall auf Hafen ${t.col}/${t.row}${t.human ? " (Mensch)" : ""}.`)) return true;
  }
  return false;
}

/** Minen vor einem gegnerischen Hafen legen (Freibeuter; Menschen nur mit Erlaubnis). */
export async function layMines(c: TurnCtx, base: BaseRow & { state: BaseState }): Promise<boolean> {
  const layers = base.state.units.minenleger ?? 0;
  if (layers <= 0 || c.cfg.attackPlayers < 1 || c.rand() > 0.3) return false;
  for (const t of (await playerTargets(c, base)).slice(0, 3)) {
    const sea = neighbors(t.col, t.row).find((h) => terrainAt(h.col, h.row) === "sea");
    if (!sea) continue;
    if (await tryLaunch(c, { type: "minen", units: { minenleger: layers }, col: sea.col, row: sea.row, baseId: base.id }, `Minen vor Hafen ${t.col}/${t.row} gelegt.`)) return true;
  }
  return false;
}
