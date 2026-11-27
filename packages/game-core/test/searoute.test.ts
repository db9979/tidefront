// Seewege: Wegsuche über Wasserfelder (packages/world/src/searoute.ts), Fahrzeit und Treibstoff nach der Route
// (planMission), Position unterwegs und beim Rückruf (fleetPosition), Bordsicht 105 km. Entscheidung
// „T. Seewege und Bordsicht“ (ENTSCHEIDUNGEN-3.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLS, HEX_SIZE_KM, ROWS, clearSeaRouteCache, hexAtLonLat, hexAtXY, hexCenter, hexCenterXY, hexDistanceKm, isNavigable,
  loopRouteHexes, nestSites, pointAlongRoute, routePointsXY, seaRoute, terrainAt, terrainMap, type Hex,
} from "@tidefront/world";
import { fleetPosition, fuelCost, missionTravelKm, planMission, recallMission, travelSeconds, type RoutedPlan } from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const at = (lon: number, lat: number): Hex => hexAtLonLat(lon, lat);
const LISSABON = at(-9.1, 38.7);
const NEAPEL = at(14.2, 40.8);
const BREST = at(-4.5, 48.4);
const HAMBURG = at(8.5, 54.0);
const PIRAEUS = at(23.6, 37.9);
const ODESSA = at(30.7, 46.4);
const ALEXANDRIA = at(29.9, 31.3);
const ROTES_MEER = at(35.5, 26.0);
const GENUA = at(8.9, 44.4);
const VENEDIG = at(12.3, 45.4);

/** Jede Probe (alle 5 km) des Linienzugs liegt auf einem befahrbaren Feld (See, Küste, Passage). */
function overWater(hexes: [number, number][]): boolean {
  const pts = routePointsXY({ hexes });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
    for (let k = 0; k <= n; k++) {
      const h = hexAtXY(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
      if (!isNavigable(h.col, h.row)) return false;
    }
  }
  return true;
}

test("Seewege: Gibraltar, Ärmelkanal, Bosporus und Suez sind befahrbar", () => {
  for (const [name, a, b, maxFactor] of [
    ["Gibraltar (Lissabon → Neapel)", LISSABON, NEAPEL, 1.3],
    ["Ärmelkanal (Brest → Hamburg)", BREST, HAMBURG, 1.3],
    ["Bosporus (Piräus → Odessa)", PIRAEUS, ODESSA, 1.3],
    ["Suez (Alexandria → Rotes Meer)", ALEXANDRIA, ROTES_MEER, 1.3],
  ] as const) {
    const r = seaRoute(a, b);
    assert.equal(r.partial, undefined, `${name}: Ziel über Wasser erreicht`);
    assert.ok(r.km <= maxFactor * hexDistanceKm(a, b), `${name}: durch die Meerenge, kein großer Umweg (${Math.round(r.km)} km)`);
    assert.ok(overWater(r.hexes), `${name}: kein Abschnitt über Land`);
    assert.deepEqual(r.hexes[0], [a.col, a.row]);
    assert.deepEqual(r.hexes[r.hexes.length - 1], [b.col, b.row]);
  }
});

test("Seewege: kein Weg über Land – Genua → Venedig fährt um Italien", () => {
  const r = seaRoute(GENUA, VENEDIG);
  const air = hexDistanceKm(GENUA, VENEDIG);
  assert.ok(r.km > 3 * air, `um den Stiefel herum (${Math.round(r.km)} km statt ${Math.round(air)} km)`);
  assert.ok(overWater(r.hexes));
  // Kein Wegpunkt auf reinem Land.
  for (const [c, w] of r.hexes) assert.notEqual(terrainAt(c, w), "land");
});

test("Seewege: Länge ≥ Luftlinie, offene See = Luftlinie, alle Küstenfelder erreichbar", () => {
  const coast: Hex[] = [];
  const t = terrainMap();
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (t[row * COLS + col] === "coast") coast.push({ col, row });
  const atlantic = at(-35, 45);
  for (const c of coast) assert.equal(seaRoute(atlantic, c).partial, undefined, `Küstenfeld ${c.col},${c.row} erreichbar`);
  for (const n of nestSites()) assert.equal(seaRoute(atlantic, n).partial, undefined);
  for (let i = 0; i < 150; i++) {
    const a = coast[(i * 97) % coast.length];
    const b = coast[(i * 389 + 17) % coast.length];
    const r = seaRoute(a, b);
    assert.ok(r.km >= hexDistanceKm(a, b) - 1e-6, `${a.col},${a.row} → ${b.col},${b.row}`);
  }
  // Offene See (Atlantik): gerade.
  const r = seaRoute(at(-40, 45), at(-25, 50));
  assert.equal(r.hexes.length, 2);
  assert.ok(Math.abs(r.km - hexDistanceKm(at(-40, 45), at(-25, 50))) < 1e-6);
});

