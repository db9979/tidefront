// Fronten auf der Wetterkarte mit den üblichen Zeichen: Kaltfront blau mit Dreiecken, Warmfront rot mit
// Halbkreisen, Okklusion violett mit beidem im Wechsel. Die Zeichen sitzen auf der Seite, in die die Front zieht
// (links in Laufrichtung des Linienzugs, siehe game-core/weather-fronts.ts). Größen in Bildschirm-Pixeln (`px`
// = Kartenkm je Pixel), gezeichnet in Kartenkoordinaten.
import type { Graphics } from "pixi.js";
import type { WeatherFront } from "@tidefront/game-core";
import { toXY } from "./weather-geo.ts";

export const FRONT_COLOR = { kalt: 0x2f5fa3, warm: 0xa8331f, okklusion: 0x6b4a7a } as const;

/** Linienzug in Kartenkoordinaten. */
export function frontPath(f: WeatherFront): { x: number; y: number }[] {
  return f.points.map((p) => toXY(p.lat, p.lon));
}

/**
 * Zeichnet eine Front: Linie und Zeichen in `line` bzw. `fill` (der Aufrufer streicht und füllt je Farbe).
 * Abstand der Zeichen etwa 26 px, Größe 6 px.
 */
export function drawFront(line: Graphics, fill: Graphics, f: WeatherFront, px: number): void {
  const pts = frontPath(f);
  if (pts.length < 2) return;
  line.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) line.lineTo(pts[i].x, pts[i].y);
  const gap = 26 * px;
  const size = 6 * px;
  let next = gap * 0.6;
  let walked = 0;
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    // Links in Laufrichtung (Kartenkoordinaten, y nach Süden): (dy, −dx).
    const nx = dy, ny = -dx;
    while (next <= walked + len) {
      const t = next - walked;
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const tri = f.kind === "kalt" || (f.kind === "okklusion" && n % 2 === 0);
      if (tri) {
        fill.poly([cx - dx * size, cy - dy * size, cx + dx * size, cy + dy * size, cx + nx * size * 1.5, cy + ny * size * 1.5]);
      } else {
        // Halbkreis: Bogen von hinten über die Zugseite nach vorn (Drehung um +90° führt −d auf die Normale).
        const start = Math.atan2(-dy, -dx);
        const steps = 8;
        const poly: number[] = [];
        for (let k = 0; k <= steps; k++) {
          const ang = start + (Math.PI * k) / steps;
          poly.push(cx + Math.cos(ang) * size, cy + Math.sin(ang) * size);
        }
        fill.poly(poly);
      }
      n++;
      next += gap;
    }
    walked += len;
  }
}
