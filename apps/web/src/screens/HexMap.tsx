// Hexkarte mit PixiJS: Gelände einmal gezeichnet, Beschriftungen und Symbole in fester Bildschirmgröße,
// Missionen mit Route und Schiff, Schwenken per Ziehen, Zoomen per Zwei-Finger, Mausrad oder Knöpfe.
import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, type Ticker } from "pixi.js";
import {
  COLS,
  HEX_SIZE_KM,
  MAP_LABELS,
  ROWS,
  TRADE_PORTS,
  hexAtLonLat,
  hexAtXY,
  hexCenterXY,
  inGrid,
} from "@tidefront/world";
import type { MapData } from "../lib/trpc.ts";
import { serverNow } from "../lib/time.ts";
import { buildTerrain, hexPoints, xyOf } from "../map/terrain.ts";
import { Graticule } from "../map/graticule.ts";
import { attachGestures, clampScale } from "../map/gestures.ts";
import {
  INK, SEE, SIEGEL, alertRing, compassRose, mapLabel, nameTag, nestSymbol, otherBaseSymbol, ownBaseSymbol, portSymbol, shipSymbol, wreckSymbol,
} from "../map/symbols.ts";
import { buildSoundings } from "../map/soundings.ts";

/** Kartenschriften vor dem ersten Zeichnen laden (Pixi rastert Text über das Canvas). */
const FONTS = ["600 12px Fraunces", "italic 600 12px Fraunces", "600 12px 'IBM Plex Sans'", "500 10px 'IBM Plex Mono'"];
const fontsReady = () => Promise.all(FONTS.map((f) => document.fonts?.load(f))).catch(() => undefined);

export interface MapMission {
  id: number;
  status: string;
  target: { col: number; row: number };
  arriveAtMs: number;
  returnAtMs: number;
}

export interface HexMapProps {
  data: MapData;
  selected: { col: number; row: number } | null;
  onSelect: (h: { col: number; row: number }) => void;
  selectMode?: boolean;
  center?: { col: number; row: number } | null;
  /** Anfangszoom beim Zentrieren (Vorgabe 0,35). */
  zoom?: number;
  /** Ändern erzwingt erneutes Zentrieren auf `center`. */
  recenter?: number;
  /** Im Auswahlmodus: freie Felder ("col,row"), die hervorgehoben werden. */
  free?: Set<string>;
  home?: { col: number; row: number } | null;
  missions?: MapMission[];
  alert?: boolean;
}

/** Element in fester Bildschirmgröße, sichtbar in einem Zoombereich. */
interface Pinned {
  obj: Container;
  min?: number;
  max?: number;
}

interface Scene {
  app: Application;
  world: Container;
  free: Graphics;
  routes: Graphics;
  pinnedLayer: Container;
  markerLayer: Container;
  selection: Graphics;
  pinnedStatic: Pinned[];
  pinnedMarkers: Pinned[];
  ships: Map<number, Container>;
  alert: Graphics | null;
  grid: Graphics;
  graticule: Graticule;
  compass: Container;
}

/** Gegenskalierung: Symbole bleiben etwa gleich groß, wachsen beim Hineinzoomen nur leicht. */
function pinScale(worldScale: number, floor = 0.75): number {
  return Math.max(floor, Math.min(1.3, worldScale / 0.3 + 0.35)) / worldScale;
}

function applyPinned(list: Pinned[], scale: number, floor?: number): void {
  const k = pinScale(scale, floor);
  for (const p of list) {
    p.obj.visible = (p.min === undefined || scale >= p.min) && (p.max === undefined || scale <= p.max);
    p.obj.scale.set(k);
  }
}

