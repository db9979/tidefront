import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDefenseResult,
  attackerReturning,
  baseStrength,
  cancelTraining,
  cancelUpgrade,
  computeLoot,
  defenderFromBase,
  deliverCargo,
  isAttackDetected,
  isWeakTarget,
  protectionStatus,
  radarWarningMinutes,
  resolveBattle,
  returnMission,
  salvageWreck,
  scoutBase,
  startTraining,
  startUpgrade,
  wreckRemaining,
} from "../src/index.ts";
import { HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("Verteidigung: Endbestände, Beuteabzug und Schutz nach Niederlage", () => {
  const base = makeBase(balance, {
    units: { schuetzen: 10 },
    defenses: { bunkerlinie: 0 },
    resources: { stahl: 10000, treibstoff: 5000, elektronik: 2000, proviant: 3000 },
    protection: { ...makeBase(balance).protection, createdAtMs: T0 - 30 * 24 * HOUR },
  });
  const at = T0 + HOUR;
  const res = resolveBattle(
    { units: { landungsschiff: 2, kampfpanzer: 10, schuetzen: 50 } },
    defenderFromBase(base, balance),
    balance,
    11,
  );
  assert.ok(res.ok);
  const report = res.report;
  assert.equal(report.winner, "attacker");
  const after = applyDefenseResult(base, report, at, balance);
  assert.equal(after.units.schuetzen, report.defender.final.schuetzen);
  assert.ok(report.loot.stahl > 0);
  // Bestand nach settle bis at minus Beute
  assert.ok(after.resources.stahl < 10000 + 20);
  assert.equal(protectionStatus(after.protection, at + 1, balance).reason, "niederlage");
  // Eingabe unverändert
  assert.equal(base.units.schuetzen, 10);
});

test("Rückkehr: unitsAway sinkt, Überlebende und Beute kommen an", () => {
  const base = makeBase(balance, { units: { korvette: 1 }, unitsAway: { korvette: 3, schuetzen: 20 } });
  const back = returnMission(base, { korvette: 3, schuetzen: 20 }, { korvette: 2, schuetzen: 5 }, { stahl: 900 }, T0, balance);
  assert.deepEqual(back.unitsAway, {});
  assert.equal(back.units.korvette, 3);
  assert.equal(back.units.schuetzen, 5);
  assert.equal(back.resources.stahl, balance.start.stahl + 900);
});

test("attackerReturning liefert nur Typen mit Bestand", () => {
  const res = resolveBattle({ units: { korvette: 1 } }, { units: { zerstoerer: 5 }, defenses: {} }, balance, 1);
  assert.ok(res.ok);
  assert.deepEqual(attackerReturning(res.report), {});
});

test("Transport und Aufklärung am Ziel", () => {
  const target = makeBase(balance, { units: { korvette: 2 }, defenses: { flakstellung: 1 } });
  const got = deliverCargo(target, { stahl: 50000 }, T0, balance);
  assert.equal(got.resources.stahl, balance.start.stahl + 50000); // über der Kapazität erlaubt
  const scout = scoutBase(target, T0 + HOUR, balance);
  assert.equal(scout.units.korvette, 2);
  assert.equal(scout.defenses.flakstellung, 1);
  assert.equal(scout.resources.stahl, balance.start.stahl + 20); // Grundrate eine Stunde
});

test("Schwachziel: Anteilsbeute mal weakTargetLootFactor, Nestbeute unberührt", () => {
  const strong = makeBase(balance, { buildings: { kommandozentrale: 10, stahlwerk: 10 } });
  const weak = makeBase(balance, { buildings: { kommandozentrale: 2 } });
  assert.equal(baseStrength(strong), 20);
  assert.ok(isWeakTarget(baseStrength(strong), baseStrength(weak), balance));
  assert.ok(!isWeakTarget(baseStrength(weak), baseStrength(strong), balance));
  const defender = { resources: { stahl: 10300 }, protectedPerResource: 300 };
  assert.equal(computeLoot(defender, Infinity, 0, balance).stahl, 3000);
  assert.equal(computeLoot(defender, Infinity, 0, balance, true).stahl, 300);
  assert.equal(computeLoot({ fixedLoot: { stahl: 500 } }, Infinity, 0, balance, true).stahl, 500);
});

test("Wracks verfallen linear und lassen sich bergen", () => {
  const w = { stahl: 1000, elektronik: 200, createdAtMs: T0 };
  assert.deepEqual(wreckRemaining(w, T0, balance), { stahl: 1000, elektronik: 200 });
  const half = T0 + (balance.combat.wreckHours / 2) * HOUR;
  assert.deepEqual(wreckRemaining(w, half, balance), { stahl: 500, elektronik: 100 });
  assert.deepEqual(wreckRemaining(w, T0 + balance.combat.wreckHours * HOUR, balance), { stahl: 0, elektronik: 0 });
  const s = salvageWreck(w, 300, half, balance);
  assert.deepEqual(s.taken, { stahl: 250, elektronik: 50 });
  assert.deepEqual(wreckRemaining(s.rest, half, balance), { stahl: 250, elektronik: 50 });
});

test("Radar: Vorwarnzeit nach Stufe, Erkennung spätestens bei Ankunft", () => {
  assert.equal(radarWarningMinutes(makeBase(balance), balance), 0);
  assert.equal(radarWarningMinutes(makeBase(balance, { buildings: { radarstation: 2, kraftwerk: 1 } }), balance), 20);
  // v1.6: ohne Strom keine Vorwarnung.
  assert.equal(radarWarningMinutes(makeBase(balance, { buildings: { radarstation: 2 } }), balance), 0);
  const arrive = T0 + 60 * 60000;
  assert.equal(isAttackDetected(arrive, T0, 20), false);
  assert.equal(isAttackDetected(arrive, arrive - 20 * 60000, 20), true);
  assert.equal(isAttackDetected(arrive, arrive, 0), true);
});

test("Abbruch des Ausbaus erstattet den Anteil der Restzeit", () => {
  const base = makeBase(balance);
  const started = startUpgrade(base, "stahlwerk", T0, balance);
  assert.ok(started.ok);
  const order = started.base.buildQueue[0];
  const mid = T0 + (order.finishesAt - T0) / 2;
  const c = cancelUpgrade(started.base, mid, balance);
  assert.ok(c.ok);
  assert.deepEqual(c.refund, { stahl: 60, treibstoff: 15, elektronik: 0, proviant: 0 });
  assert.equal(c.base.buildQueue.length, 0);
  assert.equal(c.base.buildings.stahlwerk, 0);
  assert.equal(cancelUpgrade(c.base, mid, balance).ok, false);
  const late = cancelUpgrade(started.base, order.finishesAt, balance);
  assert.equal(late.ok, false);
});

test("Abbruch der Ausbildung erstattet anteilig und gibt den Bauplatz frei", () => {
  const base = makeBase(balance, { buildings: { kaserne: 1 } });
  const t = startTraining(base, "schuetzen", 10, T0, balance);
  assert.ok(t.ok);
  const c = cancelTraining(t.base, "kaserne", T0, balance);
  assert.ok(c.ok);
  assert.deepEqual(c.refund, { stahl: 300, treibstoff: 0, elektronik: 0, proviant: 200 });
  assert.equal(c.base.trainingQueue.length, 0);
  assert.equal(cancelTraining(c.base, "kaserne", T0, balance).ok, false);
});
