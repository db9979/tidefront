import { test } from "node:test";
import assert from "node:assert/strict";
import type { Counts, GeoPoint, MissionInput } from "../src/index.ts";
import {
  EARTH_RADIUS_KM,
  createProtection,
  fuelCost,
  isNightShieldActive,
  planMission,
  travelSeconds,
  validateFleet,
} from "../src/index.ts";
import { DAY, HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const origin: GeoPoint = { lat: 0, lon: 0 };
/** Punkt auf dem Äquator in `km` Entfernung vom Ursprung. */
const atKm = (km: number): GeoPoint => ({ lat: 0, lon: km / ((EARTH_RADIUS_KM * Math.PI) / 180) });
const input = (units: Counts, km: number, patch: Partial<MissionInput> = {}): MissionInput => ({
  type: "ueberfall",
  units,
  origin,
  target: atKm(km),
  activeMissions: 0,
  ...patch,
});
const fuelRich = { treibstoff: 1e6 };

test("Kommandopunkt-Limit", () => {
  const base = makeBase(balance, { units: { zerstoerer: 20 }, resources: fuelRich });
  // Stufe 0: 60 Punkte, Zerstörer kostet 6
  assert.ok(validateFleet(base, { zerstoerer: 10 }, 100, balance).ok);
  assert.deepEqual(validateFleet(base, { zerstoerer: 11 }, 100, balance), { ok: false, code: "command_points" });
  assert.deepEqual(planMission(base, input({ zerstoerer: 11 }, 100), T0, balance), { ok: false, code: "command_points" });
  const bigger = makeBase(balance, { units: { zerstoerer: 20 }, buildings: { kommandozentrale: 1 }, resources: fuelRich });
  const res = validateFleet(bigger, { zerstoerer: 15 }, 100, balance);
  assert.ok(res.ok);
  assert.equal(res.check.commandPointsUsed, 90);
  assert.equal(res.check.commandPointsAvailable, 90);
});

test("Truppenkapazität: Bodentruppen nur in Landungsschiffen", () => {
  const base = makeBase(balance, {
    units: { landungsschiff: 2, schuetzen: 300, kampfpanzer: 20, korvette: 2 },
    buildings: { kommandozentrale: 5 },
  });
  assert.ok(validateFleet(base, { landungsschiff: 1, schuetzen: 100 }, 100, balance).ok);
  assert.deepEqual(validateFleet(base, { landungsschiff: 1, schuetzen: 101 }, 100, balance), {
    ok: false,
    code: "troop_capacity",
  });
  // Panzer belegen 10 Plätze
  assert.ok(validateFleet(base, { landungsschiff: 1, kampfpanzer: 10 }, 100, balance).ok);
  assert.deepEqual(validateFleet(base, { landungsschiff: 1, kampfpanzer: 10, schuetzen: 1 }, 100, balance), {
    ok: false,
    code: "troop_capacity",
  });
  assert.deepEqual(validateFleet(base, { korvette: 2, schuetzen: 1 }, 100, balance), {
    ok: false,
    code: "troop_capacity",
  });
  assert.ok(validateFleet(base, { landungsschiff: 2, kampfpanzer: 10, schuetzen: 100 }, 100, balance).ok);
});

test("Flugreichweite", () => {
  const base = makeBase(balance, { units: { jagdbomber: 2, abfangjaeger: 2, korvette: 1 } });
  assert.ok(validateFleet(base, { jagdbomber: 2 }, 499, balance).ok);
  assert.deepEqual(validateFleet(base, { jagdbomber: 2 }, 501, balance), { ok: false, code: "out_of_range" });
  assert.ok(validateFleet(base, { abfangjaeger: 2 }, 599, balance).ok);
  assert.deepEqual(validateFleet(base, { abfangjaeger: 2, korvette: 1 }, 601, balance), {
    ok: false,
    code: "out_of_range",
  });
  // Schiffe haben keine Reichweitengrenze
  assert.ok(validateFleet(base, { korvette: 1 }, 5000, balance).ok);
});

test("Verbandsprüfung: leer, unbekannt, nicht vorhanden", () => {
  const base = makeBase(balance, { units: { korvette: 1 } });
  assert.deepEqual(validateFleet(base, {}, 10, balance), { ok: false, code: "empty_fleet" });
  assert.deepEqual(validateFleet(base, { korvette: 0 }, 10, balance), { ok: false, code: "empty_fleet" });
  assert.deepEqual(validateFleet(base, { schnellboot: 1 }, 10, balance), { ok: false, code: "unknown_unit" });
  assert.deepEqual(validateFleet(base, { korvette: 2 }, 10, balance), { ok: false, code: "units_unavailable" });
  assert.deepEqual(validateFleet(base, { korvette: 0.5 }, 10, balance), { ok: false, code: "bad_count" });
  assert.deepEqual(validateFleet(base, { korvette: -1 }, 10, balance), { ok: false, code: "bad_count" });
});

test("Reisezeit: langsamstes Schiff, reine Luftmission nach langsamstem Flugzeug", () => {
  assert.equal(travelSeconds({ korvette: 3, landungsschiff: 1 }, 400, balance), 10 * 3600);
  assert.equal(travelSeconds({ korvette: 3 }, 120, balance), 2 * 3600);
  assert.equal(travelSeconds({ abfangjaeger: 2, jagdbomber: 1 }, 440, balance), 2 * 3600);
  assert.equal(travelSeconds({ aufklaerungsdrohne: 1 }, 600, balance), 2 * 3600);
  // gemischt: Schiffe bestimmen das Tempo
  assert.equal(travelSeconds({ zerstoerer: 1, abfangjaeger: 2 }, 110, balance), 2 * 3600);
  assert.equal(travelSeconds({ schuetzen: 5 }, 100, balance), null);
});

test("Treibstoff: Hin- und Rückweg, aufgerundet", () => {
  // (2*4 + 12) * 2.5 * 2 = 100
  assert.equal(fuelCost({ korvette: 2, landungsschiff: 1, schuetzen: 50 }, 250, balance), 100);
  // 4 * 1.23 * 2 = 9.84 -> 10
  assert.equal(fuelCost({ korvette: 1 }, 123, balance), 10);
  assert.equal(fuelCost({ aufklaerungsdrohne: 1 }, 30, balance), 1);
  assert.equal(fuelCost({ korvette: 1 }, 0, balance), 0);
});

test("planMission: zieht Treibstoff ab, verschiebt Einheiten, liefert Zeiten", () => {
  const base = makeBase(balance, { units: { korvette: 4, landungsschiff: 1, schuetzen: 80 } });
  const res = planMission(base, input({ korvette: 2, landungsschiff: 1, schuetzen: 50 }, 250), T0, balance);
  assert.ok(res.ok);
  assert.ok(approx(res.mission.distanceKm, 250, 1e-6));
  assert.equal(res.mission.fuelCost, 100);
  assert.equal(res.base.resources.treibstoff, 900);
  assert.deepEqual(res.base.units, { korvette: 2, landungsschiff: 0, schuetzen: 30 });
  assert.deepEqual(res.base.unitsAway, { korvette: 2, landungsschiff: 1, schuetzen: 50 });
  assert.ok(approx(res.mission.travelSeconds, 6.25 * 3600, 1e-3));
  assert.equal(res.mission.departAtMs, T0);
  assert.ok(Math.abs(res.mission.arriveAtMs - (T0 + 6.25 * HOUR)) <= 1);
  assert.ok(Math.abs(res.mission.returnAtMs - (T0 + 12.5 * HOUR)) <= 2);
  // Eingabe unverändert
  assert.deepEqual(base.units, { korvette: 4, landungsschiff: 1, schuetzen: 80 });
  assert.deepEqual(base.unitsAway, {});
  assert.equal(base.resources.treibstoff, 1000);
});

test("planMission: zu wenig Treibstoff", () => {
  const base = makeBase(balance, { units: { zerstoerer: 5 }, resources: { treibstoff: 89 } });
  // 5 * 9 * 1 * 2 = 90
  assert.deepEqual(planMission(base, input({ zerstoerer: 5 }, 100), T0, balance), { ok: false, code: "fuel" });
  const enough = makeBase(balance, { units: { zerstoerer: 5 }, resources: { treibstoff: 90 } });
  const res = planMission(enough, input({ zerstoerer: 5 }, 100), T0, balance);
  assert.ok(res.ok);
  assert.equal(res.base.resources.treibstoff, 0);
});

test("planMission: Missionsplätze und Missionsart", () => {
  const base = makeBase(balance, { units: { korvette: 2 } });
  assert.deepEqual(planMission(base, input({ korvette: 1 }, 50, { activeMissions: 1 }), T0, balance), {
    ok: false,
    code: "no_mission_slot",
  });
  const harbor = makeBase(balance, { units: { korvette: 2 }, buildings: { hafenkommandantur: 2 } });
  assert.ok(planMission(harbor, input({ korvette: 1 }, 50, { activeMissions: 1 }), T0, balance).ok);
  assert.deepEqual(planMission(base, input({ korvette: 1 }, 50, { type: "eroberung" }), T0, balance), {
    ok: false,
    code: "bad_type",
  });
});

test("planMission: Transport nimmt Ladung bis zur Ladekapazität mit", () => {
  const base = makeBase(balance, { units: { landungsschiff: 1, korvette: 1 } });
  const ok = planMission(
    base,
    input({ landungsschiff: 1 }, 100, { type: "transport", cargo: { stahl: 1500, proviant: 500 } }),
    T0,
    balance,
  );
  assert.ok(ok.ok);
  assert.equal(ok.base.resources.stahl, 500);
  assert.equal(ok.base.resources.proviant, 500);
  assert.deepEqual(ok.mission.cargo, { stahl: 1500, proviant: 500 });
  const cases: [Partial<MissionInput>, Counts, string][] = [
    [{ type: "transport", cargo: { stahl: 4001 } }, { landungsschiff: 1 }, "cargo_capacity"],
    [{ type: "transport", cargo: { stahl: 10 } }, { korvette: 1 }, "cargo_capacity"],
    [{ type: "transport", cargo: { elektronik: 501 } }, { landungsschiff: 1 }, "insufficient_resources"],
    [{ type: "transport", cargo: { gold: 5 } }, { landungsschiff: 1 }, "bad_cargo"],
    [{ type: "transport", cargo: { stahl: -5 } }, { landungsschiff: 1 }, "bad_cargo"],
    [{ type: "ueberfall", cargo: { stahl: 5 } }, { landungsschiff: 1 }, "cargo_not_allowed"],
  ];
  for (const [patch, units, code] of cases) {
    assert.deepEqual(planMission(base, input(units, 100, patch), T0, balance), { ok: false, code });
  }
});

test("planMission: Überfall hebt den eigenen Nachtschild auf, Aufklärung nicht", () => {
  const protection = createProtection(T0 - 30 * DAY, 22);
  const base = makeBase(balance, { units: { korvette: 2 }, protection });
  const night = T0 + 11 * HOUR; // 23 Uhr UTC
  assert.equal(isNightShieldActive(base.protection, night, balance), true);
  const raid = planMission(base, input({ korvette: 1 }, 50), T0, balance);
  assert.ok(raid.ok);
  assert.equal(isNightShieldActive(raid.base.protection, night, balance), false);
  assert.equal(isNightShieldActive(raid.base.protection, night + DAY, balance), true);
  const scout = planMission(base, input({ korvette: 1 }, 50, { type: "aufklaerung" }), T0, balance);
  assert.ok(scout.ok);
  assert.equal(isNightShieldActive(scout.base.protection, night, balance), true);
});

test("planMission: geschütztes Ziel wird für Überfälle abgelehnt", () => {
  const base = makeBase(balance, { units: { korvette: 2 } });
  const targetProtection = createProtection(T0 - DAY);
  assert.deepEqual(planMission(base, input({ korvette: 1 }, 50, { targetProtection }), T0, balance), {
    ok: false,
    code: "target_protected",
  });
  assert.ok(planMission(base, input({ korvette: 1 }, 50, { targetProtection, type: "aufklaerung" }), T0, balance).ok);
});
