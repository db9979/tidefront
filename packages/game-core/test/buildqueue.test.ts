// Bauschlange: Einreihen, Abschluss der Reihe nach, Abbruch einzelner Aufträge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancelUpgrade,
  completeUpgrade,
  maxAllowedLevel,
  plannedLevel,
  startUpgrade,
  upgradeCost,
  upgradeSeconds,
  type BaseState,
} from "../src/index.ts";
import { T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const rich = { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 };

function enqueue(base: BaseState, ids: string[], nowMs = T0): BaseState {
  let cur = base;
  for (const id of ids) {
    const r = startUpgrade(cur, id, nowMs, balance);
    assert.ok(r.ok, `${id}: ${!r.ok ? r.code : ""}`);
    cur = r.base;
  }
  return cur;
}

test("Einreihen: Zielstufe zählt eingereihte Aufträge, Kosten sofort, Start nach dem vorigen", () => {
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 1, stahlwerk: 1 } });
  const q = enqueue(base, ["stahlwerk", "stahlwerk", "kraftwerk"]);
  assert.deepEqual(q.buildQueue.map((o) => [o.buildingId, o.targetLevel]), [["stahlwerk", 2], ["stahlwerk", 3], ["kraftwerk", 1]]);
  const [a, b, c] = q.buildQueue;
  assert.equal(a.startedAt, T0);
  assert.equal(a.finishesAt, T0 + Math.ceil(upgradeSeconds("stahlwerk", 1, balance) * 1000));
  assert.equal(b.startedAt, a.finishesAt);
  assert.equal(b.finishesAt, b.startedAt + Math.ceil(upgradeSeconds("stahlwerk", 2, balance) * 1000));
  assert.equal(c.startedAt, b.finishesAt);
  assert.equal(c.finishesAt, c.startedAt + 25000);
  const paid = upgradeCost("stahlwerk", 1, balance).stahl + upgradeCost("stahlwerk", 2, balance).stahl + upgradeCost("kraftwerk", 0, balance).stahl;
  assert.ok(approx(q.resources.stahl, 1e6 - paid));
  assert.equal(plannedLevel(q, "stahlwerk"), 3);
  assert.equal(q.buildings.stahlwerk, 1);
});

test("Einreihen: maxLevel und Deckel gelten für die geplante Stufe, geplante Kommandozentrale zählt mit", () => {
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 0, stahlwerk: 2 } });
  const one = enqueue(base, ["stahlwerk"]);
  assert.deepEqual(startUpgrade(one, "stahlwerk", T0, balance), { ok: false, code: "command_cap" });
  const withKz = enqueue(one, ["kommandozentrale"]);
  assert.equal(maxAllowedLevel(withKz, "stahlwerk", balance), 4);
  const full = enqueue(withKz, ["stahlwerk"]);
  assert.equal(plannedLevel(full, "stahlwerk"), 4);
  const top = makeBase(balance, { resources: { stahl: 1e12, treibstoff: 1e12, elektronik: 1e12, proviant: 1e12 }, buildings: { kommandozentrale: 19 } });
  const kz = enqueue(top, ["kommandozentrale"]);
  assert.deepEqual(startUpgrade(kz, "kommandozentrale", T0, balance), { ok: false, code: "max_level" });
});

test("Ein später eingereihter Auftrag startet frühestens jetzt", () => {
  const base = makeBase(balance, { resources: rich });
  const q = enqueue(base, ["stahlwerk"]);
  // Der erste Auftrag ist überfällig, aber noch nicht verbucht.
  const late = q.buildQueue[0].finishesAt + 5000;
  const r = startUpgrade(q, "kraftwerk", late, balance);
  assert.ok(r.ok);
  assert.equal(r.order.startedAt, late);
});

test("completeUpgrade schließt alle fälligen Aufträge der Reihe nach ab", () => {
  const base = makeBase(balance, { resources: { ...rich, stahl: 1000 }, buildings: { kraftwerk: 1 } });
  const q = enqueue(base, ["stahlwerk", "stahlwerk", "raffinerie"]);
  const [a, b, c] = q.buildQueue;
  assert.deepEqual(completeUpgrade(q, a.finishesAt - 1, balance), { ok: false, code: "not_finished" });
  const two = completeUpgrade(q, b.finishesAt, balance);
  assert.ok(two.ok);
  assert.equal(two.base.buildings.stahlwerk, 2);
  assert.equal(two.base.buildQueue.length, 1);
  assert.deepEqual(two.base.buildQueue[0], c);
  assert.deepEqual(two.completed.map((o) => o.targetLevel), [1, 2]);
  // Bestände: bis a mit Stufe 0, bis b mit Stufe 1, danach Stufe 2 – wie zwei Einzelschritte.
  const stepOne = completeUpgrade(q, a.finishesAt, balance);
  assert.ok(stepOne.ok);
  const stepTwo = completeUpgrade(stepOne.base, b.finishesAt, balance);
  assert.ok(stepTwo.ok);
  assert.ok(approx(two.base.resources.stahl, stepTwo.base.resources.stahl, 1e-6));
  assert.ok(two.base.resources.stahl > stepOne.base.resources.stahl);
  const all = completeUpgrade(q, c.finishesAt + 1000, balance);
  assert.ok(all.ok);
  assert.deepEqual(all.base.buildQueue, []);
  assert.equal(all.base.buildings.raffinerie, 1);
});

