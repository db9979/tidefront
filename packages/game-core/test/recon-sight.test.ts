// Aufklärung auf Sicht (docs/VORLAGE-NESTER.md 2, ENTSCHEIDUNGEN-5.md): Wendepunkt in Lagebild-Reichweite, Fahrzeit und
// Treibstoff nur bis dorthin, Mindestfahrzeit, Position unterwegs endet am Wendepunkt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexAtLonLat, hexCenter, hexCenterXY, hexDistanceKm, seaRoute } from "@tidefront/world";
import { fleetPosition, fuelCost, planMission, reconRangeKm, sightTurn, travelSeconds, type RoutedPlan } from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const GENUA = hexAtLonLat(8.9, 44.4);
const VENEDIG = hexAtLonLat(12.3, 45.4);
const MARSEILLE = hexAtLonLat(5.4, 43.3);
const PALERMO = hexAtLonLat(11.8, 42.1); // Civitavecchia, Luftlinie ≈ 560 km
const NAH = hexAtLonLat(8.9, 43.6); // ≈ 100 km vor Genua
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

test("Lagebild-Reichweite: Drohne 200, Kriegsschiff 105, Transporter 40, Jäger und U-Boote 0", () => {
  const fs = balance.intel!.fleetSight;
  const r = (u: Record<string, number>) => reconRangeKm(u, balance.units, fs);
  assert.equal(r({ aufklaerungsdrohne: 1 }), 200);
  assert.equal(r({ korvette: 1 }), 105);
  assert.equal(r({ zerstoerer: 2, landungsschiff: 1 }), 105, "beste Einheit zählt");
  assert.equal(r({ landungsschiff: 1 }), 40);
  assert.equal(r({ abfangjaeger: 3 }), 0, "Jäger: keine Objektsicht");
  assert.equal(r({ uboot: 2 }), 0, "U-Boote fahren bis ans Ziel");
  assert.equal(r({ korvette: 1, aufklaerungsdrohne: 1 }), 200);
});

test("Wendepunkt: erster Punkt des Weges in Reichweite (gerade und über den Seeweg)", () => {
  const air = sightTurn(MARSEILLE, PALERMO, null, 200)!;
  const tgt = hexCenterXY(PALERMO.col, PALERMO.row);
  assert.ok(Math.abs(dist(air, tgt) - 200) < 0.5, "auf dem Kreis um das Ziel");
  const total = hexDistanceKm(MARSEILLE, PALERMO);
  assert.ok(air.km > 0 && air.km < total);
  const route = seaRoute(GENUA, VENEDIG);
  const sea = sightTurn(GENUA, VENEDIG, route, 105)!;
  assert.ok(sea.km < route.km && sea.km > 0, "Teilstück der Route");
  assert.ok(Math.abs(dist(sea, hexCenterXY(VENEDIG.col, VENEDIG.row)) - 105) < 0.5);
  assert.equal(sightTurn(MARSEILLE, PALERMO, null, 0), null, "ohne Objektsicht bis ans Ziel");
  const inside = sightTurn(GENUA, VENEDIG, null, 5000)!;
  assert.equal(inside.km, 0, "schon in Reichweite: Umkehr am Start");
});

test("planMission: Aufklärung auf Sicht fährt nur bis zum Wendepunkt, Mindestfahrzeit 10 min", () => {
  const base = makeBase(balance, { units: { aufklaerungsdrohne: 2, korvette: 2, abfangjaeger: 2 }, resources: { treibstoff: 1e6 } });
  const origin = hexCenter(MARSEILLE.col, MARSEILLE.row);
  const target = hexCenter(PALERMO.col, PALERMO.row);
  const full = planMission(base, { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, origin, target, activeMissions: 0 }, T0, balance);
  const sight = planMission(base, { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, origin, target, activeMissions: 0, sightRecon: true }, T0, balance);
  assert.ok(full.ok && sight.ok);
  assert.equal(full.mission.sightTurn, undefined, "ohne Schalter wie bisher");
  const t = sight.mission.sightTurn!;
  assert.ok(t && t.rangeKm === 200);
  assert.ok(Math.abs(sight.mission.travelSeconds - travelSeconds({ aufklaerungsdrohne: 1 }, t.km, balance)!) < 1e-6);
  assert.equal(sight.mission.fuelCost, fuelCost({ aufklaerungsdrohne: 1 }, t.km, balance));
  assert.ok(sight.mission.fuelCost < full.mission.fuelCost);
  assert.equal(sight.mission.returnAtMs - T0, 2 * (sight.mission.arriveAtMs - T0));
  // Überfall und Jäger: kein Wendepunkt.
  const raid = planMission(base, { type: "ueberfall", units: { korvette: 1 }, origin, target, activeMissions: 0, sightRecon: true }, T0, balance);
  assert.ok(raid.ok && raid.mission.sightTurn === undefined);
  const jets = planMission(base, { type: "aufklaerung", units: { abfangjaeger: 1 }, origin: hexCenter(GENUA.col, GENUA.row), target: hexCenter(VENEDIG.col, VENEDIG.row), activeMissions: 0, sightRecon: true }, T0, balance);
  assert.ok(jets.ok && jets.mission.sightTurn === undefined, "Jäger fliegen bis ans Ziel");
  // Ziel schon in Reichweite: Mindestfahrzeit.
  const near = planMission(base, { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, origin: hexCenter(GENUA.col, GENUA.row), target: hexCenter(NAH.col, NAH.row), activeMissions: 0, sightRecon: true }, T0, balance);
  assert.ok(near.ok);
  assert.equal(near.mission.sightTurn!.km, 0);
  assert.equal(near.mission.travelSeconds, balance.intel!.sightRecon!.minMinutes * 60);
  assert.equal(near.mission.fuelCost, 0);
});

test("Position: Hinfahrt endet am Wendepunkt, Heimfahrt beginnt dort (Seeweg und Luftlinie)", () => {
  const base = makeBase(balance, { units: { korvette: 2, aufklaerungsdrohne: 1 }, resources: { treibstoff: 1e6 } });
  for (const [units, a, b] of [[{ korvette: 1 }, GENUA, VENEDIG], [{ aufklaerungsdrohne: 1 }, MARSEILLE, PALERMO]] as const) {
    const r = planMission(base, { type: "aufklaerung", units, origin: hexCenter(a.col, a.row), target: hexCenter(b.col, b.row), activeMissions: 0, sightRecon: true }, T0, balance);
    assert.ok(r.ok);
    const m = r.mission;
    const home = hexCenterXY(a.col, a.row);
    const tgt = hexCenterXY(b.col, b.row);
    const turn = { x: m.sightTurn!.x, y: m.sightTurn!.y };
    const out = (now: number) => fleetPosition({ status: "outbound", arriveAt: new Date(m.arriveAtMs), returnAt: null, plan: m as RoutedPlan }, home, tgt, now)!;
    const back = (now: number) => fleetPosition({ status: "returning", arriveAt: new Date(m.arriveAtMs), returnAt: new Date(m.returnAtMs), plan: m as RoutedPlan }, home, tgt, now)!;
    assert.ok(dist(out(m.arriveAtMs).at, turn) < 1, "Ankunft am Wendepunkt");
    assert.ok(dist(back(m.arriveAtMs).at, turn) < 1, "Heimfahrt ab dem Wendepunkt");
    assert.ok(dist(back(m.returnAtMs).at, home) < 1);
    assert.ok(dist(out(m.arriveAtMs).at, tgt) > m.sightTurn!.rangeKm - 1, "nie näher als die Reichweite");
  }
});
