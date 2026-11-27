// Seewege und Lagebild: Position eines Verbands auf See zu einem Zeitpunkt (Projektions-km) – gerade Fahrt oder Route
// über Wasser (Seewege), Rückruf (zurück vom Wendepunkt), Patrouille (Runde über die Wegpunkte bzw. ihre Seewege),
// Aufklärungskampagne (Abschnitt für Abschnitt). Rein: Server (engine intel-route.ts: Sicht, Karte) und Oberfläche
// (apps/web/src/map/movers.ts) rechnen dieselbe Position.
import { hexCenterXY, routeAt } from "@tidefront/world";
import { pointOnLoop } from "./intel-ops.ts";
import type { Mission, MissionRoute } from "./types.ts";

type XY = { x: number; y: number };

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
  /** Seewege: Runde als Felderkette über Wasser (Schiffe); fehlt = gerade zwischen den Wegpunkten (Drohnen, alt). */
  loop?: [number, number][];
  /** Seewege: Heimweg ab endAt (Projektions-km) über die Felder der Route; fehlt = gerade. */
  homePath?: XY[];
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

/** homeRoute: Seewege der Kampagne – Heimweg vom aktuellen Ziel (route gilt dem aktuellen Abschnitt). */
export type RoutedPlan = Partial<Mission> & { patrol?: PatrolPlan; campaign?: CampaignPlan; homeRoute?: MissionRoute };
// sightTurn (Aufklärung auf Sicht) steckt in Mission: Hin- und Rückweg enden bzw. beginnen am Wendepunkt.

const lerp = (a: XY, b: XY, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const frac = (now: number, t0: number, t1: number) => Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)));

/** Gerade Fahrt oder Route (Seewege) von a nach b bei Anteil f; `back` = Route rückwärts (Heimfahrt). */
function leg(plan: RoutedPlan, a: XY, b: XY, f: number, back = false, upToKm?: number): { at: XY; from: XY; to: XY } {
  if (plan.route && plan.route.hexes.length >= 2) {
    const p = routeAt(plan.route, f, back, upToKm);
    return { at: { x: p.x, y: p.y }, from: p.from, to: p.to };
  }
  return { at: lerp(a, b, f), from: a, to: b };
}

/** Position auf einem Linienzug (Projektions-km) bei Anteil f der Länge. */
export function alongPath(pts: XY[], f: number): { at: XY; from: XY; to: XY } {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let left = Math.max(0, Math.min(1, f)) * lens.reduce((x, y) => x + y, 0);
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) return { at: lerp(pts[i], pts[i + 1], lens[i] > 0 ? Math.min(1, left / lens[i]) : 1), from: pts[i], to: pts[i + 1] };
    left -= lens[i];
  }
  return { at: pts[0], from: pts[0], to: pts[0] };
}

/**
 * Position eines Verbands jetzt (Projektions-km) mit Kurs; null, wenn er nicht auf See ist. Seewege: mit Route im
 * Plan entlang der Route (Hin- und Heimfahrt, Rückruf vom Wendepunkt auf der Route zurück); ohne Route gerade.
 */
