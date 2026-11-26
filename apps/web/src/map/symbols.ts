// Kartensymbole in Bildschirm-Pixeln um (0, 0); der Aufrufer setzt Position und Gegenskalierung.
import { Container, Graphics, Text } from "pixi.js";

export const LEVEL_COLORS = [0xf2d44e, 0xf2a93b, 0xe8742f, 0xd9442b, 0xb01e3a];
const INK = 0x0b1726;

function star(g: Graphics, r1: number, r2: number, points = 5): Graphics {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return g.poly(pts);
}

/** Namensschild unter einem Symbol. */
export function nameTag(text: string, color: number, y = 20): Container {
  const c = new Container();
  const t = new Text({ text, style: { fontSize: 12, fill: 0xffffff, fontWeight: "600", fontFamily: "system-ui, sans-serif" } });
  t.resolution = 2;
  t.anchor.set(0.5, 0);
  const w = t.width + 10;
  const bg = new Graphics().roundRect(-w / 2, y - 1, w, t.height + 3, 5).fill({ color: INK, alpha: 0.82 }).stroke({ color, width: 1.5 });
  t.position.set(0, y + 1);
  c.addChild(bg, t);
  return c;
}

/** Eigener Stützpunkt: Festung mit Stern, messingfarben. */
export function ownBaseSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 17).fill({ color: 0xf2c14e, alpha: 0.25 });
  // Bastion: Achteck
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    pts.push(Math.cos(a) * 13, Math.sin(a) * 13);
  }
  g.poly(pts).fill({ color: 0xf2c14e }).stroke({ color: INK, width: 2.5 });
  star(g, 8, 3.4).fill({ color: INK });
  c.addChild(g);
  return c;
}

/** Fremder Stützpunkt: rotes Wappenschild. */
export function otherBaseSymbol(isProtected: boolean): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([-11, -12, 11, -12, 11, 1, 0, 13, -11, 1]).fill({ color: 0xe5484d }).stroke({ color: 0xffffff, width: 2 });
  g.rect(-1.5, -8, 3, 15).fill({ color: 0xffffff, alpha: 0.85 });
  g.rect(-7, -3, 14, 3).fill({ color: 0xffffff, alpha: 0.85 });
  if (isProtected) g.circle(0, 0, 17).stroke({ color: 0x6ee7b7, width: 2, alpha: 0.9 });
  c.addChild(g);
  return c;
}

/** Piratennest: Totenkopf-Flagge mit Stufenabzeichen. */
export function nestSymbol(level: number, empty: boolean): Container {
  const c = new Container();
  const g = new Graphics();
  const ring = empty ? 0x6b7280 : LEVEL_COLORS[Math.max(0, Math.min(4, level - 1))];
  g.circle(0, 0, 13).fill({ color: empty ? 0x374151 : 0x161616 }).stroke({ color: ring, width: 2.5 });
  const bone = empty ? 0x9ca3af : 0xf5f1e6;
  // gekreuzte Knochen
  g.moveTo(-8, 6).lineTo(8, -2).moveTo(-8, -2).lineTo(8, 6).stroke({ color: bone, width: 2.2, cap: "round" });
  // Schädel
  g.circle(0, -2, 5.6).fill({ color: bone });
  g.rect(-3, 2, 6, 3).fill({ color: bone });
  g.circle(-2.1, -2.4, 1.4).circle(2.1, -2.4, 1.4).fill({ color: 0x161616 });
  c.addChild(g);
  const badge = new Graphics().circle(11, -11, 7.5).fill({ color: ring }).stroke({ color: INK, width: 1.5 });
  const t = new Text({ text: String(level), style: { fontSize: 11, fill: INK, fontWeight: "800", fontFamily: "system-ui, sans-serif" } });
  t.resolution = 2;
  t.anchor.set(0.5);
  t.position.set(11, -11);
  c.addChild(badge, t);
  return c;
}

/** Wrackfeld: gebrochener Rumpf auf dem Wasser. */
export function wreckSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 10).fill({ color: 0x0b1726, alpha: 0.55 });
  g.poly([-9, 1, -2, 1, -4, 6, -8, 6]).fill({ color: 0xe8893a });
  g.poly([1, -1, 9, -4, 8, 5, 2, 5]).fill({ color: 0xc96a24 });
  g.moveTo(4, -2).lineTo(5, -9).stroke({ color: 0xe8893a, width: 1.6 });
  g.moveTo(-9, 7).lineTo(9, 7).stroke({ color: 0xbfe9f5, width: 1.2, alpha: 0.7 });
  c.addChild(g);
  return c;
}

/** Handelshafen: Anker. */
export function portSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 10).fill({ color: 0x0b1726, alpha: 0.75 }).stroke({ color: 0x7cc6e8, width: 1.5 });
  g.circle(0, -5, 1.8).stroke({ color: 0xe6eef7, width: 1.4 });
  g.moveTo(0, -3).lineTo(0, 6).moveTo(-3.5, -1).lineTo(3.5, -1).stroke({ color: 0xe6eef7, width: 1.6 });
  g.arc(0, 1, 5.5, 0.15 * Math.PI, 0.85 * Math.PI).stroke({ color: 0xe6eef7, width: 1.6 });
  c.addChild(g);
  return c;
}

/** Schiff, Bug zeigt nach +x; der Aufrufer dreht. */
export function shipSymbol(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([-9, -4, 6, -4, 11, 0, 6, 4, -9, 4]).fill({ color }).stroke({ color: INK, width: 1.5 });
  g.rect(-4, -2, 6, 4).fill({ color: INK, alpha: 0.6 });
  c.addChild(g);
  return c;
}

/** Warnring für einen erkannten Angriff. */
export function alertRing(): Graphics {
  return new Graphics().circle(0, 0, 24).stroke({ color: 0xff4d4f, width: 3 }).circle(0, 0, 30).stroke({ color: 0xff4d4f, width: 1.5, alpha: 0.6 });
}

/** Kartenbeschriftung: Meere kursiv und blau, Regionen in Versalien. */
export function mapLabel(name: string, kind: "sea" | "region", size: number): Text {
  const sea = kind === "sea";
  const t = new Text({
    text: sea ? name : name.toUpperCase(),
    style: {
      fontFamily: sea ? "Georgia, 'Times New Roman', serif" : "system-ui, sans-serif",
      fontStyle: sea ? "italic" : "normal",
      fontWeight: sea ? "400" : "600",
      fontSize: Math.round(13 * size),
      letterSpacing: sea ? 1 : 2.5,
      fill: sea ? 0xa9dcf0 : 0xf2ead2,
      stroke: { color: sea ? 0x0b2540 : 0x1d2a17, width: 3 },
    },
  });
  t.resolution = 2;
  t.anchor.set(0.5);
  t.alpha = sea ? 0.85 : 0.75;
  return t;
}
