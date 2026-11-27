// Mehrere Häfen je Spieler: Gründung eines Außenpostens (Kolonieschiff auf ein freies Küstenfeld) und Verlegung von
// Einheiten zwischen eigenen Häfen (docs/REGELN-EXPANSION.md). Hier: Prüfungen, Planung, Auslaufen und Vorschau;
// die Ankunft steht in expansion-arrive.ts. Eingehängt in commands.ts (launchMission), views.ts (missionPreview)
// und handlers.ts (missionArrive).
import { and, eq, ne } from "drizzle-orm";
import {
  aircraftSlots, aircraftSlotsUsed, allowedBases, combineModifiers, expansionOf, foundingBlocker, planMission,
  type Counts, type Modifiers, type ResourceMap,
} from "@tidefront/game-core";
import { TRADE_PORTS, hexAtLonLat, hexCenter, hexDistanceKm, isCoast } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError } from "./context.ts";
import { activeMissionCount, homeBaseOf, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { missionWeather, withArrival } from "./weather.ts";
import { admiralForLaunch, admiralPreviewMods, assignAdmiral } from "./admirals-core.ts";
import type { Notes } from "./naval-common.ts";

/** Missionsart: Kolonieschiff gründet auf einem freien Küstenfeld einen neuen Hafen. */
export const FOUNDING_TYPE = "gruendung";
/** Missionsart: Einheiten (und Admiral) dauerhaft in einen anderen eigenen Hafen verlegen. */
export const TRANSFER_TYPE = "verlegung";
/** Zielarten der Missionszeilen (nicht „base“, damit die Verlegung nicht als Anmarsch auf den Zielhafen zählt). */
export const SITE_TARGET = "site";
export const OWN_BASE_TARGET = "own_base";

export { expansionArrive } from "./expansion-arrive.ts";

/** Eingabe einer Gründung/Verlegung (Teilmenge von LaunchInput). */
export interface ExpansionInput {
  type: string;
  units: Counts;
  col: number;
  row: number;
  cargo?: ResourceMap;
  admiralId?: number;
}

export function isExpansionType(type: string): boolean {
  return type === FOUNDING_TYPE || type === TRANSFER_TYPE;
}

function fail(code: string): never {
  throw new GameError(code);
}

const TRADE_HEXES = TRADE_PORTS.map(([lon, lat]) => hexAtLonLat(lon, lat));

/** Laufende Gründungen des Spielers (ohne `exceptMissionId`). */
async function pendingFoundings(db: DbOrTx, playerId: number, exceptMissionId?: number): Promise<number> {
  const rows = await db.select({ id: tables.mission.id }).from(tables.mission).where(and(
    eq(tables.mission.playerId, playerId), eq(tables.mission.type, FOUNDING_TYPE), eq(tables.mission.status, "outbound"),
    ...(exceptMissionId !== undefined ? [ne(tables.mission.id, exceptMissionId)] : []),
  ));
  return rows.length;
}

/**
 * Grund gegen eine Gründung auf (col,row) oder null. Liest Häfen, Nester und Rohstofffelder (resource_field);
 * `units` fehlt bei der Ankunft (Kolonieschiff dann vom Aufrufer geprüft). Codes siehe game-core foundingBlocker, dazu no_base.
 */
export async function foundingCheck(db: DbOrTx, playerId: number, target: { col: number; row: number }, units?: Counts, exceptMissionId?: number): Promise<string | null> {
  const home = await homeBaseOf(db, playerId);
  if (!home) return "no_base";
  const bases = await db.select({ playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row }).from(tables.base);
  const nests = await db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest);
  const fields = await db.select({ col: tables.resourceField.col, row: tables.resourceField.row }).from(tables.resourceField);
  return foundingBlocker({
    target: { col: target.col, row: target.row },
    coast: isCoast(target.col, target.row),
    homeDistanceKm: hexDistanceKm(home, target),
    bases: bases.map((b) => ({ col: b.col, row: b.row, own: b.playerId === playerId })),
    nests, tradePorts: TRADE_HEXES, fields,
    homeState: home.state,
    ownBases: bases.filter((b) => b.playerId === playerId).length,
    pendingFoundings: await pendingFoundings(db, playerId, exceptMissionId),
    units,
  }, balance);
}

/** Ziel einer Verlegung: anderer eigener Hafen. Codes: transfer_needs_own_base, same_base, no_aircraft_slots. */
async function transferTarget(db: DbOrTx, playerId: number, own: BaseRow, input: ExpansionInput) {
  const [t] = await db.select().from(tables.base).where(and(eq(tables.base.col, input.col), eq(tables.base.row, input.row)));
  if (!t || t.playerId !== playerId) fail("transfer_needs_own_base");
  if (t.id === own.id) fail("same_base");
  const state = t.state as BaseRow["state"];
  const planes = Object.entries(input.units).reduce((s, [id, n]) => s + (balance.units[id]?.branch === "luft" && n > 0 ? n : 0), 0);
  if (planes > 0 && aircraftSlotsUsed(state, balance) + planes > aircraftSlots(state, balance)) fail("no_aircraft_slots");
  return t;
}