test("Seewege: Ziel nicht über Wasser erreichbar → nächstes erreichbares Feld, letztes Stück über Land", () => {
  // Binnenland (Mitte Frankreichs): Teilroute, letzter Wegpunkt ist das Ziel.
  const inland = at(2.5, 46.5);
  assert.equal(terrainAt(inland.col, inland.row), "land");
  const r = seaRoute(BREST, inland);
  assert.equal(r.partial, true);
  assert.deepEqual(r.hexes[r.hexes.length - 1], [inland.col, inland.row]);
  assert.ok(r.km >= hexDistanceKm(BREST, inland));
});

test("Seewege: Wegsuche schnell genug für den Raspberry Pi (Messung, ohne Zwischenspeicher)", () => {
  const pairs: [Hex, Hex][] = [[LISSABON, NEAPEL], [BREST, HAMBURG], [PIRAEUS, ODESSA], [ALEXANDRIA, ROTES_MEER], [GENUA, VENEDIG], [at(-74, 40.6), at(30.7, 46.4)]];
  const times: number[] = [];
  for (const [a, b] of pairs) {
    clearSeaRouteCache();
    const t0 = performance.now();
    seaRoute(a, b);
    times.push(performance.now() - t0);
  }
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) seaRoute(GENUA, VENEDIG); // Zwischenspeicher
  const cached = (performance.now() - t0) / 1000;
  console.log(`Seewege: Wegsuche ${times.map((x) => x.toFixed(1)).join(" / ")} ms (New York → Odessa zuletzt), aus dem Zwischenspeicher ${(cached * 1000).toFixed(1)} µs`);
  assert.ok(Math.max(...times) < 200, "Wegsuche unter 200 ms (Entwicklerrechner)");
});

test("Fahrzeit und Treibstoff nach Route; reine Luftverbände Luftlinie; gemischte Verbände Seeweg", () => {
  const base = makeBase(balance, { units: { korvette: 2, aufklaerungsdrohne: 2 }, resources: { treibstoff: 1e6 } });
  const origin = hexCenter(GENUA.col, GENUA.row);
  const target = hexCenter(VENEDIG.col, VENEDIG.row);
  const ship = planMission(base, { type: "aufklaerung", units: { korvette: 2 }, origin, target, activeMissions: 0 }, T0, balance);
  assert.ok(ship.ok);
  const route = seaRoute(GENUA, VENEDIG);
  assert.ok(ship.mission.route, "Route im Plan");
  assert.equal(ship.mission.route!.km, route.km);
  assert.equal(missionTravelKm(ship.mission), route.km);
  assert.ok(Math.abs(ship.mission.travelSeconds - travelSeconds({ korvette: 2 }, route.km, balance)!) < 1e-6);
  assert.equal(ship.mission.fuelCost, fuelCost({ korvette: 2 }, route.km, balance));
  const air = planMission(base, { type: "aufklaerung", units: { aufklaerungsdrohne: 2 }, origin, target, activeMissions: 0 }, T0, balance);
  assert.ok(air.ok);
  assert.equal(air.mission.route, undefined, "Drohnen fliegen Luftlinie");
  assert.ok(Math.abs(air.mission.travelSeconds - travelSeconds({ aufklaerungsdrohne: 2 }, air.mission.distanceKm, balance)!) < 1e-6);
  const mixed = planMission(base, { type: "aufklaerung", units: { korvette: 1, aufklaerungsdrohne: 1 }, origin, target, activeMissions: 0 }, T0, balance);
  assert.ok(mixed.ok && mixed.mission.route, "gemischter Verband fährt den Seeweg");
  // Vorgabe null erzwingt die Luftlinie.
  const forced = planMission(base, { type: "aufklaerung", units: { korvette: 1 }, origin, target, activeMissions: 0, route: null }, T0, balance);
  assert.ok(forced.ok && forced.mission.route === undefined);
});

const row = (m: { arriveAtMs: number; returnAtMs: number }, status: string, plan: RoutedPlan) => ({
  status, arriveAt: new Date(m.arriveAtMs), returnAt: status === "returning" ? new Date(m.returnAtMs) : null, plan,
});
const near = (p: { x: number; y: number }, q: { x: number; y: number }, eps = 0.5) => Math.hypot(p.x - q.x, p.y - q.y) < eps;

