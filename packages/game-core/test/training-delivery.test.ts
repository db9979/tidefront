// Teillieferung (0.44): fertige Einheiten eines Auftrags wandern einzeln in den Bestand.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TrainingOrder } from "../src/index.ts";
import {
  aircraftSlotsUsed,
  cancelTraining,
  completeTraining,
  deliverTraining,
  nextTrainingDelivery,
  nextTrainingDeliveryAt,
  spyCount,
  startTraining,
  trainingCost,
  trainingLeft,
  trainingReadyBy,
  trainingUnitAt,
} from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const rich = { stahl: 1e7, treibstoff: 1e7, elektronik: 1e7, proviant: 1e7 };

test("Teillieferung: 3 Korvetten einzeln nach je einem Drittel der Dauer", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1, kraftwerk: 1 } });
  const s = startTraining(base, "korvette", 3, T0, balance);
  assert.ok(s.ok);
  assert.equal(s.order.finishesAt, T0 + 900000);
  assert.deepEqual([1, 2, 3].map((i) => trainingUnitAt(s.order, i) - T0), [300000, 600000, 900000]);
  assert.equal(nextTrainingDeliveryAt(s.order), T0 + 300000);
  assert.deepEqual(completeTraining(s.base, T0 + 299999, balance), { ok: false, code: "not_finished" });

  const one = completeTraining(s.base, T0 + 300000, balance);
  assert.ok(one.ok);
  assert.equal(one.base.units.korvette, 1);
  assert.equal(one.base.trainingQueue[0].done, 1);
  assert.equal(trainingLeft(one.base.trainingQueue[0]), 2);
  assert.deepEqual(one.completed, []);
  assert.equal(one.delivered[0].count, 1);
  assert.equal(nextTrainingDelivery(one.base), T0 + 600000);

  const all = completeTraining(one.base, T0 + 900000, balance);
  assert.ok(all.ok);
  assert.equal(all.base.units.korvette, 3);
  assert.deepEqual(all.base.trainingQueue, []);
  assert.equal(all.completed.length, 1);
  assert.equal(all.delivered[0].count, 2);
  assert.equal(nextTrainingDelivery(all.base), null);
});

test("Teillieferung: Unterhalt jeweils ab Lieferung (Hafen bis zum Lieferzeitpunkt fortgeschrieben)", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1, kraftwerk: 1 } });
  const s = startTraining(base, "korvette", 3, T0, balance);
  assert.ok(s.ok);
  const r = deliverTraining(s.base, T0 + 650000, balance);
  assert.equal(r.base.units.korvette, 2);
  assert.equal(r.base.resUpdatedAt, T0 + 600000, "nur bis zur letzten Lieferung fortgeschrieben");
  // In einem Zug nachgeholt = Schritt für Schritt
  const stepwise = deliverTraining(deliverTraining(s.base, T0 + 300000, balance).base, T0 + 650000, balance);
  assert.deepEqual(stepwise.base.resources, r.base.resources);
});

test("Teillieferung: Verteidigungsanlagen ebenso", () => {
  const s = startTraining(makeBase(balance, { resources: rich }), "flakstellung", 2, T0, balance);
  assert.ok(s.ok);
  const one = completeTraining(s.base, T0 + 240000, balance);
  assert.ok(one.ok);
  assert.equal(one.base.defenses.flakstellung, 1);
  assert.equal(one.base.trainingQueue.length, 1);
});

test("Abbruch erstattet nur den noch nicht gelieferten Rest; Gelieferte bleiben", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1, kraftwerk: 1 } });
  const s = startTraining(base, "korvette", 3, T0, balance);
  assert.ok(s.ok);
  // Bei 450 s: Korvette 1 fertig (wird beim Abbruch geliefert), Korvette 2 zur Hälfte, 3 nicht begonnen.
  const c = cancelTraining(s.base, "werft", T0 + 450000, balance);
  assert.ok(c.ok);
  assert.equal(c.base.units.korvette, 1);
  assert.deepEqual(c.base.trainingQueue, []);
  // Rest 2 Korvetten, Restzeit 450 von 600 s ihrer Spanne → 75 % von 2 × Kosten.
  const two = trainingCost("korvette", 2, balance);
  assert.equal(c.refund.stahl, Math.floor(two.stahl * 0.75));
  assert.equal(c.refund.elektronik, Math.floor(two.elektronik * 0.75));
  // Bereits gelieferte (gespeicherte) Einheit genauso
  const one = completeTraining(s.base, T0 + 300000, balance);
  assert.ok(one.ok);
  const c2 = cancelTraining(one.base, "werft", T0 + 450000, balance);
  assert.ok(c2.ok);
  assert.equal(c2.base.units.korvette, 1);
  assert.deepEqual(c2.refund, c.refund);
});

