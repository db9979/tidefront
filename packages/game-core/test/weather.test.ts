import { test } from "node:test";
import assert from "node:assert/strict";
import type { Counts, GeoPoint, MissionInput } from "../src/index.ts";
import {
  combatWeather,
  daylightAt,
  fogRadarFactor,
  planMission,
  resolveBattle,
  routeWeather,
  scoutBase,
  sunshine,
  travelSeconds,
  weatherAt,
} from "../src/index.ts";
import { DAY, HOUR, T0, approx, loadBalance, loadBalanceNoLuck, makeBase } from "./helpers.ts";

const balance = loadBalance();
const wb = balance.weather!;
const YEAR0 = Date.UTC(2026, 0, 1);

const NORDSEE: GeoPoint = { lat: 55, lon: 4 };
const NORWEGEN: GeoPoint = { lat: 62, lon: 5 };
const MITTELMEER: GeoPoint = { lat: 39, lon: 4 };
const NORDAFRIKA: GeoPoint = { lat: 33, lon: 0 };
const NEUFUNDLAND: GeoPoint = { lat: 47, lon: -53 };

function mean(p: GeoPoint, f: (w: ReturnType<typeof weatherAt>) => number, days = 365): number {
  let sum = 0;
  let n = 0;
  for (let h = 0; h < days * 24; h += 3) {
    sum += f(weatherAt(p, YEAR0 + h * HOUR, wb));
    n++;
  }
  return sum / n;
}

test("Wetter ist deterministisch: gleicher Ort, gleiche Zeit, gleiches Wetter", () => {
  const a = weatherAt(NORDSEE, T0 + 5 * HOUR, wb);
  const b = weatherAt({ ...NORDSEE }, T0 + 5 * HOUR, { ...wb });
  assert.deepEqual(a, b);
  // Anderer Seed: anderes Wetter (irgendwo in einer Woche).
  let differs = false;
  for (let h = 0; h < 7 * 24 && !differs; h += 6) {
    differs = weatherAt(NORDSEE, T0 + h * HOUR, wb).wind !== weatherAt(NORDSEE, T0 + h * HOUR, { ...wb, seed: wb.seed + 1 }).wind;
  }
  assert.ok(differs);
});

test("Wertebereiche: alle Größen 0–1, Sturm genau ab stormFrom", () => {
  for (let i = 0; i < 2000; i++) {
    const p = { lat: 25 + ((i * 7) % 47), lon: -78 + ((i * 13) % 118) };
    const w = weatherAt(p, T0 + i * 37 * 60000, wb);
    for (const v of [w.wind, w.clouds, w.fog, w.daylight]) assert.ok(v >= 0 && v <= 1, `${v}`);
    assert.equal(w.storm, w.wind >= wb.stormFrom);
  }
});

test("Wettersysteme ziehen: Wind ändert sich über Stunden, aber stetig", () => {
  let jumps = 0;
  let changes = 0;
  for (let h = 0; h < 10 * 24; h++) {
    const a = weatherAt(NORDSEE, T0 + h * HOUR, wb).wind;
    const b = weatherAt(NORDSEE, T0 + (h + 1) * HOUR, wb).wind;
    if (Math.abs(a - b) > 0.2) jumps++;
    if (Math.abs(a - b) > 0.005) changes++;
  }
  assert.equal(jumps, 0);
  assert.ok(changes > 100);
});

test("Regionale Mittel: Norden windiger, Süden sonniger, Nebel an der Nebelküste", () => {
  const windNord = mean(NORDSEE, (w) => w.wind);
  const windNorwegen = mean(NORWEGEN, (w) => w.wind);
  const windMed = mean(MITTELMEER, (w) => w.wind);
  assert.ok(windNord > windMed + 0.2, `${windNord} ${windMed}`);
  assert.ok(windNorwegen > windMed + 0.2);
  const sunNord = mean(NORDSEE, (w) => sunshine(w, 0.7));
  const sunMed = mean(MITTELMEER, (w) => sunshine(w, 0.7));
  const sunAfrika = mean(NORDAFRIKA, (w) => sunshine(w, 0.7));
  assert.ok(sunMed > 1.8 * sunNord, `${sunMed} ${sunNord}`);
  assert.ok(sunAfrika > 1.8 * sunNord);
  const fogNf = mean(NEUFUNDLAND, (w) => w.fog);
  const fogMed = mean(MITTELMEER, (w) => w.fog);
  assert.ok(fogNf > 0.15 && fogMed < 0.02, `${fogNf} ${fogMed}`);
  const stormsNord = mean(NORDSEE, (w) => (w.storm ? 1 : 0));
  const stormsMed = mean(MITTELMEER, (w) => (w.storm ? 1 : 0));
  assert.ok(stormsNord > 0.01 && stormsMed === 0, `${stormsNord} ${stormsMed}`);
});

test("Tageslicht aus dem Sonnenstand: nachts 0, Sommermittag heller als Wintermittag", () => {
  assert.equal(daylightAt(50, 0, Date.UTC(2026, 5, 21, 0, 0)), 0);
  const summer = daylightAt(50, 0, Date.UTC(2026, 5, 21, 12, 0));
  const winter = daylightAt(50, 0, Date.UTC(2026, 11, 21, 12, 0));
  assert.ok(summer > 0.85 && winter < 0.35 && winter > 0.1, `${summer} ${winter}`);
  // Ortszeit: Mittag in Neufundland ist später (UTC).
  assert.ok(daylightAt(47, -53, Date.UTC(2026, 5, 21, 15, 30)) > daylightAt(47, -53, Date.UTC(2026, 5, 21, 11, 0)));
});

