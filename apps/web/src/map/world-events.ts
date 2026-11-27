// Weltereignisse auf der Karte im Kupferstich-Stil der übrigen Kartenzeichen: Schatzschiff mit Route,
// Großflotte mit Ankündigungs-Countdown, Zielregion und Kurslinien, Belagerungsring um den Hafen, Saisonfinale (Leviathan
// mit Lebensbalken aus Geschwadern und Flaggschiff-Sektionen, Vorhuten).
// Linien in Weltkoordinaten (1 px über pixelLine), Zeichen in Bildschirmgröße (Gegenskalierung durch HexMap).
import { Container, Graphics, Text } from "pixi.js";
import { hexCenterXY } from "@tidefront/world";
import { routePosition } from "@tidefront/game-core";
import { INK, PAPER, SIEGEL } from "./symbols.ts";
import { xyOf } from "./terrain.ts";

export interface MapWorldEvent {
  id: number;
  kind: string;
  status: string;
  outcome: string | null;
  col: number;
  row: number;
  activeAtMs: number;
  endsAtMs: number;
  path: { col: number; row: number }[] | null;
  route: { lat: number; lon: number; atMs: number }[] | null;
  harbor: { col: number; row: number } | null;
  region: { col: number; row: number; radiusKm: number } | null;
  targets: { col: number; row: number; status: string }[];
  /** Saisonfinale: Lebensbalken und Vorhuten. */
  finale?: { remainingHp: number; initialHp: number; boats: number; initialBoats: number; sections: number; initialSections: number; vanguards: { col: number; row: number; name: string }[] } | null;
}

const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
const GOLD = 0x9a7b2f;

function label(text: string, color: number, y: number): Container {
  const c = new Container();
  const t = new Text({ text: text.toUpperCase(), style: { fontFamily: SERIF, fontSize: 9.5, fill: color, fontWeight: "600", letterSpacing: 1.1 } });
  t.resolution = 2;
  t.anchor.set(0.5, 0);
  const w = t.width + 8;
  const bg = new Graphics().rect(-w / 2, y, w, t.height + 2).fill({ color: PAPER }).stroke({ color, width: 1 });
  t.position.set(0, y + 1);
  c.addChild(bg, t);
  return c;
}

/** Schatzschiff: Papierkreis mit Doppelrand, Dreimaster im Seitenriss, goldene Truhe am Heck. */
export function treasureSymbol(gone = false): Container {
  const c = new Container();
  const g = new Graphics();
  const ink = gone ? 0x59636f : INK;
  g.circle(0, 0, 14).fill({ color: PAPER }).stroke({ color: gone ? ink : SIEGEL, width: 1.6 });
  g.circle(0, 0, 11.5).stroke({ color: gone ? ink : SIEGEL, width: 0.6 });
  g.poly([-8, 2, 8, 2, 5.5, 6.5, -5.5, 6.5]).fill({ color: ink });
  for (const [x, h] of [[-4, 7], [0.5, 9], [5, 6]] as const) g.moveTo(x, 2).lineTo(x, 2 - h);
  g.stroke({ color: ink, width: 1 });
  for (const [x, h] of [[-4, 7], [0.5, 9], [5, 6]] as const) g.poly([x, 2 - h + 1, x + 3.2, 2 - h / 2, x, 1]).fill({ color: ink, alpha: 0.85 });
  if (!gone) g.rect(-3, 3.2, 3.6, 2.4).fill({ color: GOLD });
  if (gone) g.moveTo(-9, -9).lineTo(9, 9).stroke({ color: SIEGEL, width: 1.4 });
  c.addChild(g);
  return c;
}

/** Großflotte: siegelrotes Wappenschild mit drei Rümpfen in Keilformation. */
export function armadaSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([0, -16, 15, -10, 13, 6, 0, 16, -13, 6, -15, -10]).fill({ color: SIEGEL }).stroke({ color: INK, width: 1 });
  g.poly([0, -12.5, 11.5, -8, 10, 4.5, 0, 12.5, -10, 4.5, -11.5, -8]).stroke({ color: PAPER, width: 0.7 });
  for (const [x, y] of [[0, -5], [-5.5, 3], [5.5, 3]] as const) {
    g.poly([x - 4, y, x + 4, y, x + 2.6, y + 2.6, x - 2.6, y + 2.6]).fill({ color: PAPER });
    g.moveTo(x, y).lineTo(x, y - 4).stroke({ color: PAPER, width: 0.9 });
  }
  c.addChild(g);
  return c;
}

