// Wetterschicht der Karte im Stil einer alten Wetterkarte (v1.9): Isobaren aus dem Druckfeld der Tiefs (T) und
// Hochs (H), Fronten (Kaltfront, Warmfront, Okklusion), Windfahnen mit Fiedern nach den Regelschwellen, weiche
// Wolkenfelder mit Regen, Sturmwimpel und Nebelschleier. Dasselbe deterministische Wetterfeld wie auf dem Server (game-core/weather.ts).
// Leistung: Alle Wetterwerte und die Geometrie entstehen einmal je 15-Minuten-Fenster. Die Übersicht zeichnet mit
// Haarlinien (pixelLine, zoomunabhängig) und wird beim Zoomen nicht neu gezeichnet; die Feldzeichen werden nur bei
// einem Zoomsprung um etwa die Hälfte neu gestrichen. Die T/H-Schilder kommen aus einem Vorrat.
import { Container, Graphics, Text } from "pixi.js";
import { stormShare, weatherAt, weatherFrontsAt, weatherSystemsAt, type Weather, type WeatherBalance, type WeatherFront } from "@tidefront/game-core";
import { COLS, HEX_SIZE_KM, ROWS, hexCenter, hexCenterXY, terrainAt } from "@tidefront/world";
import { weatherAlpha } from "./lod.ts";
import { INK, PAPER, SEE, SIEGEL } from "./symbols.ts";
import { barbsOf, drawStormFlag, drawVane, isobars, toXY, windDir, type MapSystem } from "./weather-geo.ts";
import { FRONT_COLOR, drawFront } from "./weather-fronts.ts"; // Kalt-, Warmfront, Okklusion

/** Abtastung der Übersicht: jedes STEP-te Feld in beide Richtungen. */
const STEP = 3;
const REDRAW_MS = 15 * 60000;
const CLOUD = 0x8c96a3;
const FOG = 0xdfe8ee;
const SERIF = "Fraunces, Georgia, serif";
/** Ab diesem Zoom werden betroffene Felder einzeln gezeichnet (Sturm, Nebel, Wolken, Windfahnen). */
const HEX_FROM = 0.42;
/** Schilder T/H nur für Systeme ab dieser Stärke (sonst zu viele schwache Systeme). */
const LABEL_FROM = 0.35;
/** Zoomstufen der Feldzeichen: neu gestrichen erst, wenn der Zoom um diesen Faktor springt. */
const BUCKET = 1.5;

/** Sechseck (Spitze oben) um einen Feldmittelpunkt. */
function hexPoly(x: number, y: number, r: number): number[] {
  const pts: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 30) * Math.PI) / 180;
    pts.push(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  return pts;
}

export interface WeatherLayer {
  root: Container;
  /** Neu rechnen alle 15 Minuten; beim Zoomen nur Deckkraft, Schildgröße und gelegentlich die Feldstriche. */
  update(nowMs: number, scale: number): void;
}

interface Cell {
  x: number;
  y: number;
  lat: number;
  lon: number;
  col: number;
  row: number;
  /** Fester Zufallswert je Zelle für Wolkenform und Auswahl. */
  r: number;
}

interface FieldSample {
  x: number;
  y: number;
  w: Weather;
  share: number;
  dir: { x: number; y: number };
}

function pressureLabel(low: boolean): Container {
  const c = new Container();
  const ring = new Graphics().circle(0, 0, 13).fill({ color: PAPER, alpha: 0.92 }).stroke({ color: low ? SIEGEL : SEE, width: 1.6 });
  const t = new Text({ text: low ? "T" : "H", style: { fontFamily: SERIF, fontWeight: "700", fontSize: 17, fill: low ? SIEGEL : SEE } });
  t.anchor.set(0.5, 0.55);
  c.addChild(ring, t);
  return c;
}

const HAIR = { pixelLine: true } as const;
/** Versatz zum nächsten Seefeld: erst die direkten Nachbarn, dann die Diagonalen. */
const NEAR: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