test("In Ausbildung zählt nur der Rest: Stellplätze, Spione, Höchstzahl", () => {
  const jets: TrainingOrder = { kind: "unit", id: "abfangjaeger", count: 3, done: 1, builtIn: "flugfeld", startedAt: T0, finishesAt: T0 + 3000 };
  const air = makeBase(balance, { buildings: { flugfeld: 1 }, units: { abfangjaeger: 1 }, trainingQueue: [jets] });
  assert.equal(aircraftSlotsUsed(air, balance), 3, "1 geliefert + 2 Rest");

  const spies: TrainingOrder = { kind: "unit", id: "spion", count: 2, done: 1, builtIn: "nachrichtendienst", startedAt: T0, finishesAt: T0 + 3000 };
  const intel = makeBase(balance, { resources: rich, buildings: { nachrichtendienst: 2 }, units: { spion: 1 }, trainingQueue: [spies] });
  assert.deepEqual(spyCount(intel, balance), { home: 1, away: 0, training: 1 });
  // Höchstzahl (2 je Stufe → 4): Rest-Auftrag in einem anderen Hafenzustand mitgezählt – 1 daheim + 1 Rest + 2 neu = 4.
  const other: TrainingOrder = { ...spies, builtIn: "x" }; // fremder Platz, damit der Nachrichtendienst frei ist
  const capBase = { ...intel, trainingQueue: [other] };
  assert.ok(startTraining(capBase, "spion", 2, T0, balance).ok);
  assert.deepEqual(startTraining(capBase, "spion", 3, T0, balance), { ok: false, code: "unit_cap" });
});

test("Alter Auftrag ohne done: wird anteilig geliefert", () => {
  const old: TrainingOrder = { kind: "unit", id: "schuetzen", count: 4, builtIn: "kaserne", startedAt: T0, finishesAt: T0 + 4000 };
  const base = makeBase(balance, { buildings: { kaserne: 1 }, trainingQueue: [old] });
  assert.equal(trainingLeft(old), 4);
  assert.equal(trainingReadyBy(old, T0 + 2500), 2);
  const r = completeTraining(base, T0 + 2500, balance);
  assert.ok(r.ok);
  assert.equal(r.base.units.schuetzen, 2);
  assert.equal(r.base.trainingQueue[0].done, 2);
});

test("Nachholen vieler Lieferungen wird gebündelt und bleibt vollständig", () => {
  const big: TrainingOrder = { kind: "unit", id: "schuetzen", count: 5000, builtIn: "kaserne", startedAt: T0, finishesAt: T0 + 5000 * 30000 };
  const base = makeBase(balance, { resources: rich, buildings: { kaserne: 1 }, trainingQueue: [big] });
  const half = deliverTraining(base, T0 + 2500 * 30000, balance);
  assert.equal(half.base.units.schuetzen, 2500);
  const all = deliverTraining(half.base, T0 + 5000 * 30000, balance);
  assert.equal(all.base.units.schuetzen, 5000);
  assert.deepEqual(all.base.trainingQueue, []);
  assert.equal(all.completed.length, 1);
});

test("trainingReadyBy passt zu trainingUnitAt (Rundung)", () => {
  const o: TrainingOrder = { kind: "unit", id: "korvette", count: 7, builtIn: "werft", startedAt: T0, finishesAt: T0 + 1000 };
  for (let i = 1; i <= 7; i++) {
    const at = trainingUnitAt(o, i);
    assert.equal(trainingReadyBy(o, at), i);
    assert.equal(trainingReadyBy(o, at - 1), i - 1);
  }
});
