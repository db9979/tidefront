// Lagebild Stufe 2 (5.4): Patrouille. Verband aus Korvetten, Zerstörern, U-Booten und/oder Aufklärungsdrohnen fährt
// zum ersten Wegpunkt, dann 4/8/12 h im Kreis über 2–4 Wegpunkte auf See (Status "holding"), danach von der aktuellen
// Position heim. Treibstoff: Hin- und Rückweg zum ersten Wegpunkt plus die Strecke auf Station. Sicht um die Position
// (intel-mobile.ts). Prüftakt patrol_tick: Abfangjäger fremder Häfen in deren Radarreichweite schießen Drohnen ab
// (15 % je Jäger, höchstens 75 %, einmal je Hafen); wer erfasst wird und die Patrouille selbst sieht, bekommt die
// Meldung „Fremde Patrouille gesichtet“.
import { eq, ne } from "drizzle-orm";
import {
  activeUnits, dronesShot, fuelCost, hasShipUnits, interceptChance, patrolCheck, patrolOf, patrolSightKm, slowestSpeedKmh, sonarKm,
  techLevel, type BaseState, type Counts, type Mission,
} from "@tidefront/game-core";
import { hexAtXY, hexCenterXY, hexDistanceKm, inGrid, loopRouteHexes, routePointsXY, seaRoute, terrainAt } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import { activeMissionCount, homeBaseOf, randomSeed, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { insertMission, planNaval, playerName, pushNotice, storeNavalReport, type MissionRowLike, type Notes } from "./naval-common.ts";
import { intelRules, partyOf, sensorsOfBase } from "./intel-sight.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { patrolAt, type PatrolPlan } from "./intel-route.ts";

export const PATROL_TYPE = "patrouille";
const HOUR_MS = 3600000;
const defs = () => balance.units as unknown as Record<string, { branch?: string; submerged?: boolean; attack?: { uboot?: number } }>;

export interface PatrolInput {
  units: Counts;
  waypoints: { col: number; row: number }[];
  hours: number;
}

/** Planung. Codes: patrol_off, patrol_units, patrol_waypoints, patrol_sea, patrol_hours, patrol_drone_hours, patrol_drone_range, fuel … */
export async function planPatrol(db: DbOrTx, playerId: number, own: BaseRow, input: PatrolInput, nowMs: number) {
  const pb = patrolOf(intelRules());
  if (!pb) throw new GameError("patrol_off");
  for (const w of input.waypoints) if (!inGrid(w.col, w.row) || terrainAt(w.col, w.row) !== "sea") throw new GameError("patrol_sea");
  const farthest = Math.max(0, ...input.waypoints.map((w) => hexDistanceKm(own, w)));
  const c = patrolCheck(input.units, input.hours, input.waypoints.length, farthest, defs(), pb);
  if (!c.ok) throw new GameError(c.code);
  const mods = await modsOf(db, own, nowMs);
  const first = input.waypoints[0];
  const r = planNaval(own, { type: PATROL_TYPE, baseType: "aufklaerung", units: input.units, col: first.col, row: first.row, activeMissions: await activeMissionCount(db, own.id), mods }, nowMs);
  if (!r.ok) return r;
  const speedKmh = slowestSpeedKmh(input.units, balance, mods) ?? 0;
  // Strecke auf Station: Fahrt über die ganze Dauer (Treibstoff wie eine normale Fahrt, eine Richtung).
  const extra = fuelCost(input.units, speedKmh * input.hours, balance, mods, 1);
  if ((r.base.resources.treibstoff ?? 0) < extra) return { ok: false as const, code: "fuel" };
  r.base.resources = { ...r.base.resources, treibstoff: (r.base.resources.treibstoff ?? 0) - extra };
  const home = own.isHome ? own : await homeBaseOf(db, playerId);
  const patrol: PatrolPlan = {
    waypoints: input.waypoints.map((w) => ({ col: w.col, row: w.row })), hours: input.hours, speedKmh,
    sightKm: patrolSightKm(input.units, defs(), pb),
    sonarKm: sonarKm(input.units, defs(), home ? techLevel(home.state, "sonar") : 0, intelRules()?.sonar, true),
    // Seewege: mit Schiffen fährt die Runde zwischen den Wegpunkten über Wasser (einmal hier gerechnet).
    ...(hasShipUnits(input.units, balance) ? { loop: loopRouteHexes(input.waypoints) } : {}),
  };
  const travel = r.mission.arriveAtMs - r.mission.departAtMs;
  const mission = { ...r.mission, fuelCost: r.mission.fuelCost + extra, returnAtMs: r.mission.arriveAtMs + input.hours * HOUR_MS + travel, patrol };
  return { ok: true as const, base: r.base, mission, extraFuel: extra };
}

export async function launchPatrol(tx: Tx, playerId: number, own: BaseRow, input: PatrolInput, nowMs: number, notify: Notes) {
  const r = await planPatrol(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const first = input.waypoints[0];
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "patrol", targetId: null, col: first.col, row: first.row, plan: r.mission });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

/** Ankunft am ersten Wegpunkt: Station beginnt. */
export async function patrolArrive(tx: Tx, m: MissionRowLike, plan: Mission & { patrol: PatrolPlan }, due: number, notify: Notes): Promise<void> {
  const endMs = due + plan.patrol.hours * HOUR_MS;
  const travel = Math.max(0, plan.arriveAtMs - plan.departAtMs);
  const next = { ...plan, patrol: { ...plan.patrol, startMs: due, endMs } };
  await tx.update(tables.mission).set({ status: "holding", plan: next, returning: activeUnits(plan.units), returnAt: new Date(endMs + travel) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "patrol_tick", due, { missionId: m.id }, null);
  await scheduleEvent(tx, "patrol_end", endMs, { missionId: m.id }, null);
  notify.push([[m.playerId!], "missions"]);
}

/** Station beenden (Ablauf oder Heimruf): Heimfahrt von der aktuellen Position. */
export async function endPatrolAt(tx: Tx, missionId: number, due: number): Promise<number | null> {
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  if (!m || m.status !== "holding" || m.type !== PATROL_TYPE || m.baseId === null) return null;
  const plan = m.plan as Mission & { patrol: PatrolPlan };
  const [b] = await tx.select({ col: tables.base.col, row: tables.base.row }).from(tables.base).where(eq(tables.base.id, m.baseId));
  const pos = patrolAt(plan.patrol, due).at;
  const home = b ? hexCenterXY(b.col, b.row) : pos;
  // Seewege: Schiffe fahren von der aktuellen Position über die Route heim (Linienzug ab der Position).
  let homePath: { x: number; y: number }[] | undefined;
  if (b && hasShipUnits(plan.units, balance)) {
    const h = hexAtXY(pos.x, pos.y);
    const pts = routePointsXY(seaRoute(h, { col: b.col, row: b.row }));
    homePath = [pos, ...pts.slice(1)];
  }
  const pathKm = homePath ? homePath.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - homePath![i].x, p.y - homePath![i].y), 0) : Math.hypot(home.x - pos.x, home.y - pos.y);
  const hours = plan.patrol.speedKmh > 0 ? pathKm / plan.patrol.speedKmh : 0;
  const returnAt = due + Math.ceil(hours * HOUR_MS);
  const next = { ...plan, patrol: { ...plan.patrol, endMs: due, endAt: pos, ...(homePath ? { homePath } : {}) } };
  await tx.update(tables.mission).set({ status: "returning", plan: next, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  return returnAt;
}

export async function patrolEnd(tx: Tx, payload: Record<string, unknown>, due: number) {
  const [m] = await tx.select({ playerId: tables.mission.playerId }).from(tables.mission).where(eq(tables.mission.id, Number(payload.missionId)));
  const at = await endPatrolAt(tx, Number(payload.missionId), due);
  return { notify: at !== null && m?.playerId ? [[[m.playerId], "missions"]] as [number[], "missions"][] : [] };
}

/** Prüftakt auf Station: Abfangen von Drohnen, Meldung „Fremde Patrouille gesichtet“. */
export async function patrolTick(tx: Tx, payload: Record<string, unknown>, due: number) {
  const pb = patrolOf(intelRules());
  const ib = intelRules();
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(payload.missionId))).for("update");
  if (!m || m.status !== "holding" || m.type !== PATROL_TYPE || !pb || !ib || m.playerId === null) return { notify: [] };
  const plan = m.plan as Mission & { patrol: PatrolPlan };
  const p = { ...plan.patrol, interceptedBy: [...(plan.patrol.interceptedBy ?? [])], seenBy: [...(plan.patrol.seenBy ?? [])] };
  const pos = patrolAt(p, due).at;
  let units = activeUnits((m.returning as Counts | null) ?? plan.units);
  const { members } = await partyOf(tx, m.playerId);
  const owner = await playerName(tx, m.playerId);
  const push: NoticeJob[] = [];
  const notify: [number[] | null, "missions" | "reports" | "map"][] = [];
  const bases = await tx.select().from(tables.base).where(ne(tables.base.playerId, m.playerId));
  for (const b of bases) {
    if (members.includes(b.playerId)) continue;
    const sensors = sensorsOfBase({ ...b, state: b.state as BaseState }, due, ib);
    const inside = (kind?: string) => sensors.some((s) => (!kind || s.kind === kind) && (s.x - pos.x) ** 2 + (s.y - pos.y) ** 2 <= s.km * s.km);
    const c = hexCenterXY(b.col, b.row);
    const seesBase = Math.hypot(c.x - pos.x, c.y - pos.y) <= p.sightKm;
    // Meldung: Patrouille erfasst den Hafen und liegt selbst in seiner Sicht (einmal je Spieler und Patrouille).
    if (seesBase && inside() && !p.seenBy.includes(b.playerId)) {
      p.seenBy.push(b.playerId);
      await storeNavalReport(tx, {
        kind: "sichtung", title: `Fremde Patrouille gesichtet bei ${b.name}`, attackerPlayerId: null, defenderPlayerId: b.playerId, defenderBaseId: b.id,
        report: { sighting: { owner, col: m.targetCol, row: m.targetRow, at: pos, baseName: b.name } }, atMs: due,
      });
      push.push(pushNotice(b.playerId, "attack", "Fremde Patrouille gesichtet", `${owner} patrouilliert vor ${b.name}.`, "karte"));
      notify.push([[b.playerId], "reports"]);
    }
    // Abfangen: Drohnen in der Radarreichweite eines feindlichen Hafens mit Abfangjägern (einmal je Hafen).
    const drones = units.aufklaerungsdrohne ?? 0;
    const fighters = (b.state as BaseState).units.abfangjaeger ?? 0;
    if (drones > 0 && fighters > 0 && inside("radar") && !p.interceptedBy.includes(b.id) && (await diplomacyBlock(tx, m.playerId, b.playerId, due)) === null) {
      p.interceptedBy.push(b.id);
      const shot = dronesShot(drones, interceptChance(fighters, pb), randomSeed());
      if (shot > 0) {
        units = activeUnits({ ...units, aufklaerungsdrohne: drones - shot });
        p.shot = (p.shot ?? 0) + shot;
        await storeNavalReport(tx, {
          kind: "patrouille", title: `${shot} Drohne${shot === 1 ? "" : "n"} vor ${b.name} abgeschossen`, attackerPlayerId: m.playerId, defenderPlayerId: b.playerId,
          attackerBaseId: m.baseId, defenderBaseId: b.id,
          report: { intercept: { shot, drones, fighters, chance: interceptChance(fighters, pb), baseName: b.name, owner } }, atMs: due,
        });
        push.push(pushNotice(m.playerId, "report", "Drohnen abgeschossen", `${shot} von ${drones} Drohnen vor ${b.name} verloren.`, "berichte"));
        push.push(pushNotice(b.playerId, "report", "Drohne abgefangen", `Abfangjäger aus ${b.name} haben ${shot} Drohne${shot === 1 ? "" : "n"} von ${owner} abgeschossen.`, "berichte"));
        notify.push([[m.playerId, b.playerId], "reports"]);
      }
    }
  }
  p.sightKm = patrolSightKm(units, defs(), pb);
  if (!activeUnits(units) || Object.keys(units).length === 0) {
    // Alles abgeschossen: die Mission endet sofort (nichts kehrt heim).
    await tx.update(tables.mission).set({ status: "returning", plan: { ...plan, patrol: { ...p, endMs: due, endAt: pos } }, returning: {}, returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
    await scheduleEvent(tx, "mission_return", due, { missionId: m.id }, m.baseId);
  } else {
    await tx.update(tables.mission).set({ plan: { ...plan, patrol: p }, returning: units }).where(eq(tables.mission.id, m.id));
    const next = due + pb.tickMinutes * 60000;
    if (next < (p.endMs ?? 0)) await scheduleEvent(tx, "patrol_tick", next, { missionId: m.id }, null);
  }
  notify.push([[m.playerId], "missions"], [null, "map"]);
  return { notify, push };
}
