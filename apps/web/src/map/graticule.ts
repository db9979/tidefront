// Gradnetz: Längen- und Breitengrade als feine Linien, Beschriftung am linken und oberen Bildrand.
import { Container, Graphics, Text } from "pixi.js";
import { LAT1, LON0 } from "@tidefront/world";
import { xyOf } from "./terrain.ts";
import { fmtLat, fmtLon } from "./coords.ts";

const LON_MIN = -90, LON_MAX = 50, LAT_MIN = 20, LAT_MAX = 76;
const STYLE = { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 10, fill: 0x9fd3e6 };

export class Graticule {
  lines = new Graphics();
  labels = new Container();
  private latText = new Map<number, Text>();
  private lonText = new Map<number, Text>();
  private step = 0;

  constructor() {
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += 5) this.latText.set(lat, this.text(fmtLat(lat)));
    for (let lon = LON_MIN; lon <= LON_MAX; lon += 5) this.lonText.set(lon, this.text(fmtLon(lon)));
  }

  private text(s: string): Text {
    const t = new Text({ text: s, style: STYLE });
    t.resolution = 2;
    t.alpha = 0.85;
    this.labels.addChild(t);
    return t;
  }

  /** Linien (Weltkoordinaten) bei Zoomänderung neu zeichnen. */
  redraw(scale: number): void {
    const step = scale < 0.12 ? 10 : 5;
    this.step = step;
    const g = this.lines;
    g.clear();
    const a = xyOf(LON_MIN, LAT_MAX), b = xyOf(LON_MAX, LAT_MIN);
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += step) {
      const y = xyOf(LON0, lat).y;
      g.moveTo(a.x, y).lineTo(b.x, y);
    }
    for (let lon = LON_MIN; lon <= LON_MAX; lon += step) {
      const x = xyOf(lon, LAT1).x;
      g.moveTo(x, a.y).lineTo(x, b.y);
    }
    g.stroke({ color: 0x7fd4f0, width: 1 / scale, alpha: 0.18 });
  }

  /** Beschriftungen an den Bildrand legen (Bildschirmkoordinaten; die Ebene liegt außerhalb der Welt). */
  place(world: { x: number; y: number; scale: { x: number } }, w: number, h: number, top = 4, left = 4): void {
    const s = world.scale.x;
    for (const [lat, t] of this.latText) {
      const sy = world.y + xyOf(LON0, lat).y * s;
      t.visible = lat % this.step === 0 && sy > top + 24 && sy < h - 16;
      t.position.set(left, sy - 12);
    }
    for (const [lon, t] of this.lonText) {
      const sx = world.x + xyOf(lon, LAT1).x * s;
      t.visible = lon % this.step === 0 && sx > left + 56 && sx < w - 60;
      t.position.set(sx + 3, top);
    }
  }
}
