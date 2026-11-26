// Wetterschicht der Karte im Stil einer alten Wetterkarte: Tiefs (T) und Hochs (H) mit Isobaren, Windpfeile,
// weiche Wolkenfelder mit Regen, Sturmzellen mit Blitz und Nebelschleier. Dasselbe deterministische Wetterfeld
// wie auf dem Server (game-core/weather.ts), grob abgetastet (jedes dritte Feld). Neu gezeichnet alle 15 Minuten
// oder bei deutlicher Zoomänderung; die T/H-Schilder behalten bei jedem Zoom ihre Bildschirmgröße.
import { Container, Graphics, Text } from "pixi.js";
import { weatherAt, weatherSystemsAt, type WeatherBalance } from "@tidefront/game-core";
import { COLS, HEX_SIZE_KM, terrainAt, KM_PER_DEG_LAT, KM_PER_DEG_LON, LAT1, LON0, ROWS, hexCenter, hexCenterXY } from "@tidefront/world";
import { weatherAlpha } from "./lod.ts";
import { INK, PAPER, SEE, SIEGEL } from "./symbols.ts";

/** Abtastung: jedes STEP-te Feld in beide Richtungen. */
const STEP = 3;
const REDRAW_MS = 15 * 60000;
const CLOUD = 0x8c96a3;
const FOG = 0xdfe8ee;
const SERIF = "Fraunces, Georgia, serif";
/** Ab diesem Zoom werden betroffene Felder einzeln eingefärbt (Sturm, Nebel, dichte Wolken). */
const HEX_FROM = 0.42;

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
  /** Neu zeichnen, wenn 15 Minuten vergangen sind oder der Zoom sich um mehr als 15 % geändert hat. */
  update(nowMs: number, scale: number): void;
}

interface Cell {
  x: number;
  y: number;
  lat: number;
  lon: number;
  /** Fester Zufallswert je Zelle für Wolkenform und Auswahl. */
  r: number;
}

const toXY = (lat: number, lon: number) => ({ x: (lon - LON0) * KM_PER_DEG_LON, y: (LAT1 - lat) * KM_PER_DEG_LAT });

/** Windrichtung (Einheitsvektor in Kartenkoordinaten, y nach unten) aus Westwind und den Wirbeln der Systeme. */
function windDir(x: number, y: number, systems: { x: number; y: number; radiusKm: number; sign: number; strength: number }[]) {
  let vx = 0.35;
  let vy = 0;
  for (const s of systems) {
    const dx = x - s.x;
    const dy = y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const q = d / s.radiusKm;
    const w = s.strength * Math.exp(-q * q) * Math.min(1, q * 2.5);
    // Tief: gegen den Uhrzeigersinn und leicht einwärts; Hoch: im Uhrzeigersinn und leicht auswärts (Nordhalbkugel).
    vx += w * (s.sign * (dy / d) - s.sign * 0.3 * (dx / d));
    vy += w * (s.sign * (-dx / d) - s.sign * 0.3 * (dy / d));
  }
  const n = Math.hypot(vx, vy) || 1;
  return { x: vx / n, y: vy / n };
}

/** Gestrichelter Kreis (Isobare). */
function dashedRing(g: Graphics, cx: number, cy: number, r: number, dash: number): void {
  const n = Math.max(12, Math.round((2 * Math.PI * r) / (dash * 2)));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = a0 + Math.PI / n;
    g.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)).arc(cx, cy, r, a0, a1);
  }
}

function pressureLabel(low: boolean): Container {
  const c = new Container();
  const ring = new Graphics().circle(0, 0, 13).fill({ color: PAPER, alpha: 0.92 }).stroke({ color: low ? SIEGEL : SEE, width: 1.6 });
  const t = new Text({ text: low ? "T" : "H", style: { fontFamily: SERIF, fontWeight: "700", fontSize: 17, fill: low ? SIEGEL : SEE } });
  t.anchor.set(0.5, 0.55);
  c.addChild(ring, t);
  return c;
}

