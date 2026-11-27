// Eigene Verbände auf der Karte: Route (gestrichelt; Seewege als Linienzug über die Wegpunkte), Schiffszeichen auf der
// aktuellen Position, Warnring am Hafen. Die Position rechnet dieselbe Funktion wie der Server (game-core fleetPosition:
// Route, Rückruf, Patrouillenrunde, Kampagne). Läuft gedrosselt im Ticker der Hexkarte (HexMap.tsx).
import { Container, Graphics } from "pixi.js";
import { hexCenterXY, routePointsXY, routePrefixXY } from "@tidefront/world";
import { fleetPosition, patrolPoints, type MissionRoute, type PatrolPlan, type RoutedPlan, type SightTurn } from "@tidefront/game-core";
import { serverNow } from "../lib/time.ts";
import { INK, SIEGEL, alertRing, planeSymbol, shipSymbol } from "./symbols.ts";
import { sensorRing } from "./sensor-ring.ts";
import { pinScale } from "./lod.ts";
import type { Scene } from "../screens/HexMap.tsx";

type XY = { x: number; y: number };

export interface MapMission {
  id: number;
  status: string;
  target: { col: number; row: number };
  arriveAtMs: number;
  returnAtMs: number;
  departAtMs?: number;
  /** Lagebild Stufe 2: Bordsicht (km) und Patrouille (Runde auf Station). */
  sightKm?: number;
  /** Reiner Luftverband (Flugzeuge/Drohnen): Flugzeug-Symbol statt Schiff. */
  air?: boolean;
  patrol?: {
    waypoints: { col: number; row: number }[]; startMs: number | null; endMs: number | null; speedKmh: number;
    loop?: [number, number][] | null; homePath?: XY[] | null; endAt?: XY | null;
  } | null;
  campaign?: { index: number; legFrom: { col: number; row: number }; legDepartMs: number } | null;
  /** Seewege: Route über Wasser (fehlt = gerade) und Heimweg der Kampagne; Rückruf und Fahrzeit für die Position. */
  route?: MissionRoute | null;
  homeRoute?: MissionRoute | null;
  recalledAtMs?: number | null;
  travelSeconds?: number | null;
  /** Aufklärung auf Sicht: Wendepunkt (Projektions-km); der Verband fährt nur bis dorthin. */
  sightTurn?: SightTurn | null;
}

/** Bordsicht: Reichweitenkreis, wandert mit dem Verband. */
const SIGHT = { color: INK, alpha: 0.85, fill: 0.06, dash: 9 } as const;

/** Eigene bewegte Sicht (Kreismitte, Reichweite) für die Nebel-Aussparung (intel.ts updateMovingFog). */
export type MovingSight = { x: number; y: number; km: number };

/**
 * Missionen, deren Bordsicht drawMovers mit der aktuellen Position zeichnet (unterwegs, Patrouille auf Station); für
 * sie führt die Nebel-Ebene die Aufhellung selbst nach (intel.ts buildIntelLayer `followed`).
 */
export function followedMissionIds(missions: readonly MapMission[] | undefined): number[] {
  return (missions ?? []).filter((m) => m.sightKm && (m.status === "outbound" || m.status === "returning" || (m.status === "holding" && m.patrol && m.patrol.startMs !== null))).map((m) => m.id).sort((a, b) => a - b);
}

/** Plan im Format des Servers aus den Feldern der Missionsliste. */
function planOf(m: MapMission): RoutedPlan {
  const p = m.patrol;
  return {
    departAtMs: m.departAtMs,
    ...(m.recalledAtMs != null ? { recalledAtMs: m.recalledAtMs } : {}),
    ...(m.travelSeconds != null ? { travelSeconds: m.travelSeconds } : {}),
    ...(m.sightTurn ? { sightTurn: m.sightTurn } : {}),
    ...(m.route ? { route: m.route } : {}),
    ...(m.homeRoute ? { homeRoute: m.homeRoute } : {}),
    ...(p ? {
      patrol: {
        waypoints: p.waypoints, hours: 0, speedKmh: p.speedKmh, sightKm: 0, sonarKm: 0,
        startMs: p.startMs ?? undefined, endMs: p.endMs ?? undefined, endAt: p.endAt ?? undefined,
        loop: p.loop ?? undefined, homePath: p.homePath ?? undefined,
      } satisfies PatrolPlan,
    } : {}),
    ...(m.campaign ? { campaign: { targets: [], index: m.campaign.index, legFrom: m.campaign.legFrom, legDepartMs: m.campaign.legDepartMs } } : {}),
  };
}

/**
 * Gezeichneter Weg: Route (Seewege) oder gerade Linie; Kampagne nach dem ersten Ziel ab dem letzten Ziel bzw.
 * Wendepunkt. Aufklärung auf Sicht: nur bis zum Wendepunkt (Route: Teilstück).
 */
function pathOf(m: MapMission, plan: RoutedPlan, home: XY, tgt: XY): XY[] {
  const c = m.campaign;
  const t = m.sightTurn;
  const end = t ? { x: t.x, y: t.y } : tgt;
  const routed = (r: MissionRoute) => (t ? [...routePrefixXY(r, t.km), end] : routePointsXY(r));
  if (m.status === "returning" && plan.patrol?.homePath && plan.patrol.homePath.length >= 2) return plan.patrol.homePath;
  if (m.status === "returning" && plan.patrol?.endAt) return [plan.patrol.endAt, home];
  if (c && c.index > 0) {
    if (m.status === "returning") return m.homeRoute ? routePointsXY(m.homeRoute) : [end, home];
    return m.route ? routed(m.route) : [hexCenterXY(c.legFrom.col, c.legFrom.row), end];
  }
  return m.route && m.route.hexes.length >= 2 ? routed(m.route) : [home, end];
}

