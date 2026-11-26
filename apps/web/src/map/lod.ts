// Detailstufen der Karte (Level of Detail): Sichtbarkeit je Zoom mit weichen Übergängen,
// Kollisionsvermeidung der Beschriftungen nach Priorität. Berechnung nur bei Zoomänderung;
// der Ticker blendet danach nur noch die Deckkraft zum Ziel hin über.
import type { Bounds, Container } from "pixi.js";

/** Übersicht: darunter nur das Wesentliche (Punkte statt Zeichen). */
export const LOD_OVERVIEW = 0.25;
/** Nahansicht: ab hier Wracks, Lotungen, alle Namen. */
export const LOD_NEAR = 0.55;
/** Wetterschicht: in der Übersicht voll, ab der Nahansicht nur noch blass (Zeichen bleiben lesbar). */
export const LOD_WEATHER_FADE = LOD_NEAR;
export const WEATHER_NEAR_ALPHA = 0.35;

/** Element in Bildschirmgröße, sichtbar in einem Zoombereich. */
export interface Pinned {
  obj: Container;
  /** Ab dieser Zoomstufe eingeblendet (weicher Übergang um den Wert). */
  min?: number;
  /** Bis zu dieser Zoomstufe sichtbar. */
  max?: number;
  /** Feste Bildschirmgröße (Schrift, Punkte); sonst wachsen Symbole beim Hineinzoomen leicht. */
  fixed?: boolean;
  /** Untergrenze der Gegenskalierung für Symbole. */
  floor?: number;
  /** Kollisionsprüfung: kleinere Zahl = wichtiger; negativ = immer sichtbar, belegt aber Platz. */
  prio?: number;
  /** Grundlegende Deckkraft (beim Anlegen übernommen). */
  base?: number;
  /** Zieldeckkraft aus Zoom und Kollision. */
  target?: number;
  /** Lokale Ausmaße (einmal gemessen). */
  box?: Bounds;
}

/** Gegenskalierung: Symbole bleiben etwa gleich groß, wachsen beim Hineinzoomen nur leicht. */
export function pinScale(worldScale: number, floor = 0.75): number {
  return Math.max(floor, Math.min(1.3, worldScale / 0.3 + 0.35)) / worldScale;
}

/** Weiche Rampe in logarithmischer Zoomskala (Breite etwa ±12 %). */
function ramp(scale: number, edge: number): number {
  const t = Math.log(scale / edge) / 0.24 + 0.5;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Deckkraft der Wetterschicht je Zoom (weicher Übergang um LOD_WEATHER_FADE). */
export function weatherAlpha(scale: number): number {
  return 1 - (1 - WEATHER_NEAR_ALPHA) * ramp(scale, LOD_WEATHER_FADE);
}

export function zoomAlpha(p: Pinned, scale: number): number {
  let a = 1;
  if (p.min !== undefined) a *= ramp(scale, p.min);
  if (p.max !== undefined) a *= 1 - ramp(scale, p.max);
  return a;
}

const PAD = 3;

/**
 * Zielwerte für alle Elemente setzen: Skalierung sofort, Deckkraft als Ziel.
 * Kollision im Bildschirmmaß, unabhängig vom Verschieben (nur Zoom geht ein): kein Flackern beim Schwenken.
 */
export function layout(lists: Pinned[][], scale: number): void {
  const k = pinScale(scale);
  const cand: { p: Pinned; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const list of lists) {
    for (const p of list) {
      if (p.base === undefined) p.base = p.obj.alpha;
      const s = p.fixed ? 1 / scale : p.floor !== undefined ? pinScale(scale, p.floor) : k;
      p.obj.scale.set(s);
      const a = zoomAlpha(p, scale);
      p.target = a;
      if (p.prio === undefined || a < 0.05) continue;
      if (!p.box) p.box = p.obj.getLocalBounds().clone();
      const f = s * scale;
      const cx = p.obj.x * scale;
      const cy = p.obj.y * scale;
      cand.push({ p, x0: cx + p.box.minX * f - PAD, y0: cy + p.box.minY * f - PAD, x1: cx + p.box.maxX * f + PAD, y1: cy + p.box.maxY * f + PAD });
    }
  }
  cand.sort((a, b) => a.p.prio! - b.p.prio!);
  const taken: typeof cand = [];
  for (const c of cand) {
    const hit = taken.some((t) => c.x0 < t.x1 && c.x1 > t.x0 && c.y0 < t.y1 && c.y1 > t.y0);
    if (hit && c.p.prio! >= 0) c.p.target = 0;
    else taken.push(c);
  }
}

/** Deckkraft einen Schritt zum Ziel blenden. Rückgabe: noch in Bewegung. */
export function fade(lists: Pinned[][], step: number): boolean {
  let busy = false;
  for (const list of lists) {
    for (const p of list) {
      const want = (p.target ?? 1) * (p.base ?? 1);
      const cur = p.obj.alpha;
      if (cur === want) continue;
      const next = Math.abs(want - cur) <= step ? want : cur + Math.sign(want - cur) * step;
      p.obj.alpha = next;
      p.obj.visible = next > 0.01;
      if (next !== want) busy = true;
    }
  }
  return busy;
}

/** Sofort auf Zielwerte setzen (beim ersten Aufbau). */
export function snap(lists: Pinned[][]): void {
  for (const list of lists) for (const p of list) {
    p.obj.alpha = (p.target ?? 1) * (p.base ?? 1);
    p.obj.visible = p.obj.alpha > 0.01;
  }
}
