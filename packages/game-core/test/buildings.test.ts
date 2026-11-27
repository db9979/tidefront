import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandPoints,
  completeUpgrade,
  harborCreditLimit,
  harborMarketUnlocked,
  maxAllowedLevel,
  missionSlots,
  startUpgrade,
  upgradeCost,
  upgradeSeconds,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("Kostenformel für mehrere Stufen, aufgerundet (ohne Kostenverschiebung, die prüft cost-shift.test.ts)", () => {
  const balance = { ...loadBalance(), building: { ...loadBalance().building, costShift: undefined } };
  assert.deepEqual(upgradeCost("stahlwerk", 0, balance), { stahl: 120, treibstoff: 30, elektronik: 0, proviant: 0 });
  assert.deepEqual(upgradeCost("stahlwerk", 1, balance), { stahl: 180, treibstoff: 45, elektronik: 0, proviant: 0 });
  assert.deepEqual(upgradeCost("stahlwerk", 2, balance), { stahl: 270, treibstoff: 68, elektronik: 0, proviant: 0 });
  // 150 * 1.5^3 = 506.25, 20 * 3.375 = 67.5, 10 * 3.375 = 33.75
  assert.deepEqual(upgradeCost("raffinerie", 3, balance), { stahl: 507, treibstoff: 68, elektronik: 34, proviant: 0 });
  assert.equal(upgradeCost("kommandozentrale", 10, balance).stahl, Math.ceil(400 * 1.5 ** 10));
});

test("Zeitformel für mehrere Stufen", () => {
  assert.equal(upgradeSeconds("stahlwerk", 0, balance), 20);
  assert.ok(approx(upgradeSeconds("stahlwerk", 1, balance), 28));
  assert.ok(approx(upgradeSeconds("stahlwerk", 5, balance), 20 * 1.4 ** 5));
  assert.ok(approx(upgradeSeconds("kommandozentrale", 4, balance), 120 * 1.4 ** 4));
});

test("Bauzeit ist durch maxBuildSeconds gedeckelt", () => {
  // Mit den v1-Zahlen wird die Obergrenze nie erreicht (längste Bauzeit: 120 * 1.4^19, rund 20 Stunden),
  // deshalb prüft der Test die Kappung mit einer verkleinerten Obergrenze.
  assert.ok(upgradeSeconds("kommandozentrale", 19, balance) < balance.building.maxBuildSeconds);
  const capped = { ...balance, building: { ...balance.building, maxBuildSeconds: 1000 } };
  assert.ok(approx(upgradeSeconds("kommandozentrale", 6, capped), 120 * 1.4 ** 6));
  assert.equal(upgradeSeconds("kommandozentrale", 7, capped), 1000);
  assert.equal(upgradeSeconds("kommandozentrale", 19, capped), 1000);
  const rich = { stahl: 1e9, treibstoff: 1e9, elektronik: 1e9, proviant: 1e9 };
  const base = makeBase(capped, { resources: rich, buildings: { kommandozentrale: 10 } });
  const res = startUpgrade(base, "kommandozentrale", T0, capped);
  assert.ok(res.ok);
  assert.equal(res.base.buildQueue[0].finishesAt, T0 + 1000 * 1000);
});

test("startUpgrade zieht Kosten ab und legt den Auftrag an", () => {
  const base = makeBase(balance);
  const res = startUpgrade(base, "stahlwerk", T0, balance);
  assert.ok(res.ok);
  assert.equal(res.base.resources.stahl, 2000 - 120);
  assert.equal(res.base.resources.treibstoff, 1000 - 30);
  assert.deepEqual(res.base.buildQueue, [
    { buildingId: "stahlwerk", targetLevel: 1, startedAt: T0, finishesAt: T0 + 20000 },
  ]);
  // Eingabe unverändert
  assert.equal(base.resources.stahl, 2000);
  assert.deepEqual(base.buildQueue, []);
  assert.equal(res.base.buildings.stahlwerk, 0);
});

test("startUpgrade schreibt Bestände vorher fort", () => {
  const base = makeBase(balance, { resources: { stahl: 100 } });
  assert.deepEqual(startUpgrade(base, "stahlwerk", T0, balance), { ok: false, code: "insufficient_resources" });
  // nach einer Stunde Grundrate (+20) reicht es
  const res = startUpgrade(base, "stahlwerk", T0 + HOUR, balance);
  assert.ok(res.ok);
  assert.ok(approx(res.base.resources.stahl, 0));
});

test("Ablehnung bei zu wenig Ressourcen", () => {
  const base = makeBase(balance, { resources: { stahl: 399 } });
  assert.deepEqual(startUpgrade(base, "kommandozentrale", T0, balance), {
    ok: false,
    code: "insufficient_resources",
  });
});