function missionPosition(m: MapMission, home: { x: number; y: number }, tgt: { x: number; y: number }, now: number) {
  const travel = Math.max(1, m.returnAtMs - m.arriveAtMs);
  const outbound = m.status === "outbound";
  const start = outbound ? m.arriveAtMs - travel : m.arriveAtMs;
  const end = outbound ? m.arriveAtMs : m.returnAtMs;
  const t = Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  const [a, b] = outbound ? [home, tgt] : [tgt, home];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x), outbound };
}

function dashed(g: Graphics, a: { x: number; y: number }, b: { x: number; y: number }, dash: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.floor(len / (dash * 2)));
  for (let i = 0; i < n; i++) {
    const t0 = (i * 2 * dash) / len;
    const t1 = Math.min(1, ((i * 2 + 1) * dash) / len);
    g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
  }
}

export function HexMap(props: HexMapProps) {
  const { data, selected, onSelect, selectMode, center, zoom, recenter, free, home, missions, alert } = props;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const live = useRef({ selected, home, missions, alert });
  live.current = { selected, home, missions, alert };

  // Aufbau (einmal)
  useEffect(() => {
    const el = host.current!;
    let destroyed = false;
    const app = new Application();
    const cleanups: (() => void)[] = [];
    void app
      .init({ resizeTo: el, background: 0xf4f1e7, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true })
      .then(fontsReady)
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
        const terrain = buildTerrain();
        world.addChild(terrain.root);
        const graticule = new Graticule();
        world.addChild(graticule.lines);
        const freeG = new Graphics();
        const routes = new Graphics();
        const pinnedLayer = new Container();
        const markerLayer = new Container();
        const selection = new Graphics();
        world.addChild(freeG, routes, markerLayer, pinnedLayer, selection);

        // Lotungen, Beschriftungen und Handelshäfen (fest)
        const pinnedStatic: Pinned[] = [];
        for (const t of buildSoundings()) {
          pinnedLayer.addChild(t);
          pinnedStatic.push({ obj: t, min: 0.2 });
        }
        for (const l of MAP_LABELS) {
          const t = mapLabel(l.name, l.kind, l.size);
          const p = xyOf(l.lon, l.lat);
          t.position.set(p.x, p.y);
          pinnedLayer.addChild(t);
          const big = l.size >= 1.25;
          pinnedStatic.push(l.kind === "sea" ? { obj: t, min: big ? undefined : 0.11, max: big ? 0.9 : 1.2 } : { obj: t, max: 0.5 });
        }
        for (const [lon, lat, name] of TRADE_PORTS) {
          const h = hexAtLonLat(lon, lat);
          const p = hexCenterXY(h.col, h.row);
          const c = new Container();
          c.addChild(portSymbol());
          const tag = nameTag(name, INK, 11);
          c.addChild(tag);
          c.position.set(p.x, p.y);
          pinnedLayer.addChild(c);
          pinnedStatic.push({ obj: c, min: 0.16 });
        }
        app.stage.addChild(graticule.labels);
        const compass = compassRose();
        app.stage.addChild(compass);

        const s: Scene = {
          app, world, free: freeG, routes, pinnedLayer, markerLayer, selection, pinnedStatic,
          pinnedMarkers: [], ships: new Map(), alert: null, grid: terrain.grid, graticule, compass,
        };
        scene.current = s;

        let lastScale = -1;
        let lastMove = 0;
        let lastPos = "";
        const tick = (_t: Ticker) => {
          const sc = world.scale.x;
          if (sc !== lastScale) {
            lastScale = sc;
            applyPinned(s.pinnedStatic, sc);
            applyPinned(s.pinnedMarkers, sc, 0.5);
            drawSelection(s, live.current.selected);
            s.graticule.redraw(sc);
            // Hexraster erst beim Hineinzoomen und nur zart
            s.grid.alpha = Math.max(0, Math.min(0.16, (sc - 0.16) * 0.4));
            s.grid.visible = s.grid.alpha > 0.005;
            lastMove = 0;
          }
          const pos = `${world.x | 0},${world.y | 0},${sc}`;
          if (pos !== lastPos) {
            lastPos = pos;
            s.graticule.place(world, app.screen.width, app.screen.height);
            s.compass.position.set(app.screen.width - 40, Math.min(178, app.screen.height - 60));
            s.compass.visible = app.screen.height > 360;
          }
          const now = performance.now();
          if (now - lastMove > 250) {
            lastMove = now;
            drawMovers(s, live.current);
          }
        };
        app.ticker.add(tick);
        app.ticker.maxFPS = 40;
        cleanups.push(() => app.ticker.remove(tick));
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
  }, []);

  // Zentrieren
  const centerKey = center ? `${center.col},${center.row},${recenter ?? 0}` : `none,${recenter ?? 0}`;
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    const w = s.app.screen.width;
    const h = s.app.screen.height;
    const target = center ? hexCenterXY(center.col, center.row) : hexCenterXY(Math.floor(COLS / 2), Math.floor(ROWS / 2));
    const fit = Math.min(w / (COLS * HEX_SIZE_KM * 1.75), h / (ROWS * HEX_SIZE_KM * 1.5));
    const scale = clampScale(center ? (zoom ?? 0.35) : fit * 2.2);
    s.world.scale.set(scale);
    s.world.position.set(w / 2 - target.x * scale, h / 2 - target.y * scale);
  }, [ready, centerKey]);

  // Freie Felder im Auswahlmodus
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    s.free.clear();
    if (!selectMode || !free) return;
    for (const key of free) {
      const [col, row] = key.split(",").map(Number);
      const { x, y } = hexCenterXY(col, row);
      s.free.poly(hexPoints(x, y, HEX_SIZE_KM * 0.82)).fill({ color: SEE, alpha: 0.12 });
      s.free.poly(hexPoints(x, y, HEX_SIZE_KM * 0.82));
    }
    s.free.stroke({ color: SEE, width: 2, alpha: 0.85 });
  }, [ready, selectMode, free]);

  // Symbole für Stützpunkte, Nester, Wracks
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    for (const c of s.markerLayer.removeChildren()) c.destroy({ children: true });
    s.pinnedMarkers = [];
    const add = (c: Container, col: number, row: number, min?: number) => {
      const p = hexCenterXY(col, row);
      c.position.set(p.x, p.y);
      s.markerLayer.addChild(c);
      s.pinnedMarkers.push({ obj: c, min });
    };
    for (const w of data.wrecks) add(wreckSymbol(), w.col, w.row, 0.1);
    for (const n of data.nests) add(nestSymbol(n.level, n.empty), n.col, n.row);
    for (const b of data.bases) {
      const c = new Container();
      c.addChild(b.own ? ownBaseSymbol() : otherBaseSymbol(b.protection !== null));
      add(c, b.col, b.row);
      const tag = nameTag(b.own ? b.name : `${b.name} · ${b.owner}`, b.own ? INK : SEE);
      add(tag, b.col, b.row, b.own ? 0.08 : 0.15);
    }
    applyPinned(s.pinnedMarkers, s.world.scale.x, 0.5);
  }, [ready, data]);

  // Auswahl
  useEffect(() => {
    const s = scene.current;
    if (ready && s) drawSelection(s, selected);
  }, [ready, selected]);

  const zoomBy = (f: number) => {
    const s = scene.current;
    if (!s) return;
    const p = { x: s.app.screen.width / 2, y: s.app.screen.height / 2 };
    const ns = clampScale(s.world.scale.x * f);
    const wx = (p.x - s.world.x) / s.world.scale.x;
    const wy = (p.y - s.world.y) / s.world.scale.y;
    s.world.scale.set(ns);
    s.world.position.set(p.x - wx * ns, p.y - wy * ns);
  };
  return (
    <div className="w-full h-full relative">
      <div ref={host} className="w-full h-full overflow-hidden select-none" />
      <div className="absolute right-2 top-6 flex flex-col gap-1.5">
        <button type="button" className="tap rounded-[3px] bg-card border border-ink text-xl text-ink" onClick={() => zoomBy(1.5)} aria-label="Hineinzoomen">+</button>
        <button type="button" className="tap rounded-[3px] bg-card border border-ink text-xl text-ink" onClick={() => zoomBy(1 / 1.5)} aria-label="Herauszoomen">−</button>
      </div>
    </div>
  );
}

