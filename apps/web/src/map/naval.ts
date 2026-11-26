// See: Minen, Blockade und Konvois auf der Karte im Kupferstich-Stil: Minenfeld (gestrichelter Kreis mit Seemine),
// Blockade (Kettenring um den Hafen), Konvoi (Route und Frachtschiff). Linien in Weltkoordinaten (km), Zeichen in
// Bildschirmgröße (Gegenskalierung durch HexMap, wie bei den Weltereignissen).
import { Container, Graphics, Text } from "pixi.js";
import { hexCenterXY } from "@tidefront/world";
import { INK, PAPER, SIEGEL, SEE } from "./symbols.ts";

export interface MapNaval {
  minefields: { id: number; col: number; row: number; strength: number; own: boolean; allied: boolean }[];
  blockades: { id: number; col: number; row: number; endsAtMs: number; role: string }[];
  convoys: { id: number; from: { col: number; row: number }; to: { col: number; row: number }; departAtMs: number; arriveAtMs: number; enemy: boolean; escorted: boolean }[];
  rules?: { mines: { fieldRadiusKm: number } | null };
}

const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
const ALLY = 0x3d6b4f;

function tag(text: string, color: number, y: number): Container {
  const c = new Container();
  const t = new Text({ text: text.toUpperCase(), style: { fontFamily: SERIF, fontSize: 9, fill: color, fontWeight: "600", letterSpacing: 1 } });
  t.resolution = 2;
  t.anchor.set(0.5, 0);
  const w = t.width + 8;
  c.addChild(new Graphics().rect(-w / 2, y, w, t.height + 2).fill({ color: PAPER }).stroke({ color, width: 1 }), t);
  t.position.set(0, y + 1);
  return c;
}

/** Seemine: Kugel mit Hörnern. */
export function mineSymbol(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6).lineTo(Math.cos(a) * 9.5, Math.sin(a) * 9.5);
  }
  g.stroke({ color: INK, width: 1.4 });
  g.circle(0, 0, 6.5).fill({ color }).stroke({ color: INK, width: 1.2 });
  g.circle(-2, -2, 1.6).fill({ color: PAPER, alpha: 0.8 });
  c.addChild(g);
  return c;
}

/** Blockade: Kettenring aus Gliedern um den Hafen. */
export function blockadeRing(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  const r = 22;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    g.ellipse(Math.cos(a) * r, Math.sin(a) * r, i % 2 ? 3.4 : 2.2, i % 2 ? 2.2 : 3.4).stroke({ color, width: 1.4 });
  }
  c.addChild(g);
  return c;
}

/** Frachtschiff im Seitenriss. */
export function convoySymbol(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([-9, 0, 9, 0, 6, 4.5, -7, 4.5]).fill({ color }).stroke({ color: INK, width: 1 });
  g.rect(-5, -4, 4, 4).fill({ color: PAPER }).stroke({ color: INK, width: 0.9 });
  g.rect(0, -3, 3.5, 3).fill({ color: PAPER }).stroke({ color: INK, width: 0.9 });
  g.moveTo(5.5, 0).lineTo(5.5, -6).stroke({ color: INK, width: 1 });
  c.addChild(g);
  return c;
}

function hours(ms: number): string {
  const h = Math.max(0, ms) / 3600000;
  return h >= 1 ? `${Math.floor(h)} h` : `${Math.max(1, Math.round(h * 60))} min`;
}

export function buildNavalLayer(n: MapNaval, now: number): { root: Container; pinned: { obj: Container; min?: number }[] } {
  const root = new Container();
  const lines = new Graphics();
  root.addChild(lines);
  const pinned: { obj: Container; min?: number }[] = [];
  const pin = (obj: Container, x: number, y: number, min?: number) => {
    obj.position.set(x, y);
    root.addChild(obj);
    pinned.push({ obj, min });
  };
  const radius = n.rules?.mines?.fieldRadiusKm ?? 35;
  for (const f of n.minefields) {
    const p = hexCenterXY(f.col, f.row);
    const color = f.own ? INK : f.allied ? ALLY : SIEGEL;
    for (let i = 0; i < 20; i++) lines.arc(p.x, p.y, radius, (i * Math.PI) / 10, (i * Math.PI) / 10 + 0.18).moveTo(p.x, p.y);
    lines.stroke({ color, width: 1, pixelLine: true, alpha: 0.85 });
    pin(mineSymbol(f.own || f.allied ? PAPER : SIEGEL), p.x, p.y, 0.08);
  }
  for (const b of n.blockades) {
    const p = hexCenterXY(b.col, b.row);
    const color = b.role === "own" ? INK : SIEGEL;
    pin(blockadeRing(color), p.x, p.y);
    pin(tag(`Blockade · ${hours(b.endsAtMs - now)}`, color, 30), p.x, p.y, 0.12);
  }
  for (const c of n.convoys) {
    const a = hexCenterXY(c.from.col, c.from.row);
    const b = hexCenterXY(c.to.col, c.to.row);
    const color = c.enemy ? SIEGEL : SEE;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(1, Math.floor(len / 14));
    for (let i = 0; i < k; i++) {
      const t0 = i / k, t1 = (i + 0.5) / k;
      lines.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
    }
    lines.stroke({ color, width: 1, pixelLine: true, alpha: 0.8 });
    const t = Math.max(0, Math.min(1, (now - c.departAtMs) / Math.max(1, c.arriveAtMs - c.departAtMs)));
    const ship = convoySymbol(c.escorted ? INK : color);
    pin(ship, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.08);
  }
  return { root, pinned };
}
