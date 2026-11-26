// Kartensymbole im Stil einer Admiralitätskarte (Kupferstich): Tinte, Papier, Siegelrot für Feinde.
// In Bildschirm-Pixeln um (0, 0); der Aufrufer setzt Position und Gegenskalierung.
import { Container, Graphics, Text } from "pixi.js";

export const INK = 0x18273a;
export const PAPER = 0xfbf8f0;
export const SIEGEL = 0xa8331f;
export const SEE = 0x2d5b7a;
/** Farben für Verbände: Hinfahrt Siegelrot, Rückfahrt Tinte. Namen bleiben für ältere Aufrufer. */
export const FRIEND = SIEGEL;
export const NEUTRAL = SEE;
export const HOSTILE = SIEGEL;
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const ROMAN = ["", "I", "II", "III", "IV", "V"];

function txt(s: string, size: number, fill: number, family = SERIF, weight = "600", spacing = 0): Text {
  const t = new Text({ text: s, style: { fontFamily: family, fontSize: size, fill, fontWeight: weight as "600", letterSpacing: spacing } });
  t.resolution = 2;
  return t;
}

/** Namensschild: Papierplakette mit Tintenrahmen, Name in Fraunces-Versalien. */
export function nameTag(text: string, color: number, y = 18): Container {
  const c = new Container();
  const t = txt(text.toUpperCase(), 10.5, INK, SERIF, "600", 1.2);
  t.anchor.set(0.5, 0);
  const w = t.width + 10;
  const bg = new Graphics().rect(-w / 2, y, w, t.height + 3).fill({ color: PAPER }).stroke({ color, width: color === SEE || color === INK ? 1 : 1.4 });
  t.position.set(0, y + 1.5);
  c.addChild(bg, t);
  return c;
}

function anchor(g: Graphics, color: number, k = 1): void {
  g.circle(0, -5 * k, 1.8 * k).stroke({ color, width: 1.3 });
  g.moveTo(0, -3.2 * k).lineTo(0, 5.5 * k).moveTo(-3.4 * k, -1 * k).lineTo(3.4 * k, -1 * k).stroke({ color, width: 1.5 });
  g.arc(0, 1.2 * k, 5 * k, 0.12 * Math.PI, 0.88 * Math.PI).stroke({ color, width: 1.5 });
}

/** Eigener Hafen: Tintenkreis mit Anker. */
export function ownBaseSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 14).fill({ color: INK });
  g.circle(0, 0, 11).stroke({ color: PAPER, width: 0.8 });
  anchor(g, PAPER, 1.15);
  c.addChild(g);
  return c;
}

/** Verhältnis eines fremden Hafens zum Betrachter (aus der Kartenansicht). */
export type Relation = "allianz" | "pakt" | "krieg" | "neutral";
/** Grünspan für die eigene Allianz, Ocker für Paktpartner, Siegelrot für Kriegsgegner, Seeblau neutral. */
export const ALLY = 0x3d6b4f;
export const PAKT = 0x9a7424;
export const RELATION_COLOR: Record<Relation, number> = { allianz: ALLY, pakt: PAKT, krieg: SIEGEL, neutral: SEE };

/**
 * Fremder Spielerhafen: Papierkreis mit Anker in der Farbe des Verhältnisses; Allianz mit innerem Doppelring,
 * Krieg mit vier Peilstrichen, geschützt mit gestricheltem Außenring.
 */
export function otherBaseSymbol(isProtected: boolean, relation: Relation = "neutral"): Container {
  const c = new Container();
  const g = new Graphics();
  const col = RELATION_COLOR[relation];
  g.circle(0, 0, 12).fill({ color: PAPER }).stroke({ color: col, width: relation === "neutral" ? 1.6 : 2 });
  if (relation === "allianz") g.circle(0, 0, 9.6).stroke({ color: col, width: 0.7 });
  anchor(g, col, relation === "allianz" ? 0.85 : 1);
  if (relation === "krieg") {
    g.moveTo(0, -13).lineTo(0, -19).moveTo(0, 13).lineTo(0, 19).moveTo(-13, 0).lineTo(-19, 0).moveTo(13, 0).lineTo(19, 0);
    g.stroke({ color: SIEGEL, width: 1.6 });
  }
  if (isProtected) for (let i = 0; i < 12; i++) g.arc(0, 0, 16, (i * Math.PI) / 6, (i * Math.PI) / 6 + 0.28).moveTo(0, 0);
  if (isProtected) g.stroke({ color: col, width: 1.2 });
  c.addChild(g);
  return c;
}

/** Übersichtspunkt eines Nests: kleine Raute (Häfen sind Kreise), Größe nach Stufe. */
export function diamondDot(color: number, r: number, alpha = 1): Container {
  const c = new Container();
  const g = new Graphics();
  const o = r + 1.1;
  g.poly([0, -o, o, 0, 0, o, -o, 0]).fill({ color: PAPER, alpha: 0.9 });
  g.poly([0, -r, r, 0, 0, r, -r, 0]).fill({ color, alpha });
  c.addChild(g);
  return c;
}

