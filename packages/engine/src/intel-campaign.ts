// Lagebild Stufe 2 (5.5): Aufklärungskampagne. Mission „aufklaerung“ mit bis zu 4 Zielen (Häfen, Nester, Felder)
// nacheinander. Jede Ankunft läuft wie eine einzelne Aufklärung (handlers.ts missionArrive bzw. fields-missions.ts)
// und schreibt ein Lagebild; danach fährt der Verband zum nächsten Ziel (campaignContinue), nach dem letzten heim.
// Unterwegs Erkennung in revealKm um die Position (intel-mobile.ts). Wer am Ziel erkannt wird (Radar), bekommt die
// Meldung „Aufklärer gesichtet“ (scoutSighted).
import { and, eq, sql } from "drizzle-orm";
import {
  activeUnits, campaignCheck, campaignOf, fuelCost, hasShipUnits, travelSeconds, validateFleet,
  type BaseState, type Counts, type Mission,
} from "@tidefront/game-core";
import { hexDistanceKm, seaRoute, seaRouteCopy, type Hex } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import { activeMissionCount, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { insertMission, planNaval, playerName, pushNotice, storeNavalReport, type Notes } from "./naval-common.ts";
import { intelRules, partyOf, sensorsOfBase } from "./intel-sight.ts";
import type { CampaignPlan } from "./intel-route.ts";

export interface CampaignInput {
  units: Counts;
  targets: { col: number; row: number }[];
}

type Target = CampaignPlan["targets"][number];

/** Seewege: Abschnittslänge mit Schiffen über Wasser, sonst Luftlinie. */
function legKm(units: Counts, a: Hex, b: Hex): number {
  return hasShipUnits(units, balance) ? Math.max(hexDistanceKm(a, b), seaRoute(a, b).km) : hexDistanceKm(a, b);
}

/** Ziel auf einem Feld: fremder Hafen, Nest oder Rohstofffeld. Codes: no_target, own_base. */
async function resolveTarget(db: DbOrTx, playerId: number, t: { col: number; row: number }): Promise<Target> {
  const [b] = await db.select().from(tables.base).where(and(eq(tables.base.col, t.col), eq(tables.base.row, t.row)));
  if (b) {
    if (b.playerId === playerId) throw new GameError("own_base");
    return { kind: "base", id: b.id, col: b.col, row: b.row };
  }
  const [n] = await db.select().from(tables.nest).where(and(eq(tables.nest.col, t.col), eq(tables.nest.row, t.row)));
  if (n) return { kind: "nest", id: n.id, col: n.col, row: n.row };
  const [f] = await db.select().from(tables.resourceField).where(and(eq(tables.resourceField.col, t.col), eq(tables.resourceField.row, t.row)));
  if (f) return { kind: "field", id: f.id, col: f.col, row: f.row, fieldId: f.id };
  throw new GameError("no_target");
}

/** Planung: Ziele, Verband (Luft: jedes Ziel in Reichweite), Fahrt über alle Abschnitte, Treibstoff für die ganze Runde. */
export async function planCampaign(db: DbOrTx, playerId: number, own: BaseRow, input: CampaignInput, nowMs: number) {
  const c = campaignCheck(input.targets, campaignOf(intelRules()));
  if (!c.ok) throw new GameError(c.code);
  const targets: Target[] = [];
  for (const t of input.targets) targets.push(await resolveTarget(db, playerId, t));
  const mods = await modsOf(db, own, nowMs);
  for (const t of targets) {
    const v = validateFleet(own.state, input.units, hexDistanceKm(own, t), balance, mods);
    if (!v.ok) return v;
  }
  const first = targets[0];
  const r = planNaval(own, { type: "aufklaerung", baseType: "aufklaerung", units: input.units, col: first.col, row: first.row, activeMissions: await activeMissionCount(db, own.id), mods }, nowMs);
  if (!r.ok) return r;
  // Weitere Abschnitte und die Heimfahrt vom letzten Ziel statt vom ersten.
  const factor = r.mission.weather?.shipFactor ?? 1;
  const legSec = (km: number) => (travelSeconds(input.units, km, balance, mods) ?? 0) * factor;
  let extraKm = 0;
  let at = r.mission.arriveAtMs;
  for (let i = 1; i < targets.length; i++) {
    const km = legKm(input.units, targets[i - 1], targets[i]);
    extraKm += km;
    at += Math.ceil(legSec(km) * 1000);
  }
  const homeKm = legKm(input.units, targets[targets.length - 1], own);
  extraKm += homeKm - legKm(input.units, first, own);
  const extra = Math.max(0, fuelCost(input.units, extraKm, balance, mods, 1));
  if ((r.base.resources.treibstoff ?? 0) < extra) return { ok: false as const, code: "fuel" };
  r.base.resources = { ...r.base.resources, treibstoff: (r.base.resources.treibstoff ?? 0) - extra };
  const campaign: CampaignPlan = { targets, index: 0, legFrom: { col: own.col, row: own.row }, legDepartMs: nowMs };
  const mission = { ...r.mission, fuelCost: r.mission.fuelCost + extra, returnAtMs: at + Math.ceil(legSec(homeKm) * 1000), campaign };
  return { ok: true as const, base: r.base, mission, targets, lastArriveAtMs: at };
}

export async function launchCampaign(tx: Tx, playerId: number, own: BaseRow, input: CampaignInput, nowMs: number, notify: Notes) {
  const r = await planCampaign(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const t = r.targets[0];
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: t.kind, targetId: t.id, col: t.col, row: t.row, plan: r.mission });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

/**
 * Nach der Ankunft an einem Ziel (die Aufklärung ist gelaufen, die Mission steht auf "returning"): weiter zum nächsten
 * Ziel, solange Einheiten übrig sind. Die schon geplante Rückkehr wird gestrichen.
 */
export async function campaignContinue(tx: Tx, missionId: number, due: number): Promise<boolean> {
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  if (!m || m.status !== "returning" || m.type !== "aufklaerung" || m.baseId === null) return false;
  const plan = m.plan as Mission & { campaign?: CampaignPlan };
  const c = plan.campaign;
  if (!c || c.index + 1 >= c.targets.length) return false;
  const units = activeUnits((m.returning as Counts | null) ?? plan.units);
  if (Object.keys(units).length === 0) return false;
  const [home] = await tx.select({ col: tables.base.col, row: tables.base.row }).from(tables.base).where(eq(tables.base.id, m.baseId));
  if (!home) return false;
  const cur = c.targets[c.index];
  const next = c.targets[c.index + 1];
  const factor = plan.weather?.shipFactor ?? 1;
  const sec = (km: number) => (travelSeconds(units, km, balance) ?? 0) * factor;
  const arrive = due + Math.ceil(sec(legKm(units, cur, next)) * 1000);
  const back = sec(legKm(units, next, home));
  // Seewege: Route des aktuellen Abschnitts und des Heimwegs vom neuen Ziel (intel-route.ts fleetPosition).
  const ships = hasShipUnits(units, balance);
  const nextPlan = {
    ...plan, arriveAtMs: arrive, returnAtMs: arrive + Math.ceil(back * 1000), travelSeconds: back,
    ...(ships ? { route: seaRouteCopy(seaRoute(cur, next)), homeRoute: seaRouteCopy(seaRoute(next, home)) } : {}),
    campaign: { ...c, index: c.index + 1, legFrom: { col: cur.col, row: cur.row }, legDepartMs: due },
  };
  await tx.execute(sql`delete from game_event where type = 'mission_return' and status = 'pending' and payload->>'missionId' = ${String(m.id)}`);
  await tx.update(tables.mission).set({
    status: "outbound", plan: nextPlan, targetKind: next.kind, targetId: next.id, targetCol: next.col, targetRow: next.row,
    arriveAt: new Date(arrive), returnAt: null,
  }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_arrive", arrive, { missionId: m.id }, next.kind === "base" ? next.id : null);
  return true;
}

/** Aufklärer am Hafen angekommen: hat der Hafen Radar, bekommt der Besitzer die Meldung „Aufklärer gesichtet“. */
export async function scoutSighted(tx: Tx, m: { playerId: number | null; baseId: number | null; targetKind: string; targetId: number | null }, due: number, push: NoticeJob[]): Promise<void> {
  const ib = intelRules();
  if (!ib || m.targetKind !== "base" || m.targetId === null || m.playerId === null) return;
  const [b] = await tx.select().from(tables.base).where(eq(tables.base.id, m.targetId));
  if (!b || b.playerId === m.playerId) return;
  if ((await partyOf(tx, m.playerId)).members.includes(b.playerId)) return;
  if (!sensorsOfBase({ ...b, state: b.state as BaseState }, due, ib).some((s) => s.kind === "radar")) return;
  const who = await playerName(tx, m.playerId);
  await storeNavalReport(tx, {
    kind: "sichtung", title: `Aufklärer gesichtet bei ${b.name}`, attackerPlayerId: null, defenderPlayerId: b.playerId, defenderBaseId: b.id,
    report: { sighting: { owner: who, scout: true, baseName: b.name } }, atMs: due,
  });
  push.push(pushNotice(b.playerId, "attack", "Aufklärer gesichtet", `${who} hat ${b.name} aufgeklärt.`, "berichte"));
}
