// Geometrie der Wetterkarte (v1.9): Druckfeld und Isobaren (Marching Squares), Windrichtung mit echter km-Metrik
// und Windfahnen mit Fiedern nach den Regelschwellen. Reine Rechnung, keine Pixi-Objekte außer dem Zeichnen in eine
// übergebene Graphics.
import type { Graphics } from "pixi.js";
import type { WeatherBalance } from "@tidefront/game-core";
import { KM_PER_DEG_LAT, KM_PER_DEG_LON, LAT0, LAT1, LON0, LON1 } from "@tidefront/world";

const RAD = Math.PI / 180;
/** Kilometer je Breitengrad im Wettermodell (game-core/weather.ts). */
const KM_DEG = 111.32;

export interface MapSystem {
  lat: number;
  lon: number;
  /** Kartenkoordinaten (Projektions-km). */
  x: number;
  y: number;
  radiusKm: number;
  sign: number;
  strength: number;
}

export const toXY = (lat: number, lon: number) => ({ x: (lon - LON0) * KM_PER_DEG_LON, y: (LAT1 - lat) * KM_PER_DEG_LAT });
const toLatLon = (x: number, y: number) => ({ lon: LON0 + x / KM_PER_DEG_LON, lat: LAT1 - y / KM_PER_DEG_LAT });

/** Abstand² zum Kern in Radien² – dieselbe Metrik wie das Wettermodell (Ost-West mit cos(Breite)). */
function q(lat: number, lon: number, s: MapSystem): { q: number; e: number; n: number } {
  const e = (lon - s.lon) * KM_DEG * Math.cos(lat * RAD);
  const n = (lat - s.lat) * KM_DEG;
  return { q: (e * e + n * n) / (s.radiusKm * s.radiusKm), e, n };
}

/** Druckabweichung: Tiefs negativ, Hochs positiv (Summe der Glocken). */
export function pressureAt(lat: number, lon: number, systems: MapSystem[]): number {
  let p = 0;
  for (const s of systems) {
    const d = q(lat, lon, s).q;
    if (d < 9) p -= s.sign * s.strength * Math.exp(-d);
  }
  return p;
}

/** Isobaren-Stufen: drei um Tiefs, drei um Hochs. */
export const ISOBAR_LEVELS = [-0.7, -0.45, -0.2, 0.2, 0.45, 0.7];

/** Isobaren als Liniensegmente [x1, y1, x2, y2, …] je Stufe (Marching Squares über ein Gitter von `stepKm`). */
export function isobars(systems: MapSystem[], stepKm: number): number[][] {
  const w = (LON1 - LON0) * KM_PER_DEG_LON;
  const h = (LAT1 - LAT0) * KM_PER_DEG_LAT;
  const nx = Math.ceil(w / stepKm) + 1;
  const ny = Math.ceil(h / stepKm) + 1;
  const p = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const { lat, lon } = toLatLon(i * stepKm, j * stepKm);
      p[j * nx + i] = pressureAt(lat, lon, systems);
    }
  }
  return ISOBAR_LEVELS.map((lv) => {
    const seg: number[] = [];
    const lerp = (a: number, b: number) => (lv - a) / (b - a || 1e-9);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = p[j * nx + i], b = p[j * nx + i + 1], c = p[(j + 1) * nx + i + 1], d = p[(j + 1) * nx + i];
        const k = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x0 = i * stepKm, y0 = j * stepKm, s = stepKm;
        // Kantenpunkte: oben (a–b), rechts (b–c), unten (d–c), links (a–d).
        const T = [x0 + s * lerp(a, b), y0], R = [x0 + s, y0 + s * lerp(b, c)];
        const B = [x0 + s * lerp(d, c), y0 + s], L = [x0, y0 + s * lerp(a, d)];
        const pairs: number[][][] = {
          1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
          8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
        }[k] as number[][][];
        for (const [u, v] of pairs) seg.push(u[0], u[1], v[0], v[1]);
      }
    }
    return seg;
  });
}

/**
 * Windrichtung (Einheitsvektor in Kartenkoordinaten, y nach Süden): Westwind plus Wirbel der Systeme
 * (Tief gegen den Uhrzeigersinn und leicht einwärts, Hoch im Uhrzeigersinn und leicht auswärts). Gerechnet in km
 * (Ost/Nord), dann in die Kartenprojektion umgerechnet – so stimmen Richtung und Isobaren überein.
 */
