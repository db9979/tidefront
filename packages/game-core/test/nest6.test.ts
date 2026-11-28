// Nest Stufe 6 (Balance v1.15): Besatzung, Beute, eigene Wiederkehr, Plätze in @tidefront/world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LATE_NEST_LEVEL, LATE_NEST_POINTS, hexAtLonLat, hexDistanceKm, isCoast, nestSites, neighbors, terrainAt } from "@tidefront/world";
import { isNestRespawned, nestDefender, nestGarrison, nestRespawnHours, resolveBattle } from "../src/index.ts";
import { HOUR, T0, loadBalance } from "./helpers.ts";

const balance = loadBalance();

test("Nest 6: Besatzung ≈ Nest 5 × 1,40–1,45 (v1.35, Nutzerentscheid 9B), respawnHours ist kein Besatzungsschlüssel", () => {
  const g = nestGarrison(6, balance);
  assert.ok(g.ok);
  assert.deepEqual(Object.keys(g.nest.units).sort(), ["piratenmiliz", "schnellboot"]);
  assert.equal("respawnHours" in g.nest.units, false);
  const n5 = nestGarrison(5, balance);
  assert.ok(n5.ok);
  const u6: Record<string, number> = g.nest.units;
  for (const [id, n] of Object.entries(n5.nest.units)) {
    assert.ok(u6[id] >= Math.round(n * 1.4) && u6[id] <= Math.round(n * 1.45), `${id} ${u6[id]} gegen Nest 5 ${n}`);
  }
});

test("Nest 6: Beute in weniger Einheiten bei gleichem Wert (v1.35, Nutzerentscheid 9A) – passt in 8 Landungsschiffe", () => {
  const value = (m: Record<string, number>) => Object.entries(m).reduce((s, [r, n]) => s + n * (balance.market.refPrice[r] ?? 0), 0);
  const l6 = balance.pirates.nestLevels["6"].loot;
  const units = Object.values(l6).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(value(l6) - 73580) < 500, `Wert ${value(l6)} (v1.34: 73 580)`);
  assert.ok(units <= 8 * (balance.units.landungsschiff.cargo ?? 0), `Beute ${units} Einheiten`);
});

test("Nest 6: Beute lohnt (mehr Wert als Nest 5) und passt ungefähr in 10 Landungsschiffe", () => {
  const value = (m: Record<string, number>) => Object.entries(m).reduce((s, [r, n]) => s + n * (balance.market.refPrice[r] ?? 0), 0);
  const l6 = balance.pirates.nestLevels["6"].loot;
  const l5 = balance.pirates.nestLevels["5"].loot;
  assert.ok(value(l6) > 1.5 * value(l5));
  const units = Object.values(l6).reduce((a, b) => a + b, 0);
  const cargo = balance.units.landungsschiff.cargo ?? 0;
  // v1.24: Beute × 1,3 (37 700) – voll nur mit zusätzlichen Landungsschiffen abzutransportieren (vorher ≤ 8).
  assert.ok(units <= 10 * cargo, `Beute ${units} > 10 Landungsschiffe`);
});

test("Nest 6: eigene Wiederkehr 24 h, andere Stufen weiter nestRespawnHours", () => {
  assert.equal(nestRespawnHours(balance, 6), 24);
  assert.equal(nestRespawnHours(balance, 5), balance.pirates.nestRespawnHours);
  assert.equal(nestRespawnHours(balance), balance.pirates.nestRespawnHours);
  assert.equal(isNestRespawned(T0, T0 + 12 * HOUR, balance, 6), false);
  assert.equal(isNestRespawned(T0, T0 + 24 * HOUR - 1, balance, 6), false);
  assert.equal(isNestRespawned(T0, T0 + 24 * HOUR, balance, 6), true);
  assert.equal(isNestRespawned(T0, T0 + 12 * HOUR, balance, 5), true);
});

test("Nest 6 ist ein Kampfziel: großer Verband siegt, kleiner verliert", () => {
  const d = nestDefender(6, balance);
  assert.ok(d.ok);
  const small = resolveBattle({ units: { korvette: 10, landungsschiff: 3, schuetzen: 250 } }, d.defender, balance, 1);
  assert.ok(small.ok);
  assert.equal(small.report.winner, "defender");
  const big = resolveBattle({ units: { korvette: 40, zerstoerer: 10, landungsschiff: 10, schuetzen: 800, kampfpanzer: 10, jagdbomber: 15 } }, d.defender, balance, 1);
  assert.ok(big.ok);
  assert.equal(big.report.winner, "attacker");
});

test("Nestplätze: die ersten 70 Plätze unverändert, Stufe 6 angehängt auf abgelegenen Inseln", () => {
  const sites = nestSites();
  const six = sites.filter((s) => s.level === LATE_NEST_LEVEL);
  assert.equal(six.length, LATE_NEST_POINTS.length);
  assert.ok(six.length >= 3 && six.length <= 5);
  assert.deepEqual(sites.slice(0, 70).filter((s) => s.level > 5), []);
  assert.deepEqual(sites.slice(70), six); // angehängt
  assert.equal(new Set(sites.map((s) => `${s.col},${s.row}`)).size, sites.length); // keine doppelten Felder
  for (const s of six) {
    assert.ok(isCoast(s.col, s.row));
    // Insel: höchstens ein Nachbar an Land (keine Festlandküste)
    assert.ok(neighbors(s.col, s.row).filter((n) => terrainAt(n.col, n.row) !== "sea").length <= 1);
    for (const o of sites) if (o !== s) assert.ok(hexDistanceKm(o, s) >= 150, `Nest 6 bei ${s.col},${s.row} zu nah an ${o.col},${o.row}`);
  }
  const bermuda = hexAtLonLat(-64.8, 32.3);
  assert.ok(six.some((s) => s.col === bermuda.col && s.row === bermuda.row));
});
