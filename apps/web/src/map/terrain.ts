// Gelände im Stil eines Satellitenbilds: Landmaske aus den Küstenlinien gerastert, Höhe aus Abstand zur
// Küste, Rauschen und Gebirgen, Schummerung mit Licht aus Nordwest. Wird einmal je Sitzung berechnet
// und als Textur wiederverwendet. Darüber: feine Küstenlinie und ein sehr zartes Hexraster.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  COLS, HEX_SIZE_KM, HEX_W, ISLANDS, KM_PER_DEG_LAT, KM_PER_DEG_LON, LAND, LAT1, LON0, ROWS, ROW_H, WATER, hexCenterXY,
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
  deep: hex(0x081a29), mid: hex(0x0d2b40), shelf: hex(0x1a4656), lagoon: hex(0x26575f),
  forest: hex(0x3a4b31), meadow: hex(0x56613d), dryOlive: hex(0x7a7452), steppe: hex(0x8f8560),
  sand: hex(0xb39a6a), rock: hex(0x6e6a5d), tundra: hex(0x5f6658), boreal: hex(0x34402f), ice: hex(0xdfe5e8), snow: hex(0xeef2f3),
};

function landBase(lon: number, lat: number, e: number, n: number): RGB {
  let c: RGB = lon < -50 ? lerp(C.forest, C.meadow, n * 0.6) : lerp(C.meadow, C.forest, n * 0.7);
  // Mittelmeerklima: trockenes Oliv
  const med = smooth(46, 40, lat) * (lon > -12 && lon < 45 ? 1 : 0);
  c = lerp(c, C.dryOlive, med * 0.85);
  // Wüste und Steppe in Nordafrika und Nahost
  const desert = smooth(35, 30, lat) * (lon > -18 && lon < 45 ? 1 : 0) + smooth(37, 33, lat) * (lon > 33 ? 0.8 : 0);
  c = lerp(c, lerp(C.steppe, C.sand, smooth(33, 28, lat)), clamp01(desert));
  // Nordwälder, Tundra
  c = lerp(c, C.boreal, smooth(56, 61, lat) * 0.8);
  c = lerp(c, C.tundra, smooth(63, 68, lat) * 0.85);
  // Gebirge: Fels, Schnee in großer Höhe
  const eRough = e + (n - 0.5) * 0.45;
  c = lerp(c, C.rock, smooth(0.55, 0.95, eRough) * 0.6);
  // Schnee nur in Hochgebirgen (Alpen, Skanden, Atlas-Gipfel) und hohen Breiten
  const snowLine = 1.12 - smooth(55, 70, lat) * 0.35;
  c = lerp(c, C.snow, smooth(snowLine, snowLine + 0.25, eRough) * 0.5);
  // Inlandeis
  const greenland = lon < -20 && lon > -62 && lat > 59.5;
  if (greenland || (lon < -62 && lat > 66)) c = lerp(c, C.ice, smooth(0.25, 0.5, e));
  return c;
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
  for (let y = 0; y < H; y++) {
    const lat = LAT1 - (Y0 + y * KM_PX) / KM_PER_DEG_LAT;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lon = LON0 + (X0 + x * KM_PX) / KM_PER_DEG_LON;
      const land = m[i * 4 + 3] > 127;
      const n = hash(x, y);
      let c: RGB;
      if (land) {
        const e = elev[i];
        c = landBase(lon, lat, e, fbm(x / 9, y / 9));
        // Schummerung: Licht aus Nordwest
        const xa = Math.max(0, x - 1), ya = Math.max(0, y - 1), xb = Math.min(W - 1, x + 1), yb = Math.min(H - 1, y + 1);
        const slope = (elev[ya * W + xa] - elev[yb * W + xb]) * 9;
        const shade = 0.88 + Math.max(-0.45, Math.min(0.5, slope)) + (n - 0.5) * 0.05;
        c = [c[0] * shade, c[1] * shade, c[2] * shade];
      } else {
        const nr = near[i * 4 + 3] / 255;
        const fr = far[i * 4 + 3] / 255;
        c = lerp(C.deep, C.mid, smooth(0.02, 0.35, fr));
        c = lerp(c, C.shelf, smooth(0.05, 0.6, nr) * 0.9);
        c = lerp(c, C.lagoon, smooth(0.55, 0.95, nr) * 0.5);
        const s = 1 + (fbm(x / 60, y / 60) - 0.5) * 0.12 + (n - 0.5) * 0.025;
        c = [c[0] * s, c[1] * s, c[2] * s];
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

export interface TerrainLayers {
  root: Container;
  /** Zartes Hexraster; Deckkraft je Zoom setzt der Aufrufer. */
  grid: Graphics;
}

/** Reliefbild, Küstenlinie und Hexraster in Weltkoordinaten (km). */
export function buildTerrain(): TerrainLayers {
  const root = new Container();
  const sprite = new Sprite(Texture.from(terrainCanvas()));
  sprite.position.set(X0, Y0);
  sprite.scale.set(KM_PX);
  root.addChild(sprite);

  const coast = new Graphics();
  const glow = new Graphics();
  for (const ring of [...LAND, ...WATER]) {
    ring.forEach(([lon, lat], i) => {
      const p = xyOf(lon, lat);
      if (i === 0) { coast.moveTo(p.x, p.y); glow.moveTo(p.x, p.y); } else { coast.lineTo(p.x, p.y); glow.lineTo(p.x, p.y); }
    });
    coast.closePath();
    glow.closePath();
  }
  glow.stroke({ color: 0xbfe6f2, width: 10, alpha: 0.07, join: "round" });
  coast.stroke({ color: 0xd8ecf2, width: 2.2, alpha: 0.55, join: "round" });
  root.addChild(glow, coast);

  const grid = new Graphics();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const { x, y } = hexCenterXY(col, row);
    grid.poly(hexPoints(x, y, HEX_SIZE_KM));
  }
  grid.stroke({ color: 0xcfe8f0, width: 1.4, alpha: 1 });
  grid.alpha = 0;
  root.addChild(grid);
  return { root, grid };
}