export function windDir(lat: number, lon: number, systems: MapSystem[]): { x: number; y: number } {
  let ve = 0.35;
  let vn = 0;
  for (const s of systems) {
    const { q: d2, e, n } = q(lat, lon, s);
    if (d2 > 9) continue;
    const d = Math.hypot(e, n) || 1;
    // Stärke wie im Modell: bei Tiefs am stärksten im Ring um einen Radius, bei Hochs schwächer.
    const w = s.sign > 0 ? s.strength * (0.3 * Math.exp(-d2) + 0.7 * d2 * Math.exp(1 - d2)) : 0.6 * s.strength * Math.exp(-d2) * Math.min(1, d2 * 3);
    // Tangential (gegen den Uhrzeigersinn für Tiefs) plus 25 % einwärts (Reibung).
    ve += w * s.sign * (-n / d - 0.25 * (e / d));
    vn += w * s.sign * (e / d - 0.25 * (n / d));
  }
  const mx = (ve / (KM_DEG * Math.cos(lat * RAD))) * KM_PER_DEG_LON;
  const my = (-vn / KM_DEG) * KM_PER_DEG_LAT;
  const len = Math.hypot(mx, my) || 1;
  return { x: mx / len, y: my / len };
}

/**
 * Fiedern nach den Regelschwellen: halber Strich ab leichter Brise, ein Strich frische Brise, zwei Striche ab
 * `shipSlowFrom` (Schiffe langsamer), drei Striche ab halbem Weg zum Sturm, Wimpel ab `stormFrom` (Sturm).
 */
export function barbsOf(wind: number, wb: WeatherBalance): { half: number; full: number; pennant: number } {
  if (wind >= wb.stormFrom) return { half: 0, full: wind >= wb.stormFrom + 0.1 ? 1 : 0, pennant: 1 };
  if (wind >= (wb.shipSlowFrom + wb.stormFrom) / 2) return { half: 0, full: 3, pennant: 0 };
  if (wind >= wb.shipSlowFrom) return { half: 0, full: 2, pennant: 0 };
  if (wind >= 0.35) return { half: 1, full: 1, pennant: 0 };
  if (wind >= 0.22) return { half: 1, full: 0, pennant: 0 };
  return { half: 0, full: 0, pennant: 0 };
}

/**
 * Windfahne um (x, y): Schaft in Windrichtung mit Pfeilspitze (wohin der Wind weht), am Ende gegen den Wind die
 * Fiedern (links des Schafts, Nordhalbkugel-Konvention). Wimpel als gefülltes Dreieck in `pennants` (eigene Füllung).
 */
export function drawVane(g: Graphics, pennants: Graphics, x: number, y: number, d: { x: number; y: number }, len: number, b: ReturnType<typeof barbsOf>): void {
  const tx = x + (d.x * len) / 2, ty = y + (d.y * len) / 2;
  const bx = x - (d.x * len) / 2, by = y - (d.y * len) / 2;
  const h = len * 0.26;
  g.moveTo(bx, by).lineTo(tx, ty);
  g.moveTo(tx - d.x * h - d.y * h * 0.55, ty - d.y * h + d.x * h * 0.55).lineTo(tx, ty).lineTo(tx - d.x * h + d.y * h * 0.55, ty - d.y * h - d.x * h * 0.55);
  // Senkrechte links vom Schaft (in Windrichtung gesehen): (d.y, −d.x).
  const px = d.y, py = -d.x;
  const bl = len * 0.42;
  const gap = len * 0.15;
  let at = 0;
  for (let i = 0; i < b.pennant; i++) {
    const ox = bx + d.x * at, oy = by + d.y * at;
    pennants.poly([ox, oy, ox + px * bl - d.x * gap * 0.4, oy + py * bl - d.y * gap * 0.4, ox + d.x * gap * 1.3, oy + d.y * gap * 1.3]);
    at += gap * 1.6;
  }
  for (let i = 0; i < b.full; i++) {
    const ox = bx + d.x * at, oy = by + d.y * at;
    g.moveTo(ox, oy).lineTo(ox + px * bl - d.x * gap * 0.6, oy + py * bl - d.y * gap * 0.6);
    at += gap;
  }
  for (let i = 0; i < b.half; i++) {
    const ox = bx + d.x * (at + (at === 0 ? gap : 0)), oy = by + d.y * (at + (at === 0 ? gap : 0));
    g.moveTo(ox, oy).lineTo(ox + px * bl * 0.5 - d.x * gap * 0.3, oy + py * bl * 0.5 - d.y * gap * 0.3);
    at += gap;
  }
}

/** Sturmwimpel: kurzer Mast mit zwei roten Wimpeln (Sturmwarnung), Größe `s`. Mast in `g`, Wimpel in `fill`. */
export function drawStormFlag(g: Graphics, fill: Graphics, x: number, y: number, s: number): void {
  g.moveTo(x, y + s).lineTo(x, y - s);
  fill.poly([x, y - s, x + s * 1.1, y - s * 0.72, x, y - s * 0.44]);
  fill.poly([x, y - s * 0.3, x + s * 1.1, y - s * 0.02, x, y + s * 0.26]);
}