test("Route: Sturmanteil und Zuschlag für Schiffe höchstens +30 %", () => {
  let maxFactor = 1;
  let sawCalm = false;
  for (let d = 0; d < 60; d++) {
    const r = routeWeather(NORDSEE, NORWEGEN, T0 + d * DAY / 2, wb);
    assert.ok(r.shipFactor >= 1 && r.shipFactor <= 1 + wb.shipSlowMax + 1e-12);
    assert.ok(approx(r.shipFactor, 1 + wb.shipSlowMax * r.storminess));
    maxFactor = Math.max(maxFactor, r.shipFactor);
    if (r.storminess === 0) sawCalm = true;
  }
  assert.ok(maxFactor > 1.05 && sawCalm, `${maxFactor}`);
  const med = routeWeather(MITTELMEER, { lat: 37, lon: 15 }, T0, wb);
  assert.ok(med.shipFactor < 1.1);
});

const atKm = (km: number): GeoPoint => ({ lat: 0, lon: km / 111.19 });
const input = (units: Counts, patch: Partial<MissionInput> = {}): MissionInput => ({
  type: "ueberfall", units, origin: { lat: 0, lon: 0 }, target: atKm(400), activeMissions: 0, ...patch,
});
const stormy = { avgWind: 0.95, maxWind: 1, avgClouds: 0.9, avgFog: 0, storminess: 1, shipFactor: 1.3, stormAtOrigin: true };

test("Reise bei Sturm: Schiffe langsamer, reine Luftmission startet nicht", () => {
  const base = makeBase(balance, { units: { korvette: 2, abfangjaeger: 2 }, buildings: { flugfeld: 1 }, resources: { treibstoff: 1e5 } });
  const calm = planMission(base, input({ korvette: 2 }), T0, balance);
  const storm = planMission(base, input({ korvette: 2 }, { weather: stormy }), T0, balance);
  assert.ok(calm.ok && storm.ok);
  assert.ok(approx(storm.mission.travelSeconds, calm.mission.travelSeconds * 1.3));
  assert.ok(approx(storm.mission.travelSeconds, travelSeconds({ korvette: 2 }, storm.mission.distanceKm, balance)! * 1.3));
  assert.equal(storm.mission.weather?.shipFactor, 1.3);
  assert.deepEqual(planMission(base, input({ abfangjaeger: 2 }, { weather: stormy }), T0, balance), { ok: false, code: "storm" });
  // Gemischter Verband startet (Flugzeuge begleiten die Schiffe).
  assert.ok(planMission(base, input({ korvette: 1, abfangjaeger: 1 }, { weather: stormy }), T0, balance).ok);
  // Ohne Sturm am Start fliegt die Luftmission, Flugzeuge werden nicht gebremst.
  const air = planMission(base, input({ abfangjaeger: 2 }, { weather: { ...stormy, stormAtOrigin: false } }), T0, balance);
  assert.ok(air.ok);
  assert.equal(air.mission.weather?.shipFactor, 1);
});

test("Kampfwetter: Sturm schwächt die Luftphasen, Wolken den Luftschlag", () => {
  const b = loadBalanceNoLuck();
  const attacker = { units: { jagdbomber: 10 } };
  // Küstenbatterien schießen nicht auf Flugzeuge: Der Luftschlag läuft in beiden Fällen volle Runden.
  const defender = { units: {}, defenses: { kuestenbatterie: 20 } };
  const clear = resolveBattle(attacker, defender, b, 7);
  const bad = resolveBattle(attacker, defender, b, 7, { air: 0.4, strike: 0.7, wind: 1, clouds: 1, storm: true });
  assert.ok(clear.ok && bad.ok);
  const dealt = (r: typeof clear) => (r.ok ? Object.values(r.report.phases[1].damage.attacker).reduce((x, y) => x + y, 0) : 0);
  assert.ok(approx(dealt(bad), dealt(clear) * 0.4 * 0.7, 1e-6));
  assert.equal(bad.ok && bad.report.weather?.storm, true);
  const w = combatWeather(NORDSEE, T0, wb);
  assert.ok(w.air >= 1 - wb.airStormPenalty && w.air <= 1 && w.strike >= 1 - wb.cloudStrikePenalty && w.strike <= 1);
});

test("Nebel: Radar-Vorwarnzeit bis −30 %, Lagebild unsicher und gerundet", () => {
  assert.equal(fogRadarFactor(0, wb), 1);
  assert.ok(approx(fogRadarFactor(1, wb), 0.7));
  assert.ok(approx(fogRadarFactor(0.5, wb), 0.85));
  const target = makeBase(balance, { units: { schuetzen: 37, korvette: 3 }, defenses: { flakstellung: 2 }, resources: { stahl: 12345 } });
  const clear = scoutBase(target, T0, balance);
  assert.equal(clear.uncertain, undefined);
  assert.equal(clear.units.schuetzen, 37);
  const light = scoutBase(target, T0, balance, undefined, 0.5);
  assert.deepEqual(light.uncertain, { fog: 0.5, heavy: false });
  assert.equal(light.units.schuetzen, 35);
  assert.equal(light.units.korvette, 3);
  assert.equal(light.resources.stahl, 12000);
  const heavy = scoutBase(target, T0, balance, undefined, 0.9);
  assert.equal(heavy.uncertain?.heavy, true);
  assert.equal(heavy.units.schuetzen, 40);
  assert.equal(heavy.units.korvette, 10);
  assert.equal(heavy.resources.stahl, 10000);
  assert.deepEqual(heavy.buildings, clear.buildings);
});