/** Belagerungsring: gestrichelter Siegelring mit acht Bootsmarken um den Hafen. */
export function siegeRing(): Container {
  const c = new Container();
  const g = new Graphics();
  const r = 25;
  for (let i = 0; i < 24; i++) g.arc(0, 0, r, (i * Math.PI) / 12, (i * Math.PI) / 12 + 0.17).moveTo(0, 0);
  g.stroke({ color: SIEGEL, width: 1.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    g.poly([x - 3, y - 1, x + 3, y - 1, x + 2, y + 1.5, x - 2, y + 1.5]).fill({ color: SIEGEL });
  }
  c.addChild(g);
  return c;
}

/** Saisonfinale: großes Siegel mit Seeungeheuer-Krone (Leviathan) über drei Rümpfen. */
export function leviathanSymbol(gone = false): Container {
  const c = new Container();
  const g = new Graphics();
  const ink = gone ? 0x59636f : INK;
  g.circle(0, 0, 19).fill({ color: gone ? PAPER : SIEGEL }).stroke({ color: ink, width: 1.4 });
  g.circle(0, 0, 15.5).stroke({ color: PAPER, width: 0.8 });
  // Krone aus fünf Zacken (Kartell) und ein langer Rumpf mit Aufbauten (Flaggschiff).
  g.poly([-9, -4, -9, -11, -5, -7, 0, -13, 5, -7, 9, -11, 9, -4]).fill({ color: gone ? ink : GOLD });
  g.poly([-13, 2, 13, 2, 9, 8, -9, 8]).fill({ color: gone ? ink : PAPER });
  g.rect(-6, -2, 4, 4).rect(1, -3, 5, 5).fill({ color: gone ? ink : PAPER });
  if (gone) g.moveTo(-13, -13).lineTo(13, 13).stroke({ color: SIEGEL, width: 1.6 });
  c.addChild(g);
  return c;
}

/** Lebensbalken unter dem Leviathan: oben Geschwader, unten Sektionen des Flaggschiffs (Segmente). */
function lifeBar(f: NonNullable<MapWorldEvent["finale"]>, y: number): Container {
  const c = new Container();
  const g = new Graphics();
  const w = 46;
  g.position.set(0, y);
  g.rect(-w / 2, 0, w, 4).fill({ color: PAPER }).stroke({ color: INK, width: 0.8 });
  const boats = f.initialBoats > 0 ? f.boats / f.initialBoats : 0;
  if (boats > 0) g.rect(-w / 2 + 0.5, 0.5, (w - 1) * boats, 3).fill({ color: SIEGEL });
  const n = Math.max(1, Math.min(f.initialSections, 12));
  const seg = w / n;
  const per = f.initialSections / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + i * seg;
    g.rect(x + 0.5, 6, seg - 1, 3).fill({ color: i * per < f.sections ? GOLD : PAPER }).stroke({ color: INK, width: 0.5 });
  }
  c.addChild(g);
  return c;
}

function hours(ms: number): string {
  const h = Math.max(0, ms) / 3600000;
  return h >= 1 ? `${Math.floor(h)} h ${Math.floor((h % 1) * 60)} min` : `${Math.max(1, Math.round(h * 60))} min`;
}

function dashedPath(g: Graphics, pts: { x: number; y: number }[], dash: number): void {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.floor(len / (dash * 2)));
    for (let k = 0; k < n; k++) {
      const t0 = (k * 2 * dash) / len;
      const t1 = Math.min(1, ((k * 2 + 1) * dash) / len);
      g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
    }
  }
}