test("Position entlang der Route; Rückruf mitten auf der Route fährt dasselbe Stück zurück", () => {
  const base = makeBase(balance, { units: { korvette: 2 }, resources: { treibstoff: 1e6 } });
  const r = planMission(base, { type: "ueberfall", units: { korvette: 2 }, origin: hexCenter(GENUA.col, GENUA.row), target: hexCenter(VENEDIG.col, VENEDIG.row), activeMissions: 0 }, T0, balance);
  assert.ok(r.ok);
  const m = r.mission;
  const home = hexCenterXY(GENUA.col, GENUA.row);
  const tgt = hexCenterXY(VENEDIG.col, VENEDIG.row);
  const half = T0 + (m.arriveAtMs - T0) / 2;
  const mid = fleetPosition(row(m, "outbound", m), home, tgt, half)!;
  const expect = pointAlongRoute(m.route!, m.route!.km / 2);
  assert.ok(near(mid.at, expect), "Hälfte der Fahrzeit = Hälfte der Route");
  assert.ok(!near(mid.at, { x: (home.x + tgt.x) / 2, y: (home.y + tgt.y) / 2 }, 50), "nicht auf der Luftlinie (über Land)");
  const onLand = hexAtXY(mid.at.x, mid.at.y);
  assert.ok(isNavigable(onLand.col, onLand.row));
  // Rückruf bei der Hälfte: Heimfahrt dauert so lange wie die Hinfahrt bisher und folgt der Route rückwärts.
  const rc = recallMission(m, half);
  assert.ok(rc.ok);
  const back = { ...m, ...rc.mission };
  const start = fleetPosition(row(back, "returning", back), home, tgt, half)!;
  assert.ok(near(start.at, expect), "Wendepunkt = Position beim Rückruf");
  const q = fleetPosition(row(back, "returning", back), home, tgt, half + (rc.returnAtMs - half) / 2)!;
  assert.ok(near(q.at, pointAlongRoute(m.route!, m.route!.km / 4)), "auf halbem Heimweg: ein Viertel der Route");
  const end = fleetPosition(row(back, "returning", back), home, tgt, rc.returnAtMs)!;
  assert.ok(near(end.at, home), "daheim");
  // Normale Heimfahrt nach der Ankunft: Route rückwärts.
  const ret = fleetPosition(row(m, "returning", m), home, tgt, m.returnAtMs - (m.returnAtMs - m.arriveAtMs) / 2)!;
  assert.ok(near(ret.at, expect));
});

test("Abwärtskompatibel: Missionen ohne Route fahren gerade", () => {
  const home = hexCenterXY(GENUA.col, GENUA.row);
  const tgt = hexCenterXY(VENEDIG.col, VENEDIG.row);
  const plan: RoutedPlan = { departAtMs: T0, travelSeconds: 3600 };
  const p = fleetPosition({ status: "outbound", arriveAt: new Date(T0 + 3600000), returnAt: null, plan }, home, tgt, T0 + 1800000)!;
  assert.ok(near(p.at, { x: (home.x + tgt.x) / 2, y: (home.y + tgt.y) / 2 }));
  const back = fleetPosition({ status: "returning", arriveAt: new Date(T0 + 3600000), returnAt: new Date(T0 + 3600000), plan: { ...plan, recalledAtMs: T0 + 1800000 } }, home, tgt, T0 + 2700000)!;
  assert.ok(near(back.at, { x: home.x + (tgt.x - home.x) * 0.25, y: home.y + (tgt.y - home.y) * 0.25 }));
});

test("Bordsicht: 105 km erfassen das eigene Feld und die sechs Nachbarn (80 km nur das eigene)", () => {
  const fs = balance.intel!.fleetSight!;
  const pb = balance.intel!.patrol!;
  const count = (km: number) => {
    const c = hexCenterXY(40, 30);
    let n = 0;
    for (let row = 25; row <= 35; row++) for (let col = 35; col <= 45; col++) {
      const p = hexCenterXY(col, row);
      if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= km * km) n++;
    }
    return n;
  };
  assert.equal(count(fs.warshipKm), 7);
  assert.equal(count(pb.shipSightKm), 7);
  assert.equal(count(80), 1);
  assert.ok(Math.sqrt(3) * HEX_SIZE_KM < fs.warshipKm && fs.warshipKm < 3 * HEX_SIZE_KM, "zwischen Nachbar- und übernächstem Feld");
});

test("Patrouille: Runde über die Seewege der Wegpunkte", () => {
  const a = at(-30, 45);
  const b = at(-25, 47);
  const loop = loopRouteHexes([a, b]);
  assert.deepEqual(loop, [[a.col, a.row], [b.col, b.row]], "offene See: gerade Runde");
  const g = loopRouteHexes([GENUA, VENEDIG]);
  assert.ok(g.length > 4, "um Italien herum und zurück");
});
