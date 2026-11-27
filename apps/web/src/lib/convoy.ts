// Konvois in der Oberfläche: Position jetzt (Projektions-km) – eigene und feindliche entlang ihrer Route über Wasser
// (game-core convoyPosition, dieselbe Rechnung wie der Server), fremde (Lagebild-Sichtung) an der gemeldeten Stelle.
// Ohne Pixi, damit Kartenblatt und Börse es nutzen können (apps/web/src/map/naval.ts zeichnet).
import { hexDistanceKm } from "@tidefront/world";
import { convoyPosition } from "@tidefront/game-core";

type Hex = { col: number; row: number };
/** Konvoi auf der Karte: eigene und feindliche mit Route und Zeiten, fremde (gesichtet) nur mit Position. */
export interface MapConvoy {
  id: number;
  from: Hex | null;
  to: Hex | null;
  route: [number, number][] | null;
  departAtMs: number | null;
  arriveAtMs: number | null;
  x: number;
  y: number;
  own: boolean;
  enemy: boolean;
  escorted: boolean | null;
  size: string;
}

/** Position jetzt (Projektions-km): entlang der Route für eigene/feindliche Konvois, sonst die gemeldete. */
export function convoyXY(c: MapConvoy, now: number): { x: number; y: number } {
  if (!c.from || !c.to || c.departAtMs === null || c.arriveAtMs === null) return { x: c.x, y: c.y };
  return convoyPosition({ route: c.route ? { hexes: c.route, km: routeKmOf(c.route) } : null, from: c.from, to: c.to, departAtMs: c.departAtMs, arriveAtMs: c.arriveAtMs }, now).at;
}

const kmCache = new WeakMap<object, number>();
/** Länge der Route in Großkreis-km wie im Server (Summe der Abschnitte, pointAlongRoute). */
export function routeKmOf(r: [number, number][]): number {
  let km = kmCache.get(r);
  if (km === undefined) {
    km = 0;
    for (let i = 1; i < r.length; i++) km += hexKm(r[i - 1], r[i]);
    kmCache.set(r, km);
  }
  return km;
}

const hexKm = (a: [number, number], b: [number, number]) => hexDistanceKm({ col: a[0], row: a[1] }, { col: b[0], row: b[1] });
