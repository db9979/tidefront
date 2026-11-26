// Allianz-Ops: Stationierung. Truppen (Schiffe, Land, Flug; keine Spione) verteidigen den Hafen eines Verbündeten
// (gleiche Allianz) mit. Eine Stationierung ist eine Mission (Typ "stationierung"): auf der Hinfahrt "outbound",
// am Ziel "stationed" (mission.returning = aktueller Bestand), heim über den normalen mission_return. Die Einheiten
// bleiben in unitsAway des Besitzers – der Unterhalt läuft dort weiter. Verluste trägt der Besitzer.
// Eingehängt über markierte Eingriffe in commands.ts (launchMission), views.ts (missionPreview, baseView) und
// handlers.ts (missionArrive, Verteidigung).
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  activeUnits,
  allianceOpsOf,
  planMission,
  recallMission,
  settle,
  splitOutcome,
  type BattleReport,
  type Counts,
  type DefenderInput,
  type Mission,
} from "@tidefront/game-core";
import { hexCenter, hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type ChangeKind, type Engine } from "./context.ts";
import { activeMissionCount, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { missionWeather, withArrival } from "./weather.ts";
import { modsOf } from "./modifiers.ts";
import { membershipOf, systemMessage, type Notes } from "./alliance-core.ts";
import { runCommand } from "./commands.ts";
import type { HandlerResult } from "./events.ts";

export const STATION_TYPE = "stationierung";
type Notify = [number[] | null, ChangeKind][];

interface MissionRow {
  id: number;
  playerId: number | null;
  baseId: number | null;
  targetId: number | null;
  status: string;
  plan: unknown;
  returning?: unknown;
}

export async function sameAlliance(db: DbOrTx, a: number, b: number): Promise<boolean> {
  const x = await membershipOf(db, a);
  if (!x) return false;
  const y = await membershipOf(db, b);
  return !!y && x.allianceId === y.allianceId;
}

/** Stationierte und anfahrende fremde Verbände an einem Hafen (eigene des Gastgebers zählen nicht). */
async function hostLoad(db: DbOrTx, baseId: number, hostPlayerId: number): Promise<number> {
  const rows = await db
    .select({ id: tables.mission.id })
    .from(tables.mission)
    .where(and(
      eq(tables.mission.type, STATION_TYPE), eq(tables.mission.targetId, baseId), inArray(tables.mission.status, ["outbound", "stationed"]),
      ne(tables.mission.playerId, hostPlayerId),
    ));
  return rows.length;
}

/**
 * Gastgeber prüfen. Mehrere Häfen: ein anderer eigener Hafen ist erlaubt (ohne Allianzprüfung und Liegeplatzgrenze),
 * nur der Ausgangshafen selbst nicht. Codes: no_target, own_base, station_not_ally, station_full.
 */
async function hostAt(db: DbOrTx, playerId: number, originId: number, col: number, row: number) {
  const [h] = await db.select().from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  if (!h) throw new GameError("no_target");
  if (h.id === originId) throw new GameError("own_base");
  if (h.playerId === playerId) return h;
  if (!(await sameAlliance(db, playerId, h.playerId))) throw new GameError("station_not_ally");
  if ((await hostLoad(db, h.id, h.playerId)) >= allianceOpsOf(balance).station.maxPerBase) throw new GameError("station_full");
  return h;
}

/** Planung wie ein Transport ohne Ladung (Treibstoff hin und zurück), danach als Stationierung geführt. */
async function planStation(db: DbOrTx, own: BaseRow, units: Counts, host: { col: number; row: number }, nowMs: number) {
  const mods = await modsOf(db, own, nowMs);
  const r = planMission(
    own.state,
    {
      type: "transport", units, origin: hexCenter(own.col, own.row), target: hexCenter(host.col, host.row),
      activeMissions: await activeMissionCount(db, own.id), weather: missionWeather(own.col, own.row, host.col, host.row, nowMs),
    },
    nowMs,
    balance,
    mods,
  );
  if (r.ok) r.mission = { ...r.mission, type: STATION_TYPE as Mission["type"] };
  return r;
}

/** missionPreview mit type "stationierung". */
export async function stationPreview(db: DbOrTx, playerId: number, own: BaseRow, input: { units: Counts; col: number; row: number }, nowMs: number) {
  const distanceKm = hexDistanceKm(own, input);
  let ownHost = false;
  try {
    ownHost = (await hostAt(db, playerId, own.id, input.col, input.row)).playerId === playerId;
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code, distanceKm };
    throw err;
  }
  const mods = await modsOf(db, own, nowMs);
  const weather = missionWeather(own.col, own.row, input.col, input.row, nowMs);
  const r = await planStation(db, { ...own, state: settle(own.state, nowMs, balance, mods) }, input.units, input, nowMs);
  if (!r.ok) return { ok: false as const, code: r.code, distanceKm, weather };
  return {
    ok: true as const, distanceKm, travelSeconds: r.mission.travelSeconds, fuelCost: r.mission.fuelCost, arriveAtMs: r.mission.arriveAtMs,
    returnAtMs: r.mission.returnAtMs, target: { kind: "base", own: ownHost }, intercept: null, weather: withArrival(weather, input.col, input.row, r.mission.arriveAtMs), weatherFactor: r.mission.weather?.shipFactor ?? 1,
  };
}

