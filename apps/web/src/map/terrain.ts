// Gelände im Stil einer Admiralitätskarte: Land als chamois Papier mit Küstenschraffur und Bergstrichen,
// Meer als helles Papier mit blau getönten Flachwasserstufen und Tiefenlinien (Isobathen). Landmaske aus
// den Küstenlinien gerastert; einmal je Sitzung berechnet und als Textur wiederverwendet.
// Darüber: Tintenküste und ein zartes Hexraster.
import { CanvasSource, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { MAP_BOUNDS } from "./gestures.ts";
import {
  COLS, HEX_SIZE_KM, HEX_W, ISLANDS, KM_PER_DEG_LAT, KM_PER_DEG_LON, LAND, LAT1, LON0, ROWS, ROW_H, WATER, WATER_DRAW, hexCenterXY,
} from "@tidefront/world";

export function hexPoints(cx: number, cy: number, size: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    pts.push(cx + size * Math.cos(a), cy + size * Math.sin(a));
  }
  return pts;
}

export const xyOf = (lon: number, lat: number) => ({ x: (lon - LON0) * KM_PER_DEG_LON, y: (LAT1 - lat) * KM_PER_DEG_LAT });

/** Rasterauflösung: Kilometer je Pixel. */
const KM_PX = 5;
const X0 = -HEX_W;
const Y0 = -HEX_SIZE_KM * 1.2;
const W = Math.ceil((HEX_W * (COLS + 1.5)) / KM_PX);
const H = Math.ceil((ROW_H * (ROWS - 1) + HEX_SIZE_KM * 2.4) / KM_PX);

/** Gebirge als Höhenbuckel: Länge, Breite, Radius in km, Höhe (0..1). */
const RIDGES: [number, number, number, number][] = [
  [10, 46.5, 260, 1], [7, 45.5, 160, 0.8], [13.5, 47, 200, 0.8], // Alpen
  [0.5, 42.7, 170, 0.75], // Pyrenäen
  [-4, 40.5, 280, 0.3], [-3.2, 37.1, 120, 0.5], // Iberische Meseta, Sierra Nevada
  [13, 42.5, 220, 0.55], [16, 40, 160, 0.4], // Apennin
  [20, 42.3, 260, 0.6], [22.5, 39.5, 180, 0.5], // Dinariden, Pindos
  [25, 42, 200, 0.45], [33, 38.5, 380, 0.6], [37, 37.5, 200, 0.55], // Balkan, Anatolien, Taurus
  [-5, 31.5, 380, 0.85], [2, 34.5, 260, 0.45], // Atlas
  [9, 61.5, 330, 0.75], [15, 66, 320, 0.7], [18.5, 68.5, 260, 0.6], // Skanden
  [-4.5, 57, 150, 0.45], [-3.8, 52.6, 110, 0.35], // Schottland, Wales
  [-18.5, 64.8, 160, 0.6], // Island
  [-80, 37, 320, 0.45], [-77, 40.5, 260, 0.35], [-72.5, 44, 220, 0.35], // Appalachen
  [-64, 54, 420, 0.35], [-66, 58.5, 260, 0.4], // Labrador
  [-42, 67, 520, 0.9], [-46, 63, 420, 0.8], [-38, 71, 420, 0.95], // Grönland
  [24, 47, 260, 0.45], [36, 33.5, 140, 0.4], [4.5, 50, 180, 0.2], [9, 50.5, 220, 0.25],
];

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v / 0.9375;
}

const toPx = (lon: number, lat: number) => {
  const p = xyOf(lon, lat);
  return [(p.x - X0) / KM_PX, (p.y - Y0) / KM_PX] as const;
};

