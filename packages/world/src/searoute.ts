// Seewege: Verbände mit Schiffen fahren über Wasserfelder statt Luftlinie (docs/REGELN.md, Missionen; Entscheidung
// „U. Seewege und Bordsicht“ in packages/game-core/ENTSCHEIDUNGEN-4.md). Rein und deterministisch: Server und Oberfläche
// rechnen dieselbe Route; der Server speichert sie im Missionsplan (Hex-Liste + Länge), die Karte zeichnet sie nach.
//
// Befahrbar: See, Küste und die Passagen (PASSAGES, nur für die Wegsuche – das Gelände ändert sich NIE). Küstenfelder
// sind Uferstreifen: Ein Schiff fährt an ihnen entlang, aber nicht quer über eine Landenge. Darum gelten zwei Regeln:
//  1. Zwischen zwei Küstenfeldern nur, wenn sie ein gemeinsames Wasserfeld (See/Passage) berühren (am Ufer entlang).
//  2. Durch ein Küstenfeld hindurch (nicht Start/Ziel) nur, wenn Ein- und Ausfahrt rund um das Feld über Wasserfelder
//     verbunden sind (kein Schnitt quer über eine Halbinsel oder Landbrücke).
// Kosten je Schritt = Großkreis-km zwischen Feldmittelpunkten (A*, Schätzung = Luftlinie zum Ziel). Danach wird die
// Hex-Kette geglättet (Sichtlinie über Wasser): Auf offener See ist die Route die Luftlinie, Umwege nur um Land.
// Ziel nicht per See erreichbar (Binnenmeer ohne Verbindung): Fahrt zum erreichbaren Feld mit der kürzesten
// Luftlinie zum Ziel, das letzte Stück gerade (Landung über Land); `partial` = true.
import { COLS, ROWS, hexAtLonLat, hexAtXY, hexCenter, hexCenterXY, hexDistanceKm, hexIndex, inGrid, terrainMap, type Hex } from "./index.ts";

/** Gespeicherte Route: Wegpunkte (Feld-Spalte, -Zeile) von Start bis Ziel und Länge in km (Großkreis je Abschnitt). */
export interface SeaRoute {
  hexes: [number, number][];
  km: number;
  /** Ziel nicht vollständig über Wasser erreichbar: letzter Abschnitt führt über Land. */
  partial?: boolean;
}

/**
 * Durchfahrten, die im Raster aus Küsten- oder Landfeldern bestehen (Länge, Breite, Name). Ihr Feld gilt für die
 * Wegsuche als Wasser. Gelände, Nest- und Feldplätze bleiben unverändert.
 */
export const PASSAGES: readonly (readonly [number, number, string])[] = [
  [-5.5, 36.0, "Straße von Gibraltar"],
  [1.5, 51.0, "Straße von Dover"], [0.5, 50.6, "Ärmelkanal"],
  [29.0, 41.1, "Bosporus"], [28.0, 40.8, "Marmarameer"], [26.4, 40.2, "Dardanellen"],
  [32.3, 31.3, "Suezkanal (Port Said)"], [32.3, 30.6, "Suezkanal (Ismailia)"], [32.5, 29.95, "Suezkanal (Suez)"],
  [12.7, 55.9, "Öresund"], [10.9, 55.4, "Großer Belt"],
  [15.6, 38.2, "Straße von Messina"], [36.5, 45.3, "Straße von Kertsch"],
];

// Nachbarn im Uhrzeigersinn (O, SO, SW, W, NW, NO) für gerade und ungerade Zeilen (wie neighbors() in index.ts).
const RING_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]] as const;
const RING_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] as const;

interface Grid {
  /** 0 = Land, 1 = Küste, 2 = Wasser (See oder Passage). */
  kind: Uint8Array;
  /** Nachbar je Richtung (Ring-Reihenfolge), -1 außerhalb. */
  nb: Int32Array;
  /** Großkreis-km zum Nachbarn je Richtung. */
  step: Float32Array;
  lat: Float64Array;
  lon: Float64Array;
}
let grid: Grid | null = null;
let passageSet: Set<number> | null = null;

function passageIndexes(): Set<number> {
  if (passageSet) return passageSet;
  passageSet = new Set(PASSAGES.map(([lon, lat]) => { const h = hexAtLonLat(lon, lat); return hexIndex(h.col, h.row); }));
  return passageSet;
}

