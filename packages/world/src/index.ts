// Schauplatz: Nordatlantik mit Mittelmeer als Hexraster (spitze Seite oben, ungerade Zeilen eingerückt).
// Rein und deterministisch; Server und Oberfläche berechnen dasselbe Raster.
import { ISLANDS, LAND, TRADE_PORTS, WATER, type Ring } from "./coast.ts";

export { TRADE_PORTS } from "./coast.ts";

export const LON0 = -80;
export const LON1 = 42;
export const LAT0 = 24;
export const LAT1 = 72;
/** Kilometer je Grad Länge in der Projektion (bei 48° Breite) und je Grad Breite. */
export const KM_PER_DEG_LON = 111.32 * Math.cos((48 * Math.PI) / 180);
export const KM_PER_DEG_LAT = 110.6;
/** Abstand Mittelpunkt zu Ecke eines Felds in Projektions-Kilometern. */
export const HEX_SIZE_KM = 58;
export const HEX_W = Math.sqrt(3) * HEX_SIZE_KM;
export const ROW_H = 1.5 * HEX_SIZE_KM;
export const COLS = Math.ceil(((LON1 - LON0) * KM_PER_DEG_LON) / HEX_W);
export const ROWS = Math.ceil(((LAT1 - LAT0) * KM_PER_DEG_LAT) / ROW_H) + 1;

export interface Hex {
  col: number;
  row: number;
}

export type Terrain = "sea" | "land" | "coast";

export function inGrid(col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function hexIndex(col: number, row: number): number {
  return row * COLS + col;
}

/** Mittelpunkt in Projektions-Kilometern (x nach Osten, y nach Süden). */
export function hexCenterXY(col: number, row: number): { x: number; y: number } {
  return { x: HEX_W * (col + 0.5 * (row & 1)), y: ROW_H * row };
}

export function hexCenter(col: number, row: number): { lat: number; lon: number } {
  const { x, y } = hexCenterXY(col, row);
  return { lon: LON0 + x / KM_PER_DEG_LON, lat: LAT1 - y / KM_PER_DEG_LAT };
}

/** Feld, in dem ein Punkt (Projektions-km) liegt. */
export function hexAtXY(x: number, y: number): Hex {
  // axiale Koordinaten, dann runden
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_SIZE_KM;
  const r = ((2 / 3) * y) / HEX_SIZE_KM;
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - (-q - r));
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (!(dy > dz)) rz = -rx - ry;
  const row = rz;
  const col = rx + (row - (row & 1)) / 2;
  return { col, row };
}

export function hexAtLonLat(lon: number, lat: number): Hex {
  return hexAtXY((lon - LON0) * KM_PER_DEG_LON, (LAT1 - lat) * KM_PER_DEG_LAT);
}

const EVEN_DIRS = [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]] as const;
const ODD_DIRS = [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]] as const;

export function neighbors(col: number, row: number): Hex[] {
  const dirs = row & 1 ? ODD_DIRS : EVEN_DIRS;
  const out: Hex[] = [];
  for (const [dc, dr] of dirs) {
    const c = col + dc;
    const r = row + dr;
    if (inGrid(c, r)) out.push({ col: c, row: r });
  }
  return out;
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isLandPoint(lon: number, lat: number): boolean {
  if (!LAND.some((ring) => inRing(lon, lat, ring))) return false;
  return !WATER.some((ring) => inRing(lon, lat, ring));
}

let terrainCache: Terrain[] | null = null;

/** Gelände aller Felder, Index hexIndex(col, row). Küste = Land mit mindestens einem Meeresnachbarn. */
export function terrainMap(): Terrain[] {
  if (terrainCache !== null) return terrainCache;
  const land = new Array<boolean>(COLS * ROWS).fill(false);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const c = hexCenter(col, row);
      land[hexIndex(col, row)] = isLandPoint(c.lon, c.lat);
    }
  }
  for (const [lon, lat] of ISLANDS) {
    const h = hexAtLonLat(lon, lat);
    if (inGrid(h.col, h.row)) land[hexIndex(h.col, h.row)] = true;
  }
  const out: Terrain[] = new Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = hexIndex(col, row);
      if (!land[i]) out[i] = "sea";
      else out[i] = neighbors(col, row).some((n) => !land[hexIndex(n.col, n.row)]) ? "coast" : "land";
    }
  }
  terrainCache = out;
  return out;
}