/** Piratennest: siegelrote Raute mit römischer Stufe; verlassen als gestrichelte Tintenraute. */
export function nestSymbol(level: number, empty: boolean): Container {
  const c = new Container();
  const g = new Graphics();
  const r = 12;
  const roman = ROMAN[Math.max(1, Math.min(5, level))];
  if (empty) {
    const pts = [[0, -r], [r, 0], [0, r], [-r, 0], [0, -r]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      for (let t = 0; t < 1; t += 0.34) {
        const t2 = Math.min(1, t + 0.18);
        g.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t).lineTo(ax + (bx - ax) * t2, ay + (by - ay) * t2);
      }
    }
    g.stroke({ color: 0x59636f, width: 1.4 });
  } else {
    g.poly([0, -r, r, 0, 0, r, -r, 0]).fill({ color: SIEGEL });
    g.poly([0, -r + 3.5, r - 3.5, 0, 0, r - 3.5, -r + 3.5, 0]).stroke({ color: PAPER, width: 0.8 });
  }
  c.addChild(g);
  const t = txt(roman, roman.length > 2 ? 7.5 : 9, empty ? 0x59636f : PAPER, SERIF, "600");
  t.anchor.set(0.5, 0.5);
  t.position.set(0, 0.5);
  c.addChild(t);
  return c;
}

/** Wrackfeld: Seekarten-Zeichen (Rumpfstrich mit drei Masten), gestrichelt umrandet. */
export function wreckSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  for (let i = 0; i < 10; i++) g.arc(0, 0, 9, (i * Math.PI) / 5, (i * Math.PI) / 5 + 0.32).moveTo(0, 0);
  g.stroke({ color: INK, width: 1 });
  g.moveTo(-6, 0).lineTo(6, 0).moveTo(-3, -3).lineTo(-3, 3).moveTo(0, -4).lineTo(0, 4).moveTo(3, -3).lineTo(3, 3).stroke({ color: INK, width: 1.4 });
  c.addChild(g);
  return c;
}

/** Übersichtspunkt: kleiner Kreis mit Papierrand (Bildschirm-Pixel), z. B. für Nester und fremde Häfen. */
export function dotSymbol(color: number, r: number, alpha = 1, hollow = false): Container {
  const c = new Container();
  const g = new Graphics();
  if (hollow) g.circle(0, 0, r).fill({ color: PAPER }).stroke({ color, width: 1.2, alpha });
  else g.circle(0, 0, r + 0.9).fill({ color: PAPER, alpha: 0.9 }).circle(0, 0, r).fill({ color, alpha });
  c.addChild(g);
  return c;
}

/** Handelshafen: kleiner Tintenanker im Papierkreis. */
export function portSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 8).fill({ color: PAPER }).stroke({ color: INK, width: 1.2 });
  anchor(g, INK, 0.75);
  c.addChild(g);
  return c;
}

/** Eigener Verband: Papierkreis mit Rumpf im Seitenriss. */
export function shipSymbol(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 10).fill({ color: PAPER }).stroke({ color, width: 1.4 });
  g.poly([-6.5, 0.5, 6.5, 0.5, 4.5, 4, -4.5, 4]).fill({ color: INK });
  g.rect(-2.5, -2.5, 5, 3).fill({ color: INK });
  g.moveTo(0.5, -2.5).lineTo(0.5, -6).stroke({ color: INK, width: 1.1 });
  c.addChild(g);
  return c;
}

/** Erkannter Angriff: rote Raute und Ring um den eigenen Hafen. */
export function alertRing(): Graphics {
  return new Graphics()
    .poly([0, -28, 28, 0, 0, 28, -28, 0]).stroke({ color: SIEGEL, width: 2 })
    .circle(0, 0, 34).stroke({ color: SIEGEL, width: 1, alpha: 0.6 });
}

/** Windrose für den Kartenrand (Bildschirm-Pixel). */
export function compassRose(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 26).fill({ color: PAPER, alpha: 0.92 }).stroke({ color: INK, width: 0.8 });
  g.circle(0, 0, 21).stroke({ color: INK, width: 0.5 });
  for (let i = 0; i < 32; i++) {
    const a = (i * Math.PI) / 16;
    const r0 = i % 4 === 0 ? 17 : 19;
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * 21, Math.sin(a) * 21);
  }
  g.stroke({ color: INK, width: 0.6 });
  g.poly([0, -24, 3.6, 0, 0, 24, -3.6, 0]).fill({ color: INK });
  g.poly([-24, 0, 0, -3.6, 24, 0, 0, 3.6]).fill({ color: INK, alpha: 0.5 });
  g.poly([0, -24, 3.6, 0, -3.6, 0]).fill({ color: SIEGEL });
  g.circle(0, 0, 2).fill({ color: PAPER }).stroke({ color: INK, width: 0.8 });
  c.addChild(g);
  const n = txt("N", 10, INK);
  n.anchor.set(0.5, 1);
  n.position.set(0, -27);
  c.addChild(n);
  return c;
}

/** Lotung (Wassertiefe in Metern): kleine kursive Zahl. */
export function sounding(m: number): Text {
  const t = new Text({ text: String(m), style: { fontFamily: SERIF, fontStyle: "italic", fontWeight: "600", fontSize: 9, fill: 0x5b7486 } });
  t.resolution = 2;
  t.anchor.set(0.5);
  return t;
}

export function mapLabel(name: string, kind: "sea" | "region", size: number): Text {
  const sea = kind === "sea";
  const t = new Text({
    text: sea ? name : name.toUpperCase(),
    style: {
      fontFamily: sea ? SERIF : SANS,
      fontStyle: sea ? "italic" : "normal",
      fontWeight: "600",
      fontSize: Math.round((sea ? 12 : 10.5) * size),
      letterSpacing: sea ? 1.5 : 3.5,
      fill: sea ? SEE : 0x4f5b69,
      stroke: { color: 0xf4f1e7, width: 3, alpha: 0.85 },
    },
  });
  t.resolution = 2;
  t.anchor.set(0.5);
  t.alpha = sea ? 0.95 : 0.85;
  return t;
}