function ringPath(ctx: CanvasRenderingContext2D, ring: readonly (readonly [number, number])[]): void {
  ring.forEach(([lon, lat], i) => {
    const [x, y] = toPx(lon, lat);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Landanteil in der Umgebung (0..1) durch Verkleinern und weiches Vergrößern der Maske. */
function proximity(mask: HTMLCanvasElement, factor: number): Uint8ClampedArray {
  const [small, sctx] = canvas(Math.max(2, Math.ceil(W / factor)), Math.max(2, Math.ceil(H / factor)));
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(mask, 0, 0, small.width, small.height);
  const [, bctx] = canvas(W, H);
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(small, 0, 0, W, H);
  return bctx.getImageData(0, 0, W, H).data;
}

type RGB = [number, number, number];
const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const C = {
  sea: hex(0xf4f1e7), sea1: hex(0xe9eee6), sea2: hex(0xdbe7e2), sea3: hex(0xc9dcd8), isobath: hex(0x8eaaad),
  land: hex(0xe6d5a9), land2: hex(0xdcc792), ink: hex(0x18273a), hachure: hex(0x6b5a3a), ice: hex(0xf1ece0),
};

function landBase(lon: number, lat: number, e: number, n: number): RGB {
  let c = lerp(C.land, C.land2, clamp01(n * 0.8 - 0.15));
  const greenland = lon < -20 && lon > -62 && lat > 59.5;
  if (greenland || (lon < -62 && lat > 66)) c = lerp(c, C.ice, smooth(0.25, 0.5, e));
  return c;
}

/** Flachwasserstufe 0..3 aus dem Landanteil der Umgebung. */
function seaBand(nr: number, fr: number): number {
  return nr > 0.42 ? 3 : nr > 0.12 ? 2 : fr > 0.16 ? 1 : 0;
}

let cached: HTMLCanvasElement | null = null;

/** Berechnet das Reliefbild (einmal je Sitzung). */
export function terrainCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  const [mask, mctx] = canvas(W, H);
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  for (const r of LAND) ringPath(mctx, r);
  mctx.fill("nonzero");
  mctx.globalCompositeOperation = "destination-out";
  mctx.beginPath();
  for (const r of WATER) ringPath(mctx, r);
  for (const r of WATER_DRAW) ringPath(mctx, r); // Kanäle und Meerengen: nur Bild, kein Gelände
  mctx.fill("nonzero");
  mctx.globalCompositeOperation = "source-over";
  for (const [lon, lat] of ISLANDS) {
    const [x, y] = toPx(lon, lat);
    mctx.beginPath();
    mctx.ellipse(x, y, 3.2 + hash(Math.round(x), 1) * 2, 2.4 + hash(Math.round(y), 2) * 1.6, hash(Math.round(x), Math.round(y)) * 3, 0, Math.PI * 2);
    mctx.fill();
  }
  const m = mctx.getImageData(0, 0, W, H).data;
  const near = proximity(mask, 6); // ~30 km
  const far = proximity(mask, 28); // ~140 km

  // Höhe
  const elev = new Float32Array(W * H);
  const ridgePx = RIDGES.map(([lon, lat, r, h]) => { const [x, y] = toPx(lon, lat); return [x, y, r / KM_PX, h] as const; });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const land = m[i * 4 + 3] / 255;
      const n = fbm(x / 38, y / 38);
      let e: number;
      if (land > 0.5) {
        const inland = far[i * 4 + 3] / 255;
        e = 0.12 + inland * 0.28 + (n - 0.5) * 0.35;
        for (const [rx, ry, rr, rh] of ridgePx) {
          const dx = x - rx, dy = y - ry;
          const d2 = (dx * dx + dy * dy) / (rr * rr);
          if (d2 < 4) e += rh * Math.exp(-d2 * 1.6) * (0.65 + n * 0.7);
        }
      } else {
        e = -0.6 + (near[i * 4 + 3] / 255) * 0.5 + (n - 0.5) * 0.06;
      }
      elev[i] = e;
    }
  }

  const [out, octx] = canvas(W, H);
  const img = octx.createImageData(W, H);
  const d = img.data;
  const band = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) band[i] = m[i * 4 + 3] > 127 ? 9 : seaBand(near[i * 4 + 3] / 255, far[i * 4 + 3] / 255);
  const SEA = [C.sea, C.sea1, C.sea2, C.sea3];
  for (let y = 0; y < H; y++) {
    const lat = LAT1 - (Y0 + y * KM_PX) / KM_PER_DEG_LAT;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lon = LON0 + (X0 + x * KM_PX) / KM_PER_DEG_LON;
      const n = hash(x, y);
      let c: RGB;
      if (band[i] === 9) {
        const e = elev[i];
        c = landBase(lon, lat, e, fbm(x / 9, y / 9));
        // Bergstriche: kurze Schraffen in Hanglage
        const eRough = e + (fbm(x / 9, y / 9) - 0.5) * 0.4;
        const hill = smooth(0.5, 1.0, eRough);
        if (hill > 0 && (x - y + 300000) % 3 === 0 && n > 0.25) c = lerp(c, C.hachure, hill * 0.55);
        // Küstenschraffur: diagonale Tintenlinien in einem schmalen Saum an der Küste
        const coast = smooth(0.985, 0.72, near[i * 4 + 3] / 255);
        if (coast > 0 && (x + y) % 3 === 0) c = lerp(c, C.ink, coast * 0.42);
        const s2 = 1 + (n - 0.5) * 0.03;
        c = [c[0] * s2, c[1] * s2, c[2] * s2];
      } else {
        const b0 = band[i];
        c = SEA[b0];
        // Tiefenlinie an jeder Stufengrenze; die äußere gestrichelt
        const r1 = x + 1 < W ? band[i + 1] : b0, d1 = y + 1 < H ? band[i + W] : b0;
        const edge = (r1 !== b0 && r1 !== 9) || (d1 !== b0 && d1 !== 9);
        if (edge) {
          const lo = Math.min(b0, r1 === 9 ? b0 : r1, d1 === 9 ? b0 : d1);
          if (lo >= 1 || (x + y) % 6 < 3) c = lerp(c, C.isobath, 0.85);
        }
        const s2 = 1 + (n - 0.5) * 0.02;
        c = [c[0] * s2, c[1] * s2, c[2] * s2];
      }
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  cached = out;
  return out;
}

