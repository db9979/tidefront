// Kartensymbole als Taktikzeichen nach Art von APP-6 (freundlich blau, neutral grün, feindlich rot),
// in Bildschirm-Pixeln um (0, 0); der Aufrufer setzt Position und Gegenskalierung.
import { Container, Graphics, Text } from "pixi.js";

export const FRIEND = 0x80c0ff;
export const NEUTRAL = 0xaaffaa;
export const HOSTILE = 0xff8080;
const INK = 0x0a1420;
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const ROMAN = ["", "I", "II", "III", "IV", "V"];

function txt(s: string, size: number, fill: number, weight = "600"): Text {
  const t = new Text({ text: s, style: { fontFamily: MONO, fontSize: size, fill, fontWeight: weight as "600" } });
  t.resolution = 2;
  return t;
}

/** Namensschild in Monospace-Versalien unter einem Zeichen. */
export function nameTag(text: string, color: number, y = 16): Container {
  const c = new Container();
  const t = txt(text.toUpperCase(), 10, 0xe8f1f6);
  t.anchor.set(0.5, 0);
  const w = t.width + 8;
  const bg = new Graphics().rect(-w / 2, y, w, t.height + 2).fill({ color: INK, alpha: 0.78 }).stroke({ color, width: 1, alpha: 0.9 });
  t.position.set(0, y + 1);
  c.addChild(bg, t);
  return c;
}

/** Einrichtungsrahmen (Rechteck) mit Ankerzeichen und Einrichtungsbalken oben. */
function installation(fill: number): Graphics {
  const g = new Graphics();
  g.rect(-13, -9, 26, 18).fill({ color: fill }).stroke({ color: INK, width: 1.6 });
  g.rect(-5, -12.5, 10, 3.5).fill({ color: INK });
  // Anker
  g.circle(0, -4.2, 1.6).stroke({ color: INK, width: 1.2 });
  g.moveTo(0, -2.6).lineTo(0, 5).moveTo(-3, -0.8).lineTo(3, -0.8).stroke({ color: INK, width: 1.4 });
  g.arc(0, 1.4, 4.6, 0.15 * Math.PI, 0.85 * Math.PI).stroke({ color: INK, width: 1.4 });
  return g;
}

export function ownBaseSymbol(): Container {
  const c = new Container();
  c.addChild(installation(FRIEND));
  return c;
}

/** Fremder Spielerhafen: neutral (grün); geschützt mit gestricheltem Rahmen. */
export function otherBaseSymbol(isProtected: boolean): Container {
  const c = new Container();
  c.addChild(installation(NEUTRAL));
  if (isProtected) {
    const g = new Graphics();
    for (let i = -17; i < 17; i += 6) g.moveTo(i, -14).lineTo(Math.min(17, i + 3), -14).moveTo(i, 13).lineTo(Math.min(17, i + 3), 13);
    g.stroke({ color: 0xcfe8f0, width: 1.2, alpha: 0.9 });
    c.addChild(g);
  }
  return c;
}

/** Piratennest: feindliche Raute, Stufe als römische Zahl darüber; verlassen gestrichelt grau. */
export function nestSymbol(level: number, empty: boolean): Container {
  const c = new Container();
  const g = new Graphics();
  const r = 11;
  if (empty) {
    const pts = [[0, -r], [r, 0], [0, r], [-r, 0], [0, -r]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      for (let t = 0; t < 1; t += 0.34) {
        const t2 = Math.min(1, t + 0.18);
        g.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t).lineTo(ax + (bx - ax) * t2, ay + (by - ay) * t2);
      }
    }
    g.stroke({ color: 0x9aa4ad, width: 1.6 });
  } else {
    g.poly([0, -r, r, 0, 0, r, -r, 0]).fill({ color: HOSTILE }).stroke({ color: INK, width: 1.6 });
    // Kennung: gekreuzte Säbel als zwei Linien
    g.moveTo(-4.5, -4.5).lineTo(4.5, 4.5).moveTo(4.5, -4.5).lineTo(-4.5, 4.5).stroke({ color: INK, width: 1.4 });
  }
  c.addChild(g);
  const t = txt(ROMAN[Math.max(1, Math.min(5, level))], 9, empty ? 0x9aa4ad : 0xffd0d0, "700");
  t.anchor.set(0.5, 1);
  t.position.set(0, -r - 1);
  c.addChild(t);
  return c;
}

/** Wrackfeld: gestrichelter Kreis mit Kreuz. */
export function wreckSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  for (let i = 0; i < 8; i++) g.arc(0, 0, 7, (i * Math.PI) / 4, (i * Math.PI) / 4 + 0.45).moveTo(0, 0);
  g.stroke({ color: 0xb8c2ca, width: 1.4 });
  g.moveTo(-3.5, -3.5).lineTo(3.5, 3.5).moveTo(3.5, -3.5).lineTo(-3.5, 3.5).stroke({ color: 0xb8c2ca, width: 1.4 });
  c.addChild(g);
  return c;
}

/** Handelshafen: kleiner Kreis mit Anker. */
export function portSymbol(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 7).fill({ color: INK, alpha: 0.7 }).stroke({ color: 0x9fd3e6, width: 1 });
  g.moveTo(0, -3.5).lineTo(0, 4).moveTo(-2.5, -1.5).lineTo(2.5, -1.5).stroke({ color: 0xd8ecf2, width: 1.1 });
  g.arc(0, 0.5, 3.6, 0.15 * Math.PI, 0.85 * Math.PI).stroke({ color: 0xd8ecf2, width: 1.1 });
  c.addChild(g);
  return c;
}

/** Eigener Verband auf See: freundlicher Kreisrahmen (Seeeinheit) mit Rumpfzeichen. */
export function shipSymbol(color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 8).fill({ color }).stroke({ color: INK, width: 1.4 });
  g.poly([-5, -1, 5, -1, 3, 3, -3, 3]).fill({ color: INK });
  g.moveTo(0, -1).lineTo(0, -5).stroke({ color: INK, width: 1.2 });
  c.addChild(g);
  return c;
}

/** Erkannter Angriff: rote Raute und Ring um den eigenen Hafen. */
export function alertRing(): Graphics {
  return new Graphics()
    .poly([0, -26, 26, 0, 0, 26, -26, 0]).stroke({ color: HOSTILE, width: 2 })
    .circle(0, 0, 32).stroke({ color: HOSTILE, width: 1, alpha: 0.6 });
}

/** Kartenbeschriftung: Meere kursiv gedeckt blau, Regionen in gesperrten Versalien. */
export function mapLabel(name: string, kind: "sea" | "region", size: number): Text {
  const sea = kind === "sea";
  const t = new Text({
    text: sea ? name : name.toUpperCase(),
    style: {
      fontFamily: sea ? "Georgia, 'Times New Roman', serif" : "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif",
      fontStyle: sea ? "italic" : "normal",
      fontWeight: "400",
      fontSize: Math.round((sea ? 12 : 10.5) * size),
      letterSpacing: sea ? 1.5 : 3.5,
      fill: sea ? 0x8fb8cc : 0xd9d3bd,
      stroke: { color: 0x061019, width: 2, alpha: 0.5 },
    },
  });
  t.resolution = 2;
  t.anchor.set(0.5);
  t.alpha = sea ? 0.8 : 0.62;
  return t;
}
