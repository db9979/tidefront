// Gradnetz: Längen- und Breitengrade als feine Linien, Beschriftung am linken und oberen Bildrand.
// Abstand der Beschriftung je Zoom (5°/10°/20°), nie überlappend, jede auf kleinem Papierschild.
import { MAP_BOUNDS } from "./gestures.ts";
import { Container, Graphics, Text } from "pixi.js";
import { LAT1, LON0 } from "@tidefront/world";
import { xyOf } from "./terrain.ts";
import { fmtLat, fmtLon } from "./coords.ts";
import { PAPER } from "./symbols.ts";

const LON_MIN = -90, LON_MAX = 50, LAT_MIN = 20, LAT_MAX = 76;
const STYLE = { fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace", fontSize: 9.5, fill: 0x4f5b69, fontWeight: "500" as const };
const STEPS = [5, 10, 20];
/** Mindestabstand der Beschriftungen in Bildschirm-Pixeln (Länge: Textbreite plus Luft). */
const MIN_LON_PX = 62;
const MIN_LAT_PX = 34;

export class Graticule {
  lines = new Graphics();
  labels = new Container();
  private latText = new Map<number, Container>();
  private lonText = new Map<number, Container>();
  private lonStep = 10;
  private latStep = 10;

  constructor() {
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += 5) this.latText.set(lat, this.text(fmtLat(lat)));
    for (let lon = LON_MIN; lon <= LON_MAX; lon += 5) this.lonText.set(lon, this.text(fmtLon(lon)));
  }

  private text(s: string): Container {
    const c = new Container();
    const t = new Text({ text: s, style: STYLE });
    t.resolution = 2;
    t.position.set(3, 1);
    const bg = new Graphics().roundRect(0, 0, t.width + 6, t.height + 2, 1.5).fill({ color: PAPER, alpha: 0.88 }).stroke({ color: 0x4f5b69, width: 0.6, alpha: 0.45 });
    c.addChild(bg, t);
    c.visible = false;
    this.labels.addChild(c);
    return c;
  }

  /** Linien (Weltkoordinaten) und Beschriftungsabstand bei Zoomänderung neu bestimmen. */
  redraw(scale: number): void {
    const pick = (kmPerDeg: number, px: number) => STEPS.find((d) => d * kmPerDeg * scale >= px) ?? 20;
    const lonKm = xyOf(1, LAT1).x - xyOf(0, LAT1).x;
    const latKm = xyOf(LON0, 0).y - xyOf(LON0, 1).y;
    const step = scale < 0.22 ? 10 : 5;
    this.lonStep = Math.max(step, pick(lonKm, MIN_LON_PX));
    this.latStep = Math.max(step, pick(latKm, MIN_LAT_PX));
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
    g.stroke({ color: 0x18273a, width: 1, pixelLine: true, alpha: scale < 0.3 ? 0.18 : 0.26 });
  }

  /** Beschriftungen an den Bildrand legen (Bildschirmkoordinaten; die Ebene liegt außerhalb der Welt). */
  place(world: { x: number; y: number; scale: { x: number } }, w: number, h: number, top = 4, left = 4): void {
    const s = world.scale.x;
    for (const [lat, t] of this.latText) {
      const wy = xyOf(LON0, lat).y;
      const sy = world.y + wy * s;
      // oben links liegt das Wetterkärtchen: erst darunter beschriften; nur Linien innerhalb des Kartenrahmens
      t.visible = lat % this.latStep === 0 && sy > top + 96 && sy < h - 20 && wy >= MAP_BOUNDS.y0 && wy <= MAP_BOUNDS.y1;
      t.position.set(left, sy - 15);
    }
    for (const [lon, t] of this.lonText) {
      const wx = xyOf(lon, LAT1).x;
      const sx = world.x + wx * s;
      // links oben das Wetterkärtchen (bis ~100 px), rechts die Knopfleiste (46 px + Rand): Beschriftung (~45 px breit) nur dazwischen
      t.visible = lon % this.lonStep === 0 && sx > left + 96 && sx < w - 108 && wx >= MAP_BOUNDS.x0 && wx <= MAP_BOUNDS.x1;
      t.position.set(sx + 3, top);
    }
  }
}
