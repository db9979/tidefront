// Weltereignisse: Entstehen (game_event world_event_spawn). Wählt Art, Ziel und Route, stellt den Verband nach
// Saisonfortschritt und Spielerstärke zusammen, plant Fahrt, Angriffe und Ende, kündigt per Nachricht und Push an.
// Nie gegen Spieler im Anfängerschutz; die Belagerung trifft nur gerade ungeschützte Häfen.
import {
  armadaTargetHp,
  buildRoute,
  composeArmada,
  composeSiege,
  composeTreasure,
  defenseHp,
  forceHp,
  isBeginnerProtected,
  mulberry32,
  nextSpawn,
  protectionStatus,
  referenceHp,
  seasonProgress,
  settle,
  strengthFactor,
  worldEventsBalance,
  WORLD_EVENT_KINDS,
  type BaseState,
  type Counts,
  type WorldEventKind,
} from "@tidefront/game-core";
import { hexCenter, hexDistanceKm, neighbors, terrainAt } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import { politikEventData, politikEventKind } from "./politik-core.ts"; // Weltpolitik: Kartellfehde, Gemeinsame Aktion
import { nOf } from "./names.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { randomSeed, scheduleEvent } from "./store.ts";
import { worldEventNews } from "./market-news-sources.ts";
import {
  KIND_TEXT, notice, openWorldEvents, ordinaryEventsUntil, playersWithBase, resText, runningSeasonRow, systemMessage,
  type ArmadaTarget, type Hex, type WorldEventData,
} from "./world-events.ts";

const HOUR_MS = 3600000;
const none = (): HandlerResult => ({ notify: [] });

interface Candidate extends Hex {
  baseId: number;
  playerId: number;
  name: string;
  state: BaseState;
  hp: number;
  /** Bezug der Großflotte (v1.16: Schiffe gewichtet wie beim Kartell, sie landet Miliz). */
  armadaHp: number;
}

type Rng = () => number;
const pick = <T>(rng: Rng, list: T[]): T => list[Math.floor(rng() * list.length)];

/**
 * Mehrere Häfen: Hafen auswählen, gewichtet je Spieler (nicht je Hafen) – erst ein Spieler gleichverteilt, dann einer
 * seiner Häfen. Mit einem Hafen je Spieler identisch zu pick (gleicher Zufallswert für die Spielerwahl).
 */
function pickPerPlayer<T extends { playerId: number }>(rng: Rng, list: T[]): T {
  const players = [...new Set(list.map((c) => c.playerId))];
  if (players.length === list.length) return pick(rng, list);
  const p = pick(rng, players);
  return pick(rng, list.filter((c) => c.playerId === p));
}

/** Ein Eintrag je Spieler (Pushes nicht doppelt). */
const onePerPlayer = <T extends { playerId: number }>(list: T[]): T[] => list.filter((c, i) => list.findIndex((x) => x.playerId === c.playerId) === i);
const isSea = (h: Hex) => terrainAt(h.col, h.row) === "sea";
const key = (h: Hex) => `${h.col},${h.row}`;

/** Breitensuche über Seefelder ab den Seenachbarn von `from` (bzw. from selbst, wenn es See ist). */
function seaBfs(from: Hex, maxHops: number): Map<string, { hex: Hex; hops: number; parent: string | null }> {
  const seen = new Map<string, { hex: Hex; hops: number; parent: string | null }>();
  const queue: Hex[] = [];
  const starts = isSea(from) ? [from] : neighbors(from.col, from.row).filter(isSea);
  for (const s of starts) {
    seen.set(key(s), { hex: s, hops: 0, parent: null });
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = seen.get(key(queue[i]))!;
    if (cur.hops >= maxHops) continue;
    for (const n of neighbors(cur.hex.col, cur.hex.row)) {
      if (!isSea(n) || seen.has(key(n))) continue;
      seen.set(key(n), { hex: n, hops: cur.hops + 1, parent: key(cur.hex) });
      queue.push(n);
    }
  }
  return seen;
}

