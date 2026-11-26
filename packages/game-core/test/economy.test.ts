import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bunkerProtection,
  productionRates,
  settle,
  storageCapacity,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("Grundrate allein ohne Gebäude", () => {
  const base = makeBase(balance);
  const rates = productionRates(base, balance);
  assert.deepEqual(rates.perHour, { stahl: 20, treibstoff: 10, elektronik: 5, proviant: 15 });
  assert.equal(rates.powerFactor, 1);
});

test("Gebäudeproduktion wächst mit productionGrowth^(L-1)", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 3, kraftwerk: 5 } });
  const rates = productionRates(base, balance);
  assert.ok(approx(rates.perHour.stahl, 20 + 120 * 1.15 ** 2));
  assert.equal(rates.perHour.treibstoff, 10);
});

test("Fortschreibung über Zeit", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 1, kraftwerk: 1 } });
  const later = settle(base, T0 + 2 * HOUR, balance);
  assert.ok(approx(later.resources.stahl, 2000 + 2 * 140));
  assert.ok(approx(later.resources.treibstoff, 1000 + 2 * 10));
  assert.equal(later.resUpdatedAt, T0 + 2 * HOUR);
  // Eingabe unverändert
  assert.equal(base.resources.stahl, 2000);
  assert.equal(base.resUpdatedAt, T0);
});

test("settle in zwei Schritten ergibt dasselbe wie in einem", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 2, raffinerie: 1, kraftwerk: 1 } });
  const once = settle(base, T0 + 5 * HOUR, balance);
  const twice = settle(settle(base, T0 + 2 * HOUR, balance), T0 + 5 * HOUR, balance);
  for (const r of balance.resources) assert.ok(approx(once.resources[r], twice.resources[r]));
});

test("settle mit nowMs vor resUpdatedAt ändert nichts", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 1, kraftwerk: 1 } });
  const earlier = settle(base, T0 - HOUR, balance);
  assert.deepEqual(earlier.resources, base.resources);
  assert.equal(earlier.resUpdatedAt, T0);
});

test("Lager deckelt die Produktion", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 5, kraftwerk: 5 } });
  assert.equal(storageCapacity(base, balance), 5000);
  const later = settle(base, T0 + 1000 * HOUR, balance);
  assert.equal(later.resources.stahl, 5000);
  const bigger = makeBase(balance, { buildings: { lagerkomplex: 2 } });
  assert.equal(storageCapacity(bigger, balance), 5000 * 1.5 ** 2);
});

test("Bestand über der Kapazität (Beute) bleibt erhalten, wächst aber nicht", () => {
  const base = makeBase(balance, { resources: { stahl: 9000 } });
  const later = settle(base, T0 + 10 * HOUR, balance);
  assert.equal(later.resources.stahl, 9000);
});

test("Strom-Drosselung trifft Gebäudeproduktion, nicht die Grundrate", () => {
  // Bedarf: stahlwerk 4 * 10 + raffinerie 5 * 12 = 100, Angebot: kraftwerk 1 * 60
  const base = makeBase(balance, { buildings: { stahlwerk: 4, raffinerie: 5, kraftwerk: 1 } });
  const rates = productionRates(base, balance);
  assert.equal(rates.powerDemand, 100);
  assert.equal(rates.powerSupply, 60);
  assert.ok(approx(rates.powerFactor, 0.6));
  assert.ok(approx(rates.perHour.stahl, 20 + 120 * 1.15 ** 3 * 0.6));
  assert.ok(approx(rates.perHour.treibstoff, 10 + 60 * 1.15 ** 4 * 0.6));
  assert.equal(rates.perHour.elektronik, 5);
});

test("ohne Kraftwerk bleibt nur die Grundrate", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 3 } });
  assert.equal(productionRates(base, balance).perHour.stahl, 20);
});

test("genug Strom: keine Drosselung", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 6, kraftwerk: 1 } });
  assert.equal(productionRates(base, balance).powerFactor, 1);
});

test("Proviant-Unterhalt wird abgezogen, auch für Einheiten auf Mission", () => {
  const base = makeBase(balance, { units: { korvette: 5 }, unitsAway: { zerstoerer: 2 } });
  const rates = productionRates(base, balance);
  assert.equal(rates.upkeepPerHour, 5 * 2 + 2 * 4);
  assert.equal(rates.perHour.proviant, 15 - 18);
});

test("negativer Proviant fällt nie unter 0 und setzt Versorgungsmangel", () => {
  const base = makeBase(balance, { units: { zerstoerer: 10 }, resources: { proviant: 100 } });
  // Netto -25/h
  const mid = settle(base, T0 + 2 * HOUR, balance);
  assert.ok(approx(mid.resources.proviant, 50));
  assert.equal(mid.versorgungsmangel, false);
  const empty = settle(base, T0 + 100 * HOUR, balance);
  assert.equal(empty.resources.proviant, 0);
  assert.equal(empty.versorgungsmangel, true);
  const exact = settle(base, T0 + 4 * HOUR, balance);
  assert.equal(exact.resources.proviant, 0);
  assert.equal(exact.versorgungsmangel, true);
});

test("Versorgungsmangel endet, sobald die Rate nicht mehr negativ ist", () => {
  const starving = makeBase(balance, {
    units: { zerstoerer: 10 },
    resources: { proviant: 0 },
    versorgungsmangel: true,
  });
  const fed = { ...starving, units: {} };
  const later = settle(fed, T0 + HOUR, balance);
  assert.equal(later.versorgungsmangel, false);
  assert.ok(approx(later.resources.proviant, 15));
});

test("Bunkerschutz wächst mit der Stufe", () => {
  assert.equal(bunkerProtection(makeBase(balance), balance), 300);
  const b3 = makeBase(balance, { buildings: { tiefbunker: 3 } });
  assert.ok(approx(bunkerProtection(b3, balance), 300 * 1.4 ** 3));
});
