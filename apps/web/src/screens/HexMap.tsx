// Hexkarte mit PixiJS: Gelände einmal gezeichnet, Marker bei neuen Daten, Schwenken per Ziehen,
// Zoomen per Zwei-Finger oder Mausrad, Tippen wählt ein Feld.
import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import {
  COLS,
  HEX_SIZE_KM,
  ROWS,
  hexAtXY,
  hexCenterXY,
  hexIndex,
  inGrid,
  terrainMap,
} from "@tidefront/world";
import type { MapData } from "../lib/trpc.ts";

export interface HexMapProps {
  data: MapData;
  selected: { col: number; row: number } | null;
  onSelect: (h: { col: number; row: number }) => void;
  selectMode?: boolean;
  center?: { col: number; row: number } | null;
}

const COLOR = { sea: 0x0f2a44, coast: 0x6b7d45, land: 0x2f4a2b, bg: 0x060e18 };
const MIN_SCALE = 0.04;
const MAX_SCALE = 2.5;

function hexPoints(cx: number, cy: number, size: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    pts.push(cx + size * Math.cos(a), cy + size * Math.sin(a));
  }
  return pts;
}

interface Scene {
  app: Application;
  world: Container;
  markers: Container;
  selection: Graphics;
}

export function HexMap({ data, selected, onSelect, selectMode, center }: HexMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Aufbau (einmal)
  useEffect(() => {
    const el = host.current!;
    let destroyed = false;
    const app = new Application();
    const cleanups: (() => void)[] = [];
    void app
      .init({ resizeTo: el, background: COLOR.bg, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true })
      .then(() => {
        if (destroyed) {
          app.destroy(true);
          return;
        }
        el.appendChild(app.canvas);
        app.canvas.style.touchAction = "none";
        app.canvas.style.display = "block";
        const world = new Container();
        app.stage.addChild(world);
        const terrain = new Graphics();
        const t = terrainMap();
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const { x, y } = hexCenterXY(col, row);
            terrain.poly(hexPoints(x, y, HEX_SIZE_KM * 0.95)).fill({ color: COLOR[t[hexIndex(col, row)]] });
          }
        }
        world.addChild(terrain);
        if (selectMode) {
          const ring = new Graphics();
          for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
            if (t[hexIndex(col, row)] !== "coast") continue;
            const { x, y } = hexCenterXY(col, row);
            ring.poly(hexPoints(x, y, HEX_SIZE_KM * 0.85)).stroke({ color: 0xf2c14e, width: 5, alpha: 0.55 });
          }
          world.addChild(ring);
        }
        const markers = new Container();
        world.addChild(markers);
        const selection = new Graphics();
        world.addChild(selection);
        scene.current = { app, world, markers, selection };
        cleanups.push(attachGestures(app.canvas, world, (x, y) => {
          const h = hexAtXY(x, y);
          if (inGrid(h.col, h.row)) onSelectRef.current(h);
        }));
        setReady(true);
      });
    return () => {
      destroyed = true;
      for (const c of cleanups) c();
      if (scene.current) {
        scene.current.app.destroy(true, { children: true });
        scene.current = null;
      }
    };
  }, [selectMode]);

  // Ausgangsansicht: auf das gewünschte Feld zentrieren
  const centerKey = center ? `${center.col},${center.row}` : "";
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    const w = s.app.screen.width;
    const h = s.app.screen.height;
    const target = center ? hexCenterXY(center.col, center.row) : hexCenterXY(Math.floor(COLS / 2), Math.floor(ROWS / 2));
    const scale = center ? 0.35 : Math.max(MIN_SCALE, Math.min(w / (COLS * HEX_SIZE_KM * 1.75), h / (ROWS * HEX_SIZE_KM * 1.5)) * 2.2);
    s.world.scale.set(scale);
    s.world.position.set(w / 2 - target.x * scale, h / 2 - target.y * scale);
  }, [ready, centerKey]);

  // Marker
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    for (const c of s.markers.removeChildren()) c.destroy();
    const g = new Graphics();
    for (const w of data.wrecks) {
      const { x, y } = hexCenterXY(w.col, w.row);
      g.poly([x + 22, y - 30, x + 34, y - 18, x + 22, y - 6, x + 10, y - 18]).fill({ color: 0xe8893a });
    }
    for (const n of data.nests) {
      const { x, y } = hexCenterXY(n.col, n.row);
      g.circle(x, y, 26).fill({ color: n.empty ? 0x4b5563 : 0x8e3fb8 }).stroke({ color: 0x0b1726, width: 4 });
    }
    for (const b of data.bases) {
      const { x, y } = hexCenterXY(b.col, b.row);
      g.rect(x - 24, y - 24, 48, 48).fill({ color: b.own ? 0xf2c14e : 0xe5484d }).stroke({ color: 0xffffff, width: 5 });
    }
    s.markers.addChild(g);
    for (const n of data.nests) {
      const { x, y } = hexCenterXY(n.col, n.row);
      const txt = new Text({ text: String(n.level), style: { fontSize: 34, fill: 0xffffff, fontWeight: "bold" } });
      txt.anchor.set(0.5);
      txt.position.set(x, y);
      s.markers.addChild(txt);
    }
  }, [ready, data]);

  // Auswahl
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    s.selection.clear();
    if (selected) {
      const { x, y } = hexCenterXY(selected.col, selected.row);
      s.selection.poly(hexPoints(x, y, HEX_SIZE_KM)).stroke({ color: 0xffffff, width: 7 });
    }
  }, [ready, selected]);

  const zoom = (f: number) => {
    const s = scene.current;
    if (!s) return;
    const p = { x: s.app.screen.width / 2, y: s.app.screen.height / 2 };
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.world.scale.x * f));
    const wx = (p.x - s.world.x) / s.world.scale.x;
    const wy = (p.y - s.world.y) / s.world.scale.y;
    s.world.scale.set(ns);
    s.world.position.set(p.x - wx * ns, p.y - wy * ns);
  };
  return (
    <div className="w-full h-full relative">
      <div ref={host} className="w-full h-full overflow-hidden select-none" />
      <div className="absolute right-2 top-2 flex flex-col gap-2">
        <button type="button" className="tap rounded-full bg-navy-800/90 border border-navy-600 text-xl" onClick={() => zoom(1.4)} aria-label="Hineinzoomen">+</button>
        <button type="button" className="tap rounded-full bg-navy-800/90 border border-navy-600 text-xl" onClick={() => zoom(1 / 1.4)} aria-label="Herauszoomen">−</button>
      </div>
    </div>
  );
}

/** Ziehen, Zwei-Finger-Zoom, Mausrad, Tippen. Rückgabe: Aufräumfunktion. */
function attachGestures(canvas: HTMLCanvasElement, world: Container, onTap: (x: number, y: number) => void): () => void {
  const pts = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let moved = 0;
  let pinch: { dist: number; scale: number; mid: { x: number; y: number } } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (p: { x: number; y: number }, newScale: number) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
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
      // Mittelpunkt mitschwenken, dann um ihn zoomen
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
