// KI-Spieler: Angriffe (Nester, andere Bots, Menschen nur mit Erlaubnis), Aufklärung, Probekampf und Minen.
// Alles läuft über missionPreview/launchMission; Schutzregeln (Anfängerschutz, Nachtschild, Gründungsschutz,
// Diplomatie) prüfen die Befehle selbst. Zusätzlich: Mindestabstand zwischen zwei Angriffen desselben Bots auf
// denselben Menschen (bots.humanAttackCooldownHours). Informationen nur aus der Kartenansicht (Lagebild) und eigenen Berichten.
import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import {
  fleetTotals,
  liveNestDefender,
  nestDefenders,
  nestVaries,
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
import type { NestLagebild } from "./nest-live.ts"; // Lebendige Nester
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { bountyByPlayer, rankSnapshot, snapshotEntry } from "./pvp.ts"; // PvP: Freibeuter bevorzugt Kopfgeld-Ziele
import { launchMission, type LaunchInput } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { NPC_UNIT_VALUE } from "./scoring.ts";
import { botsConfig, type BotRow, type BotState, type ProfileConfig } from "./bots-core.ts";
import { value } from "./bots-plan.ts";
import type { BaseRow } from "./store.ts";
import { reservedForField } from "./bots-fields.ts";
import { botMap, scoutNearest, scoutsUnknown } from "./bots-intel.ts"; // Lagebild

export interface TurnCtx {
  engine: Engine;
  bot: BotRow;
  cfg: ProfileConfig;
  nowMs: number;
  rand: () => number;
  log: string[];
  key: (what: string) => string;
  state: BotState;
  /** Admirale (bots-admiral.ts): bereiter Admiral für den nächsten Überfall aus seinem Hafen. */
  admiral?: { id: number; baseId: number; mods: Modifiers };
  /** Admirale: Kredite, die die Börse für die Ernennung zurückhält. */
  creditReserve?: number;
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

/**
 * Feldverband daheim lassen (bots-fields.ts): Kampfschiffe des Angriffsverbands abziehen, bis ihre Kommandopunkte den
 * reservierten Verband decken (Korvetten zuerst, dann die übrigen Schiffe).
 */
export function withoutReserve(force: Counts, reserve: Counts): Counts {
  let cp = 0;
  for (const [id, n] of Object.entries(reserve)) cp += (balance.units[id]?.commandPoints ?? 0) * n;
  if (cp <= 0) return force;
  const out = { ...force };
  const ships = Object.keys(out)
    .filter((id) => balance.units[id]?.branch === "see" && (balance.units[id].attack.see ?? 0) > 0 && id !== "landungsschiff")
    .sort((a, b) => Number(b === "korvette") - Number(a === "korvette") || a.localeCompare(b));
  for (const id of ships) {
    const per = balance.units[id].commandPoints ?? 1;
    const k = Math.min(out[id], Math.ceil(cp / per));
    out[id] -= k;
    cp -= k * per;
    if (out[id] <= 0) delete out[id];
    if (cp <= 0) break;
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
  // Admirale: ein Überfall aus dem Hafen des bereiten Admirals nimmt ihn mit (Probekampf rechnete ihn schon ein).
  const adm = input.type === "ueberfall" && c.admiral && c.admiral.baseId === input.baseId ? c.admiral : null;
  if (adm) input = { ...input, admiralId: adm.id };
  const p = await missionPreview(c.engine, c.bot.id, input);
  if (!p.ok) return false;
  const r = await launchMission(c.engine, c.bot.id, c.key(input.type), input);
  if (r.ok) c.log.push(adm ? `${text} Mit Admiral.` : text);
  if (r.ok && adm) c.admiral = undefined;
  return r.ok;
}

/** Lebendige Nester: Verteidiger, gegen den die KI probt – genaues Lagebild (hochgerechnet), sonst ungünstigster Wurf. */
export function botNestDefender(n: { level: number; lagebild?: NestLagebild | null }, nowMs: number): DefenderInput {
  const lb = n.lagebild;
  return lb ? liveNestDefender(n.level, { roll: lb.roll, garrison: lb.garrison, garrisonAtMs: lb.garrisonAtMs, lootAtMs: lb.lootAtMs }, nowMs, balance) : nestDefenders(n.level, balance, "worst")[0];
}

/** Überfall auf ein Piratennest, wenn der Verband es sicher schafft. */
export async function raidNest(c: TurnCtx, base: BaseRow & { state: BaseState }, mods: Modifiers): Promise<boolean> {
  if (!c.cfg.attackNests || c.cfg.probeRuns <= 0) return false;
  const force = withoutReserve(strikeForce(base.state, c.cfg.homeGuardShare), reservedForField(c, base.id));
  const fv = forceValue(force);
  if (fv < 2000) return false;
  // Lagebild: nur Nester mit bekannter Stufe und Zustand (Sicht oder Wissen), wie bei Menschen.
  const map = await botMap(c);
  const nests = map.nests
    .filter((n): n is typeof n & { level: number } => n.level !== null && n.empty === false && n.level <= (c.cfg.nestMaxLevel ?? Infinity))
    .map((n) => ({ ...n, d: hexDistanceKm(base, n) }))
    .filter((n) => n.d <= MAX_RANGE_KM)
    .sort((a, b) => b.level - a.level || a.d - b.d);
  // Lebendige Nester: Probekampf je Nest – mit genauem Lagebild gegen die hochgerechnete Besatzung, sonst gegen den
  // ungünstigsten Wurf (die KI soll nicht „Glück haben“); ohne Lagebild je Stufe nur einmal. Höchstens botMaxNests
  // Probekämpfe je Zug (Pi-Last), danach höchstens 6 Startversuche.
  const fits = new Map<string, boolean>();
  const maxProbes = balance.pirates.living?.botMaxNests ?? 6;
  let probes = 0;
  let tries = 0;
  for (const n of nests) {
    const lb = n.lagebild;
    const k = lb ? `n${n.id}` : `l${n.level}`;
    if (!fits.has(k)) {
      if (probes >= maxProbes) break;
      probes++;
      const p = probe({ units: force, modifiers: mods }, botNestDefender(n, c.nowMs), c.cfg.probeRuns);
      fits.set(k, p.winRate >= c.cfg.probeWinRate && p.lootValue >= 0.8 * p.lossValue);
    }
    if (!fits.get(k)) continue;
    if (++tries > 6) break;
    if (await tryLaunch(c, { type: "ueberfall", units: force, col: n.col, row: n.row, baseId: base.id }, `Überfall auf Piratennest Stufe ${n.level} (${Math.round(n.d)} km).`)) return true;
  }
  // Lagebild: unbekannte Nester in Reichweite aufklären (Kampagne; Freibeuter laufend, Festung mit Pause), danach entscheidet der Probekampf.
  if (!scoutsUnknown(c, "nest")) return false;
  // Lebendige Nester: Freibeuter und Festung klären auch erkannte Nester ohne genaues Lagebild auf (Händler nicht).
  const unknown = map.nests.filter((n) => !n.known || (c.bot.profile !== "haendler" && n.level !== null && n.empty === false && !n.lagebild && nestVaries(n.level, balance) && n.level <= (c.cfg.nestMaxLevel ?? Infinity)))
    .map((n) => ({ key: `n${n.id}`, col: n.col, row: n.row, label: `Piratennest ${n.col}/${n.row}` }));
  return scoutNearest(c, base, unknown, MAX_RANGE_KM);
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
    .select({ id: tables.base.id, playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row, bot: tables.player.botProfile })
    .from(tables.base).innerJoin(tables.player, eq(tables.player.id, tables.base.playerId))
    .where(ne(tables.base.playerId, c.bot.id));
  // Lagebild: Schutzstatus nur, soweit der Bot ihn sieht oder kennt (unbekannt: Planung entscheidet).
  const shown = new Map((await botMap(c)).bases.map((b) => [b.id, b]));
  const out: { id: number; playerId: number; col: number; row: number; human: boolean; d: number }[] = [];
  for (const r of rows) {
    const human = r.bot === null;
    if (human && !c.bot.settings.attackHumans) continue;
    if (shown.get(r.id)?.protection) continue;
    const d = hexDistanceKm(base, r);
    if (d > MAX_RANGE_KM) continue;
    if (human && (await humanCooldownActive(c, r.playerId))) continue;
    out.push({ id: r.id, playerId: r.playerId, col: r.col, row: r.row, human, d });
  }
  // PvP: der Freibeuter nimmt Kopfgeld-Ziele (Rang 1–3, Stand Tagesbeginn) zuerst, sonst das nächste Ziel.
  const snap = c.bot.profile === "freibeuter" ? await rankSnapshot(c.engine.db, c.nowMs) : null;
  const bounty = snap ? bountyByPlayer(snap) : new Map<number, number>();
  const mine = snap ? snapshotEntry(snap, c.bot.id).rank : null;
  const prize = (t: { playerId: number }) => (snap && (mine === null || mine > (snapshotEntry(snap, t.playerId).rank ?? Infinity)) ? bounty.get(t.playerId) ?? 0 : 0);
  return out.sort((a, b) => prize(b) - prize(a) || a.d - b.d);
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
  const force = withoutReserve(strikeForce(base.state, c.cfg.homeGuardShare), reservedForField(c, base.id));
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