async function candidates(tx: Tx, due: number): Promise<Candidate[]> {
  const rows = await tx.select().from(tables.base);
  return rows
    .map((b) => {
      const state = settle(b.state as BaseState, due, balance);
      return {
        baseId: b.id, playerId: b.playerId, name: b.name, col: b.col, row: b.row, state, hp: defenseHp(state.units, state.defenses, balance),
        armadaHp: armadaTargetHp(state.units, state.defenses, balance),
      };
    })
    .filter((c) => !isBeginnerProtected(c.state.protection, due, balance));
}

interface Draft {
  kind: WorldEventKind;
  col: number;
  row: number;
  targetBaseId: number | null;
  units: Counts;
  data: WorldEventData;
  activeAtMs: number;
  endsAtMs: number;
  /** Ankündigung: Betreff, Text an alle, Push an diese Spieler (Art attack = eigener Hafen bedroht). */
  subject: string;
  body: string;
  pushes: [number, "attack" | "fleet", string][];
}

async function draftTreasure(tx: Tx, rng: Rng, due: number, cands: Candidate[], progress: number, focus: Candidate[]): Promise<Draft | null> {
  const t = worldEventsBalance(balance).schatzschiff;
  if (focus.length === 0) return null;
  const nests = await tx.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest);
  for (let attempt = 0; attempt < 6; attempt++) {
    const near = pickPerPlayer(rng, focus);
    const around = [...seaBfs(near, 6).values()].map((v) => v.hex)
      .filter((h) => { const d = hexDistanceKm(near, h); return d >= t.spawnKmFromBase[0] && d <= t.spawnKmFromBase[1]; });
    if (around.length === 0) continue;
    const start = pick(rng, around);
    const tree = seaBfs(start, Math.ceil(t.routeKm[1] / 90) + 2);
    const options: { nest: Hex; last: string; km: number }[] = [];
    for (const n of nests) {
      for (const s of neighbors(n.col, n.row)) {
        const node = tree.get(key(s));
        if (!node) continue;
        const km = node.hops * 100 + hexDistanceKm(s, n);
        if (km >= t.routeKm[0] && km <= t.routeKm[1]) { options.push({ nest: n, last: key(s), km }); break; }
      }
    }
    if (options.length === 0) continue;
    const goal = pick(rng, options);
    const path: Hex[] = [goal.nest];
    for (let k: string | null = goal.last; k; k = tree.get(k)!.parent) path.unshift(tree.get(k)!.hex);
    const hours = t.durationHours[0] + Math.floor(rng() * (t.durationHours[1] - t.durationHours[0] + 1));
    const endsAtMs = due + hours * HOUR_MS;
    const route = buildRoute(path.map((h) => hexCenter(h.col, h.row)), due, endsAtMs);
    const comp = composeTreasure(referenceHp(cands.map((c) => c.hp), balance), progress, balance);
    const nearby = cands.filter((c) => path.some((h) => hexDistanceKm(c, h) <= worldEventsBalance(balance).nearbyKm));
    return {
      kind: "schatzschiff", col: start.col, row: start.row, targetBaseId: null, units: comp.units, activeAtMs: due, endsAtMs,
      data: { initialHp: forceHp(comp.units, balance), strength: strengthFactor(progress, balance), path, route, harbor: goal.nest, loot: comp.loot },
      subject: "Schatzschiff gesichtet",
      body: `Ein Schatzschiff des Kartells läuft mit ${nOf(comp.units.schnellboot, "Schnellboot", "Schnellbooten")} als Begleitschutz in ${nOf(hours, "Stunde", "Stunden")} ` +
        `in einen Kartellhafen ein. An Bord: ${resText(comp.loot)}. Nur der erste Verband, der den Begleitschutz versenkt, ` +
        "erhält die Beute. Plane auf der Karte eine Mission – der Abfangpunkt wird beim Planen berechnet.",
      pushes: onePerPlayer(nearby).map((c) => [c.playerId, "fleet", `Ein Schatzschiff fährt in der Nähe von ${c.name}.`]),
    };
  }
  return null;
}

