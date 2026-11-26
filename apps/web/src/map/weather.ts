// Wetterschicht der Karte (v1.6): Wolken als zarte Kupferstich-Schraffur, Sturmgebiete als rote Kreuzschraffur,
// Nebel als gepunktete Linien. Dasselbe deterministische Wetterfeld wie auf dem Server (game-core/weather.ts),
// grob abgetastet (jedes dritte Feld) und nur zur vollen Stunde oder bei deutlicher Zoomänderung neu gezeichnet.
import { Graphics } from "pixi.js";
import { weatherAt, type WeatherBalance } from "@tidefront/game-core";
import { COLS, ROWS, hexCenter, hexCenterXY } from "@tidefront/world";
import { INK, SEE, SIEGEL } from "./symbols.ts";

/** Abtastung: jedes STEP-te Feld in beide Richtungen. */
const STEP = 3;
const HOUR_MS = 3600000;

export interface WeatherLayer {
  root: Graphics;
  /** Neu zeichnen, wenn Stunde oder Zoom (um mehr als 15 %) sich geändert haben. */
  update(nowMs: number, scale: number): void;
}

interface Cell {
  x: number;
  y: number;
  lat: number;
  lon: number;
}

export function buildWeatherLayer(wb: WeatherBalance): WeatherLayer {
  const root = new Graphics();
  const cells: Cell[] = [];
  for (let row = 1; row < ROWS; row += STEP) {
    for (let col = 1; col < COLS; col += STEP) {
      const { x, y } = hexCenterXY(col, row);
      const { lat, lon } = hexCenter(col, row);
      cells.push({ x, y, lat, lon });
    }
  }
  const cellKm = hexCenterXY(STEP, 0).x - hexCenterXY(0, 0).x;
  let drawnHour = -1;
  let drawnScale = 0;

  function draw(hourMs: number, scale: number): void {
    root.clear();
    const px = 1 / scale;
    const half = cellKm * 0.55;
    const clouds: [number, number, number][] = [];
    for (const c of cells) {
      const w = weatherAt({ lat: c.lat, lon: c.lon }, hourMs, wb);
      // Wolken: 1–4 Schraffurstriche je nach Bedeckung (ab 45 %).
      if (w.clouds >= 0.45) clouds.push([c.x, c.y, Math.min(4, 1 + Math.floor((w.clouds - 0.45) / 0.14))]);
      if (w.storm) {
        for (const d of [-0.5, 0, 0.5]) {
          const o = d * half;
          root.moveTo(c.x - half + o, c.y + half * 0.6).lineTo(c.x + o, c.y - half * 0.6);
          root.moveTo(c.x + half + o, c.y + half * 0.6).lineTo(c.x + o, c.y - half * 0.6);
        }
      }
    }
    root.stroke({ color: SIEGEL, width: 1.4 * px, alpha: 0.55 });
    for (const [x, y, n] of clouds) {
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * half * 0.45;
        root.moveTo(x - half * 0.7 + o, y + half * 0.7).lineTo(x + half * 0.7 + o, y - half * 0.7);
      }
    }
    root.stroke({ color: INK, width: 1 * px, alpha: 0.22 });
    for (const c of cells) {
      const w = weatherAt({ lat: c.lat, lon: c.lon }, hourMs, wb);
      if (w.fog < 0.35) continue;
      const rows = w.fog >= 0.6 ? 3 : 2;
      for (let r = 0; r < rows; r++) {
        const yy = c.y + (r - (rows - 1) / 2) * half * 0.35;
        for (let k = -2; k <= 2; k++) root.moveTo(c.x + k * half * 0.32 - half * 0.08, yy).lineTo(c.x + k * half * 0.32 + half * 0.08, yy);
      }
    }
    root.stroke({ color: SEE, width: 1.6 * px, alpha: 0.5 });
  }

  return {
    root,
    update(nowMs: number, scale: number): void {
      const hourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
      if (hourMs === drawnHour && drawnScale > 0 && Math.abs(Math.log(scale / drawnScale)) < 0.15) return;
      drawnHour = hourMs;
      drawnScale = scale;
      draw(hourMs, scale);
    },
  };
}