/** Ebene aller Ereignisse; pinned: Zeichen in Bildschirmgröße (min = ab Zoomstufe sichtbar). */
export function buildWorldEventLayer(events: MapWorldEvent[], now: number): { root: Container; pinned: { obj: Container; min?: number }[] } {
  const root = new Container();
  const lines = new Graphics();
  root.addChild(lines);
  const pinned: { obj: Container; min?: number }[] = [];
  const pin = (obj: Container, x: number, y: number, min?: number) => {
    obj.position.set(x, y);
    root.addChild(obj);
    pinned.push({ obj, min });
  };
  for (const e of events) {
    const ended = e.status === "ended";
    if (e.kind === "schatzschiff") {
      const pts = (e.path ?? []).map((h) => hexCenterXY(h.col, h.row));
      if (!ended && pts.length > 1) {
        dashedPath(lines, pts, 9);
        lines.stroke({ color: SIEGEL, width: 1, pixelLine: true, alpha: 0.9 });
      }
      const here = !ended && e.route && e.route.length > 0 ? (() => { const p = routePosition(e.route!, now); return xyOf(p.lon, p.lat); })() : hexCenterXY(e.col, e.row);
      pin(treasureSymbol(ended), here.x, here.y);
      pin(label(ended ? (e.outcome === "defeated" ? "aufgebracht" : "entkommen") : `Schatzschiff · ${hours(e.endsAtMs - now)}`, ended ? INK : SIEGEL, 18), here.x, here.y, 0.12);
    } else if (e.kind === "grossflotte") {
      const at = hexCenterXY(e.col, e.row);
      if (!ended && e.region) {
        const c = hexCenterXY(e.region.col, e.region.row);
        lines.circle(c.x, c.y, e.region.radiusKm).stroke({ color: SIEGEL, width: 1, pixelLine: true, alpha: 0.5 });
        const pending = e.targets.filter((t) => t.status === "pending").map((t) => hexCenterXY(t.col, t.row));
        if (pending.length > 0) {
          dashedPath(lines, [at, ...pending], 5);
          lines.stroke({ color: SIEGEL, width: 1, pixelLine: true, alpha: 0.75 });
        }
      }
      if (!ended) pin(armadaSymbol(), at.x, at.y);
      const text = ended ? (e.outcome === "defeated" ? "zerschlagen" : "abgezogen")
        : e.status === "announced" ? `Großflotte läuft aus in ${hours(e.activeAtMs - now)}` : "Großflotte greift an";
      pin(label(text, ended ? INK : SIEGEL, 19), at.x, at.y, 0.1);
    } else if (e.kind === "finale") {
      const at = hexCenterXY(e.col, e.row);
      if (!ended) {
        for (const v of e.finale?.vanguards ?? []) {
          if (e.status === "active" && (e.finale?.boats ?? 0) <= 0) continue; // Vorhuten aufgelöst
          const p = hexCenterXY(v.col, v.row);
          dashedPath(lines, [p, at], 7);
          lines.stroke({ color: SIEGEL, width: 1, pixelLine: true, alpha: 0.6 });
          pin(armadaSymbol(), p.x, p.y);
          pin(label("Vorhut", SIEGEL, 19), p.x, p.y, 0.12);
        }
      }
      pin(leviathanSymbol(ended), at.x, at.y);
      if (!ended && e.status === "active" && e.finale) pin(lifeBar(e.finale, 23), at.x, at.y);
      const text = ended ? (e.outcome === "defeated" ? "Leviathan versenkt" : "Armada entkommen")
        : e.status === "announced" ? `Saisonfinale · erscheint in ${hours(e.activeAtMs - now)}` : `Kartell-Armada · ${hours(e.endsAtMs - now)}`;
      pin(label(text, ended ? INK : SIEGEL, e.status === "active" && !ended ? 34 : 23), at.x, at.y, 0.08);
    } else if (e.kind === "belagerung") {
      const at = hexCenterXY(e.col, e.row);
      if (!ended) {
        pin(siegeRing(), at.x, at.y);
        pin(label(`Belagerung · ${hours(e.endsAtMs - now)}`, SIEGEL, -44), at.x, at.y, 0.12);
      }
    }
  }
  return { root, pinned };
}