function draftArmada(rng: Rng, due: number, cands: Candidate[], progress: number, focus: Candidate[]): Draft | null {
  const g = worldEventsBalance(balance).grossflotte;
  if (focus.length === 0) return null;
  const center = pickPerPlayer(rng, focus);
  const inRegion = cands
    .map((c) => ({ c, d: hexDistanceKm(center, c) }))
    .filter((x) => x.d <= g.regionRadiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, g.maxTargets)
    .map((x) => x.c);
  const tree = [...seaBfs(center, 3).values()].sort((a, b) => b.hops - a.hops);
  const assembly = tree[0]?.hex ?? center;
  const comp = composeArmada(referenceHp(inRegion.map((c) => c.armadaHp), balance), progress, balance);
  const activeAtMs = due + g.announceHours * HOUR_MS;
  const targets: ArmadaTarget[] = inRegion.map((c) => ({ baseId: c.baseId, playerId: c.playerId, name: c.name, col: c.col, row: c.row, status: "pending" }));
  const names = targets.map((x) => x.name).join(", ");
  return {
    kind: "grossflotte", col: assembly.col, row: assembly.row, targetBaseId: null, units: comp.units, activeAtMs,
    endsAtMs: activeAtMs + Math.max(1, targets.length - 1) * g.attackIntervalHours * HOUR_MS + HOUR_MS,
    data: {
      initialHp: forceHp(comp.units, balance), strength: strengthFactor(progress, balance), assembly,
      region: { col: center.col, row: center.row, radiusKm: g.regionRadiusKm }, targets, next: 0, lootPool: comp.lootPool, paid: {},
    },
    subject: "Großflotte des Kartells sammelt sich",
    body: `Das Kartell sammelt eine Großflotte (${comp.units.schnellboot} Schnellboote, ${comp.units.piratenmiliz} Milizionäre). ` +
      `In ${nOf(g.announceHours, "Stunde", "Stunden")} läuft sie aus und greift nacheinander diese Häfen an: ${names}. ` +
      "Jeder Verband, der sie vorher auf See angreift, schwächt sie dauerhaft und erhält Beute anteilig zum Schaden.",
    pushes: onePerPlayer(targets).map((x) => {
      const mine = targets.filter((y) => y.playerId === x.playerId).map((y) => y.name);
      const what = mine.length > 1 ? `deine Häfen ${mine.join(", ")}` : `deinen Hafen ${mine[0]}`;
      return [x.playerId, "attack", `Die Großflotte greift in ${nOf(g.announceHours, "Stunde", "Stunden")} ${what} an.`] as [number, "attack", string];
    }),
  };
}

async function draftSiege(rng: Rng, due: number, focus: Candidate[], progress: number, besieged: Set<number>): Promise<Draft | null> {
  const s = worldEventsBalance(balance).belagerung;
  const open = focus.filter((c) => !protectionStatus(c.state.protection, due, balance).protected && !besieged.has(c.baseId));
  if (open.length === 0) return null;
  const target = pickPerPlayer(rng, open);
  const comp = composeSiege(target.hp, progress, balance);
  return {
    kind: "belagerung", col: target.col, row: target.row, targetBaseId: target.baseId, units: comp.units, activeAtMs: due,
    endsAtMs: due + s.durationHours * HOUR_MS,
    data: {
      initialHp: forceHp(comp.units, balance), strength: strengthFactor(progress, balance), lootPool: comp.lootPool, paid: {},
      baseName: target.name, ownerId: target.playerId, lastTickMs: due, deducted: {},
    },
    subject: `Belagerung von ${target.name}`,
    body: `Das Kartell legt mit ${comp.units.schnellboot} Schnellbooten einen Belagerungsring um ${target.name}. ` +
      `${nOf(s.durationHours, "Stunde", "Stunden")} lang: keine Börsenkäufe, Produktion −${Math.round(s.productionPenalty * 100)} %. ` +
      "Andere Spieler können den Ring mit einem Überfall brechen und erhalten Beute anteilig zum Schaden.",
    pushes: [[target.playerId, "attack", `Belagerungsring um ${target.name}: keine Börsenkäufe, Produktion gedrosselt.`]],
  };
}

/**
 * Legt ein Ereignis der gewünschten Art an (oder einer anderen, wenn diese kein Ziel findet). focusBaseId
 * (Tests, Verwaltung): dieser Hafen ist Ausgangspunkt, Region bzw. Ziel.
 */