export function buildWeatherLayer(wb: WeatherBalance): WeatherLayer {
  const root = new Container();
  const atmos = new Container();
  const wash = new Graphics();
  const lines = new Graphics();
  const labels = new Container();
  const fields = new Graphics();
  const fieldLines = new Graphics();
  atmos.addChild(wash, lines);
  root.addChild(fields, fieldLines, atmos, labels);
  const cells: Cell[] = [];
  for (let row = 1; row < ROWS; row += STEP) {
    for (let col = 1; col < COLS; col += STEP) {
      const { x, y } = hexCenterXY(col, row);
      const { lat, lon } = hexCenter(col, row);
      cells.push({ x, y, lat, lon, r: ((col * 73856093) ^ (row * 19349663)) % 1000 / 1000 });
    }
  }
  const cellKm = hexCenterXY(STEP, 0).x - hexCenterXY(0, 0).x;
  let drawnAt = -1;
  let drawnScale = 0;

  function draw(ms: number, scale: number): void {
    wash.clear();
    lines.clear();
    for (const l of labels.removeChildren()) l.destroy({ children: true });
    const px = 1 / scale;
    const half = cellKm * 0.55;
    const systems = weatherSystemsAt(ms, wb).filter((s) => s.strength > 0.2).map((s) => ({ ...s, ...toXY(s.lat, s.lon) }));
    const samples = cells.map((c) => ({ c, w: weatherAt({ lat: c.lat, lon: c.lon }, ms, wb) }));

    // Wolkenfelder: zwei bis drei weiche Ballen je Zelle, Deckkraft nach Bedeckung; darunter Sturm- und Nebelschleier.
    for (const { c, w } of samples) {
      if (w.storm) wash.circle(c.x, c.y, half * 1.15).fill({ color: SIEGEL, alpha: 0.1 });
      if (w.fog >= 0.35) wash.ellipse(c.x, c.y, half * 1.2, half * 0.55).fill({ color: FOG, alpha: 0.35 + 0.35 * w.fog });
      if (w.clouds < 0.4) continue;
      const a = Math.min(0.17, (w.clouds - 0.4) * 0.34);
      const puffs = w.clouds > 0.7 ? 4 : 3;
      for (let i = 0; i < puffs; i++) {
        // Form je Zelle fest, aber ungleichmäßig: Winkel, Abstand und Größe aus dem Zellwert gestreut.
        const k = (c.r * 7.13 + i * 0.618) % 1;
        const ang = (c.r + i / puffs + k * 0.3) * 2 * Math.PI;
        const dist = half * (0.25 + 0.55 * k);
        const rr = half * (0.45 + 0.4 * w.clouds) * (0.7 + 0.6 * ((k * 3.7) % 1));
        wash.ellipse(c.x + Math.cos(ang) * dist, c.y + Math.sin(ang) * dist * 0.7, rr * 1.25, rr * 0.8).fill({ color: CLOUD, alpha: a });
      }
    }

    // Isobaren um Tiefs und Hochs.
    for (const s of systems) {
      for (const f of [0.35, 0.65, 0.95]) dashedRing(lines, s.x, s.y, s.radiusKm * f, 7 * px);
    }
    lines.stroke({ color: INK, width: 1 * px, alpha: 0.28 });

    // Regen unter dichten Wolken.
    for (const { c, w } of samples) {
      if (w.clouds < 0.72 || w.storm) continue;
      for (let k = -1; k <= 1; k++) {
        const x0 = c.x + k * half * 0.4;
        lines.moveTo(x0, c.y + half * 0.15).lineTo(x0 - half * 0.15, c.y + half * 0.55);
      }
    }
    lines.stroke({ color: SEE, width: 1.2 * px, alpha: 0.5 });

    // Windpfeile mit Fiedern (ab Wind 0,25; jede zweite Zelle, damit es ruhig bleibt).
    samples.forEach(({ c, w }, i) => {
      if (w.wind < 0.25 || i % 2 === 1) return;
      const d = windDir(c.x, c.y, systems);
      const len = half * (0.7 + 0.9 * w.wind);
      const tx = c.x + (d.x * len) / 2;
      const ty = c.y + (d.y * len) / 2;
      const bx = c.x - (d.x * len) / 2;
      const by = c.y - (d.y * len) / 2;
      lines.moveTo(bx, by).lineTo(tx, ty);
      const h = half * 0.22;
      lines.moveTo(tx, ty).lineTo(tx - d.x * h - d.y * h * 0.6, ty - d.y * h + d.x * h * 0.6);
      lines.moveTo(tx, ty).lineTo(tx - d.x * h + d.y * h * 0.6, ty - d.y * h - d.x * h * 0.6);
      const barbs = w.wind >= 0.8 ? 3 : w.wind >= 0.6 ? 2 : w.wind >= 0.4 ? 1 : 0;
      for (let b = 0; b < barbs; b++) {
        const ox = bx + d.x * half * 0.18 * b;
        const oy = by + d.y * half * 0.18 * b;
        lines.moveTo(ox, oy).lineTo(ox + d.y * half * 0.28 - d.x * half * 0.1, oy - d.x * half * 0.28 - d.y * half * 0.1);
      }
    });
    lines.stroke({ color: INK, width: 1.15 * px, alpha: 0.5 });

    // Sturm: Blitz in jeder zweiten Sturmzelle, Nebel: gepunktete Linien.
    samples.forEach(({ c, w }, i) => {
      if (!w.storm || i % 2 === 1) return;
      const s = half * 0.4;
      lines.moveTo(c.x + s * 0.3, c.y - s).lineTo(c.x - s * 0.25, c.y + s * 0.05).lineTo(c.x + s * 0.2, c.y + s * 0.05).lineTo(c.x - s * 0.3, c.y + s);
    });
    lines.stroke({ color: SIEGEL, width: 2 * px, alpha: 0.85 });
    for (const { c, w } of samples) {
      if (w.fog < 0.45) continue;
      for (let r = -1; r <= 1; r++) {
        const yy = c.y + r * half * 0.3;
        for (let k = -2; k <= 2; k++) lines.moveTo(c.x + k * half * 0.32 - half * 0.08, yy).lineTo(c.x + k * half * 0.32 + half * 0.08, yy);
      }
    }
    lines.stroke({ color: SEE, width: 1.4 * px, alpha: 0.45 });

    // Nah dran: jedes Feld mit eigenem Wetterzeichen – genau dort wirkt das Wetter (Route, Radar, Kampfort).
    fields.clear();
    fieldLines.clear();
    if (scale >= HEX_FROM) {
      const r = HEX_SIZE_KM * 0.97;
      const wind: number[][] = [];
      const rain: number[][] = [];
      const fog: number[][] = [];
      const bolts: number[][] = [];
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (terrainAt(col, row) === "land") continue;
          const { lat, lon } = hexCenter(col, row);
          const w = weatherAt({ lat, lon }, ms, wb);
          const { x, y } = hexCenterXY(col, row);
          const poly = hexPoly(x, y, r);
          if (w.storm) fields.poly(poly).fill({ color: SIEGEL, alpha: 0.16 }).stroke({ color: SIEGEL, width: 1.6 * px, alpha: 0.7 });
          else if (w.fog >= 0.45) fields.poly(poly).fill({ color: SEE, alpha: 0.08 + 0.12 * w.fog });
          else if (w.clouds >= 0.5) fields.poly(poly).fill({ color: CLOUD, alpha: (w.clouds - 0.5) * 0.45 });
          if (w.storm) bolts.push([x, y]);
          if (w.fog >= 0.45) fog.push([x, y]);
          if (w.clouds >= 0.72 && !w.storm) rain.push([x, y]);
          if (w.wind >= 0.15) wind.push([x, y, w.wind]);
        }
      }
      const R = HEX_SIZE_KM;
      for (const [x, y, v] of wind) {
        const d = windDir(x, y, systems);
        const len = R * 0.75;
        const tx = x + (d.x * len) / 2, ty = y + (d.y * len) / 2;
        const bx = x - (d.x * len) / 2, by = y - (d.y * len) / 2;
        const h = R * 0.2;
        fieldLines.moveTo(bx, by).lineTo(tx, ty);
        fieldLines.moveTo(tx - d.x * h - d.y * h * 0.55, ty - d.y * h + d.x * h * 0.55).lineTo(tx, ty).lineTo(tx - d.x * h + d.y * h * 0.55, ty - d.y * h - d.x * h * 0.55);
        const barbs = v >= 0.8 ? 3 : v >= 0.6 ? 2 : v >= 0.4 ? 1 : 0;
        for (let b = 0; b < barbs; b++) {
          const ox = bx + d.x * R * 0.13 * b, oy = by + d.y * R * 0.13 * b;
          fieldLines.moveTo(ox, oy).lineTo(ox + d.y * R * 0.24 - d.x * R * 0.08, oy - d.x * R * 0.24 - d.y * R * 0.08);
        }
      }
      fieldLines.stroke({ color: INK, width: 1.6 * px, alpha: 0.75 });
      for (const [x, y] of rain) {
        for (let k = -1; k <= 1; k++) fieldLines.moveTo(x + k * R * 0.3 + R * 0.08, y + R * 0.3).lineTo(x + k * R * 0.3 - R * 0.04, y + R * 0.6);
      }
      fieldLines.stroke({ color: SEE, width: 1.6 * px, alpha: 0.8 });
      for (const [x, y] of fog) {
        for (const yy of [-0.35, 0.45]) for (let k = -2; k <= 2; k++) fieldLines.moveTo(x + k * R * 0.22 - R * 0.06, y + yy * R).lineTo(x + k * R * 0.22 + R * 0.06, y + yy * R);
      }
      fieldLines.stroke({ color: SEE, width: 1.6 * px, alpha: 0.7 });
      for (const [x, y] of bolts) {
        const b = R * 0.3;
        fieldLines.moveTo(x + R * 0.45 + b * 0.3, y - R * 0.5 - b).lineTo(x + R * 0.45 - b * 0.25, y - R * 0.5 + b * 0.05).lineTo(x + R * 0.45 + b * 0.2, y - R * 0.5 + b * 0.05).lineTo(x + R * 0.45 - b * 0.3, y - R * 0.5 + b);
      }
      fieldLines.stroke({ color: SIEGEL, width: 2.2 * px, alpha: 0.95 });
    }

    // Schilder T (Tief) und H (Hoch) in der Mitte der Systeme.
    for (const s of systems) {
      const l = pressureLabel(s.sign > 0);
      l.position.set(s.x, s.y);
      labels.addChild(l);
    }
  }

  return {
    root,
    update(nowMs: number, scale: number): void {
      // Übersicht (Wetterkarte) blendet aus, Feldzeichen blenden ein; T/H bleiben immer.
      const near = Math.max(0, Math.min(1, (scale - HEX_FROM) / 0.12));
      atmos.alpha = weatherAlpha(scale) * (1 - near);
      fields.alpha = near;
      fieldLines.alpha = near;
      for (const l of labels.children) l.scale.set(Math.max(0.6, Math.min(1.1, scale / 0.3 + 0.3)) / scale);
      const slot = Math.floor(nowMs / REDRAW_MS) * REDRAW_MS;
      const sameMode = (scale >= HEX_FROM) === (drawnScale >= HEX_FROM);
      if (slot === drawnAt && drawnScale > 0 && sameMode && Math.abs(Math.log(scale / drawnScale)) < 0.15) return;
      drawnAt = slot;
      drawnScale = scale;
      draw(slot, scale);
      for (const l of labels.children) l.scale.set(Math.max(0.6, Math.min(1.1, scale / 0.3 + 0.3)) / scale);
    },
  };
}