export function terrainAt(col: number, row: number): Terrain | null {
  if (!inGrid(col, row)) return null;
  return terrainMap()[hexIndex(col, row)];
}

export function isCoast(col: number, row: number): boolean {
  return terrainAt(col, row) === "coast";
}

/** Großkreis-Entfernung zwischen zwei Feldmittelpunkten in km. */
export function hexDistanceKm(a: Hex, b: Hex): number {
  const p = hexCenter(a.col, a.row);
  const q = hexCenter(b.col, b.row);
  const rad = Math.PI / 180;
  const s =
    Math.sin(((q.lat - p.lat) * rad) / 2) ** 2 +
    Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(((q.lon - p.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nächster Handelshafen und Entfernung dorthin. */
export function nearestTradePort(h: Hex): { name: string; distanceKm: number } {
  let best = { name: "", distanceKm: Infinity };
  for (const [lon, lat, name] of TRADE_PORTS) {
    const p = hexAtLonLat(lon, lat);
    const d = hexDistanceKm(h, p);
    if (d < best.distanceKm) best = { name, distanceKm: d };
  }
  return best;
}

/** Deterministischer Zufall (mulberry32), unabhängig vom Regelkern. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NestSite extends Hex {
  level: number;
}

/**
 * Nest Stufe 6 (Balance v1.15): Spätspiel-Ziele auf abgelegenen Inseln, fest nach Länge/Breite (Name nur zur Doku).
 * Westatlantik, Atlantik-Mitte, Nordmeer, westliches und östliches Mittelmeer; keine Festlandküste, auf der man startet.
 */
export const LATE_NEST_POINTS: readonly (readonly [number, number, string])[] = [
  [-64.8, 32.3, "Bermuda"], [-25.6, 37.8, "Azoren (São Miguel)"], [-8.5, 71.0, "Jan Mayen"],
  [3.0, 39.6, "Balearen (Mallorca)"], [28.0, 36.2, "Rhodos"],
];

/** Stufe der Nester auf LATE_NEST_POINTS. */
export const LATE_NEST_LEVEL = 6;

/**
 * Feste Nestplätze: auf Küstenfeldern, mindestens 350 km voneinander entfernt (Luftlinie), Stufen 1–5 nach Anteilen
 * verteilt (`count` Plätze), danach die Plätze der Stufe 6 aus LATE_NEST_POINTS (v1.15, angehängt: die ersten `count`
 * Einträge bleiben unverändert). Gleicher Seed, gleiche Liste.
 */
export function nestSites(seed = 1, count = 70): NestSite[] {
  const coast: Hex[] = [];
  const t = terrainMap();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (t[hexIndex(col, row)] === "coast") coast.push({ col, row });
  }
  const rand = rng(seed);
  // Fisher-Yates
  for (let i = coast.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [coast[i], coast[j]] = [coast[j], coast[i]];
  }
  const chosen: Hex[] = [];
  for (const h of coast) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => hexDistanceKm(c, h) < 350)) continue;
    chosen.push(h);
  }
  const shares = [0.32, 0.26, 0.2, 0.14, 0.08];
  const out: NestSite[] = [];
  let k = 0;
  shares.forEach((share, i) => {
    const n = i === shares.length - 1 ? chosen.length - k : Math.round(share * chosen.length);
    for (let m = 0; m < n && k < chosen.length; m++) out.push({ ...chosen[k++], level: i + 1 });
  });
  for (const [lon, lat] of LATE_NEST_POINTS) {
    const h = hexAtLonLat(lon, lat);
    if (!inGrid(h.col, h.row) || t[hexIndex(h.col, h.row)] !== "coast") continue;
    if (out.some((o) => o.col === h.col && o.row === h.row)) continue;
    out.push({ ...h, level: LATE_NEST_LEVEL });
  }
  return out;
}
export * from "./labels.ts";
export { LAND, WATER, ISLANDS } from "./coast.ts";
export { fieldSites, type FieldSite } from "./fields.ts"; // Felder
export { COAST_PLACES, PLACE_FAR_KM, PLACE_NEAR_KM, nearestPlace, nearestLabel, placeNameAt, type Place } from "./places.ts"; // Mehrere Häfen: Ortsnamen
