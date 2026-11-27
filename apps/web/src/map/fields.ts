// Felder auf der Karte im Kupferstich-Stil: Bohrinsel (Ölfeld), Erzbucht, Fischgrund, Elektronik-Wrack, jeweils mit
// Ring in der Besitzerfarbe (eigene/Allianz/Pakt/Krieg/neutral wie die Häfen, Kartell rot gestrichelt, frei grau).
// Allianz-Einflusszonen: Verbindungslinien und Hof um die Felder. Zeichen in Bildschirmgröße (HexMap skaliert gegen).
import { Container, Graphics } from "pixi.js";
import { hexCenterXY, hexDistanceKm } from "@tidefront/world";
import { ALLY, INK, PAKT, PAPER, SEE, SIEGEL } from "./symbols.ts";

export interface MapField {
  id: number;
  col: number;
  row: number;
  kind: string;
  tier: number;
  relation: string;
  zone: { id: number; size: number; bonus: boolean } | null;
}

const GREY = 0x7d7a70;
export const FIELD_COLOR: Record<string, number> = { own: INK, allianz: ALLY, pakt: PAKT, krieg: SIEGEL, neutral: SEE, kartell: SIEGEL, frei: GREY, unbekannt: GREY };

/** Kleines Feldsymbol (Halbmesser etwa 9 px) nach Art. */
export function fieldGlyph(kind: string, g: Graphics): void {
  if (kind === "oelfeld") {
    g.moveTo(-5, 7).lineTo(-3.5, 1).moveTo(5, 7).lineTo(3.5, 1).moveTo(-1, 7).lineTo(-1, 1).moveTo(1.5, 7).lineTo(1.5, 1).stroke({ color: INK, width: 1 });
    g.rect(-6.5, -0.5, 13, 2.2).fill({ color: PAPER }).stroke({ color: INK, width: 1 });
    g.moveTo(-3, -0.5).lineTo(0, -8).lineTo(3, -0.5).moveTo(-1.8, -4).lineTo(1.8, -4).stroke({ color: INK, width: 1 });
  } else if (kind === "erzbucht") {
    g.moveTo(-7, 5).bezierCurveTo(-5, -4, 5, -4, 7, 5).stroke({ color: INK, width: 1.2 });
    g.poly([-4, 5, -2, 1, 1, 2.5, 0, 5]).fill({ color: INK });
    g.poly([1, -1, 3, -3, 4.5, -1.5, 3, 0.5]).fill({ color: SIEGEL }).stroke({ color: INK, width: 0.8 });
  } else if (kind === "fischgrund") {
    g.moveTo(-7, 0).quadraticCurveTo(-1, -5, 4, 0).quadraticCurveTo(-1, 5, -7, 0).fill({ color: PAPER }).stroke({ color: INK, width: 1.1 });
    g.poly([4, 0, 8, -3, 8, 3]).fill({ color: INK });
    g.circle(-4.5, -0.8, 0.8).fill({ color: INK });
  } else {
    g.poly([-7, 3, 5, 0, 8, 4, -5, 6]).fill({ color: INK });
    g.moveTo(-1, 2).lineTo(-1, -2).lineTo(2, -2).lineTo(2, 1.5).stroke({ color: INK, width: 1 });
    g.moveTo(4, -8).lineTo(1.5, -4).lineTo(4, -4).lineTo(2, -0.5).stroke({ color: SIEGEL, width: 1.3 });
  }
}

/** Feldzeichen: Papierscheibe mit Ring in Besitzerfarbe, Stufe als Punkte darunter. */
export function fieldSymbol(f: { kind: string; tier: number; relation: string }): Container {
  const c = new Container();
  const g = new Graphics();
  const color = FIELD_COLOR[f.relation] ?? SEE;
  g.circle(0, 0, 11).fill({ color: PAPER, alpha: 0.92 });
  if (f.relation === "kartell") {
    for (let i = 0; i < 12; i++) g.arc(0, 0, 11, (i * Math.PI) / 6, (i * Math.PI) / 6 + 0.32).moveTo(0, 0);
    g.stroke({ color, width: 1.6 });
  } else {
    g.circle(0, 0, 11).stroke({ color, width: f.relation === "own" || f.relation === "frei" ? 1.4 : 2 });
    if (f.relation === "allianz") g.circle(0, 0, 13.5).stroke({ color, width: 1 });
  }
  fieldGlyph(f.kind, g);
  // Lagebild: Besitzer unbekannt – Ring blass, Zeichen etwas zurückgenommen.
  if (f.relation === "unbekannt") c.alpha = 0.6;
  for (let i = 0; i < f.tier; i++) g.circle((i - (f.tier - 1) / 2) * 4, 14.5, 1.3).fill({ color });
  c.addChild(g);
  return c;
}

/** Ebene: Zonen (in Weltkoordinaten) und Feldzeichen (pinned, Bildschirmgröße). */
export function buildFieldLayer(fields: MapField[], linkKm: number): { root: Container; pinned: { obj: Container; min?: number }[] } {
  const root = new Container();
  const zones = new Graphics();
  root.addChild(zones);
  const pinned: { obj: Container; min?: number }[] = [];
  const byZone = new Map<number, MapField[]>();
  for (const f of fields) if (f.zone && f.zone.size >= 2) byZone.set(f.zone.id, [...(byZone.get(f.zone.id) ?? []), f]);
  for (const list of byZone.values()) {
    const color = FIELD_COLOR[list[0].relation] ?? SEE;
    const bonus = list[0].zone!.bonus;
    for (const f of list) {
      const p = hexCenterXY(f.col, f.row);
      if (bonus) zones.circle(p.x, p.y, 70).fill({ color, alpha: 0.07 });
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (hexDistanceKm(list[i], list[j]) > linkKm) continue;
      const a = hexCenterXY(list[i].col, list[i].row), b = hexCenterXY(list[j].col, list[j].row);
      const len = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.floor(len / 16));
      for (let s = 0; s < k; s++) {
        const t0 = s / k, t1 = (s + 0.55) / k;
        zones.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
    }
    zones.stroke({ color, width: 1.4, pixelLine: true, alpha: bonus ? 0.9 : 0.5 });
  }
  for (const f of fields) {
    const p = hexCenterXY(f.col, f.row);
    const s = fieldSymbol(f);
    s.position.set(p.x, p.y);
    root.addChild(s);
    pinned.push({ obj: s, min: 0.08 });
  }
  return { root, pinned };
}
