// Lagebild: Position eines Verbands auf See – die reine Rechnung liegt in packages/game-core/src/route-position.ts
// (gemeinsam mit der Karte im Browser); hier die Sicht der Missionsliste (baseView).
import { fleetSightKm, type RoutedPlan } from "@tidefront/game-core";
import { balance } from "./context.ts";

export { alongPath, fleetPosition, patrolAt, patrolPoints, type CampaignPlan, type PatrolPlan, type RoutedPlan } from "@tidefront/game-core";
export type XY = { x: number; y: number };

/** Für die Missionsliste (baseView): Patrouille (Wegpunkte, Station, Fahrt), Kampagne (Ziele), Seeweg (Route, Rückruf). */
export function intelMissionInfo(plan: unknown): {
  sightKm: number;
  patrol: { waypoints: { col: number; row: number }[]; hours: number; startMs: number | null; endMs: number | null; speedKmh: number; sightKm: number; shot: number; loop: [number, number][] | null; homePath: XY[] | null; endAt: XY | null } | null;
  campaign: { targets: { col: number; row: number; kind: string }[]; index: number; legFrom: { col: number; row: number }; legDepartMs: number } | null;
  route: { hexes: [number, number][]; km: number; partial: boolean } | null;
  homeRoute: { hexes: [number, number][]; km: number } | null;
  recalledAtMs: number | null;
  travelSeconds: number | null;
} {
  const rp = plan as RoutedPlan;
  const p = rp.patrol;
  const c = rp.campaign;
  const units = (rp.units ?? {}) as Record<string, number>;
  return {
    sightKm: p ? p.sightKm : fleetSightKm(units, balance.units as never, balance.intel?.fleetSight).recognizeKm,
    patrol: p ? {
      waypoints: p.waypoints, hours: p.hours, startMs: p.startMs ?? null, endMs: p.endMs ?? null, speedKmh: p.speedKmh, sightKm: p.sightKm, shot: p.shot ?? 0,
      loop: p.loop ?? null, homePath: p.homePath ?? null, endAt: p.endAt ?? null,
    } : null,
    campaign: c ? { targets: c.targets.map((t) => ({ col: t.col, row: t.row, kind: t.kind })), index: c.index, legFrom: c.legFrom, legDepartMs: c.legDepartMs } : null,
    route: rp.route ? { hexes: rp.route.hexes, km: rp.route.km, partial: rp.route.partial === true } : null,
    homeRoute: rp.homeRoute ? { hexes: rp.homeRoute.hexes, km: rp.homeRoute.km } : null,
    recalledAtMs: rp.recalledAtMs ?? null,
    travelSeconds: rp.travelSeconds ?? null,
  };
}
