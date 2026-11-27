// Lagebild auf der Karte: Kartennebel (leichte graublaue Überlagerung der Felder außerhalb jeder Sicht), gestrichelte
// Sensorgrenzen (Ausguck, Radar; eigene und der Allianz) und fremde Verbände als Pfeil mit Größenklasse und Kurs.
// Nebel feldweise (keine inverse Maske: die erzeugt in Pixi Randartefakte); die Ebene endet über eine normale Maske am
// Kartenrahmen. Die Sicht prüft dieselben Kreise in Projektions-km wie der Server (packages/game-core/src/intel.ts).
import { Container, Graphics, Text } from "pixi.js";
import { COLS, ROWS, HEX_SIZE_KM, hexCenterXY } from "@tidefront/world";
import { liveLevelAt, type SensorCircle } from "@tidefront/game-core";
import { hexPoints } from "./terrain.ts";
import { INK, PAPER, RELATION_COLOR, SEE, SIEGEL, type Relation } from "./symbols.ts";

export interface MapIntel {
  fog: boolean;
  sensors: { col: number; row: number; km: number; kind: "ausguck" | "radar"; label: string; own: boolean }[];
}

export interface MapFleetIn {
  id: number;
  col: number;
  row: number;
  heading: number;
  size: "klein" | "mittel" | "gross";
  relation: string | null;
  intel: { age: string };
}

/** Graublau des Kartennebels. */
const FOG = 0x5d6f82;

function circles(intel: MapIntel): SensorCircle[] {
  return intel.sensors.map((s) => ({ kind: s.kind, km: s.km, ...hexCenterXY(s.col, s.row) }));
}

/** Nebel und Sensorgrenzen in Weltkoordinaten (einmal je Datenstand gezeichnet). */
export function buildIntelLayer(intel: MapIntel, clip: () => Graphics, showSensors: boolean): Container {
  const root = new Container();
  const fog = new Graphics();
  const lines = new Graphics();
  root.addChild(fog, lines);
  const sensors = circles(intel);
  if (intel.fog) {
    // Felder außerhalb jeder Sicht: ein Polygon je Feld, eine Füllung für alle.
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const p = hexCenterXY(col, row);
      if (liveLevelAt(sensors, p.x, p.y, "object")) continue;
      fog.poly(hexPoints(p.x, p.y, HEX_SIZE_KM + 0.6));
    }
    fog.fill({ color: FOG, alpha: 0.26 });
  }
  if (showSensors) {
    for (const s of intel.sensors) {
      const c = hexCenterXY(s.col, s.row);
      const n = Math.max(24, Math.round(s.km / 12));
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        lines.moveTo(c.x + Math.cos(a0) * s.km, c.y + Math.sin(a0) * s.km).arc(c.x, c.y, s.km, a0, a1);
      }
      lines.stroke({ color: s.kind === "radar" ? SEE : INK, width: 1.2, pixelLine: true, alpha: s.own ? 0.95 : 0.6 });
    }
  }
  const mask = clip();
  root.addChild(mask);
  root.mask = mask;
  return root;
}

const SIZE_SCALE = { klein: 0.8, mittel: 1, gross: 1.25 } as const;
const SIZE_LETTER = { klein: "K", mittel: "M", gross: "G" } as const;

/** Fremder Verband: Pfeil in Kursrichtung (Farbe nach Verhältnis, ohne Erkennung Tinte), Buchstabe der Größenklasse. */
export function fleetArrow(f: MapFleetIn): Container {
  const c = new Container();
  const g = new Graphics();
  const color = f.relation === null ? INK : f.relation === "kartell" ? SIEGEL : RELATION_COLOR[(f.relation as Relation)] ?? SEE;
  const k = SIZE_SCALE[f.size] ?? 1;
  g.circle(0, 0, 11 * k).fill({ color: PAPER, alpha: 0.9 }).stroke({ color, width: 1.3, alpha: 0.9 });
  const arrow = new Graphics();
  arrow.poly([0, -10 * k, 6 * k, 6 * k, 0, 2.5 * k, -6 * k, 6 * k]).fill({ color });
  arrow.rotation = (f.heading * Math.PI) / 180;
  c.addChild(g, arrow);
  const t = new Text({ text: SIZE_LETTER[f.size] ?? "?", style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, fill: INK, fontWeight: "600" } });
  t.resolution = 2;
  t.anchor.set(0.5, 0);
  t.position.set(0, 12 * k);
  c.addChild(t);
  // Bekannt (nicht mehr live): blasser.
  c.alpha = f.intel.age === "live" ? 1 : 0.45;
  return c;
}

/** Pfeile fremder Verbände als Kartenzeichen (Bildschirmgröße wie die übrigen Zeichen). */
export function buildFleetLayer(fleets: MapFleetIn[]): { root: Container; pinned: { obj: Container; min?: number }[] } {
  const root = new Container();
  const pinned: { obj: Container; min?: number }[] = [];
  for (const f of fleets) {
    const p = hexCenterXY(f.col, f.row);
    const s = fleetArrow(f);
    s.position.set(p.x, p.y);
    root.addChild(s);
    pinned.push({ obj: s, min: 0.12 });
  }
  return { root, pinned };
}
