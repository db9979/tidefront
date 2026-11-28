// Bauempfehlung (UX 0.43, E-4): Gründe, Reihenfolge, volle Schlange, fehlende Rohstoffe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdvice, productionRates, startUpgrade, storageCapacity } from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("Neuer Hafen: höchstens drei Vorschläge, bezahlbar, mit Dauer und Zielstufe", () => {
  const s = makeBase(balance);
  const a = buildAdvice(s, balance, T0);
  assert.ok(a.length > 0 && a.length <= 3);
  for (const x of a) {
    assert.ok(x.level >= 1);
    assert.ok(x.durationMs > 0);
    if (x.affordable) assert.deepEqual(x.missing, {});
  }
  // Was als bezahlbar gilt, lässt sich auch wirklich beginnen.
  const first = a.find((x) => x.affordable);
  if (first) assert.equal(startUpgrade(s, first.buildingId, T0, balance).ok, true);
});

test("Volle Bauschlange: keine Empfehlung", () => {
  let s = makeBase(balance, { resources: { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 } });
  for (const id of ["stahlwerk", "raffinerie", "chipfabrik", "versorgungshof", "lagerkomplex"].slice(0, balance.building.queueSlots)) {
    const r = startUpgrade(s, id, T0, balance);
    if (r.ok) s = r.base;
  }
  assert.equal(s.buildQueue.length, balance.building.queueSlots);
  assert.deepEqual(buildAdvice(s, balance, T0), []);
});

test("Lager fast voll: Lagerkomplex vorn, Grund „lager“ mit Rohstoff", () => {
  const base = makeBase(balance);
  const cap = storageCapacity(base, balance);
  const s = makeBase(balance, { resources: { stahl: Math.floor(cap * 0.95) } });
  const [top] = buildAdvice(s, balance, T0);
  // Strommangel geht vor; nur ohne Strommangel muss das Lager vorn stehen.
  if (productionRates(s, balance, undefined, T0).powerFactor >= 0.995) {
    assert.equal(top.buildingId, "lagerkomplex");
    assert.equal(top.reason, "lager");
    assert.equal(top.resource, "stahl");
  } else assert.equal(top.reason, "strom");
});

test("Ohne Rohstoffe: Vorschlag mit fehlenden Mengen, nicht bezahlbar", () => {
  const s = makeBase(balance, { resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 } });
  const a = buildAdvice(s, balance, T0);
  assert.ok(a.length > 0);
  assert.equal(a[0].affordable, false);
  assert.ok(Object.values(a[0].missing).some((n) => n > 0));
});
