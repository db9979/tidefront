// Lotungen: verstreute Tiefenzahlen (Meter) auf Seefeldern, wie auf einer Seekarte. Fest je Weltlage (Hash).
import { Container } from "pixi.js";
import { COLS, ROWS, hexCenterXY, neighbors, terrainAt } from "@tidefront/world";
import { sounding } from "./symbols.ts";

function hash(a: number, b: number): number {
  let h = (a * 2654435761 + b * 40503) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Eine Zahl je ausgewähltem Seefeld; flach an der Küste, tief im offenen Ozean. */
export function buildSoundings(): Container[] {
  const out: Container[] = [];
  for (let row = 1; row < ROWS - 1; row++) {
    for (let col = 1; col < COLS - 1; col++) {
      if (terrainAt(col, row) !== "sea") continue;
      const r = hash(col, row);
      if (r > 0.075) continue;
      const shallow = neighbors(col, row).some((n) => terrainAt(n.col, n.row) !== "sea");
      const depth = shallow ? 12 + Math.round(hash(row, col) * 70) : 140 + Math.round(hash(row + 7, col) * 4100);
      const t = sounding(depth > 1000 ? Math.round(depth / 10) * 10 : depth);
      const p = hexCenterXY(col, row);
      // leicht versetzt, damit kein sichtbares Raster entsteht
      const c = new Container();
      c.addChild(t);
      c.position.set(p.x + (hash(col + 3, row) - 0.5) * 50, p.y + (hash(col, row + 5) - 0.5) * 40);
      out.push(c);
    }
  }
  return out;
}