/** Begrenzungsrahmen der Kanäle/Meerengen [lonMin, latMin, lonMax, latMax]. */
const PASSAGE_BOXES = WATER_DRAW.map((r) => [
  Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1])),
]);

/** Punkt in Polygon (Längen-/Breitengrad, Strahlverfahren). */
function inPoly(lon: number, lat: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Geschlossenen Küstenzug in zusammenhängende Stücke außerhalb der Kanäle/Meerengen zerlegen (Teilschritte ~3 km).
 * `emit` erhält je Stück die Punkte in Weltkoordinaten.
 */
function coastRuns(ring: readonly (readonly [number, number])[], emit: (pts: { x: number; y: number }[]) => void): void {
  const STEP_DEG = 0.03;
  let run: { x: number; y: number }[] = [];
  const flush = () => { if (run.length > 1) emit(run); run = []; };
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    // Nur Abschnitte nahe einem Kanal fein unterteilen; sonst bleibt es bei den Eckpunkten.
    const near = PASSAGE_BOXES.some((q) => Math.max(ax, bx) >= q[0] && Math.min(ax, bx) <= q[2] && Math.max(ay, by) >= q[1] && Math.min(ay, by) <= q[3]);
    const n = near ? Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP_DEG)) : 1;
    for (let k = 0; k <= n; k++) {
      const lon = ax + ((bx - ax) * k) / n, lat = ay + ((by - ay) * k) / n;
      if (WATER_DRAW.some((w) => inPoly(lon, lat, w))) { flush(); continue; }
      if (k === 0 && run.length > 0) continue; // Eckpunkt schon als Ende des vorigen Stücks enthalten
      run.push(xyOf(lon, lat));
    }
  }
  flush();
}

