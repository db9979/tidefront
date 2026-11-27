// Lagebild: Position eines Verbands auf See zu einem Zeitpunkt (Projektions-km) – gerade Fahrt, Patrouille (Runde über
// die Wegpunkte), Aufklärungskampagne (Abschnitt für Abschnitt). Gemeinsam für Sicht (bewegte Sensoren) und Karte.
import { fleetSightKm, pointOnLoop, type Mission } from "@tidefront/game-core";
import { balance } from "./context.ts";
import { hexCenterXY } from "@tidefront/world";

export type XY = { x: number; y: number };

/** Patrouille im Missionsplan (intel-patrol.ts). */
export interface PatrolPlan {
  waypoints: { col: number; row: number }[];
  hours: number;
  /** Fahrt auf der Runde (km/h, Projektions-km). */
  speedKmh: number;
  sightKm: number;
  sonarKm: number;
  /** Beginn und Ende auf Station (ab Ankunft am ersten Wegpunkt). */
  startMs?: number;
  endMs?: number;
  /** Position beim Ende der Station (Heimfahrt beginnt hier). */
  endAt?: XY;
  /** Abgeschossene Drohnen, Häfen, die schon abgefangen haben, und Spieler, die die Meldung schon bekamen. */
  shot?: number;
  interceptedBy?: number[];
  seenBy?: number[];
}

/** Kampagne im Missionsplan (intel-campaign.ts): Ziele nacheinander, index = aktuelles Ziel. */
export interface CampaignPlan {
  targets: { kind: string; id: number | null; col: number; row: number; fieldId?: number }[];
  index: number;
  /** Start des aktuellen Abschnitts (Feld und Zeit). */
  legFrom: { col: number; row: number };
  legDepartMs: number;
}

export type RoutedPlan = Partial<Mission> & { patrol?: PatrolPlan; campaign?: CampaignPlan };

const lerp = (a: XY, b: XY, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const frac = (now: number, t0: number, t1: number) => Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)));

/** Position eines Verbands jetzt (Projektions-km) mit Kurs; null, wenn er nicht auf See ist. */
export function fleetPosition(m: { status: string; arriveAt: Date; returnAt: Date | null; plan: unknown }, origin: XY, target: XY, nowMs: number): { at: XY; from: XY; to: XY } | null {
  const plan = m.plan as RoutedPlan;
  const arrive = m.arriveAt.getTime();
  const travel = (plan.travelSeconds ?? 0) * 1000 || Math.max(1, arrive - (plan.departAtMs ?? arrive - 3600000));
  if (plan.patrol && m.status === "holding") return patrolAt(plan.patrol, nowMs);
  if (m.status === "outbound") {
    const c = plan.campaign;
    if (c && c.index > 0) {
      const from = hexCenterXY(c.legFrom.col, c.legFrom.row);
      return { at: lerp(from, target, frac(nowMs, c.legDepartMs, arrive)), from, to: target };
    }
    const depart = plan.departAtMs ?? arrive - travel;
    if (nowMs < depart) return null;
    return { at: lerp(origin, target, frac(nowMs, depart, arrive)), from: origin, to: target };
  }
  if (m.status !== "returning" || !m.returnAt) return null;
  const end = m.returnAt.getTime();
  if (plan.recalledAtMs !== undefined && plan.departAtMs !== undefined) {
    // Rückruf auf der Hinfahrt: Heimfahrt ab dem Punkt des Rückrufs.
    const turn = lerp(origin, target, Math.max(0, Math.min(1, (plan.recalledAtMs - plan.departAtMs) / Math.max(1, arrive - plan.departAtMs))));
    return { at: lerp(turn, origin, frac(nowMs, plan.recalledAtMs, end)), from: turn, to: origin };
  }
  if (plan.patrol?.endAt && plan.patrol.endMs !== undefined) {
    return { at: lerp(plan.patrol.endAt, origin, frac(nowMs, plan.patrol.endMs, end)), from: plan.patrol.endAt, to: origin };
  }
  return { at: lerp(target, origin, frac(nowMs, end - travel, end)), from: target, to: origin };
}

/** Punkte der Runde einer Patrouille (Projektions-km). */
export function patrolPoints(p: PatrolPlan): XY[] {
  return p.waypoints.map((w) => hexCenterXY(w.col, w.row));
}

/** Position auf Station (Runde über die Wegpunkte ab startMs) mit Kurs zum nächsten Punkt. */
export function patrolAt(p: PatrolPlan, nowMs: number): { at: XY; from: XY; to: XY } {
  const pts = patrolPoints(p);
  const km = (p.speedKmh * Math.max(0, Math.min(nowMs, p.endMs ?? nowMs) - (p.startMs ?? nowMs))) / 3600000;
  const at = pointOnLoop(pts, km);
  const ahead = pointOnLoop(pts, km + 5);
  return { at, from: at, to: ahead };
}

/** Für die Missionsliste (baseView): Patrouille (Wegpunkte, Station, Fahrt) und Kampagne (Ziele, aktuelles Ziel). */
export function intelMissionInfo(plan: unknown): { sightKm: number; patrol: { waypoints: { col: number; row: number }[]; hours: number; startMs: number | null; endMs: number | null; speedKmh: number; sightKm: number; shot: number } | null; campaign: { targets: { col: number; row: number; kind: string }[]; index: number } | null } {
  const p = (plan as RoutedPlan).patrol;
  const c = (plan as RoutedPlan).campaign;
  const units = ((plan as RoutedPlan).units ?? {}) as Record<string, number>;
  return {
    sightKm: p ? p.sightKm : fleetSightKm(units, balance.units as never, balance.intel?.fleetSight).recognizeKm,
    patrol: p ? { waypoints: p.waypoints, hours: p.hours, startMs: p.startMs ?? null, endMs: p.endMs ?? null, speedKmh: p.speedKmh, sightKm: p.sightKm, shot: p.shot ?? 0 } : null,
    campaign: c ? { targets: c.targets.map((t) => ({ col: t.col, row: t.row, kind: t.kind })), index: c.index } : null,
  };
}
