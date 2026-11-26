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
  assert.deepEqual(n1.nest.units, { schnellboot: 4, piratenmiliz: 18 });
  assert.deepEqual(n1.nest.defenses, { flakstellung: 0, kuestenbatterie: 0, bunkerlinie: 0 });
  assert.deepEqual(n1.nest.loot, { stahl: 2000, treibstoff: 800, elektronik: 300, proviant: 700 });
  const n5 = nestGarrison(5, balance);
  assert.ok(n5.ok);
  assert.deepEqual(n5.nest.units, { schnellboot: 26, piratenmiliz: 250 });
  assert.deepEqual(n5.nest.defenses, { flakstellung: 3, kuestenbatterie: 2, bunkerlinie: 2 });
  assert.equal(n5.nest.loot.stahl, 14000);
});

test("Nestbeute wächst mit der Stufe", () => {
  let last = 0;
  for (let level = 1; level <= 5; level++) {
    const g = nestGarrison(level, balance);
    assert.ok(g.ok);
    const total = Object.values(g.nest.loot).reduce((x, y) => x + y, 0);
    assert.ok(total > last);
    last = total;
  }
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
  // raidMinSchnellboote 4, je Boot 8 Milizionäre
  assert.deepEqual(raid.units, { schnellboot: 4, piratenmiliz: 32 });
  assert.equal(raid.strengthFactor, 1);
  // schwache Verteidigung bleibt bei der Mindeststärke: 200 bzw. 400 HP * 0,55 / 80 < 4 Boote
  assert.deepEqual(composeRaid({ korvette: 1 }, {}, balance).units, { schnellboot: 4, piratenmiliz: 32 });
  assert.deepEqual(composeRaid({ schuetzen: 20 }, {}, balance).units, { schnellboot: 4, piratenmiliz: 32 });
});

test("Überfallstärke skaliert mit der Verteidigung einschließlich Bodentruppen", () => {
  // 5 Korvetten (1000) + 100 Schützen (2000) + 3 Küstenbatterien (1200) + 1 Bunkerlinie (600) = 4800 HP
  const raid = composeRaid({ korvette: 5, schuetzen: 100 }, { kuestenbatterie: 3, bunkerlinie: 1 }, balance);
  assert.equal(raid.defenseHp, 4800);
  // 4800 * 0,55 / 80 = 33 Boote, 264 Miliz
  assert.deepEqual(raid.units, { schnellboot: 33, piratenmiliz: 264 });
  // Bodentruppen zählen, Flugzeuge nicht
  assert.equal(defenseHp({ schuetzen: 500, kampfpanzer: 2, abfangjaeger: 10, jagdbomber: 3 }, {}, balance), 10600);
  // Miliz gerundet, Boote aufgerundet: 1650 * 0,55 / 80 = 11,34 -> 91 Miliz auf 12 Booten
  assert.deepEqual(composeRaid({ korvette: 6, zerstoerer: 1 }, {}, balance).units, { schnellboot: 12, piratenmiliz: 91 });
  // monoton wachsend, auch mit Bodentruppen allein
  let last = 0;
  for (let n = 0; n <= 400; n += 40) {
    const miliz = composeRaid({ schuetzen: n }, {}, balance).units.piratenmiliz;
    assert.ok(miliz >= last);
    last = miliz;
  }
  assert.equal(last, 440); // 8000 HP * 0,55 / 80 * 8
});

test("Überfallstärke schwankt mit dem Seed in den Grenzen von raidStrengthSpread", () => {
  const spread = balance.pirates.raidStrengthSpread;
  const units = { schuetzen: 200 }; // Grundstärke 27,5 Boote = 220 Miliz
  const seen = new Set<number>();
  for (let seed = 1; seed <= 300; seed++) {
    const raid = composeRaid(units, {}, balance, seed);
    assert.ok(raid.strengthFactor >= 1 - spread && raid.strengthFactor <= 1 + spread);
    assert.equal(raid.units.piratenmiliz, Math.round(220 * raid.strengthFactor));
    // jeder Milizionär hat einen Platz
    assert.ok(raid.units.schnellboot * balance.pirates.raidMiliPerBoot >= raid.units.piratenmiliz);
    assert.ok((raid.units.schnellboot - 1) * balance.pirates.raidMiliPerBoot < raid.units.piratenmiliz);
    seen.add(raid.units.piratenmiliz);
  }
  assert.ok(seen.size > 50);
  // gleicher Seed, gleicher Verband
  assert.deepEqual(composeRaid(units, {}, balance, 42), composeRaid(units, {}, balance, 42));
});

test("Kartell gegen die Wache (20 Schützen): mal Sieg, mal Niederlage", () => {
  let wins = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const raid = composeRaid({ schuetzen: 20 }, {}, balance, seed + 1000);
    const res = resolveBattle(raid.attacker, { units: { schuetzen: 20 }, defenses: {}, resources: { stahl: 5000 } }, balance, seed);
    assert.ok(res.ok);
    if (res.report.winner === "attacker") wins++;
  }
  assert.ok(wins >= 30 && wins <= 70, `Siege ${wins}`);
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
