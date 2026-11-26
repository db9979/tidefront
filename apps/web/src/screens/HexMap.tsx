// Hexkarte mit PixiJS: Gelände einmal gezeichnet, Beschriftungen und Symbole in fester Bildschirmgröße,
// Missionen mit Route und Schiff, Schwenken per Ziehen, Zoomen per Zwei-Finger, Mausrad oder Knöpfe.
import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, type Ticker } from "pixi.js";
import {
  HEX_SIZE_KM,
  MAP_LABELS,
  TRADE_PORTS,
  hexAtLonLat,
  hexAtXY,
  hexCenterXY,
  inGrid,
} from "@tidefront/world";
import type { MapData } from "../lib/trpc.ts";
import { serverNow } from "../lib/time.ts";
import { registerSnapshotSurface } from "../lib/screenshot.ts";
import { buildTerrain, hexPoints, xyOf } from "../map/terrain.ts";
import { Graticule } from "../map/graticule.ts";
import { MAP_BOUNDS, attachGestures, clampScale, clampView, minScale, zoomAround } from "../map/gestures.ts";
import {
  INK, RELATION_COLOR, SEE, SIEGEL, alertRing, compassRose, diamondDot, dotSymbol, mapLabel, nameTag, nestSymbol, otherBaseSymbol, ownBaseSymbol, portSymbol, shipSymbol, wreckSymbol,
} from "../map/symbols.ts";
import { LOD_NEAR, LOD_OVERVIEW, fade, layout, pinScale, snap, weatherAlpha, type Pinned } from "../map/lod.ts";
import { buildWeatherLayer, type WeatherLayer } from "../map/weather.ts"; // Wetterschicht (v1.6)
import type { WeatherBalance } from "@tidefront/game-core";
import { buildSoundings } from "../map/soundings.ts";
// Weltereignisse des Kartells (eigene Ebene unter den Hafenzeichen)
import { buildWorldEventLayer, type MapWorldEvent } from "../map/world-events.ts";
import { buildNavalLayer, type MapNaval } from "../map/naval.ts"; // See: Minen/Blockade/Konvoi
import { buildFieldLayer, type MapField } from "../map/fields.ts"; // Felder: Rohstofffelder und Allianzzonen
import { drawSelection, type HarborOverlay } from "../map/selection.ts"; // Auswahl, aktiver Hafen, Reichweite

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
  /** Tipp auf einen eigenen Verband (Schiffssymbol): Missions-ID. */
  onMissionTap?: (missionId: number) => void;
  /** Hervorgehobener Verband (pulsierender Ring). */
  focusMission?: number | null;
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
  /** Weltereignisse (Schatzschiff, Großflotte, Belagerung). */
  events?: MapWorldEvent[];
  naval?: MapNaval; // See: Minenfelder, Blockaden, Konvois
  fields?: { list: MapField[]; linkKm: number }; // Felder
  /** Wetterschicht (Wolken, Sturm, Nebel); fehlt sie, ist die Schicht aus. */
  weather?: WeatherBalance | null;
  /** Mehrere Häfen: aktiven Hafen hervorheben, Reichweitenkreis der Gründung. */
  harbors?: Omit<HarborOverlay, "multi"> | null;
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

/** Beschriftungs-Prioritäten: Meere > große Regionen > kleine Regionen > Häfen > fremde Stützpunkte. */
const PRIO = { always: -1, ocean: 0, sea: 1, bigRegion: 2, region: 3, port: 4, base: 5 } as const;
/** Ab hier Namensschilder von Häfen und fremden Stützpunkten. */
const LOD_NAMES = 0.4;
/** Unterkante der Zoomknöpfe (top-6 + zwei 44-px-Knöpfe + Abstand). */
const BUTTONS_BOTTOM = 24 + 44 * 2 + 6;