function buildGrid(): Grid {
  if (grid) return grid;
  const N = COLS * ROWS;
  const t = terrainMap();
  const pass = passageIndexes();
  const kind = new Uint8Array(N);
  const nb = new Int32Array(N * 6).fill(-1);
  const step = new Float32Array(N * 6);
  const lat = new Float64Array(N);
  const lon = new Float64Array(N);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const i = hexIndex(col, row);
    kind[i] = t[i] === "sea" || pass.has(i) ? 2 : t[i] === "coast" ? 1 : 0;
    const c = hexCenter(col, row);
    lat[i] = c.lat;
    lon[i] = c.lon;
    const ring = row & 1 ? RING_ODD : RING_EVEN;
    for (let d = 0; d < 6; d++) {
      const nc = col + ring[d][0];
      const nr = row + ring[d][1];
      if (!inGrid(nc, nr)) continue;
      nb[i * 6 + d] = hexIndex(nc, nr);
      step[i * 6 + d] = hexDistanceKm({ col, row }, { col: nc, row: nr });
    }
  }
  grid = { kind, nb, step, lat, lon };
  return grid;
}

/** Ist das Feld für Schiffe befahrbar (See, Küste oder Passage)? */
export function isNavigable(col: number, row: number): boolean {
  if (!inGrid(col, row)) return false;
  return buildGrid().kind[hexIndex(col, row)] > 0;
}

/** Wasserfeld für die Wegsuche (See oder Passage)? */
export function isOpenWater(col: number, row: number): boolean {
  if (!inGrid(col, row)) return false;
  return buildGrid().kind[hexIndex(col, row)] === 2;
}

