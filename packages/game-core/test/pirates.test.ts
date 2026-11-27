import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDefeatShield,
  composeRaid,
  raidDefenseHp,
  raidHpWeight,
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
  for (let level = 1; level <= 6; level++) {
    const g = nestGarrison(level, balance);
    assert.ok(g.ok);
    const total = Object.values(g.nest.loot).reduce((x, y) => x + y, 0);
    assert.ok(total > last);
    last = total;
  }
});

test("Nester werden mit der Stufe stärker; unbekannte Stufe wird abgelehnt", () => {
  let last = 0;
  for (let level = 1; level <= 6; level++) {
    const g = nestGarrison(level, balance);
    assert.ok(g.ok);
    const hp = defenseHp(g.nest.units, g.nest.defenses, balance);
    assert.ok(hp > last);
    last = hp;
  }
  assert.deepEqual(nestGarrison(0, balance), { ok: false, code: "unknown_nest_level" });
  assert.deepEqual(nestGarrison(7, balance), { ok: false, code: "unknown_nest_level" });
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
  // 10 Korvetten (2000, Gewicht 0,5 seit v1.13: 1000) + 100 Schützen (2000) + 3 Küstenbatterien (1200)
  // + 1 Bunkerlinie (600) = 4800 HP für das Kartell
  const raid = composeRaid({ korvette: 10, schuetzen: 100 }, { kuestenbatterie: 3, bunkerlinie: 1 }, balance);
  assert.equal(defenseHp({ korvette: 10, schuetzen: 100 }, { kuestenbatterie: 3, bunkerlinie: 1 }, balance), 5800);
  assert.equal(raid.defenseHp, 4800);
  // 4800 * 0,40 / 80 = 24 Boote, 192 Miliz (v1.24: raidStrengthShareOfDefense 0,40 statt 0,55)
  assert.deepEqual(raid.units, { schnellboot: 24, piratenmiliz: 192 });
  // Bodentruppen zählen, Flugzeuge nicht
  assert.equal(defenseHp({ schuetzen: 500, kampfpanzer: 2, abfangjaeger: 10, jagdbomber: 3 }, {}, balance), 10600);
  // Miliz gerundet, Boote aufgerundet: 3300 * 0,5 * 0,40 / 80 = 8,25 -> 66 Miliz auf 9 Booten
  assert.deepEqual(composeRaid({ korvette: 12, zerstoerer: 2 }, {}, balance).units, { schnellboot: 9, piratenmiliz: 66 });
  // monoton wachsend, auch mit Bodentruppen allein
  let last = 0;
  for (let n = 0; n <= 400; n += 40) {
    const miliz = composeRaid({ schuetzen: n }, {}, balance).units.piratenmiliz;
    assert.ok(miliz >= last);
    last = miliz;
  }
  assert.equal(last, 320); // 8000 HP * 0,40 / 80 * 8
});