test("Abbruch eines nicht begonnenen Auftrags: volle Erstattung, Nachrücken mit neuen Zeiten", () => {
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 2 } });
  const q = enqueue(base, ["stahlwerk", "kraftwerk", "raffinerie"]);
  const [a, , c] = q.buildQueue;
  const now = T0 + 5000;
  const r = cancelUpgrade(q, now, balance, 1);
  assert.ok(r.ok);
  assert.deepEqual(r.refund, upgradeCost("kraftwerk", 0, balance));
  assert.deepEqual(r.base.buildQueue[0], a);
  assert.equal(r.base.buildQueue[1].buildingId, "raffinerie");
  assert.equal(r.base.buildQueue[1].startedAt, a.finishesAt);
  assert.equal(r.base.buildQueue[1].finishesAt, a.finishesAt + (c.finishesAt - c.startedAt));
});

test("Abbruch des laufenden Auftrags: Erstattung nach Restzeit, der nächste beginnt sofort", () => {
  const base = makeBase(balance, { resources: rich });
  const q = enqueue(base, ["stahlwerk", "kraftwerk"]);
  const [a, b] = q.buildQueue;
  const mid = T0 + (a.finishesAt - T0) / 2;
  const r = cancelUpgrade(q, mid, balance, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.refund, { stahl: 60, treibstoff: 15, elektronik: 0, proviant: 0 });
  assert.equal(r.base.buildQueue.length, 1);
  assert.equal(r.base.buildQueue[0].startedAt, mid);
  assert.equal(r.base.buildQueue[0].finishesAt, mid + (b.finishesAt - b.startedAt));
});

test("Abbruch macht spätere Aufträge desselben Gebäudes ungültig: erstattet und entfernt", () => {
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 2 } });
  const q = enqueue(base, ["stahlwerk", "kraftwerk", "stahlwerk"]);
  const r = cancelUpgrade(q, T0 + 1000, balance, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.removed.map((o) => [o.buildingId, o.targetLevel]), [["stahlwerk", 1], ["stahlwerk", 2]]);
  assert.deepEqual(r.base.buildQueue.map((o) => o.buildingId), ["kraftwerk"]);
  assert.equal(r.base.buildQueue[0].startedAt, T0 + 1000);
  const first = upgradeCost("stahlwerk", 0, balance);
  const second = upgradeCost("stahlwerk", 1, balance);
  // erster nach Restzeit (19 von 20 s), zweiter voll
  assert.equal(r.refund.stahl, Math.floor(first.stahl * 0.95 + 1e-9) + second.stahl);
});

test("Abbruch der Kommandozentrale entfernt Aufträge über dem Deckel", () => {
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 0, stahlwerk: 2 } });
  const q = enqueue(base, ["stahlwerk", "kommandozentrale", "stahlwerk"]);
  const r = cancelUpgrade(q, T0 + 1000, balance, 1);
  assert.ok(r.ok);
  assert.deepEqual(r.base.buildQueue.map((o) => [o.buildingId, o.targetLevel]), [["stahlwerk", 3]]);
  assert.deepEqual(r.removed.map((o) => [o.buildingId, o.targetLevel]), [["kommandozentrale", 1], ["stahlwerk", 4]]);
});

test("Abbruch: ungültiger Index, schon fertig", () => {
  const q = enqueue(makeBase(balance, { resources: rich }), ["stahlwerk"]);
  assert.deepEqual(cancelUpgrade(q, T0, balance, 3), { ok: false, code: "no_order" });
  assert.deepEqual(cancelUpgrade(q, T0, balance, -1), { ok: false, code: "no_order" });
  assert.deepEqual(cancelUpgrade(q, q.buildQueue[0].finishesAt, balance, 0), { ok: false, code: "already_finished" });
});
