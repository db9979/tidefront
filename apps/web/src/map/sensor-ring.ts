// Reichweitenkreis eines Sensors (Ausguck, Radar, Posten, Bordsicht, Sonar): zart getönte Fläche, Papier-Saum und
// gestrichelte Linie mit fester Bildschirmbreite – in jeder Zoomstufe klar von Wetterstrichen und Gelände zu trennen.
import type { Graphics } from "pixi.js";
import { PAPER } from "./symbols.ts";

export interface RingStyle {
  color: number;
  /** Deckkraft der Linie (0–1). */
  alpha: number;
  /** Deckkraft der Fläche innerhalb der Reichweite (0 = keine). */
  fill?: number;
  /** Strichlänge/Lücke in Bildschirmpixeln; 0 = durchgezogen. */
  dash?: number;
}

export function sensorRing(g: Graphics, x: number, y: number, r: number, sc: number, st: RingStyle): void {
  if (r <= 0) return;
  if (st.fill) g.circle(x, y, r).fill({ color: st.color, alpha: st.fill });
  g.circle(x, y, r).stroke({ color: PAPER, width: 4.5 / sc, alpha: 0.7 * st.alpha });
  const dash = st.dash ?? 10;
  if (dash <= 0) {
    g.circle(x, y, r).stroke({ color: st.color, width: 2 / sc, alpha: st.alpha });
    return;
  }
  // Strich + Lücke ≈ 1,6 × dash Pixel am Bildschirm; gerade Anzahl, damit der Kreis sauber schließt.
  const px = 2 * Math.PI * r * sc;
  const n = Math.max(24, Math.min(480, Math.round(px / (dash * 1.6) / 2) * 2));
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1.2) / n) * Math.PI * 2;
    g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r).arc(x, y, r, a0, a1);
  }
  g.stroke({ color: st.color, width: 2 / sc, alpha: st.alpha, cap: "round" });
}