/** Prüfungen und Planung beider Arten; wirft GameError mit dem Ablehnungsgrund. */
async function planExpansion(db: DbOrTx, playerId: number, own: BaseRow, input: ExpansionInput, nowMs: number, admiralMods: Modifiers | null) {
  if (!expansionOf(balance)) fail("expansion_off");
  let targetId: number | null = null;
  if (input.type === FOUNDING_TYPE) {
    const blocker = await foundingCheck(db, playerId, input, input.units);
    if (blocker) fail(blocker);
  } else {
    targetId = (await transferTarget(db, playerId, own, input)).id;
  }
  const weather = missionWeather(own.col, own.row, input.col, input.row, nowMs);
  const r = planMission(own.state, {
    type: input.type, units: input.units, origin: hexCenter(own.col, own.row), target: hexCenter(input.col, input.row),
    activeMissions: await activeMissionCount(db, own.id), cargo: input.cargo, weather,
  }, nowMs, balance, combineModifiers(await modsOf(db, own, nowMs), admiralMods ?? undefined));
  return { r, targetId, weather };
}

/** Auslaufen einer Gründung/Verlegung aus dem gesperrten Hafen `own` (in runCommand). Codes zusätzlich: admiral_elsewhere. */
export async function launchExpansion(
  tx: Tx,
  playerId: number,
  own: BaseRow,
  input: ExpansionInput,
  nowMs: number,
  notify: Notes,
): Promise<{ ok: true; missionId: number; arriveAtMs: number } | { ok: false; code: string }> {
  const adm = input.admiralId !== undefined ? await admiralForLaunch(tx, playerId, input.admiralId, nowMs) : null;
  if (adm) {
    const [a] = await tx.select({ baseId: tables.admiral.baseId }).from(tables.admiral).where(eq(tables.admiral.id, adm.id));
    if (a.baseId !== own.id) fail("admiral_elsewhere");
  }
  const { r, targetId } = await planExpansion(tx, playerId, own, input, nowMs, adm?.mods ?? null);
  if (!r.ok) return r;
  await tx.update(tables.base).set({ state: r.base }).where(eq(tables.base.id, own.id));
  const plan = adm ? { ...r.mission, admiralId: adm.id } : r.mission;
  const [m] = await tx.insert(tables.mission).values({
    playerId, baseId: own.id, type: input.type, targetKind: targetId === null ? SITE_TARGET : OWN_BASE_TARGET, targetId,
    targetCol: input.col, targetRow: input.row, plan, status: "outbound", arriveAt: new Date(r.mission.arriveAtMs),
  }).returning({ id: tables.mission.id });
  // Verlegung: Ankunft am Zielhafen (wird vor Befehlen dieses Hafens verarbeitet); Gründung ohne Hafen.
  await scheduleEvent(tx, "mission_arrive", r.mission.arriveAtMs, { missionId: m.id }, targetId);
  if (adm) await assignAdmiral(tx, adm.id, m.id);
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId: m.id, arriveAtMs: r.mission.arriveAtMs };
}

/** Antwort der Vorschau (Form wie missionPreview). */
export type ExpansionPreview =
  | { ok: false; code: string; distanceKm: number; weather?: ReturnType<typeof missionWeather> }
  | {
    ok: true; distanceKm: number; travelSeconds: number; fuelCost: number; arriveAtMs: number; returnAtMs: number;
    target: { kind: string; own: boolean }; intercept: null; weather: ReturnType<typeof missionWeather>; weatherFactor: number;
    /** Häfen: eigene, laufende Gründungen, erlaubt (Kommandozentrale des Heimathafens), Höchstzahl. */
    expansion: { bases: number; pending: number; allowed: number; max: number };
  };

/** Vorschau einer Gründung/Verlegung mit Ablehnungsgrund (Code) wie launchExpansion. */
export async function previewExpansion(db: DbOrTx, playerId: number, own: BaseRow, input: ExpansionInput, nowMs: number): Promise<ExpansionPreview> {
  const distanceKm = hexDistanceKm(own, input);
  try {
    const { r, weather } = await planExpansion(db, playerId, own, input, nowMs, await admiralPreviewMods(db, playerId, input.admiralId));
    if (!r.ok) return { ok: false as const, code: r.code, distanceKm, weather };
    const home = await homeBaseOf(db, playerId);
    const e = expansionOf(balance)!;
    const bases = await db.select({ id: tables.base.id }).from(tables.base).where(eq(tables.base.playerId, playerId));
    const m = r.mission;
    return {
      ok: true as const, distanceKm: m.distanceKm, travelSeconds: m.travelSeconds, fuelCost: m.fuelCost, arriveAtMs: m.arriveAtMs,
      returnAtMs: m.returnAtMs, target: { kind: input.type === FOUNDING_TYPE ? SITE_TARGET : "base", own: input.type === TRANSFER_TYPE },
      intercept: null, weather: withArrival(weather, input.col, input.row, m.arriveAtMs, nowMs, own.state), weatherFactor: m.weather?.shipFactor ?? 1,
      expansion: { bases: bases.length, pending: await pendingFoundings(db, playerId), allowed: home ? allowedBases(home.state, balance) : 1, max: e.maxBases },
    };
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code, distanceKm };
    throw err;
  }
}
