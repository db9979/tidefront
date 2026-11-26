// Ziehen, Zwei-Finger-Zoom, Mausrad und Tippen auf der Karte.
import type { Container } from "pixi.js";

export const MIN_SCALE = 0.04;
export const MAX_SCALE = 2.5;

export function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
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
  const zoomAt = (p: { x: number; y: number }, newScale: number) => {
    const s = clampScale(newScale);
    const wx = (p.x - world.x) / world.scale.x;
    const wy = (p.y - world.y) / world.scale.y;
    world.scale.set(s);
    world.position.set(p.x - wx * s, p.y - wy * s);
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
      world.position.set(world.x + p.x - prev.x, world.y + p.y - prev.y);
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
    } else if (pts.size === 2 && pinch) {
      const i = pinchInfo();
      world.position.set(world.x + i.mid.x - pinch.mid.x, world.y + i.mid.y - pinch.mid.y);
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