export async function spawnWorldEvent(
  tx: Tx, due: number, wanted: WorldEventKind, seasonId: number | null, progress: number, focusBaseId?: number,
): Promise<{ id: number; kind: WorldEventKind; jobs: NoticeJob[] } | null> {
  const rng = mulberry32(randomSeed());
  const cands = await candidates(tx, due);
  const focus = focusBaseId === undefined ? cands : cands.filter((c) => c.baseId === focusBaseId);
  const besieged = new Set((await openWorldEvents(tx)).filter((e) => e.kind === "belagerung").map((e) => e.targetBaseId!));
  const order = [wanted, ...WORLD_EVENT_KINDS.filter((k) => k !== wanted)];
  let d: Draft | null = null;
  for (const kind of order) {
    d = kind === "schatzschiff" ? await draftTreasure(tx, rng, due, cands, progress, focus)
      : kind === "grossflotte" ? draftArmada(rng, due, cands, progress, focus)
      : await draftSiege(rng, due, focus, progress, besieged);
    if (d) break;
  }
  if (!d) return null;
  d.data = await politikEventData(tx, due, d.data); // Weltpolitik: Gemeinsame Aktion (mehr Beute)
  const [row] = await tx
    .insert(tables.worldEvent)
    .values({
      kind: d.kind, status: d.activeAtMs > due ? "announced" : "active", seasonId, col: d.col, row: d.row,
      targetBaseId: d.targetBaseId, units: d.units, initialUnits: d.units, data: d.data,
      startsAt: new Date(due), activeAt: new Date(d.activeAtMs), endsAt: new Date(d.endsAtMs),
    })
    .returning({ id: tables.worldEvent.id });
  const payload = { eventId: row.id };
  // Marktnachrichten: Großflotte und Belagerung verschieben den Richtwert ab dem Entstehen.
  await worldEventNews(tx, row.id, due);
  if (d.kind === "grossflotte") await scheduleEvent(tx, "world_event_attack", d.activeAtMs, payload, null);
  else {
    await scheduleEvent(tx, "world_event_end", d.endsAtMs, payload, null);
    const step = d.kind === "belagerung" ? worldEventsBalance(balance).belagerung.tickMinutes * 60000 : HOUR_MS;
    if (due + step < d.endsAtMs) await scheduleEvent(tx, "world_event_move", due + step, payload, d.targetBaseId);
  }
  const all = await playersWithBase(tx);
  await systemMessage(tx, all.map((p) => p.playerId), d.subject, d.body, due);
  const jobs = d.pushes.map(([id, kind, text]) => notice(id, kind, `${KIND_TEXT[d!.kind]}: ${d!.subject}`, text));
  return { id: row.id, kind: d.kind, jobs };
}

/** game_event world_event_spawn: Ereignis anlegen, nächstes planen (Abstand spawnIntervalHours). */
export const worldEventSpawn: Handler = async (tx, ev, due) => {
  const w = worldEventsBalance(balance);
  const season = await runningSeasonRow(tx);
  if (!season || (ev.payload.seasonId !== undefined && Number(ev.payload.seasonId) !== season.id)) return none();
  const left = season.endsAt.getTime() - due;
  if (left < w.minSeasonHoursLeft * HOUR_MS) return none();
  const until = ordinaryEventsUntil(season); // Saisonfinale: ab der Ankündigung keine gewöhnlichen Ereignisse
  const wanted = await politikEventKind(tx, due, (WORLD_EVENT_KINDS as readonly string[]).includes(String(ev.payload.kind)) ? (ev.payload.kind as WorldEventKind) : "schatzschiff"); // Weltpolitik: Kartellfehde
  const progress = seasonProgress(season.startsAt.getTime(), season.endsAt.getTime(), due);
  if (due >= until) return none();
  const made = await spawnWorldEvent(tx, due, wanted, season.id, progress);
  const next = nextSpawn(due, randomSeed(), balance);
  const at = made ? next.atMs : due + w.retryHours * HOUR_MS;
  if (at <= season.endsAt.getTime() - w.minSeasonHoursLeft * HOUR_MS && at < until) {
    await scheduleEvent(tx, "world_event_spawn", at, { seasonId: season.id, kind: made ? next.kind : wanted }, null);
  }
  if (!made) return none();
  return { notify: [[null, "map"], [null, "messages"]], push: made.jobs };
};

export { seaBfs };