test("Bauschlange: höchstens queueSlots Aufträge", () => {
  const rich = { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 };
  let base = makeBase(balance, { resources: rich });
  for (const id of ["stahlwerk", "kraftwerk", "raffinerie"]) {
    const r = startUpgrade(base, id, T0, balance);
    assert.ok(r.ok);
    base = r.base;
  }
  assert.equal(base.buildQueue.length, balance.building.queueSlots);
  assert.deepEqual(startUpgrade(base, "chipfabrik", T0 + 1, balance), { ok: false, code: "queue_full" });
});

test("unbekanntes Gebäude", () => {
  assert.deepEqual(startUpgrade(makeBase(balance), "palast", T0, balance), { ok: false, code: "unknown_building" });
  assert.deepEqual(startUpgrade(makeBase(balance), "toString", T0, balance), { ok: false, code: "unknown_building" });
});

test("Limit über die Kommandozentrale", () => {
  const rich = { stahl: 1e9, treibstoff: 1e9, elektronik: 1e9, proviant: 1e9 };
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 1, stahlwerk: 4 } });
  assert.equal(maxAllowedLevel(base, "stahlwerk", balance), 4);
  assert.deepEqual(startUpgrade(base, "stahlwerk", T0, balance), { ok: false, code: "command_cap" });
  const lower = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 1, stahlwerk: 3 } });
  assert.ok(startUpgrade(lower, "stahlwerk", T0, balance).ok);
  // die Kommandozentrale selbst ist nur durch maxLevel begrenzt
  const cmd = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 19 } });
  assert.ok(startUpgrade(cmd, "kommandozentrale", T0, balance).ok);
});

test("Höchststufe maxLevel", () => {
  const rich = { stahl: 1e12, treibstoff: 1e12, elektronik: 1e12, proviant: 1e12 };
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 20, stahlwerk: 20 } });
  assert.deepEqual(startUpgrade(base, "kommandozentrale", T0, balance), { ok: false, code: "max_level" });
  assert.deepEqual(startUpgrade(base, "stahlwerk", T0, balance), { ok: false, code: "max_level" });
});

test("completeUpgrade: zu früh, dann Stufe erhöht und Schlange leer", () => {
  const started = startUpgrade(makeBase(balance), "kraftwerk", T0, balance);
  assert.ok(started.ok);
  assert.deepEqual(completeUpgrade(started.base, T0 + 24999, balance), { ok: false, code: "not_finished" });
  const done = completeUpgrade(started.base, T0 + 25000, balance);
  assert.ok(done.ok);
  assert.equal(done.base.buildings.kraftwerk, 1);
  assert.deepEqual(done.base.buildQueue, []);
  assert.equal(started.base.buildings.kraftwerk, 0);
  assert.deepEqual(completeUpgrade(done.base, T0 + 30000, balance), { ok: false, code: "no_order" });
});

test("completeUpgrade rechnet bis zur Fertigstellung mit der alten Stufe", () => {
  const base = makeBase(balance, { buildings: { kraftwerk: 1 }, resources: { stahl: 1000 } });
  const started = startUpgrade(base, "stahlwerk", T0, balance);
  assert.ok(started.ok);
  // Abschluss wird erst eine Stunde nach Fertigstellung verbucht.
  const done = completeUpgrade(started.base, T0 + 20000 + HOUR, balance);
  assert.ok(done.ok);
  const expected = 1000 - 120 + (20 * 20) / 3600 + 140;
  assert.ok(approx(done.base.resources.stahl, expected, 1e-6));
});

test("Kommandopunkte und Missionsplätze", () => {
  assert.equal(commandPoints(makeBase(balance), balance), 60);
  assert.equal(commandPoints(makeBase(balance, { buildings: { kommandozentrale: 4 } }), balance), 180);
  // v1.24: ab KZ 9 je Stufe 60 statt 30 (KZ 8: 300, KZ 9: 360, KZ 12: 540).
  assert.equal(commandPoints(makeBase(balance, { buildings: { kommandozentrale: 8 } }), balance), 300);
  assert.equal(commandPoints(makeBase(balance, { buildings: { kommandozentrale: 9 } }), balance), 360);
  assert.equal(commandPoints(makeBase(balance, { buildings: { kommandozentrale: 12 } }), balance), 540);
  const slots = [0, 1, 2, 3, 4, 5].map((L) => missionSlots(makeBase(balance, { buildings: { hafenkommandantur: L } }), balance));
  assert.deepEqual(slots, [1, 1, 2, 2, 3, 3]);
});

test("Börsenfreischaltung und Kreditlimit über die Hafenkommandantur", () => {
  assert.equal(harborMarketUnlocked(makeBase(balance, { buildings: { hafenkommandantur: 2 } }), balance), false);
  const h3 = makeBase(balance, { buildings: { hafenkommandantur: 3 } });
  assert.equal(harborMarketUnlocked(h3, balance), true);
  assert.equal(harborCreditLimit(h3, balance), 15000);
});