/** Sichtbarkeit und Größe aller Zeichen bei Zoomänderung neu bestimmen. */
function relayout(s: Scene): void {
  layout([s.pinnedStatic, s.pinnedMarkers], s.world.scale.x);
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
  const { data, selected, onSelect, selectMode, center, zoom, recenter, free, home, missions, alert, events, weather, naval, fields } = props;
  const weatherLayer = useRef<WeatherLayer | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onMissionRef = useRef(props.onMissionTap);
  onMissionRef.current = props.onMissionTap;
  const ownCount = data.bases.filter((b) => b.own).length;
  const harbors = props.harbors ? { ...props.harbors, multi: ownCount > 1 } : null;
  const live = useRef({ selected, home, missions, alert, focus: props.focusMission ?? null, harbors });
  live.current = { selected, home, missions, alert, focus: props.focusMission ?? null, harbors };

  // Aufbau (einmal)
  useEffect(() => {
    const el = host.current!;
    let destroyed = false;
    const app = new Application();
    const cleanups: (() => void)[] = [];
    // „Fehler melden“: Kartenbild für den Screenshot (WebGL ohne preserveDrawingBuffer).
    const shot = registerSnapshotSurface();
    cleanups.push(() => shot.dispose());
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
        // Vor der Aufnahme auf die aktuelle Größe des Kartenrahmens bringen und Randzeichen neu setzen,
        // sonst schneidet der Rahmen eine veraltete, breitere Fläche ab (Windrose am rechten Rand).
        shot.ready(app.canvas, () => {
          app.resize();
          tick(app.ticker);
          app.render();
        });
        // resizeTo hört nur auf Fenstergrößen; Größenänderungen des Rahmens (Info-Blatt, Overlays) zusätzlich.
        const ro = new ResizeObserver(() => app.queueResize());
        ro.observe(el);
        cleanups.push(() => ro.disconnect());
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
          pinnedStatic.push({ obj: t, min: LOD_NEAR + 0.1, fixed: true });
        }
        for (const l of MAP_LABELS) {
          const t = mapLabel(l.name, l.kind, l.size);
          const p = xyOf(l.lon, l.lat);
          t.position.set(p.x, p.y);
          pinnedLayer.addChild(t);
          const big = l.size >= 1.25;
          pinnedStatic.push(l.kind === "sea"
            ? { obj: t, max: big ? 0.9 : 1.2, fixed: true, prio: big ? PRIO.ocean : PRIO.sea }
            : { obj: t, max: 0.5, fixed: true, prio: l.size >= 1 ? PRIO.bigRegion : PRIO.region });
        }
        for (const [lon, lat, name] of TRADE_PORTS) {
          const h = hexAtLonLat(lon, lat);
          const p = hexCenterXY(h.col, h.row);
          const at = (obj: Container, pin: Omit<Pinned, "obj">) => {
            obj.position.set(p.x, p.y);
            pinnedLayer.addChild(obj);
            pinnedStatic.push({ obj, ...pin });
          };
          // Übersicht: kleiner Ring; danach Ankerzeichen, Name erst näher und nur ohne Überlappung
          at(dotSymbol(INK, 2.6, 0.8, true), { max: LOD_OVERVIEW, fixed: true });
          at(portSymbol(), { min: LOD_OVERVIEW });
          at(nameTag(name, INK, 11), { min: LOD_NAMES, fixed: true, prio: PRIO.port });
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
        let lastSize = "";
        let fading = false;
        const tick = (_t: Ticker) => {
          const w = app.screen.width;
          const h = app.screen.height;
          const size = `${w}x${h}`;
          if (size !== lastSize) {
            // Drehung oder Größenänderung: Grenzen neu, Karte deckt weiter den Bildschirm
            lastSize = size;
            clampView(world, w, h);
          }
          const sc = world.scale.x;
          if (sc !== lastScale) {
            const first = lastScale < 0;
            lastScale = sc;
            relayout(s);
            if (first) snap([s.pinnedStatic, s.pinnedMarkers]);
            fading = true;
            drawSelection(s.selection, sc, live.current.selected, live.current.harbors);
            s.graticule.redraw(sc);
            // Hexraster erst in der Nahansicht und nur zart; in der Übersicht ganz aus
            s.grid.alpha = Math.max(0, Math.min(0.16, (sc - 0.3) * 0.5));
            s.grid.visible = s.grid.alpha > 0.005;
            terrain.setOverview(sc);
            lastMove = 0;
          }
          if (fading) fading = fade([s.pinnedStatic, s.pinnedMarkers], 0.14);
          const pos = `${world.x | 0},${world.y | 0},${sc},${size}`;
          if (pos !== lastPos) {
            lastPos = pos;
            s.graticule.place(world, w, h);
            // Windrose fest oben rechts unter den Zoomknöpfen, in der Übersicht kleiner; nur wenn Platz ist
            const cs = sc < LOD_OVERVIEW ? 0.72 : 0.9;
            s.compass.scale.set(cs);
            s.compass.position.set(w - 36, BUTTONS_BOTTOM + 14 + 38 * cs);
            s.compass.visible = h > 440 && w > 300;
          }
          const now = performance.now();
          if (now - lastMove > 250) {
            lastMove = now;
            drawMovers(s, live.current);
            const wl = weatherLayer.current;
            if (wl) wl.update(serverNow(), sc);
          }
        };
        app.ticker.add(tick);
        app.ticker.maxFPS = 40;
        cleanups.push(() => app.ticker.remove(tick));
        cleanups.push(attachGestures(app.canvas, world, (x, y) => {
          // Verbände liegen über den Feldern: zuerst das nächste Schiffssymbol im Tippradius prüfen.
          const sc = world.scale.x;
          const radius = Math.max(16 * pinScale(sc), 22 / sc);
          let best: { id: number; d: number } | null = null;
          for (const [key, ship] of s.ships) {
            const d = Math.hypot(ship.x - x, ship.y - y);
            if (d <= radius && (!best || d < best.d)) best = { id: Math.floor(key / 2), d };
          }
          if (best && onMissionRef.current) {
            onMissionRef.current(best.id);
            return;
          }
          const h = hexAtXY(x, y);
          if (inGrid(h.col, h.row)) onSelectRef.current(h);
        }));
        setReady(true);
      });
    return () => {
      destroyed = true;
      for (const c of cleanups) c();
      if (scene.current) { scene.current.app.destroy(true, { children: true }); scene.current = null; }
    };
  }, []);

  // Zentrieren
  const centerKey = center ? `${center.col},${center.row},${recenter ?? 0}` : `none,${recenter ?? 0}`;
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    const w = s.app.screen.width;
    const h = s.app.screen.height;
    const b = MAP_BOUNDS;
    const target = center ? hexCenterXY(center.col, center.row) : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    const scale = clampScale(center ? (zoom ?? 0.35) : minScale(w, h), w, h);
    s.world.scale.set(scale);
    s.world.position.set(w / 2 - target.x * scale, h / 2 - target.y * scale);
    clampView(s.world, w, h);
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
      // Freie Küste deutlich: kräftige Füllung und Rand, auch bei kleinem Zoom erkennbar.
      s.free.poly(hexPoints(x, y, HEX_SIZE_KM * 0.82)).fill({ color: SEE, alpha: 0.28 });
      s.free.poly(hexPoints(x, y, HEX_SIZE_KM * 0.82));
    }
    s.free.stroke({ color: SEE, width: 3, alpha: 1 });
  }, [ready, selectMode, free]);

  // Symbole für Stützpunkte, Nester, Wracks
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    for (const c of s.markerLayer.removeChildren()) c.destroy({ children: true });
    s.pinnedMarkers = [];
    const add = (c: Container, col: number, row: number, pin: Omit<Pinned, "obj"> = {}) => {
      const p = hexCenterXY(col, row);
      c.position.set(p.x, p.y);
      s.markerLayer.addChild(c);
      s.pinnedMarkers.push({ obj: c, floor: 0.5, ...pin });
    };
    // Detailstufen: Übersicht nur Punkte (Nester nach Stufe, fremde Häfen), ab mittlerer Stufe Zeichen, nah alles.
    for (const w of data.wrecks) add(wreckSymbol(), w.col, w.row, { min: LOD_NEAR });
    for (const n of data.nests) {
      // Kartell-Nester in der Übersicht als Rauten (Häfen sind Kreise), Größe nach Stufe.
      if (!n.empty) add(diamondDot(SIEGEL, 2.2 + n.level * 0.5, 0.8), n.col, n.row, { max: LOD_OVERVIEW, fixed: true });
      add(nestSymbol(n.level, n.empty), n.col, n.row, { min: LOD_OVERVIEW });
    }
    for (const b of data.bases) {
      const rel = b.relation === "own" ? "neutral" : b.relation;
      const tag = nameTag(b.own ? b.name : `${b.name} · ${b.owner}`, b.own ? INK : RELATION_COLOR[rel]);
      if (b.own) {
        add(ownBaseSymbol(), b.col, b.row, { prio: PRIO.always });
        add(tag, b.col, b.row, { fixed: true, prio: PRIO.always });
        continue;
      }
      // Übersicht: Punkt in der Farbe des Verhältnisses; Kriegsgegner etwas größer.
      add(dotSymbol(RELATION_COLOR[rel], rel === "krieg" ? 3.6 : 3, 0.95), b.col, b.row, { max: LOD_OVERVIEW, fixed: true });
      add(otherBaseSymbol(b.protection !== null, rel), b.col, b.row, { min: LOD_OVERVIEW });
      add(tag, b.col, b.row, { min: LOD_NAMES, fixed: true, prio: PRIO.base });
    }
    // Eigener Hafen zuoberst
    for (const p of s.pinnedMarkers) if (p.prio === PRIO.always) s.markerLayer.addChild(p.obj);
    relayout(s);
    snap([s.pinnedMarkers]);
  }, [ready, data]);

  // Weltereignisse: nach den Symbolen (die pinnedMarkers neu anlegen) eigene Ebene neu aufbauen.
  const eventLayer = useRef<{ root: Container; pinned: Pinned[] } | null>(null);
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s) return;
    const old = eventLayer.current;
    if (old) {
      s.pinnedMarkers = s.pinnedMarkers.filter((p) => !old.pinned.includes(p));
      old.root.destroy({ children: true });
      eventLayer.current = null;
    }
    if ((!events || events.length === 0) && !naval && !fields) return;
    const layer = buildWorldEventLayer(events ?? [], serverNow());
    if (naval) { const nl = buildNavalLayer(naval, serverNow()); layer.root.addChild(nl.root); layer.pinned.push(...nl.pinned); } // See
    if (fields) { const fl = buildFieldLayer(fields.list, fields.linkKm); layer.root.addChild(fl.root); layer.pinned.push(...fl.pinned); } // Felder
    s.world.addChildAt(layer.root, s.world.getChildIndex(s.markerLayer));
    // Weltereignisse immer sichtbar und vorrangig: Zeichen und Schilder belegen Platz vor allen Namen.
    for (const p of layer.pinned as Pinned[]) {
      p.floor = 0.5;
      p.prio = PRIO.always;
      p.min = undefined;
    }
    s.pinnedMarkers.push(...layer.pinned);
    eventLayer.current = layer;
    relayout(s);
    snap([s.pinnedMarkers]);
  }, [ready, data, events, naval, fields]);

  // Wetterschicht unter den Zeichen (an- und abschaltbar).
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s || !weather) return;
    const layer = buildWeatherLayer(weather);
    s.world.addChildAt(layer.root, s.world.getChildIndex(s.routes));
    layer.update(serverNow(), s.world.scale.x);
    weatherLayer.current = layer;
    return () => {
      weatherLayer.current = null;
      layer.root.destroy({ children: true });
    };
  }, [ready, weather]);

  // Auswahl
  useEffect(() => {
    const s = scene.current;
    if (ready && s) drawSelection(s.selection, s.world.scale.x, selected, live.current.harbors);
  }, [ready, selected, harbors?.active?.col, harbors?.active?.row, harbors?.rangeKm, harbors?.multi]);

  const zoomBy = (f: number) => {
    const s = scene.current;
    if (!s) return;
    const { width: w, height: h } = s.app.screen;
    zoomAround(s.world, { x: w / 2, y: h / 2 }, s.world.scale.x * f, w, h);
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

/** Routen, Schiffe und Warnring; läuft gedrosselt im Ticker. */
function drawMovers(s: Scene, live: { home?: { col: number; row: number } | null; missions?: MapMission[]; alert?: boolean; focus?: number | null }): void {
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
      ship.scale.set(pinScale(sc) * (live.focus === m.id ? 1.35 : 1));
      if (live.focus === m.id) {
        // Gewählter Verband: pulsierender Doppelring
        const pulse = 1 + 0.25 * Math.sin(performance.now() / 220);
        const r = 16 * pinScale(sc) * pulse;
        s.routes.circle(pos.x, pos.y, r).stroke({ color, width: 2.2 / sc, alpha: 0.9 });
        s.routes.circle(pos.x, pos.y, r * 1.45).stroke({ color, width: 1.2 / sc, alpha: 0.45 });
      }
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
