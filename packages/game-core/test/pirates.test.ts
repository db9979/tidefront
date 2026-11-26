import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDefeatShield,
  composeRaid,
  createProtection,
  defenseHp,
  isNestRespawned,
  isRaidDue,
  nestDefender,
  nestGarrison,
  raidBlocked,
  resolveBattle,
  suspendNightShield,
} from "../src/index.ts";
import { DAY, HOUR, T0, loadBalance } from "./helpers.ts";

const balance = loadBalance();

test("Besatzung und Beute eines Nests nach Stufe", () => {
  const n1 = nestGarrison(1, balance);
  assert.ok(n1.ok);
  assert.deepEqual(n1.nest.units, { schnellboot: 6, piratenmiliz: 40 });
  assert.deepEqual(n1.nest.defenses, { flakstellung: 0, kuestenbatterie: 0, bunkerlinie: 0 });
  assert.deepEqual(n1.nest.loot, { stahl: 3000, treibstoff: 1200, elektronik: 400, proviant: 800 });
  const n5 = nestGarrison(5, balance);
  assert.ok(n5.ok);
  assert.deepEqual(n5.nest.units, { schnellboot: 70, piratenmiliz: 400 });
  assert.deepEqual(n5.nest.defenses, { flakstellung: 5, kuestenbatterie: 4, bunkerlinie: 3 });
  assert.equal(n5.nest.loot.stahl, 32000);
});

test("Nester werden mit der Stufe stärker; unbekannte Stufe wird abgelehnt", () => {
  let last = 0;
  for (let level = 1; level <= 5; level++) {
    const g = nestGarrison(level, balance);
    assert.ok(g.ok);
    const hp = defenseHp(g.nest.units, g.nest.defenses, balance);
    assert.ok(hp > last);
    last = hp;
  }
  assert.deepEqual(nestGarrison(0, balance), { ok: false, code: "unknown_nest_level" });
  assert.deepEqual(nestGarrison(6, balance), { ok: false, code: "unknown_nest_level" });
});

test("nestDefender liefert feste Beute und verändert die Balance nicht", () => {
  const snapshot = JSON.stringify(balance);
  const d = nestDefender(2, balance);
  assert.ok(d.ok);
  assert.deepEqual(d.defender.fixedLoot, balance.pirates.nestLevels["2"].loot);
  d.defender.fixedLoot!.stahl = 1;
  d.defender.units.schnellboot = 999;
  assert.equal(JSON.stringify(balance), snapshot);
});

test("Nest wird nach nestRespawnHours neu besetzt", () => {
  assert.equal(isNestRespawned(T0, T0 + 12 * HOUR - 1, balance), false);
  assert.equal(isNestRespawned(T0, T0 + 12 * HOUR, balance), true);
});

test("Überfall: Mindeststärke ohne Verteidigung", () => {
  const raid = composeRaid({}, {}, balance);
  assert.deepEqual(raid.units, { schnellboot: 4, piratenmiliz: 24 });
  // schwache Verteidigung bleibt bei der Mindeststärke: 200 HP * 0.6 / 80 = 1.5 -> 2 < 4
  assert.equal(composeRaid({ korvette: 1 }, {}, balance).units.schnellboot, 4);
});

test("Überfallstärke skaliert mit der Verteidigung (Schiffe und Anlagen)", () => {
  // 5 Korvetten (1000) + 3 Küstenbatterien (1200) + 1 Bunkerlinie (600) = 2800 HP
  const raid = composeRaid({ korvette: 5, schuetzen: 500 }, { kuestenbatterie: 3, bunkerlinie: 1 }, balance);
  assert.equal(raid.defenseHp, 2800);
  assert.equal(raid.units.schnellboot, 21); // 2800 * 0.6 / 80
  assert.equal(raid.units.piratenmiliz, 126);
  // Bodentruppen und Flugzeuge zählen nicht zur Verteidigungsstärke
  assert.equal(defenseHp({ schuetzen: 500, abfangjaeger: 10 }, {}, balance), 0);
  // aufgerundet: 1650 * 0.6 / 80 = 12.375 -> 13
  assert.equal(composeRaid({ korvette: 6, zerstoerer: 1 }, {}, balance).units.schnellboot, 13);
  // monoton wachsend
  let last = 0;
  for (let n = 0; n <= 40; n += 4) {
    const boats = composeRaid({ zerstoerer: n }, { flakstellung: n }, balance).units.schnellboot;
    assert.ok(boats >= last);
    assert.ok(boats >= balance.pirates.raidMinSchnellboote);
    last = boats;
  }
  assert.ok(last > 100);
});

test("Kartell führt eigene Landungskapazität mit und plündert ohne Landungsschiffe", () => {
  const raid = composeRaid({}, {}, balance);
  const res = resolveBattle(
    raid.attacker,
    {
      units: {},
      defenses: {},
      resources: { stahl: 10300, treibstoff: 100, elektronik: 1300, proviant: 300 },
      protectedPerResource: 300,
    },
    balance,
    7,
  );
  assert.ok(res.ok);
  assert.equal(res.report.winner, "attacker");
  assert.equal(res.report.landed, true);
  assert.deepEqual(res.report.loot, { stahl: 3000, treibstoff: 0, elektronik: 300, proviant: 0 });
});

test("Überfall scheitert an einer starken Verteidigung", () => {
  const units = { zerstoerer: 10, schuetzen: 100 };
  const defenses = { kuestenbatterie: 6, bunkerlinie: 4 };
  const raid = composeRaid(units, defenses, balance);
  const res = resolveBattle(raid.attacker, { units, defenses, resources: { stahl: 9000 } }, balance, 3);
  assert.ok(res.ok);
  assert.equal(res.report.winner, "defender");
  assert.deepEqual(res.report.loot, { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 });
});

test("Überfall-Intervall", () => {
  assert.equal(isRaidDue(T0, T0 + 18 * HOUR - 1, balance), false);
  assert.equal(isRaidDue(T0, T0 + 18 * HOUR, balance), true);
});

test("kein Überfall unter Schutz", () => {
  const night = Date.UTC(2026, 2, 10, 23, 0);
  const noon = Date.UTC(2026, 2, 10, 12, 0);
  const veteran = createProtection(noon - 100 * DAY, 22);
  assert.deepEqual(raidBlocked(veteran, noon, balance), { blocked: false, reason: null });
  assert.deepEqual(raidBlocked(veteran, night, balance), { blocked: true, reason: "nachtschild" });
  assert.deepEqual(raidBlocked(createProtection(noon - DAY, 22), noon, balance), {
    blocked: true,
    reason: "anfaengerschutz",
  });
  const beaten = applyDefeatShield(veteran, noon - HOUR, balance);
  assert.deepEqual(raidBlocked(beaten, noon, balance), { blocked: true, reason: "niederlage" });
  assert.deepEqual(raidBlocked(beaten, noon + 7 * HOUR, balance), { blocked: false, reason: null });
  // Wer selbst angreift, verliert den Nachtschild für diese Nacht und kann überfallen werden.
  const aggressor = suspendNightShield(veteran, noon, balance);
  assert.deepEqual(raidBlocked(aggressor, night, balance), { blocked: false, reason: null });
});