function drawSelection(s: Scene, selected: { col: number; row: number } | null | undefined): void {
  s.selection.clear();
  if (!selected) return;
  const { x, y } = hexCenterXY(selected.col, selected.row);
  const sc = s.world.scale.x;
  // Zielmarke: Eckwinkel um das Feld, mindestens 22 px Halbmesser am Bildschirm
  const h = Math.max(HEX_SIZE_KM * 1.05, 22 / sc);
  const l = h * 0.42;
  const g = s.selection;
  g.poly(hexPoints(x, y, HEX_SIZE_KM)).fill({ color: SIEGEL, alpha: 0.06 }).stroke({ color: SIEGEL, width: 1 / sc, alpha: 0.6 });
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.moveTo(x + sx * h, y + sy * (h - l)).lineTo(x + sx * h, y + sy * h).lineTo(x + sx * (h - l), y + sy * h);
  }
  g.stroke({ color: SIEGEL, width: 2 / sc, cap: "square" });
  g.circle(x, y, 1.6 / sc).fill({ color: SIEGEL });
}

/** Routen, Schiffe und Warnring; läuft gedrosselt im Ticker. */
function drawMovers(s: Scene, live: { home?: { col: number; row: number } | null; missions?: MapMission[]; alert?: boolean }): void {
  const sc = s.world.scale.x;
  s.routes.clear();
  const seen = new Set<number>();
  const home = live.home ? hexCenterXY(live.home.col, live.home.row) : null;
  if (home) {
    const now = serverNow();
    for (const m of live.missions ?? []) {
      if (m.status !== "outbound" && m.status !== "returning") continue;
      const tgt = hexCenterXY(m.target.col, m.target.row);
      const pos = missionPosition(m, home, tgt, now);
      const color = pos.outbound ? SIEGEL : INK;
      s.routes.moveTo(home.x, home.y).lineTo(tgt.x, tgt.y).stroke({ color: 0xf4f1e7, width: 5 / sc, alpha: 0.8, cap: "round" });
      dashed(s.routes, home, tgt, 6 / sc);
      s.routes.stroke({ color, width: 1.8 / sc, alpha: 0.95 });
      s.routes.moveTo(tgt.x - 8 / sc, tgt.y).lineTo(tgt.x + 8 / sc, tgt.y).moveTo(tgt.x, tgt.y - 8 / sc).lineTo(tgt.x, tgt.y + 8 / sc);
      s.routes.stroke({ color, width: 1.2 / sc });
      const key = m.id * 2 + (pos.outbound ? 0 : 1);
      let ship = s.ships.get(key);
      if (!ship) {
        ship = shipSymbol(color);
        s.ships.set(key, ship);
        s.world.addChild(ship);
      }
      ship.position.set(pos.x, pos.y);
      ship.scale.set(pinScale(sc));
      seen.add(key);
    }
  }
  for (const [id, ship] of s.ships) {
    if (!seen.has(id)) {
      ship.destroy({ children: true });
      s.ships.delete(id);
    }
  }
  if (live.alert && home) {
    if (!s.alert) {
      s.alert = alertRing();
      s.world.addChild(s.alert);
    }
    s.alert.position.set(home.x, home.y);
    const pulse = 1 + 0.15 * Math.sin(performance.now() / 180);
    s.alert.scale.set(pinScale(sc) * pulse);
  } else if (s.alert) {
    s.alert.destroy();
    s.alert = null;
  }
}
