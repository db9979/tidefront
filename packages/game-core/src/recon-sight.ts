// Aufklärung auf Sicht (docs/VORLAGE-NESTER.md 2, docs/REGELN-LAGEBILD.md): Die Mission „Aufklärung“ endet am ersten
// Punkt ihres Weges, an dem das Ziel in Lagebild-Reichweite liegt (Bordsicht der besten Einheit für Objekte), und
// kehrt dort um. Rein: Server (Planung, Kampagne) und Oberfläche (Karte, Planung) rechnen denselben Wendepunkt.
import { hexAtXY, hexCenterXY, hexDistanceKm, routePointsXY, type Hex } from "@tidefront/world";
import { fleetSightKm, type FleetSightBalance } from "./intel-ops.ts";
import type { Counts } from "./types.ts";

/** Balance-Block `intel.sightRecon`; fehlt er, fährt die Aufklärung wie früher bis ans Ziel. */
export interface SightReconBalance {
  /** Mindestfahrzeit bis zum Wendepunkt in Minuten (Ziel schon beim Auslaufen in Reichweite: kein Sofort-Lagebild). */
  minMinutes: number;
}

/** Wendepunkt im Missionsplan: gefahrene km bis dorthin (wie Route bzw. Luftlinie), Punkt (Projektions-km), Feld. */
export interface SightTurn {
  km: number;
  x: number;
  y: number;
  col: number;
  row: number;
  /** Lagebild-Reichweite des Verbands beim Auslaufen. */
  rangeKm: number;
}

type Defs = Record<string, { branch?: string; submerged?: boolean } | undefined>;

/**
 * Lagebild-Reichweite eines Aufklärers: Objektsicht der besten Einheit (Drohne 200, Kriegsschiff 105, Transporter 40 km).
 * 0 ohne Objektsicht (nur Jäger/Bomber, nur U-Boote): Der Verband fährt bis ans Ziel.
 */
export function reconRangeKm(units: Counts, defs: Defs, fs: FleetSightBalance | undefined): number {
  return fleetSightKm(units, defs, fs).recognizeKm;
}

/**
 * Erster Punkt auf dem Weg von `from` nach `to` (Seeweg `route` über die Felder, sonst gerade), an dem `to` höchstens
 * `rangeKm` (gerader Abstand, Projektions-km) entfernt ist. null: Reichweite 0 oder der Weg erreicht die Reichweite nie
 * (unvollständige Route) – dann fährt der Verband bis ans Ziel. km: gefahrene Strecke bis zum Wendepunkt in den
 * Einheiten der Fahrzeit (Großkreis-km je Abschnitt wie die Route).
 */
export function sightTurn(from: Hex, to: Hex, route: { hexes: readonly (readonly [number, number])[] } | null | undefined, rangeKm: number): SightTurn | null {
  if (!(rangeKm > 0)) return null;
  const hexes: Hex[] = route && route.hexes.length >= 2 ? route.hexes.map(([col, row]) => ({ col, row })) : [from, to];
  const pts = route && route.hexes.length >= 2 ? routePointsXY(route) : [hexCenterXY(from.col, from.row), hexCenterXY(to.col, to.row)];
  const t = hexCenterXY(to.col, to.row);
  const r2 = rangeKm * rangeKm;
  const out = (x: number, y: number, km: number): SightTurn => ({ km, x, y, ...hexAtXY(x, y), rangeKm });
  if ((pts[0].x - t.x) ** 2 + (pts[0].y - t.y) ** 2 <= r2) return out(pts[0].x, pts[0].y, 0);
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = hexDistanceKm(hexes[i - 1], hexes[i]);
    const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - t.x, fy = a.y - t.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r2;
    const disc = B * B - 4 * A * C;
    if (A > 0 && disc >= 0) {
      const s = (-B - Math.sqrt(disc)) / (2 * A);
      if (s >= 0 && s <= 1) return out(a.x + dx * s, a.y + dy * s, km + seg * s);
    }
    km += seg;
  }
  return null;
}

/** Fahrzeit bis zum Wendepunkt (Sekunden) mit Mindestfahrzeit. */
export function sightTravelSeconds(seconds: number, sr: SightReconBalance): number {
  return Math.max(seconds, sr.minMinutes * 60);
}
