// Eigene Verbände auf der Karte: Route (gestrichelt), Schiffszeichen auf der aktuellen Position, Warnring am Hafen.
// Läuft gedrosselt im Ticker der Hexkarte (HexMap.tsx).
import type { Graphics } from "pixi.js";
import { hexCenterXY } from "@tidefront/world";
import { pointOnLoop } from "@tidefront/game-core";
import { serverNow } from "../lib/time.ts";
import { INK, SIEGEL, alertRing, shipSymbol } from "./symbols.ts";
import { pinScale } from "./lod.ts";
import type { Scene } from "../screens/HexMap.tsx";

export interface MapMission {
  id: number;
  status: string;
  target: { col: number; row: number };
  arriveAtMs: number;
  returnAtMs: number;
  /** Lagebild Stufe 2: Bordsicht (km) und Patrouille (Runde auf Station). */
  sightKm?: number;
  patrol?: { waypoints: { col: number; row: number }[]; startMs: number | null; endMs: number | null; speedKmh: number } | null;
}

/** Gestrichelter Kreis (Bordsicht, wandert mit dem Verband). */
function dashedCircle(g: Graphics, c: { x: number; y: number }, r: number): void {
  const n = Math.max(24, Math.round(r / 12));
  for (let i = 0; i < n; i += 2) g.moveTo(c.x + Math.cos((i / n) * Math.PI * 2) * r, c.y + Math.sin((i / n) * Math.PI * 2) * r).arc(c.x, c.y, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
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

/** Routen, Schiffe und Warnring; läuft gedrosselt im Ticker. */
export function drawMovers(s: Scene, live: { home?: { col: number; row: number } | null; missions?: MapMission[]; alert?: boolean; focus?: number | null }): void {
  const sc = s.world.scale.x;
  s.routes.clear();
  const seen = new Set<number>();
  const home = live.home ? hexCenterXY(live.home.col, live.home.row) : null;
  if (home) {
    const now = serverNow();
    for (const m of live.missions ?? []) {
      if (m.status === "holding" && m.patrol && m.patrol.startMs !== null) {
        // Patrouille auf Station: Runde gestrichelt, Schiff auf der aktuellen Position, Sichtkreis.
        const pts = m.patrol.waypoints.map((w) => hexCenterXY(w.col, w.row));
        const at = pointOnLoop(pts, (m.patrol.speedKmh * Math.max(0, Math.min(now, m.patrol.endMs ?? now) - m.patrol.startMs)) / 3600000);
        pts.forEach((p, i) => dashed(s.routes, p, pts[(i + 1) % pts.length], 6 / sc));
        s.routes.stroke({ color: SIEGEL, width: 1.6 / sc, alpha: 0.9 });
        if (m.sightKm) { dashedCircle(s.routes, at, m.sightKm); s.routes.stroke({ color: INK, width: 1.2 / sc, alpha: 0.7 }); }
        const key = m.id * 2;
        let ship = s.ships.get(key);
        if (!ship) { ship = shipSymbol(SIEGEL); s.ships.set(key, ship); s.world.addChild(ship); }
        ship.position.set(at.x, at.y);
        ship.scale.set(pinScale(sc) * (live.focus === m.id ? 1.35 : 1));
        seen.add(key);
        continue;
      }
      if (m.status !== "outbound" && m.status !== "returning") continue;
      const tgt = hexCenterXY(m.target.col, m.target.row);
      const pos = missionPosition(m, home, tgt, now);
      if (m.sightKm) { dashedCircle(s.routes, pos, m.sightKm); s.routes.stroke({ color: INK, width: 1.2 / sc, alpha: 0.6 }); } // Bordsicht
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