function dashed(g: Graphics, a: XY, b: XY, dash: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= 0) return;
  const n = Math.max(1, Math.floor(len / (dash * 2)));
  for (let i = 0; i < n; i++) {
    const t0 = (i * 2 * dash) / len;
    const t1 = Math.min(1, ((i * 2 + 1) * dash) / len);
    g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
  }
}

function polyline(g: Graphics, pts: XY[]): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
}

/**
 * Routen, Schiffe und Warnring; läuft gedrosselt im Ticker. Liefert die eigenen bewegten Sichtkreise (Nebel) und die
 * Zahl der gezeichneten Wegpunkte laufender Fahrten (Prüfhilfe der Oberflächentests, data-mission-route).
 */
export function drawMovers(s: Scene, live: { home?: { col: number; row: number } | null; missions?: MapMission[]; alert?: boolean; focus?: number | null }): { sights: MovingSight[]; routePoints: number } {
  const sc = s.world.scale.x;
  s.routes.clear();
  const seen = new Set<number>();
  const sights: MovingSight[] = [];
  let routePoints = 0;
  const home = live.home ? hexCenterXY(live.home.col, live.home.row) : null;
  if (home) {
    const now = serverNow();
    for (const m of live.missions ?? []) {
      const plan = planOf(m);
      if (m.status === "holding" && m.patrol && m.patrol.startMs !== null) {
        // Patrouille auf Station: Runde gestrichelt (mit Schiffen über die Seewege), Schiff auf der Position, Sichtkreis.
        const pts = patrolPoints(plan.patrol!);
        const at = fleetPosition({ status: "holding", arriveAt: new Date(m.arriveAtMs), returnAt: null, plan }, home, home, now)?.at ?? pts[0];
        pts.forEach((p, i) => dashed(s.routes, p, pts[(i + 1) % pts.length], 6 / sc));
        s.routes.stroke({ color: SIEGEL, width: 1.6 / sc, alpha: 0.9 });
        if (m.sightKm) { sensorRing(s.routes, at.x, at.y, m.sightKm, sc, SIGHT); sights.push({ ...at, km: m.sightKm }); }
        const key = m.id * 2;
        let ship = s.ships.get(key);
        if (!ship) { ship = m.air ? planeSymbol(SIEGEL) : shipSymbol(SIEGEL); s.ships.set(key, ship); s.world.addChild(ship); }
        ship.position.set(at.x, at.y);
        ship.scale.set(pinScale(sc) * (live.focus === m.id ? 1.35 : 1));
        seen.add(key);
        continue;
      }
      if (m.status !== "outbound" && m.status !== "returning") continue;
      const tgt = hexCenterXY(m.target.col, m.target.row);
      const outbound = m.status === "outbound";
      const row = { status: m.status, arriveAt: new Date(m.arriveAtMs), returnAt: outbound ? null : new Date(m.returnAtMs), plan };
      // Vor der Abfahrt (Sammelangriff) liegt der Verband im Hafen.
      const fp = fleetPosition(row, home, tgt, now) ?? { at: outbound ? home : tgt, from: home, to: tgt };
      const pos = fp.at;
      if (m.sightKm) { sensorRing(s.routes, pos.x, pos.y, m.sightKm, sc, SIGHT); sights.push({ ...pos, km: m.sightKm }); } // Bordsicht
      const color = outbound ? SIEGEL : INK;
      const path = pathOf(m, plan, home, tgt);
      routePoints += path.length;
      polyline(s.routes, path);
      s.routes.stroke({ color: 0xf4f1e7, width: 5 / sc, alpha: 0.8, cap: "round", join: "round" });
      for (let i = 1; i < path.length; i++) dashed(s.routes, path[i - 1], path[i], 6 / sc);
      s.routes.stroke({ color, width: 1.8 / sc, alpha: 0.95 });
      s.routes.moveTo(tgt.x - 8 / sc, tgt.y).lineTo(tgt.x + 8 / sc, tgt.y).moveTo(tgt.x, tgt.y - 8 / sc).lineTo(tgt.x, tgt.y + 8 / sc);
      s.routes.stroke({ color, width: 1.2 / sc });
      if (m.sightTurn) {
        // Aufklärung auf Sicht: Wendepunkt (Ring) und Sichtlinie zum Ziel (fein gepunktet).
        const t = m.sightTurn;
        s.routes.circle(t.x, t.y, 5 / sc).stroke({ color, width: 1.6 / sc, alpha: 0.95 });
        dashed(s.routes, t, tgt, 2 / sc);
        s.routes.stroke({ color, width: 0.9 / sc, alpha: 0.6 });
      }
      const key = m.id * 2 + (outbound ? 0 : 1);
      let ship = s.ships.get(key);
      if (!ship) {
        ship = m.air ? planeSymbol(color) : shipSymbol(color);
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
  return { sights, routePoints };
}

/**
 * Seewege: geplante Route der Missionsplanung (Wegpunkte der Vorschau) als Linienzug mit Papier-Saum; Weltkoordinaten,
 * endet über die Maske am Kartenrahmen.
 */
export function buildRouteLayer(hexes: readonly (readonly [number, number])[], clip: () => Graphics): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const pts = routePointsXY({ hexes });
  if (pts.length >= 2) {
    polyline(g, pts);
    g.stroke({ color: 0xf4f1e7, width: 9, alpha: 0.8, cap: "round", join: "round" });
    for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1], pts[i], 14);
    g.stroke({ color: SIEGEL, width: 4, alpha: 0.9 });
  }
  const mask = clip();
  root.addChild(mask);
  root.mask = mask;
  return root;
}