export function fleetPosition(m: { status: string; arriveAt: Date; returnAt: Date | null; plan: unknown }, origin: XY, target: XY, nowMs: number): { at: XY; from: XY; to: XY } | null {
  const plan = m.plan as RoutedPlan;
  const arrive = m.arriveAt.getTime();
  const travel = (plan.travelSeconds ?? 0) * 1000 || Math.max(1, arrive - (plan.departAtMs ?? arrive - 3600000));
  if (plan.patrol && m.status === "holding") return patrolAt(plan.patrol, nowMs);
  // Aufklärung auf Sicht: Der Weg endet am Wendepunkt (gerade: Punkt; Route: km bis dorthin).
  const turn = plan.sightTurn;
  const end: XY = turn ? { x: turn.x, y: turn.y } : target;
  const upTo = turn && plan.route && plan.route.hexes.length >= 2 ? turn.km : undefined;
  if (m.status === "outbound") {
    const c = plan.campaign;
    if (c && c.index > 0) {
      const from = hexCenterXY(c.legFrom.col, c.legFrom.row);
      return leg(plan, from, end, frac(nowMs, c.legDepartMs, arrive), false, upTo);
    }
    const depart = plan.departAtMs ?? arrive - travel;
    if (nowMs < depart) return null;
    return leg(plan, origin, end, frac(nowMs, depart, arrive), false, upTo);
  }
  if (m.status !== "returning" || !m.returnAt) return null;
  const finish = m.returnAt.getTime();
  if (plan.recalledAtMs !== undefined && plan.departAtMs !== undefined) {
    // Rückruf auf der Hinfahrt: Heimfahrt ab dem Punkt des Rückrufs (mit Route: dasselbe Stück der Route zurück).
    const done = Math.max(0, Math.min(1, (plan.recalledAtMs - plan.departAtMs) / Math.max(1, arrive - plan.departAtMs)));
    const f = frac(nowMs, plan.recalledAtMs, finish);
    if (plan.route && plan.route.hexes.length >= 2) return leg(plan, origin, end, f, true, (upTo ?? plan.route.km) * done);
    const back = lerp(origin, end, done);
    return { at: lerp(back, origin, f), from: back, to: origin };
  }
  if (plan.patrol?.endAt && plan.patrol.endMs !== undefined) {
    const f = frac(nowMs, plan.patrol.endMs, finish);
    if (plan.patrol.homePath && plan.patrol.homePath.length >= 2) return alongPath(plan.patrol.homePath, f);
    return { at: lerp(plan.patrol.endAt, origin, f), from: plan.patrol.endAt, to: origin };
  }
  // Kampagne nach dem ersten Ziel: Heimweg vom letzten Ziel bzw. Wendepunkt (homeRoute vorwärts, ohne Route gerade).
  if (plan.campaign && plan.campaign.index > 0) {
    const f = frac(nowMs, finish - travel, finish);
    if (plan.homeRoute && plan.homeRoute.hexes.length >= 2) { const p = routeAt(plan.homeRoute, f); return { at: { x: p.x, y: p.y }, from: p.from, to: p.to }; }
    return { at: lerp(end, origin, f), from: end, to: origin };
  }
  return leg(plan, end, origin, frac(nowMs, finish - travel, finish), true, upTo);
}

/** Punkte der Runde einer Patrouille (Projektions-km). */
export function patrolPoints(p: PatrolPlan): XY[] {
  if (p.loop && p.loop.length >= 2) return p.loop.map(([c, r]) => hexCenterXY(c, r)); // Seewege
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


/**
 * Konvoi (Handel, Börse, Vertrag, Transport, Feldertrag) jetzt: Position (Projektions-km) entlang seiner Route über
 * Wasser, gleichmäßig zwischen Abfahrt und Ankunft (Abschnitte in Großkreis-km wie die Fahrzeit). Server (naval-convoy)
 * und Karte (apps/web/src/map/naval.ts) rechnen dieselbe Position; fehlt die Route, gerade von from nach to.
 */
export function convoyPosition(
  c: { route?: { hexes: readonly (readonly [number, number])[]; km: number } | null; from: { col: number; row: number }; to: { col: number; row: number }; departAtMs: number; arriveAtMs: number },
  nowMs: number,
): { at: XY; from: XY; to: XY } {
  const f = frac(nowMs, c.departAtMs, c.arriveAtMs);
  if (c.route && c.route.hexes.length >= 2) {
    const p = routeAt(c.route, f);
    return { at: { x: p.x, y: p.y }, from: p.from, to: p.to };
  }
  const a = hexCenterXY(c.from.col, c.from.row);
  const b = hexCenterXY(c.to.col, c.to.row);
  return { at: lerp(a, b, f), from: a, to: b };
}
