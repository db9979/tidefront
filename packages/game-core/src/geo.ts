import type { GeoPoint } from "./types.ts";

/** Mittlerer Erdradius in km (physikalische Konstante, kein Balance-Wert). */
export const EARTH_RADIUS_KM = 6371;

/** Großkreis-Entfernung (Haversine) zwischen zwei Punkten in Kilometern. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}