/** launchMission mit type "stationierung" (Stützpunkt bereits gesperrt). */
export async function stationLaunch(tx: Tx, playerId: number, own: BaseRow, input: { units: Counts; col: number; row: number }, nowMs: number, notify: Notify) {
  const host = await hostAt(tx, playerId, own.id, input.col, input.row);
  const r = await planStation(tx, own, input.units, host, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId, baseId: own.id, type: STATION_TYPE, targetKind: "base", targetId: host.id, targetCol: host.col, targetRow: host.row,
      plan: r.mission, status: "outbound", arriveAt: new Date(r.mission.arriveAtMs),
    })
    .returning({ id: tables.mission.id });
  await scheduleEvent(tx, "mission_arrive", r.mission.arriveAtMs, { missionId: m.id }, host.id);
  notify.push([[playerId], "base"], [[playerId], "missions"], [[host.playerId], "base"]);
  return { ok: true as const, missionId: m.id, arriveAtMs: r.mission.arriveAtMs };
}

async function nameOf(db: DbOrTx, playerId: number | null): Promise<string> {
  if (playerId === null) return "?";
  const [p] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
  return p?.name ?? "?";
}

/** Heimfahrt eines stationierten (oder noch anfahrenden) Verbands; Rückkehr nach einer Reisezeit bzw. Rückruf. */
async function sendHome(tx: Tx, m: MissionRow, nowMs: number): Promise<number> {
  const plan = m.plan as Mission;
  let returnAt: number;
  let next = plan;
  if (m.status === "outbound") {
    const r = recallMission(plan, nowMs);
    returnAt = r.ok ? r.returnAtMs : nowMs;
    if (r.ok) next = r.mission;
  } else {
    returnAt = nowMs + Math.max(0, plan.arriveAtMs - plan.departAtMs);
  }
  const returning = m.status === "outbound" ? { ...plan.units } : ((m.returning as Counts | null) ?? {});
  await tx.update(tables.mission).set({ status: "returning", plan: next, returning, cargoHome: {}, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  return returnAt;
}

/** mission_arrive einer Stationierung: Verbündeter? Platz frei? Sonst kehrt der Verband um. */
export async function stationArrive(tx: Tx, m: MissionRow, due: number): Promise<HandlerResult> {
  const [host] = m.targetId !== null ? await tx.select().from(tables.base).where(eq(tables.base.id, m.targetId)) : [];
  const plan = m.plan as Mission;
  const owner = m.playerId!;
  const ownHost = !!host && host.playerId === owner; // eigener Hafen: immer erlaubt
  const ok = !!host && (ownHost || ((await sameAlliance(tx, owner, host.playerId)) && (await hostLoad(tx, host.id, host.playerId)) <= allianceOpsOf(balance).station.maxPerBase));
  const notes: Notes = [];
  if (!ok) {
    const returnAt = due + Math.max(0, plan.arriveAtMs - plan.departAtMs);
    await tx.update(tables.mission).set({ status: "returning", returning: { ...plan.units }, cargoHome: {}, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
    await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
    await systemMessage(tx, notes, [owner], "Stationierung abgewiesen", `Dein Verband konnte ${host ? `in ${host.name}` : "am Ziel"} nicht stationieren (kein Verbündeter mehr oder kein Liegeplatz frei) und kehrt um.`);
    return { notify: [...notes, [[owner], "missions"]] };
  }
  await tx.update(tables.mission).set({ status: "stationed", returning: { ...plan.units } }).where(eq(tables.mission.id, m.id));
  if (ownHost) {
    await systemMessage(tx, notes, [owner], "Stationierung angekommen", `Dein Verband liegt jetzt in ${host.name} und verteidigt dort mit, bis du ihn zurückrufst.`);
    return { notify: [...notes, [[owner], "missions"], [[owner], "base"]] };
  }
  const ownerName = await nameOf(tx, owner);
  await systemMessage(tx, notes, [owner], "Stationierung angekommen", `Dein Verband liegt jetzt in ${host.name} und verteidigt dort mit, bis du ihn zurückrufst.`);
  await systemMessage(tx, notes, [host.playerId], "Verbündete Truppen eingetroffen", `${ownerName} hat Truppen in deinem Hafen stationiert. Sie verteidigen mit; du kannst sie jederzeit heimschicken.`);
  return { notify: [...notes, [[owner], "missions"], [[host.playerId], "base"]], push: [
    { playerId: host.playerId, notice: { kind: "fleet", title: "Verbündete Truppen eingetroffen", body: `${ownerName} verteidigt ${host.name} mit.`, url: "/?tab=basis", tag: `station-${m.id}` } },
  ] };
}

/** Rückruf durch den Besitzer oder Heimschicken durch den Gastgeber. Codes: no_mission, not_stationed. */
export function stationRelease(engine: Engine, playerId: number, key: string, missionId: number, _baseId?: number) { // Besitz über Mission/Gastgeber
  return runCommand<{ ok: true; returnAtMs: number }>(engine, playerId, key, "stationRelease", async (ctx) => {
    const [m] = await ctx.tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
    if (!m || m.type !== STATION_TYPE) throw new GameError("no_mission");
    const [host] = m.targetId !== null ? await ctx.tx.select().from(tables.base).where(eq(tables.base.id, m.targetId)) : [];
    if (m.playerId !== playerId && host?.playerId !== playerId) throw new GameError("no_mission");
    if (m.status !== "stationed" && !(m.status === "outbound" && m.playerId === playerId)) throw new GameError("not_stationed");
    const returnAtMs = await sendHome(ctx.tx, m, ctx.nowMs);
    if (m.playerId !== playerId && host?.playerId === playerId) {
      await systemMessage(ctx.tx, ctx.notify, [m.playerId!], "Stationierung beendet", `${host?.name ?? "Der Gastgeber"} hat deine Truppen heimgeschickt.`);
    }
    ctx.notify.push([[m.playerId!], "missions"], [[m.playerId!], "base"]);
    if (host) ctx.notify.push([[host.playerId], "base"]);
    return { ok: true as const, returnAtMs };
  });
}

// ---------------------------------------------------------------- Verteidigung

export interface Guest {
  missionId: number;
  playerId: number;
  baseId: number | null;
  units: Counts;
}

/** Stationierte Verbände an einem Hafen (Missionen gesperrt), in fester Reihenfolge. */
export async function stationedGuests(tx: Tx, baseId: number): Promise<Guest[]> {
  const rows = await tx
    .select()
    .from(tables.mission)
    .where(and(eq(tables.mission.type, STATION_TYPE), eq(tables.mission.targetId, baseId), eq(tables.mission.status, "stationed")))
    .orderBy(tables.mission.id)
    .for("update");
  return rows.map((r) => ({ missionId: r.id, playerId: r.playerId!, baseId: r.baseId, units: activeUnits((r.returning as Counts | null) ?? {}) }));
}

/** Verteidiger mit den stationierten Einheiten (sie kämpfen unter den Modifikatoren des Gastgebers). */
export function withGuests(defender: DefenderInput, guests: Guest[]): DefenderInput {
  if (guests.length === 0) return defender;
  const units: Counts = { ...defender.units };
  for (const g of guests) for (const [id, n] of Object.entries(g.units)) units[id] = (units[id] ?? 0) + n;
  return { ...defender, units };
}

/**
 * Nach dem Kampf: Verteidiger-Ergebnis nach Besitzern trennen. Die Gäste-Missionen erhalten ihren Endbestand
 * (ganz vernichtet: Abschluss über mission_return); zurück kommt der Bericht nur mit dem Anteil des Gastgebers
 * (für applyDefenseResult). `report.guests` im gespeicherten Bericht nennt die Verluste je Gast.
 */
export async function settleGuests(tx: Tx, guests: Guest[], defender: DefenderInput, report: BattleReport, due: number, notify?: Notify): Promise<BattleReport & { guests?: unknown[] }> {
  if (guests.length === 0) return report;
  const host: Counts = { ...defender.units, ...defender.defenses };
  const parts = splitOutcome(report.defender, [host, ...guests.map((g) => g.units)]);
  const list: unknown[] = [];
  for (let i = 0; i < guests.length; i++) {
    const g = guests[i];
    const o = parts[i + 1];
    const left = activeUnits(o.final);
    if (Object.keys(left).length === 0) {
      await tx.update(tables.mission).set({ status: "returning", returning: {}, cargoHome: {}, returnAt: new Date(due) }).where(eq(tables.mission.id, g.missionId));
      await scheduleEvent(tx, "mission_return", due, { missionId: g.missionId }, g.baseId);
    } else {
      await tx.update(tables.mission).set({ returning: left }).where(eq(tables.mission.id, g.missionId));
    }
    list.push({ playerId: g.playerId, name: await nameOf(tx, g.playerId), before: o.before, losses: o.losses, final: o.final });
    notify?.push([[g.playerId], "missions"], [[g.playerId], "reports"]);
  }
  return { ...report, defender: parts[0], guests: list };
}

// ---------------------------------------------------------------- Anzeige und Allianzaustritt

/** Gastgeber: fremde Verbände im eigenen Hafen (stationiert oder anfahrend). */
export async function stationedView(db: DbOrTx, baseId: number) {
  const rows = await db
    .select({ id: tables.mission.id, status: tables.mission.status, playerId: tables.mission.playerId, plan: tables.mission.plan, returning: tables.mission.returning, arriveAt: tables.mission.arriveAt, owner: tables.player.name })
    .from(tables.mission)
    .innerJoin(tables.player, eq(tables.player.id, tables.mission.playerId))
    .where(and(eq(tables.mission.type, STATION_TYPE), eq(tables.mission.targetId, baseId), inArray(tables.mission.status, ["outbound", "stationed"])))
    .orderBy(tables.mission.id);
  return {
    max: allianceOpsOf(balance).station.maxPerBase,
    guests: rows.map((r) => ({
      missionId: r.id, owner: r.owner, status: r.status, arriveAtMs: r.arriveAt.getTime(),
      units: r.status === "stationed" ? ((r.returning as Counts | null) ?? {}) : (r.plan as Mission).units,
    })),
  };
}

/**
 * Nach Austritt, Ausschluss oder Auflösung: Stationierungen, bei denen Besitzer und Gastgeber nicht mehr derselben
 * Allianz angehören, fahren heim (beide Richtungen: eigene Truppen bei anderen, fremde Truppen im eigenen Hafen).
 */
export async function stationsAfterExit(tx: Tx, notes: Notes, playerIds: number[], nowMs: number): Promise<void> {
  if (playerIds.length === 0) return;
  const bases = await tx.select({ id: tables.base.id }).from(tables.base).where(inArray(tables.base.playerId, playerIds));
  const rows = await tx
    .select()
    .from(tables.mission)
    .where(and(eq(tables.mission.type, STATION_TYPE), inArray(tables.mission.status, ["outbound", "stationed"])))
    .for("update");
  const hostIds = new Set(bases.map((b) => b.id));
  for (const m of rows) {
    if (!playerIds.includes(m.playerId!) && !hostIds.has(m.targetId!)) continue;
    const [host] = await tx.select({ playerId: tables.base.playerId, name: tables.base.name }).from(tables.base).where(eq(tables.base.id, m.targetId!));
    if (host && (host.playerId === m.playerId || (await sameAlliance(tx, m.playerId!, host.playerId)))) continue; // eigener Hafen bleibt
    await sendHome(tx, m, nowMs);
    await systemMessage(tx, notes, [m.playerId!], "Stationierung beendet", `Ihr gehört nicht mehr derselben Allianz an: deine Truppen ${host ? `in ${host.name} ` : ""}fahren heim.`);
    notes.push([[m.playerId!], "missions"], [[m.playerId!], "base"]);
    if (host) notes.push([[host.playerId], "base"]);
  }
}