export function buildWeatherLayer(wb: WeatherBalance): WeatherLayer {
  const root = new Container();
  const atmos = new Container();
  const wash = new Graphics();
  const lines = new Graphics();
  const flags = new Graphics();
  const labels = new Container();
  const frontLine = new Graphics();
  const frontFill = new Graphics();
  const fields = new Graphics();
  const fieldLines = new Graphics();
  const fieldFill = new Graphics();
  atmos.addChild(wash, lines, flags);
  root.addChild(fields, fieldLines, fieldFill, atmos, frontLine, frontFill, labels);
  const cells: Cell[] = [];
  for (let row = 1; row < ROWS; row += STEP) {
    for (let col = 1; col < COLS; col += STEP) {
      const { x, y } = hexCenterXY(col, row);
      const { lat, lon } = hexCenter(col, row);
      cells.push({ x, y, lat, lon, col, row, r: ((col * 73856093) ^ (row * 19349663)) % 1000 / 1000 });
    }
  }
  const sea: { col: number; row: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (terrainAt(col, row) !== "land") sea.push({ col, row });
  const vanes = vaneAnchors();
  const cellKm = hexCenterXY(STEP, 0).x - hexCenterXY(0, 0).x;
  const pool: { low: Container[]; high: Container[] } = { low: [], high: [] };
  let slotAt = -1;
  let fieldSamples: FieldSample[] | null = null;
  let fieldBucket = NaN;
  let systems: MapSystem[] = [];
  let fronts: WeatherFront[] = [];
  let frontBucket = NaN;

  /**
   * Anker der Windfahnen: jede zweite Rasterzelle; liegt ihr Feld an Land, das nächste Meer-/Küstenfeld im Umkreis
   * eines Feldes (hält den Rasterabstand). Liegt auch dort keins, entfällt die Fahne; die Nachbarzelle springt ein,
   * wenn nur sie See trifft, damit schmale Seegebiete nicht leer bleiben.
   */
  function vaneAnchors(): Cell[] {
    const out: Cell[] = [];
    const isSea = (col: number, row: number) => col >= 0 && row >= 0 && col < COLS && row < ROWS && terrainAt(col, row) !== "land";
    const near = (c: Cell): Cell | null => {
      if (isSea(c.col, c.row)) return c;
      for (const [dc, dr] of NEAR) {
        const col = c.col + dc, row = c.row + dr;
        if (!isSea(col, row)) continue;
        const { x, y } = hexCenterXY(col, row);
        const { lat, lon } = hexCenter(col, row);
        return { x, y, lat, lon, col, row, r: c.r };
      }
      return null;
    };
    cells.forEach((c, i) => {
      if (i % 2 === 1) return;
      const a = near(c) ?? (cells[i + 1] && cells[i + 1].row === c.row ? near(cells[i + 1]) : null);
      if (a) out.push(a);
    });
    return out;
  }

  /** Übersicht: einmal je Zeitfenster, Haarlinien – beim Zoomen bleibt alles stehen. */
  function drawOverview(ms: number): void {
    wash.clear();
    lines.clear();
    flags.clear();
    const half = cellKm * 0.55;
    const samples = cells.map((c) => ({ c, w: weatherAt({ lat: c.lat, lon: c.lon }, ms, wb) }));

    // Wolkenfelder (weiche Ballen nach Bedeckung), darunter Sturm- und Nebelschleier.
    for (const { c, w } of samples) {
      if (w.storm) wash.circle(c.x, c.y, half * 1.15).fill({ color: SIEGEL, alpha: 0.1 });
      else if (stormShare(w.wind, wb) > 0) wash.circle(c.x, c.y, half * 1.05).fill({ color: SIEGEL, alpha: 0.03 + 0.05 * stormShare(w.wind, wb) });
      if (w.fog >= wb.fogScoutFrom) wash.ellipse(c.x, c.y, half * 1.2, half * 0.55).fill({ color: FOG, alpha: 0.35 + 0.35 * w.fog });
      if (w.clouds < 0.4) continue;
      const a = Math.min(0.17, (w.clouds - 0.4) * 0.34);
      const puffs = w.clouds > 0.7 ? 4 : 3;
      for (let i = 0; i < puffs; i++) {
        const k = (c.r * 7.13 + i * 0.618) % 1;
        const ang = (c.r + i / puffs + k * 0.3) * 2 * Math.PI;
        const dist = half * (0.25 + 0.55 * k);
        const rr = half * (0.45 + 0.4 * w.clouds) * (0.7 + 0.6 * ((k * 3.7) % 1));
        wash.ellipse(c.x + Math.cos(ang) * dist, c.y + Math.sin(ang) * dist * 0.7, rr * 1.25, rr * 0.8).fill({ color: CLOUD, alpha: a });
      }
    }

    // Isobaren aus dem Druckfeld (Marching Squares, ein Gitterpunkt je etwa 1,5 Felder).
    for (const seg of isobars(systems, cellKm * 0.5)) {
      for (let i = 0; i < seg.length; i += 4) lines.moveTo(seg[i], seg[i + 1]).lineTo(seg[i + 2], seg[i + 3]);
    }
    lines.stroke({ color: INK, alpha: 0.4, ...HAIR });

    // Regen unter dichten Wolken.
    for (const { c, w } of samples) {
      if (w.clouds < 0.72 || w.storm) continue;
      for (let k = -1; k <= 1; k++) {
        const x0 = c.x + k * half * 0.4;
        lines.moveTo(x0, c.y + half * 0.15).lineTo(x0 - half * 0.15, c.y + half * 0.55);
      }
    }
    lines.stroke({ color: SEE, alpha: 0.6, ...HAIR });

    // Windfahnen nur über See (jede zweite Zelle, damit es ruhig bleibt; Anker ggf. aufs nächste Seefeld versetzt).
    for (const v of vanes) {
      const w = weatherAt({ lat: v.lat, lon: v.lon }, ms, wb);
      if (w.wind < 0.22) continue;
      drawVane(lines, flags, v.x, v.y, windDir(v.lat, v.lon, systems), half * 1.4, barbsOf(w.wind, wb));
    }
    lines.stroke({ color: INK, alpha: 0.75, ...HAIR });
    flags.fill({ color: INK, alpha: 0.8 });

    // Sturm: Sturmwimpel in jeder zweiten Sturmzelle; Nebel: gestrichelte Linien.
    samples.forEach(({ c, w }, i) => {
      if (!w.storm || i % 2 === 1) return;
      drawStormFlag(lines, flags, c.x + half * 0.5, c.y - half * 0.35, half * 0.4);
    });
    lines.stroke({ color: INK, alpha: 0.9, ...HAIR });
    flags.fill({ color: SIEGEL, alpha: 0.9 });
    for (const { c, w } of samples) {
      if (w.fog < wb.fogScoutFrom) continue;
      for (let r = -1; r <= 1; r++) {
        const yy = c.y + r * half * 0.3;
        for (let k = -2; k <= 2; k++) lines.moveTo(c.x + k * half * 0.32 - half * 0.08, yy).lineTo(c.x + k * half * 0.32 + half * 0.08, yy);
      }
    }
    lines.stroke({ color: SEE, alpha: 0.6, ...HAIR });
  }

  /** Feldwetter je Zeitfenster (nur Meer und Küste): Werte, Sturmanteil, Windrichtung. */
  function sampleFields(ms: number): FieldSample[] {
    return sea.map(({ col, row }) => {
      const { lat, lon } = hexCenter(col, row);
      const w = weatherAt({ lat, lon }, ms, wb);
      const { x, y } = hexCenterXY(col, row);
      return { x, y, w, share: stormShare(w.wind, wb), dir: windDir(lat, lon, systems) };
    });
  }

  /** Feldzeichen mit Strichstärke passend zur Zoomstufe `bucketScale` (Geometrie aus dem Zeitfenster). */
  function drawFields(list: FieldSample[], bucketScale: number): void {
    fields.clear();
    fieldLines.clear();
    fieldFill.clear();
    const px = 1 / bucketScale;
    const r = HEX_SIZE_KM * 0.97;
    const R = HEX_SIZE_KM;
    for (const f of list) {
      const poly = hexPoly(f.x, f.y, r);
      if (f.w.storm) fields.poly(poly).fill({ color: SIEGEL, alpha: 0.16 }).stroke({ color: SIEGEL, width: 1.6 * px, alpha: 0.7 });
      else if (f.share > 0) fields.poly(poly).fill({ color: SIEGEL, alpha: 0.03 + 0.07 * f.share }); // Schiffe gebremst
      if (!f.w.storm && f.w.fog >= wb.fogScoutFrom) fields.poly(poly).fill({ color: SEE, alpha: 0.08 + 0.12 * f.w.fog });
      else if (!f.w.storm && f.share === 0 && f.w.clouds >= 0.5) fields.poly(poly).fill({ color: CLOUD, alpha: (f.w.clouds - 0.5) * 0.45 });
    }
    for (const f of list) {
      if (f.w.wind >= 0.15) drawVane(fieldLines, fieldFill, f.x, f.y, f.dir, R * 0.9, barbsOf(f.w.wind, wb));
    }
    fieldLines.stroke({ color: INK, width: 1.5 * px, alpha: 0.75 });
    fieldFill.fill({ color: INK, alpha: 0.85 });
    for (const f of list) {
      if (f.w.clouds < 0.72 || f.w.storm) continue;
      for (let k = -1; k <= 1; k++) fieldLines.moveTo(f.x + k * R * 0.3 + R * 0.08, f.y + R * 0.3).lineTo(f.x + k * R * 0.3 - R * 0.04, f.y + R * 0.6);
    }
    fieldLines.stroke({ color: SEE, width: 1.5 * px, alpha: 0.8 });
    for (const f of list) {
      if (f.w.fog < wb.fogScoutFrom) continue;
      const rows = f.w.fog >= wb.fogScoutHeavy ? [-0.35, 0.05, 0.45] : [-0.35, 0.45];
      for (const yy of rows) for (let k = -2; k <= 2; k++) fieldLines.moveTo(f.x + k * R * 0.22 - R * 0.06, f.y + yy * R).lineTo(f.x + k * R * 0.22 + R * 0.06, f.y + yy * R);
    }
    fieldLines.stroke({ color: SEE, width: 1.5 * px, alpha: 0.7 });
    for (const f of list) if (f.w.storm) drawStormFlag(fieldLines, fieldFill, f.x + R * 0.45, f.y - R * 0.45, R * 0.28);
    fieldLines.stroke({ color: INK, width: 1.6 * px, alpha: 0.95 });
    fieldFill.fill({ color: SIEGEL, alpha: 0.95 });
  }

  /** Fronten mit Zeichen in Bildschirm-Pixeln (bei Zoomsprung neu), je Art in ihrer Farbe. */
  function drawFronts(bucketScale: number): void {
    frontLine.clear();
    frontFill.clear();
    const px = 1 / bucketScale;
    for (const kind of ["kalt", "warm", "okklusion"] as const) {
      const list = fronts.filter((f) => f.kind === kind);
      if (!list.length) continue;
      for (const f of list) drawFront(frontLine, frontFill, f, px);
      frontLine.stroke({ color: FRONT_COLOR[kind], width: 2.4 * px, alpha: 0.85, cap: "round", join: "round" });
      frontFill.fill({ color: FRONT_COLOR[kind], alpha: 0.9 });
    }
  }

  /** Schilder T/H aus dem Vorrat setzen. */
  function placeLabels(): void {
    const used = { low: 0, high: 0 };
    for (const s of systems) {
      if (s.strength < LABEL_FROM) continue;
      const kind = s.sign > 0 ? "low" : "high";
      let l = pool[kind][used[kind]];
      if (!l) {
        l = pressureLabel(kind === "low");
        pool[kind].push(l);
        labels.addChild(l);
      }
      used[kind]++;
      l.visible = true;
      l.position.set(s.x, s.y);
    }
    for (const kind of ["low", "high"] as const) for (let i = used[kind]; i < pool[kind].length; i++) pool[kind][i].visible = false;
  }

  return {
    root,
    update(nowMs: number, scale: number): void {
      // Übersicht (Wetterkarte) blendet aus, Feldzeichen blenden ein; T/H bleiben immer.
      const near = Math.max(0, Math.min(1, (scale - HEX_FROM) / 0.12));
      atmos.alpha = weatherAlpha(scale) * (1 - near);
      fields.alpha = fieldLines.alpha = fieldFill.alpha = near;
      const slot = Math.floor(nowMs / REDRAW_MS) * REDRAW_MS;
      if (slot !== slotAt) {
        slotAt = slot;
        systems = weatherSystemsAt(slot, wb).map((s) => ({ ...s, ...toXY(s.lat, s.lon) }));
        fronts = weatherFrontsAt(slot, wb, LABEL_FROM);
        frontBucket = NaN;
        drawOverview(slot);
        placeLabels();
        fieldSamples = null;
        fieldBucket = NaN;
      }
      // Fronten: in der Übersicht kräftig, nah etwas zurückgenommen (Feldzeichen haben Vorrang).
      frontLine.alpha = frontFill.alpha = weatherAlpha(scale) * (1 - 0.45 * near);
      const fb = Math.round(Math.log(scale) / Math.log(BUCKET));
      if (fb !== frontBucket) {
        frontBucket = fb;
        drawFronts(BUCKET ** fb);
      }
      if (scale >= HEX_FROM * 0.9) {
        const bucket = Math.round(Math.log(scale) / Math.log(BUCKET));
        if (!fieldSamples) fieldSamples = sampleFields(slot);
        if (bucket !== fieldBucket) {
          fieldBucket = bucket;
          drawFields(fieldSamples, BUCKET ** bucket);
        }
      }
      const ls = Math.max(0.6, Math.min(1.1, scale / 0.3 + 0.3)) / scale;
      for (const l of labels.children) l.scale.set(ls);
    },
  };
}
