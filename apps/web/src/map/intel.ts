// Lagebild auf der Karte: Kartennebel (leichte graublaue Überlagerung der Felder außerhalb jeder Sicht), gestrichelte
// Sensorgrenzen (Ausguck, Radar, Posten, Patrouillen, Bordsicht der Verbände, Sonar; eigene und der Allianz), fremde
// Verbände als Pfeil mit Größenklasse und Kurs, Radarposten und Wegpunkte der Planung (Stufe 2).
// Nebel feldweise (keine inverse Maske: die erzeugt in Pixi Randartefakte); die Ebene endet über eine normale Maske am
// Kartenrahmen. Die Sicht prüft dieselben Kreise in Projektions-km wie der Server (packages/game-core/src/intel.ts).
// Stufe 3: Satellitenstreifen (live: Nebel weg außer unter Wolken; nächster Überflug: gestrichelt mit Uhrzeit) –
// ebenfalls nur über die normale Maske am Kartenrahmen beschnitten, keine inversen Masken.
import { Container, Graphics, Text } from "pixi.js";
import { COLS, ROWS, HEX_SIZE_KM, hexAtXY, hexCenterXY } from "@tidefront/world";
import { liveLevelAt, type SensorCircle, type SensorKind } from "@tidefront/game-core";
import { hexPoints } from "./terrain.ts";
import { INK, PAPER, RELATION_COLOR, SEE, SIEGEL, type Relation } from "./symbols.ts";