test("Überfallstärke schwankt mit dem Seed in den Grenzen von raidStrengthSpread", () => {
  const spread = balance.pirates.raidStrengthSpread;
  const units = { schuetzen: 200 }; // Grundstärke 4000 HP * 0,40 / 80 = 20 Boote = 160 Miliz
  const seen = new Set<number>();
  for (let seed = 1; seed <= 300; seed++) {
    const raid = composeRaid(units, {}, balance, seed);
    assert.ok(raid.strengthFactor >= 1 - spread && raid.strengthFactor <= 1 + spread);
    assert.equal(raid.units.piratenmiliz, Math.round(160 * raid.strengthFactor));
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

test("Überfallstärke zählt den Forschungsanteil der Lebenspunkte mit (raidResearchWeight, v1.7)", () => {
  const units = { korvette: 10, schuetzen: 100 };
  const defenses = { kuestenbatterie: 3, bunkerlinie: 1 };
  // Korvetten zählen mit Gewicht 0,5 (raidHpWeights, v1.13): 1000 + 2000 + 1800
  const raw = defenseHp(units, defenses, balance) - 1000;
  // ohne Modifikatoren unverändert
  assert.equal(raidDefenseHp(units, defenses, balance), raw);
  assert.equal(composeRaid(units, defenses, balance).defenseHp, raw);
  // Korvetten 1000, Schützen 2000, Anlagen 1800: See +20 %, Land +10 %, Anlagen +30 % → Zuwachs 200 + 200 + 540 = 940
  const mods = { hp: { see: 1.2, land: 1.1, anlage: 1.3 } };
  const w = balance.pirates.raidResearchWeight ?? 0;
  assert.ok(w > 0 && w <= 1);
  assert.ok(Math.abs(raidDefenseHp(units, defenses, balance, mods) - (raw + w * 940)) < 1e-9);
  assert.ok(Math.abs(composeRaid(units, defenses, balance, undefined, mods).defenseHp - (raw + w * 940)) < 1e-9);
  // Gewicht 0: wie bis v1.6
  const off = { ...balance, pirates: { ...balance.pirates, raidResearchWeight: 0 } };
  assert.equal(raidDefenseHp(units, defenses, off, mods), raw);
  // Flugzeuge zählen weiter nicht
  assert.equal(raidDefenseHp({ jagdbomber: 5 }, {}, balance, mods), 0);
});

test("Schiffe zählen für die Überfallstärke geringer, Transporter gar nicht (raidHpWeights, v1.13)", () => {
  const w = balance.pirates.raidHpWeights ?? {};
  // Kriegsschiffe über die Gattung, Transporter über die ID (ID vor Gattung)
  assert.equal(raidHpWeight("korvette", "see", balance), w.see);
  assert.equal(raidHpWeight("landungsschiff", "see", balance), 0);
  assert.equal(raidHpWeight("kolonieschiff", "see", balance), 0);
  assert.equal(raidHpWeight("schuetzen", "land", balance), 1);
  assert.equal(raidHpWeight("bunkerlinie", undefined, balance), 1);
  assert.equal(raidDefenseHp({ landungsschiff: 4 }, {}, balance), 0);
  assert.equal(raidDefenseHp({ zerstoerer: 2, schuetzen: 10 }, {}, balance), 900 * (w.see ?? 1) + 200);
  // ohne Gewichte wie bis v1.12
  const { raidHpWeights: _drop, ...plain } = balance.pirates;
  const old = { ...balance, pirates: plain };
  assert.equal(raidHpWeight("landungsschiff", "see", old), 1);
  assert.equal(raidDefenseHp({ zerstoerer: 2, landungsschiff: 4 }, {}, old), defenseHp({ zerstoerer: 2, landungsschiff: 4 }, {}, old));
});

test("Schiffe daheim erhöhen die Siegchance des Kartells nicht (v1.13)", () => {
  const res = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };
  const winRate = (units: Record<string, number>) => {
    let wins = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const raid = composeRaid(units, {}, balance, seed + 100000);
      const r = resolveBattle(raid.attacker, { units, defenses: {}, resources: res, protectedPerResource: 300 }, balance, seed);
      assert.ok(r.ok);
      if (r.report.winner === "attacker") wins++;
    }
    return wins / 200;
  };
  const base = winRate({ schuetzen: 40 });
  const fleets: Record<string, number>[] = [{ korvette: 8 }, { zerstoerer: 4 }, { landungsschiff: 4 }, { uboot: 4 }];
  for (const ships of fleets) {
    assert.ok(winRate({ schuetzen: 40, ...ships }) <= base + 0.03, JSON.stringify(ships));
  }
});

test("Die Miliz kann eine einzelne Bunkerlinie zerstören (anlage 5, v1.13)", () => {
  assert.equal(balance.npcUnits.piratenmiliz.attack.anlage, balance.npcUnits.piratenmiliz.attack.land);
  const res = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };
  const def = { units: {}, defenses: { bunkerlinie: 1 }, resources: res, protectedPerResource: 300 };
  let wins = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const raid = composeRaid({}, { bunkerlinie: 1 }, balance, seed + 100000);
    const r = resolveBattle(raid.attacker, def, balance, seed);
    assert.ok(r.ok);
    if (r.report.winner === "attacker") wins++;
  }
  // Eine Bunkerlinie allein hält nicht mehr jeden Überfall auf, aber die meisten.
  assert.ok(wins > 0 && wins < 100, `Siege ${wins}`);
});
