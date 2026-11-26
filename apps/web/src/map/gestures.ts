// Ziehen, Zwei-Finger-Zoom, Mausrad und Tippen auf der Karte.
// Zoomgrenzen: kleinste Stufe füllt den Bildschirm vollständig (cover), Schwenken endet am Kartenrand.
import type { Container } from "pixi.js";
import { COLS, HEX_SIZE_KM, HEX_W, ROWS, ROW_H } from "@tidefront/world";

export const MAX_SCALE = 2.5;

/** Kartenausdehnung in Welt-km (Hexraster plus halber Feldsaum). */
export const MAP_BOUNDS = { x0: -HEX_W * 0.5, y0: -HEX_SIZE_KM, x1: HEX_W * COLS, y1: ROW_H * (ROWS - 1) + HEX_SIZE_KM };

/** Kleinste Zoomstufe für einen Bildschirm: Karte deckt ihn vollständig. */
export function minScale(w: number, h: number): number {
  const b = MAP_BOUNDS;
  return Math.min(MAX_SCALE, Math.max(w / (b.x1 - b.x0), h / (b.y1 - b.y0)));
}

export function clampScale(s: number, w: number, h: number): number {
  return Math.max(minScale(w, h), Math.min(MAX_SCALE, s));
}

/** Verschiebung so begrenzen, dass kein leerer Rand neben der Karte erscheint. */
export function clampView(world: Container, w: number, h: number): void {
  const b = MAP_BOUNDS;
  const s = clampScale(world.scale.x, w, h);
  if (s !== world.scale.x) world.scale.set(s);
  const lim = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  const x = lim(world.x, w - b.x1 * s, -b.x0 * s);
  const y = lim(world.y, h - b.y1 * s, -b.y0 * s);
  if (x !== world.x || y !== world.y) world.position.set(x, y);
}

/** Zoomen um einen Bildschirmpunkt, mit Grenzen. */
export function zoomAround(world: Container, p: { x: number; y: number }, newScale: number, w: number, h: number): void {
  const s = clampScale(newScale, w, h);
  const wx = (p.x - world.x) / world.scale.x;
  const wy = (p.y - world.y) / world.scale.y;
  world.scale.set(s);
  world.position.set(p.x - wx * s, p.y - wy * s);
  clampView(world, w, h);
}

/** Rückgabe: Aufräumfunktion. onTap erhält Weltkoordinaten. */
export function attachGestures(canvas: HTMLCanvasElement, world: Container, onTap: (x: number, y: number) => void): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let moved = 0;
  let pinch: { dist: number; scale: number; mid: { x: number; y: number } } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (p: { x: number; y: number }, newScale: number) => zoomAround(world, p, newScale, canvas.clientWidth, canvas.clientHeight);
  const pan = (dx: number, dy: number) => {
    world.position.set(world.x + dx, world.y + dy);
    clampView(world, canvas.clientWidth, canvas.clientHeight);
  };
  const pinchInfo = () => {
    const [a, b] = [...pts.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) {
      downAt = performance.now();
      moved = 0;
    }
    if (pts.size === 2) {
      const i = pinchInfo();
      pinch = { dist: i.dist, scale: world.scale.x, mid: i.mid };
      moved = 999;
    }
  };
  const move = (e: PointerEvent) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      pan(p.x - prev.x, p.y - prev.y);
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
    } else if (pts.size === 2 && pinch) {
      const i = pinchInfo();
      pan(i.mid.x - pinch.mid.x, i.mid.y - pinch.mid.y);
      pinch.mid = i.mid;
      zoomAt(i.mid, pinch.scale * (i.dist / Math.max(1, pinch.dist)));
    }
  };
  const up = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (p && pts.size === 0 && moved < 10 && performance.now() - downAt < 600) {
      onTap((p.x - world.x) / world.scale.x, (p.y - world.y) / world.scale.y);
    }
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(local(e), world.scale.x * Math.exp(-e.deltaY * 0.0015));
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("wheel", wheel);
  };
}