export interface MapIntel {
  fog: boolean;
  sensors: { col: number; row: number; km: number; kind: SensorKind; label: string; own: boolean; strip?: { x0: number; x1: number; hidden: [number, number][] } }[];
  /** Stufe 3: Satelliten der Partei mit nächstem Überflug. */
  satellites?: { id: number; type: string; own: boolean; live: { x0: number; x1: number } | null; next: { x0: number; x1: number; atMs: number } | null }[];
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

/** Sensoren, die mit einem Verband wandern. */
const MOVING = new Set(["patrouille", "aufklaerer", "verband", "flug"]);

/** Graublau des Kartennebels. */
const FOG = 0x5d6f82;

function circles(intel: MapIntel): SensorCircle[] {
  return intel.sensors.map((s) => {
    if (!s.strip) return { kind: s.kind, km: s.km, ...hexCenterXY(s.col, s.row) };
    // Streifen: unter Wolken verdeckte Felder (optisch) kommen vom Server.
    const hidden = new Set(s.strip.hidden.map(([c, r]) => `${c},${r}`));
    const blocked = hidden.size ? (x: number, y: number) => { const h = hexAtXY(x, y); return hidden.has(`${h.col},${h.row}`); } : undefined;
    return { kind: s.kind, km: 0, x: 0, y: 0, strip: { x0: s.strip.x0, x1: s.strip.x1, blocked } };
  });
}

/** Kartenhöhe in Projektions-km (für die senkrechten Streifenlinien; die Maske schneidet am Rahmen ab). */
const MAP_TOP = -HEX_SIZE_KM;
const MAP_BOTTOM = ROWS * 1.5 * HEX_SIZE_KM;

/** Gestrichelte senkrechte Linie (Pixi kennt keine Strichelung). */
function dashedV(g: Graphics, x: number, dash: number, gap: number): void {
  for (let y = MAP_TOP; y < MAP_BOTTOM; y += dash + gap) g.moveTo(x, y).lineTo(x, Math.min(MAP_BOTTOM, y + dash));
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

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
    // Stufe 3: live Satellitenstreifen (durchgehend gestrichelt) und der nächste Überflug je Satellit (lang gestrichelt).
    for (const s of intel.sensors) {
      if (!s.strip) continue;
      dashedV(lines, s.strip.x0, 18, 10);
      dashedV(lines, s.strip.x1, 18, 10);
      lines.stroke({ color: s.kind === "radarsatellit" ? SEE : INK, width: 1.4, pixelLine: true, alpha: s.own ? 0.95 : 0.6 });
    }
    for (const sat of intel.satellites ?? []) {
      if (!sat.next || sat.live) continue;
      dashedV(lines, sat.next.x0, 40, 30);
      dashedV(lines, sat.next.x1, 40, 30);
      lines.stroke({ color: sat.type === "radar" ? SEE : INK, width: 1.2, pixelLine: true, alpha: 0.5 });
      const t = new Text({ text: `Überflug ${clock(sat.next.atMs)}`, style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: HEX_SIZE_KM * 0.6, fill: INK } });
      t.alpha = 0.7;
      t.anchor.set(0.5, 0);
      t.position.set((sat.next.x0 + sat.next.x1) / 2, HEX_SIZE_KM * 0.4);
      root.addChild(t);
    }
    for (const s of intel.sensors) {
      if (s.strip) continue;
      // Eigene Verbände auf See zeichnet movers.ts mit wanderndem Kreis; hier nur Häfen, Posten und Fremde der Allianz.
      if (s.own && MOVING.has(s.kind)) continue;
      const c = hexCenterXY(s.col, s.row);
      const n = Math.max(24, Math.round(s.km / 12));
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        lines.moveTo(c.x + Math.cos(a0) * s.km, c.y + Math.sin(a0) * s.km).arc(c.x, c.y, s.km, a0, a1);
      }
      const radar = s.kind === "radar" || s.kind === "posten";
      lines.stroke({ color: radar ? SEE : s.kind === "sonar" ? 0x3d6b4f : INK, width: 1.2, pixelLine: true, alpha: (s.own ? 0.95 : 0.6) * (s.kind === "sonar" || s.kind === "flug" ? 0.6 : 1) });
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

export interface MapPostIn {
  id: number;
  col: number;
  row: number;
  own: boolean;
  offline: boolean | null;
  intel: { age: string } | null;
}

/** Radarposten: kleiner Mast mit Bogen (eigene Tinte, fremde Siegelrot; aus = blass). */
export function postSymbol(p: MapPostIn): Container {
  const c = new Container();
  const color = p.own ? SEE : SIEGEL;
  const g = new Graphics();
  g.circle(0, 0, 9).fill({ color: PAPER, alpha: 0.95 }).stroke({ color, width: 1.3 });
  g.moveTo(0, 5).lineTo(0, -3).stroke({ color, width: 1.6 });
  g.arc(0, -3, 5, Math.PI * 1.15, Math.PI * 1.85).stroke({ color, width: 1.4 });
  c.addChild(g);
  c.alpha = p.offline ? 0.45 : p.intel && p.intel.age !== "live" ? 0.55 : 1;
  return c;
}

export function buildPostLayer(posts: MapPostIn[]): { root: Container; pinned: { obj: Container; min?: number }[] } {
  const root = new Container();
  const pinned: { obj: Container; min?: number }[] = [];
  for (const p of posts) {
    const xy = hexCenterXY(p.col, p.row);
    const s = postSymbol(p);
    s.position.set(xy.x, xy.y);
    root.addChild(s);
    pinned.push({ obj: s, min: 0.12 });
  }
  return { root, pinned };
}

/**
 * Wegpunkte bzw. Ziele der Planung (Patrouille, Kampagne): nummerierte Ringe, verbunden in Reihenfolge; als Runde
 * (Patrouille) zurück zum ersten Punkt. Weltkoordinaten; endet über die Maske am Kartenrahmen.
 */
export function buildMarkLayer(marks: { col: number; row: number }[], loop: boolean, clip: () => Graphics): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const pts = marks.map((m) => hexCenterXY(m.col, m.row));
  if (pts.length > 1) {
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    if (loop && pts.length > 2) g.lineTo(pts[0].x, pts[0].y);
    g.stroke({ color: SIEGEL, width: 4, alpha: 0.85 });
  }
  pts.forEach((p, i) => {
    g.circle(p.x, p.y, HEX_SIZE_KM * 0.55).fill({ color: PAPER, alpha: 0.95 }).stroke({ color: SIEGEL, width: 4 });
    const t = new Text({ text: String(i + 1), style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: HEX_SIZE_KM * 0.7, fill: SIEGEL, fontWeight: "700" } });
    t.anchor.set(0.5);
    t.position.set(p.x, p.y);
    root.addChild(t);
  });
  const mask = clip();
  root.addChild(mask);
  root.mask = mask;
  return root;
}
