// Gelände der Hexkarte: Meerestiefe nach Abstand zur Küste, Landfarben mit leichtem Rauschen,
// Küstenlinie und Brandung entlang der Kanten zwischen Land und Meer. Wird einmal gezeichnet.
import { Container, Graphics } from "pixi.js";
import { COLS, HEX_SIZE_KM, ROWS, hexCenter, hexCenterXY, hexIndex, neighbors, terrainMap } from "@tidefront/world";

export function hexPoints(cx: number, cy: number, size: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    pts.push(cx + size * Math.cos(a), cy + size * Math.sin(a));
  }
  return pts;
}

/** Deterministisches Rauschen in [0, 1) aus col/row. */
function noise(col: number, row: number, salt = 0): number {
  let h = (col * 374761393 + row * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Abstand jedes Felds (in Feldern) zum nächsten Feld der anderen Art: Meer zum Land, Land zum Meer. */
export function coastDistance(): Int16Array {
  const t = terrainMap();
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const queue: number[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const i = hexIndex(col, row);
    const land = t[i] !== "sea";
    if (neighbors(col, row).some((n) => (t[hexIndex(n.col, n.row)] !== "sea") !== land)) {
      dist[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const col = i % COLS, row = Math.floor(i / COLS);
    const land = t[i] !== "sea";
    for (const n of neighbors(col, row)) {
      const j = hexIndex(n.col, n.row);
      if (dist[j] !== -1 || (t[j] !== "sea") !== land) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

const SEA_SHALLOW = 0x2a8aa8;
const SEA_MID = 0x17506f;
const SEA_DEEP = 0x0b2540;
const LAND_LOW = 0x4f6b3a;
const LAND_HIGH = 0x6b6a45;
const SAND = 0xb7a46c;
const DESERT = 0xc2a061;
const ICE = 0xdfe7ea;
const TUNDRA = 0x7c8a6e;

function landColor(col: number, row: number, d: number, coast: boolean): number {
  const { lat, lon } = hexCenter(col, row);
  const n = noise(col, row);
  let c = mix(LAND_LOW, LAND_HIGH, Math.min(1, d / 7) * 0.8 + n * 0.2);
  if (lat > 58) c = mix(c, TUNDRA, Math.min(1, (lat - 58) / 6));
  if (lat < 33 && lon > -12 && lon < 36) c = mix(c, DESERT, Math.min(1, (33 - lat) / 3));
  // Grönland, Baffin: Inlandeis
  if ((lon < -20 && lon > -58 && lat > 60 && d > 1) || (lon < -62 && lat > 64)) c = mix(c, ICE, 0.85);
  if (coast) c = mix(c, SAND, 0.35);
  return mix(c, 0x000000, n * 0.08);
}

function seaColor(col: number, row: number, d: number): number {
  const n = noise(col, row, 7);
  const t = Math.min(1, (d - 1) / 6);
  const c = t < 0.35 ? mix(SEA_SHALLOW, SEA_MID, t / 0.35) : mix(SEA_MID, SEA_DEEP, (t - 0.35) / 0.65);
  return mix(c, 0x000000, n * 0.06);
}

/** Zeichnet Gelände, Küstenlinie und Brandung in einen Container (Weltkoordinaten in km). */
export function buildTerrain(): Container {
  const t = terrainMap();
  const dist = coastDistance();
  const root = new Container();
  const fill = new Graphics();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = hexIndex(col, row);
      const { x, y } = hexCenterXY(col, row);
      const color = t[i] === "sea" ? seaColor(col, row, dist[i]) : landColor(col, row, dist[i], t[i] === "coast");
      // leicht übergroß, damit keine Fugen entstehen
      fill.poly(hexPoints(x, y, HEX_SIZE_KM * 1.01)).fill({ color });
    }
  }
  root.addChild(fill);

  // feine Feldkanten nur auf dem Meer, sehr dezent
  const grid = new Graphics();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const { x, y } = hexCenterXY(col, row);
    grid.poly(hexPoints(x, y, HEX_SIZE_KM));
  }
  grid.stroke({ color: 0xffffff, width: 1.2, alpha: 0.05 });
  root.addChild(grid);

  // Küstenlinie: gemeinsame Kante jedes Land-Meer-Paars; Brandung leicht seewärts versetzt
  const coastLine = new Graphics();
  const surf = new Graphics();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (t[hexIndex(col, row)] === "sea") continue;
    const a = hexCenterXY(col, row);
    for (const n of neighbors(col, row)) {
      if (t[hexIndex(n.col, n.row)] !== "sea") continue;
      const b = hexCenterXY(n.col, n.row);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const s = HEX_SIZE_KM;
      const p1 = { x: a.x + s * Math.cos(ang - Math.PI / 6), y: a.y + s * Math.sin(ang - Math.PI / 6) };
      const p2 = { x: a.x + s * Math.cos(ang + Math.PI / 6), y: a.y + s * Math.sin(ang + Math.PI / 6) };
      coastLine.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
      const off = 9;
      const ox = Math.cos(ang) * off, oy = Math.sin(ang) * off;
      surf.moveTo(p1.x + ox, p1.y + oy).lineTo(p2.x + ox, p2.y + oy);
    }
  }
  surf.stroke({ color: 0xbfe9f5, width: 5, alpha: 0.22 });
  coastLine.stroke({ color: 0xf3e6c0, width: 3.5, alpha: 0.9, cap: "round" });
  root.addChild(surf, coastLine);
  return root;
}
