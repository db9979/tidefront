// Auswahlmarke und Hafen-Überlagerung (Mehrere Häfen): Zielwinkel um das gewählte Feld, Doppelring um den aktiven
// Hafen und gestrichelter Reichweitenkreis der Gründung. Strichstärken in Bildschirmpixeln (÷ Zoom).
import type { Graphics } from "pixi.js";
import { HEX_SIZE_KM, hexCenter, hexCenterXY } from "@tidefront/world";
import { hexPoints, xyOf } from "./terrain.ts";
import { INK, SIEGEL } from "./symbols.ts";

export interface HarborOverlay {
  /** Aktiver Hafen (Doppelring, nur bei mehreren eigenen Häfen). */
  active: { col: number; row: number } | null;
  /** Mehrere eigene Häfen: aktiven hervorheben. */
  multi?: boolean;
  /** Reichweite der Gründung um den aktiven Hafen (km); null = aus. */
  rangeKm: number | null;
}

const MESSING = 0x8a6424;

/** Punkte im Abstand km um (lat, lon) auf der Kugel, in Kartenkoordinaten (Kreis bleibt im Kartenbild korrekt verzerrt). */
function rangeRing(lat: number, lon: number, km: number, steps = 96): number[] {
  const rad = Math.PI / 180;
  const d = km / 6371;
  const la1 = lat * rad;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    const lo2 = lon * rad + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    const p = xyOf(lo2 / rad, la2 / rad);
    out.push(p.x, p.y);
  }
  return out;
}

function drawHarbors(g: Graphics, sc: number, o: HarborOverlay): void {
  if (!o.active) return;
  const { x, y } = hexCenterXY(o.active.col, o.active.row);
  if (o.rangeKm) {
    const c = hexCenter(o.active.col, o.active.row);
    const pts = rangeRing(c.lat, c.lon, o.rangeKm);
    g.poly(pts).fill({ color: MESSING, alpha: 0.05 });
    // Gestrichelt: jeder zweite Abschnitt
    for (let i = 0; i < pts.length; i += 4) {
      const j = (i + 2) % pts.length;
      g.moveTo(pts[i], pts[i + 1]).lineTo(pts[j], pts[j + 1]);
    }
    g.stroke({ color: MESSING, width: 1.8 / sc, alpha: 0.85 });
  }
  if (o.multi) {
    const r = Math.max(HEX_SIZE_KM * 0.9, 20 / sc);
    g.circle(x, y, r).stroke({ color: MESSING, width: 2.4 / sc, alpha: 0.95 });
    g.circle(x, y, r + 4 / sc).stroke({ color: INK, width: 1 / sc, alpha: 0.7 });
  }
}

export function drawSelection(g: Graphics, sc: number, selected: { col: number; row: number } | null | undefined, harbors?: HarborOverlay | null): void {
  g.clear();
  if (harbors) drawHarbors(g, sc, harbors);
  if (!selected) return;
  const { x, y } = hexCenterXY(selected.col, selected.row);
  // Zielmarke: Eckwinkel um das Feld, mindestens 22 px Halbmesser am Bildschirm
  const h = Math.max(HEX_SIZE_KM * 1.05, 22 / sc);
  const l = h * 0.42;
  g.poly(hexPoints(x, y, HEX_SIZE_KM)).fill({ color: SIEGEL, alpha: 0.06 }).stroke({ color: SIEGEL, width: 1 / sc, alpha: 0.6 });
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.moveTo(x + sx * h, y + sy * (h - l)).lineTo(x + sx * h, y + sy * h).lineTo(x + sx * (h - l), y + sy * h);
  }
  g.stroke({ color: SIEGEL, width: 2 / sc, cap: "square" });
  g.circle(x, y, 1.6 / sc).fill({ color: SIEGEL });
}