function gcKm(g: Grid, a: number, b: number): number {
  const rad = Math.PI / 180;
  const s = Math.sin(((g.lat[b] - g.lat[a]) * rad) / 2) ** 2 +
    Math.cos(g.lat[a] * rad) * Math.cos(g.lat[b] * rad) * Math.sin(((g.lon[b] - g.lon[a]) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Regel 1: Schritt von a nach b in Richtung d. */
function stepOk(g: Grid, a: number, d: number): boolean {
  const b = g.nb[a * 6 + d];
  if (b < 0 || g.kind[b] === 0) return false;
  if (g.kind[a] === 2 || g.kind[b] === 2) return true;
  // Küste → Küste: gemeinsame Nachbarn sind die Ringnachbarn d-1 und d+1 von a.
  const l = g.nb[a * 6 + ((d + 5) % 6)];
  const r = g.nb[a * 6 + ((d + 1) % 6)];
  return (l >= 0 && g.kind[l] === 2) || (r >= 0 && g.kind[r] === 2);
}

/** Regel 2: Durchfahrt durch Küstenfeld c von Richtung din (Nachbar, aus dem man kam) nach dout. */
function throughOk(g: Grid, c: number, din: number, dout: number): boolean {
  if (din === dout) return true;
  const water = (k: number) => { const n = g.nb[c * 6 + k]; return n >= 0 && g.kind[n] === 2; };
  let ok = true;
  for (let k = (din + 1) % 6; k !== dout; k = (k + 1) % 6) if (!water(k)) { ok = false; break; }
  if (ok) return true;
  for (let k = (din + 5) % 6; k !== dout; k = (k + 5) % 6) if (!water(k)) return false;
  return true;
}

// Binärer Heap über (f, Zustand).
class Heap {
  private f: number[] = [];
  private s: number[] = [];
  get size(): number { return this.s.length; }
  push(f: number, s: number): void {
    this.f.push(f); this.s.push(s);
    let i = this.s.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      [this.f[p], this.f[i]] = [this.f[i], this.f[p]];
      [this.s[p], this.s[i]] = [this.s[i], this.s[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.s[0];
    const lf = this.f.pop()!;
    const ls = this.s.pop()!;
    if (this.s.length > 0) {
      this.f[0] = lf; this.s[0] = ls;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.s.length && this.f[l] < this.f[m]) m = l;
        if (r < this.s.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        [this.f[m], this.f[i]] = [this.f[i], this.f[m]];
        [this.s[m], this.s[i]] = [this.s[i], this.s[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* über Zustände (Feld, Einfahrtsrichtung 0–5; 6 = Start). Liefert die Hex-Kette (Indizes) oder, wenn das Ziel
 * nicht erreichbar ist, die Kette zum erreichten Feld mit der kürzesten Luftlinie zum Ziel (partial).
 */
function search(g: Grid, start: number, goal: number): { path: number[]; partial: boolean } {
  const S = COLS * ROWS * 7;
  const cost = new Float64Array(S).fill(Infinity);
  const prev = new Int32Array(S).fill(-1);
  const closed = new Uint8Array(S);
  const heap = new Heap();
  const s0 = start * 7 + 6;
  cost[s0] = 0;
  heap.push(gcKm(g, start, goal), s0);
  let best = s0;
  let bestH = gcKm(g, start, goal);
  let found = -1;
  while (heap.size > 0) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const c = Math.floor(s / 7);
    const din = s % 7;
    if (c === goal) { found = s; break; }
    const h = gcKm(g, c, goal);
    if (h < bestH) { bestH = h; best = s; }
    // Startfeld und Wasser: jede Richtung; Küste (Durchfahrt): Regel 2.
    const through = din !== 6 && g.kind[c] === 1;
    for (let d = 0; d < 6; d++) {
      if (!stepOk(g, c, d)) continue;
      if (through && !throughOk(g, c, din, d)) continue;
      const n = g.nb[c * 6 + d];
      const ns = n * 7 + ((d + 3) % 6); // Einfahrt in n aus der Gegenrichtung
      if (closed[ns]) continue;
      const nc = cost[s] + g.step[c * 6 + d];
      if (nc >= cost[ns]) continue;
      cost[ns] = nc;
      prev[ns] = s;
      heap.push(nc + gcKm(g, n, goal), ns);
    }
  }
  const end = found >= 0 ? found : best;
  const path: number[] = [];
  for (let s = end; s >= 0; s = prev[s]) path.push(Math.floor(s / 7));
  path.reverse();
  if (found < 0) path.push(goal);
  return { path, partial: found < 0 };
}

/** Sichtlinie in Projektions-km von a nach b: jede Probe liegt auf Wasser oder einem erlaubten Feld (Kette selbst). */
function clearLine(a: number, b: number, allowed: Set<number>): boolean {
  const pa = hexCenterXY(a % COLS, Math.floor(a / COLS));
  const pb = hexCenterXY(b % COLS, Math.floor(b / COLS));
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  const n = Math.max(1, Math.ceil(len / 8));
  const g = buildGrid();
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = pa.x + (pb.x - pa.x) * t;
    const y = pa.y + (pb.y - pa.y) * t;
    const p = hexAtXY(x, y);
    if (!inGrid(p.col, p.row)) return false;
    const h = hexIndex(p.col, p.row);
    if (g.kind[h] !== 2 && !allowed.has(h)) return false;
  }
  return true;
}

/** Glättet die Kette: von jedem Ankerpunkt zum weitesten Punkt mit freier Sichtlinie. */
function smooth(path: number[], partial: boolean): number[] {
  if (path.length <= 2) return path;
  // Teilroute: das letzte Stück über Land bleibt ein eigener Abschnitt.
  const sea = partial ? path.slice(0, -1) : path;
  const allowed = new Set(sea);
  const out = [sea[0]];
  let i = 0;
  while (i < sea.length - 1) {
    let j = sea.length - 1;
    while (j > i + 1 && !clearLine(sea[i], sea[j], allowed)) j--;
    out.push(sea[j]);
    i = j;
  }
  if (partial) out.push(path[path.length - 1]);
  return out;
}

function lengthKm(hexes: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < hexes.length; i++) km += hexDistanceKm({ col: hexes[i - 1][0], row: hexes[i - 1][1] }, { col: hexes[i][0], row: hexes[i][1] });
  return km;
}

const CACHE_MAX = 2000;
const cache = new Map<string, SeaRoute>();

/**
 * Seeweg von `from` nach `to` (Felder). Ergebnis zwischengespeichert (je Start/Ziel einmal gerechnet); die Route ist
 * unveränderlich – Aufrufer kopieren sie, bevor sie sie in einen Plan legen (seaRouteCopy).
 */
export function seaRoute(from: Hex, to: Hex): SeaRoute {
  const key = `${from.col},${from.row}>${to.col},${to.row}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let route: SeaRoute;
  if (!inGrid(from.col, from.row) || !inGrid(to.col, to.row) || (from.col === to.col && from.row === to.row)) {
    route = { hexes: [[from.col, from.row], [to.col, to.row]], km: hexDistanceKm(from, to) };
  } else {
    const g = buildGrid();
    const { path, partial } = search(g, hexIndex(from.col, from.row), hexIndex(to.col, to.row));
    const hexes = smooth(path, partial).map((i) => [i % COLS, Math.floor(i / COLS)] as [number, number]);
    route = { hexes, km: lengthKm(hexes), ...(partial ? { partial: true } : {}) };
  }
  Object.freeze(route.hexes);
  cache.set(key, route);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return route;
}

/** Tiefe Kopie für Missionspläne (gespeichert als JSON). */
export function seaRouteCopy(r: SeaRoute): SeaRoute {
  return { hexes: r.hexes.map(([c, w]) => [c, w]), km: r.km, ...(r.partial ? { partial: true } : {}) };
}

/** Umgekehrte Route (Heimfahrt). */
export function reverseRoute(r: SeaRoute): SeaRoute {
  return { hexes: [...r.hexes].reverse().map(([c, w]) => [c, w]), km: r.km, ...(r.partial ? { partial: true } : {}) };
}

/** Wegpunkte in Projektions-km. */
export function routePointsXY(r: { hexes: readonly (readonly [number, number])[] }): { x: number; y: number }[] {
  return r.hexes.map(([c, w]) => hexCenterXY(c, w));
}

/**
 * Punkt bei `km` Fahrt entlang der Route (Projektions-km) mit Kurs (Abschnittsanfang und -ende). Die Abschnitte
 * zählen in Großkreis-km wie die Fahrzeit; innerhalb eines Abschnitts linear in der Projektion.
 */
export function pointAlongRoute(r: { hexes: readonly (readonly [number, number])[] }, km: number): { x: number; y: number; from: { x: number; y: number }; to: { x: number; y: number } } {
  const pts = routePointsXY(r);
  if (pts.length === 1) return { ...pts[0], from: pts[0], to: pts[0] };
  let left = Math.max(0, km);
  for (let i = 1; i < pts.length; i++) {
    const seg = hexDistanceKm({ col: r.hexes[i - 1][0], row: r.hexes[i - 1][1] }, { col: r.hexes[i][0], row: r.hexes[i][1] });
    if (left <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 1;
      const a = pts[i - 1];
      const b = pts[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, from: a, to: b };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1];
  return { ...last, from: last, to: last };
}

/**
 * Teilstück der Route bis `km` (für den Rückruf: der Verband fährt dieselben Wegpunkte zurück). Endet auf dem Punkt
 * (Projektions-km) – darum mit `end` statt eines Feldes.
 */
export function routePrefixXY(r: { hexes: readonly (readonly [number, number])[] }, km: number): { x: number; y: number }[] {
  const pts = routePointsXY(r);
  const out = [pts[0]];
  let left = Math.max(0, km);
  for (let i = 1; i < pts.length; i++) {
    const seg = hexDistanceKm({ col: r.hexes[i - 1][0], row: r.hexes[i - 1][1] }, { col: r.hexes[i][0], row: r.hexes[i][1] });
    if (left < seg) {
      const t = seg > 0 ? left / seg : 1;
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
      return out;
    }
    out.push(pts[i]);
    left -= seg;
  }
  return out;
}

/** Nur für Tests und Messungen: Zwischenspeicher leeren. */
export function clearSeaRouteCache(): void {
  cache.clear();
}

/**
 * Position bei Anteil `f` (0–1) der Fahrt entlang der Route; `back` = Heimfahrt (vom Ziel zum Start). `upToKm` begrenzt
 * die Fahrt (Rückruf: Wendepunkt), dann zählt `f` nur bis dorthin. Kurs: `from` → `to` in Fahrtrichtung.
 */
export function routeAt(r: { hexes: readonly (readonly [number, number])[]; km: number }, f: number, back = false, upToKm?: number): { x: number; y: number; from: { x: number; y: number }; to: { x: number; y: number } } {
  const total = upToKm ?? r.km;
  const t = Math.max(0, Math.min(1, f));
  const p = pointAlongRoute(r, total * (back ? 1 - t : t));
  return back ? { x: p.x, y: p.y, from: p.to, to: p.from } : p;
}

/**
 * Patrouille: Runde über die Wegpunkte als Kette von Wegpunkten (Seewege zwischen den Wegpunkten, zurück zum ersten).
 * Liefert die Felder der Runde ohne Wiederholung des Startpunkts (für pointOnLoop).
 */
export function loopRouteHexes(waypoints: readonly { col: number; row: number }[]): [number, number][] {
  if (waypoints.length < 2) return waypoints.map((w) => [w.col, w.row]);
  const out: [number, number][] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const r = seaRoute(waypoints[i], waypoints[(i + 1) % waypoints.length]);
    for (let k = 0; k < r.hexes.length - 1; k++) out.push([r.hexes[k][0], r.hexes[k][1]]);
  }
  return out;
}
