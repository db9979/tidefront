import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aircraftSlots,
  aircraftSlotsUsed,
  completeTraining,
  productionRates,
  startTraining,
  trainingCost,
  trainingSecondsPerUnit,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const rich = { stahl: 1e7, treibstoff: 1e7, elektronik: 1e7, proviant: 1e7 };

test("Baukosten je Stückzahl", () => {
  assert.deepEqual(trainingCost("korvette", 3, balance), { stahl: 1200, treibstoff: 300, elektronik: 150, proviant: 0 });
  assert.deepEqual(trainingCost("schuetzen", 10, balance), { stahl: 300, treibstoff: 0, elektronik: 0, proviant: 200 });
});

test("Bauzeit sinkt mit der Gebäudestufe", () => {
  assert.equal(trainingSecondsPerUnit("korvette", 1, balance), 300);
  assert.ok(approx(trainingSecondsPerUnit("korvette", 3, balance), 300 / 1.2));
  assert.ok(approx(trainingSecondsPerUnit("korvette", 11, balance), 150));
  assert.ok(approx(trainingSecondsPerUnit("abfangjaeger", 6, balance), 420 / 1.5));
});

test("Voraussetzung: Baugebäude mindestens Stufe 1", () => {
  const base = makeBase(balance, { resources: rich });
  assert.deepEqual(startTraining(base, "korvette", 1, T0, balance), { ok: false, code: "building_required" });
  assert.deepEqual(startTraining(base, "schuetzen", 1, T0, balance), { ok: false, code: "building_required" });
  const withYard = makeBase(balance, { resources: rich, buildings: { werft: 1 } });
  assert.ok(startTraining(withYard, "korvette", 1, T0, balance).ok);
  assert.deepEqual(startTraining(withYard, "schuetzen", 1, T0, balance), { ok: false, code: "building_required" });
});

test("unbekannte Einheit und ungültige Anzahl", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1 } });
  assert.deepEqual(startTraining(base, "schnellboot", 1, T0, balance), { ok: false, code: "unknown_unit" });
  for (const n of [0, -1, 1.5, NaN]) {
    assert.deepEqual(startTraining(base, "korvette", n, T0, balance), { ok: false, code: "bad_count" });
  }
});

test("Versorgungsmangel stoppt die Ausbildung", () => {
  const base = makeBase(balance, {
    resources: { ...rich, proviant: 0 },
    buildings: { werft: 1 },
    units: { zerstoerer: 10 },
  });
  assert.ok(productionRates(base, balance).perHour.proviant < 0);
  assert.deepEqual(startTraining(base, "korvette", 1, T0, balance), { ok: false, code: "supply_shortage" });
});

test("zu wenig Ressourcen", () => {
  const base = makeBase(balance, { buildings: { werft: 1 }, resources: { stahl: 799 } });
  assert.deepEqual(startTraining(base, "korvette", 2, T0, balance), { ok: false, code: "insufficient_resources" });
});

test("startTraining zieht Kosten ab; Bauzeit skaliert mit Anzahl und Stufe", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 3 } });
  const res = startTraining(base, "korvette", 4, T0, balance);
  assert.ok(res.ok);
  assert.equal(res.base.resources.stahl, 1e7 - 1600);
  assert.equal(res.order.finishesAt, T0 + 4 * 250 * 1000);
  assert.equal(res.base.trainingQueue.length, 1);
  assert.deepEqual(base.trainingQueue, []);
  assert.equal(base.resources.stahl, 1e7);
});

test("ein Auftrag je Gebäude, verschiedene Gebäude parallel", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1, kaserne: 1 } });
  const a = startTraining(base, "korvette", 1, T0, balance);
  assert.ok(a.ok);
  assert.deepEqual(startTraining(a.base, "zerstoerer", 1, T0, balance), { ok: false, code: "queue_busy" });
  const b = startTraining(a.base, "schuetzen", 5, T0, balance);
  assert.ok(b.ok);
  assert.equal(b.base.trainingQueue.length, 2);
});

test("Stellplätze begrenzen Flugzeuge (daheim, unterwegs, in Ausbildung)", () => {
  const base = makeBase(balance, {
    resources: rich,
    buildings: { flugfeld: 1 },
    units: { abfangjaeger: 2 },
    unitsAway: { aufklaerungsdrohne: 1 },
  });
  assert.equal(aircraftSlots(base, balance), 6);
  assert.equal(aircraftSlotsUsed(base, balance), 3);
  assert.deepEqual(startTraining(base, "jagdbomber", 4, T0, balance), { ok: false, code: "no_aircraft_slots" });
  const ok = startTraining(base, "jagdbomber", 3, T0, balance);
  assert.ok(ok.ok);
  assert.equal(aircraftSlotsUsed(ok.base, balance), 6);
  // Schiffe brauchen keine Stellplätze
  const yard = makeBase(balance, { resources: rich, buildings: { werft: 1 } });
  assert.ok(startTraining(yard, "korvette", 50, T0, balance).ok);
});

test("completeTraining: zu früh, dann Einheiten im Bestand", () => {
  const base = makeBase(balance, { resources: rich, buildings: { werft: 1 }, units: { korvette: 1 } });
  const started = startTraining(base, "korvette", 2, T0, balance);
  assert.ok(started.ok);
  assert.deepEqual(completeTraining(started.base, T0 + 599999, balance), { ok: false, code: "not_finished" });
  const done = completeTraining(started.base, T0 + 600000, balance);
  assert.ok(done.ok);
  assert.equal(done.base.units.korvette, 3);
  assert.deepEqual(done.base.trainingQueue, []);
  assert.equal(done.completed.length, 1);
  assert.equal(started.base.units.korvette, 1);
  assert.deepEqual(completeTraining(done.base, T0 + 700000, balance), { ok: false, code: "no_order" });
});

test("neue Einheiten kosten erst ab Fertigstellung Unterhalt", () => {
  const base = makeBase(balance, { buildings: { werft: 1 }, resources: { stahl: 5000, treibstoff: 5000, elektronik: 5000, proviant: 1000 } });
  const started = startTraining(base, "zerstoerer", 5, T0, balance);
  assert.ok(started.ok);
  // fertig nach 3600 s, verbucht eine Stunde später: 1 h +15, 1 h (15 - 20)
  const done = completeTraining(started.base, T0 + 2 * HOUR, balance);
  assert.ok(done.ok);
  assert.ok(approx(done.base.resources.proviant, 1000 + 15 - 5));
});

test("Verteidigungsanlagen: ohne Gebäude, eigener Bauplatz", () => {
  const base = makeBase(balance, { resources: rich });
  const res = startTraining(base, "flakstellung", 2, T0, balance);
  assert.ok(res.ok);
  assert.equal(res.order.kind, "defense");
  assert.equal(res.order.finishesAt, T0 + 2 * 240 * 1000);
  assert.equal(res.base.resources.elektronik, 1e7 - 300);
  assert.deepEqual(startTraining(res.base, "bunkerlinie", 1, T0, balance), { ok: false, code: "queue_busy" });
  const done = completeTraining(res.base, T0 + 480000, balance);
  assert.ok(done.ok);
  assert.equal(done.base.defenses.flakstellung, 2);
});