export interface TerrainLayers {
  root: Container;
  /** Zartes Hexraster; Deckkraft je Zoom setzt der Aufrufer. */
  grid: Graphics;
  /** Küste je Zoom anpassen: in der Übersicht feine Haarlinie statt Tintenstrich mit Saum. */
  setOverview: (scale: number) => void;
}

/** Reliefbild, Küstenlinie und Hexraster in Weltkoordinaten (km). */
/**
 * `clip` erzeugt ein Maskenrechteck der Karte (Weltkoordinaten) für die Küstenlinien; das Reliefbild wird direkt auf
 * den Kartenrahmen zugeschnitten.
 */
export function buildTerrain(clip?: () => Graphics): TerrainLayers {
  const root = new Container();
  // Mipmaps: in der Übersicht wird das Relief sauber verkleinert statt flimmernder Schraffur-Moiré.
  const source = new CanvasSource({ resource: terrainCanvas(), autoGenerateMipmaps: true, scaleMode: "linear", mipmapFilter: "linear", maxAnisotropy: 4 });
  // Bild auf den Kartenrahmen zuschneiden (Textur-Ausschnitt statt Maske): das Relief ist an den Rändern etwas größer.
  const b = MAP_BOUNDS;
  const fx = Math.max(0, Math.floor((b.x0 - X0) / KM_PX));
  const fy = Math.max(0, Math.floor((b.y0 - Y0) / KM_PX));
  const fw = Math.min(W - fx, Math.ceil((b.x1 - b.x0) / KM_PX));
  const fh = Math.min(H - fy, Math.ceil((b.y1 - b.y0) / KM_PX));
  const sprite = new Sprite(new Texture({ source, frame: new Rectangle(fx, fy, fw, fh) }));
  sprite.position.set(X0 + fx * KM_PX, Y0 + fy * KM_PX);
  sprite.scale.set(KM_PX);
  root.addChild(sprite);

  // Küstenlinien als Teilstücke; in Kanälen und Meerengen (WATER_DRAW) bleiben sie weg, damit dort keine Linie quer
  // übers Wasser läuft (die Ufer zeichnet die Küstenschraffur im Relief).
  const coast = new Graphics();
  const glow = new Graphics();
  const hair = new Graphics();
  for (const ring of [...LAND, ...WATER]) coastRuns(ring, (pts) => {
    for (const g of [coast, glow, hair]) {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    }
  });
  glow.stroke({ color: 0xf4f1e7, width: 7, alpha: 0.55, join: "round" });
  coast.stroke({ color: 0x18273a, width: 1.8, alpha: 0.9, join: "round" });
  // Übersicht: dieselbe Küste als 1-px-Haarlinie (die Weltbreite würde dort zu Grau verschwimmen)
  hair.stroke({ color: 0x18273a, width: 1, pixelLine: true, alpha: 0.7 });
  const shoreClip = new Container(); // Küstenlinien enden am Kartenrand
  shoreClip.addChild(glow, coast, hair);
  if (clip) { const m = clip(); root.addChild(m); shoreClip.mask = m; }
  root.addChild(shoreClip);

  const grid = new Graphics();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const { x, y } = hexCenterXY(col, row);
    grid.poly(hexPoints(x, y, HEX_SIZE_KM));
  }
  grid.stroke({ color: 0x18273a, width: 1.2, alpha: 1 });
  grid.alpha = 0;
  root.addChild(grid);
  const setOverview = (scale: number) => {
    // Unterhalb ~0,45 ist der Weltstrich dünner als ein Pixel: dann Haarlinie, darüber Tintenstrich
    const t = Math.max(0, Math.min(1, (scale - 0.35) / 0.2));
    coast.alpha = t;
    coast.visible = t > 0.01;
    hair.alpha = 1 - t;
    hair.visible = t < 0.99;
    glow.alpha = 0.4 + 0.6 * t;
  };
  return { root, grid, setOverview };
}
