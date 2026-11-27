// Stufenabhängige Kostenmischung (building.costShift, v1.29): höhere Stufen verlagern einen wachsenden Anteil des Stahls
// wertgleich zum Börsen-Richtpreis auf andere Rohstoffe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyCatchUp, refValue, splitBuildCost, startUpgrade, upgradeCost, type Balance, type ResourceMap } from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const real = loadBalance();
/** Feste Testwerte, unabhängig von den aktuellen Balance-Zahlen. */
const balance: Balance = {
  ...real,
  building: { ...real.building, costFactor: 1.5, costShift: { perLevel: 0.03, max: 0.3, to: { elektronik: 0.75, proviant: 0.25 } } },
  market: { ...real.market, refPrice: { stahl: 1, treibstoff: 1.8, elektronik: 3, proviant: 0.6 } },
  buildings: {
    ...real.buildings,
    testwerk: { cost: { stahl: 1000, treibstoff: 100, elektronik: 0 }, seconds: 10 },
    testkaserne: { cost: { stahl: 1000 }, costShiftTo: { proviant: 1 }, seconds: 10 },
  },
};
const value = (c: ResourceMap) => Object.entries(c).reduce((a, [r, n]) => a + n * (balance.market.refPrice[r] ?? 0), 0);

test("Stufe 0 bleibt unverändert, ohne costShift gilt die alte Formel", () => {
  assert.deepEqual(upgradeCost("testwerk", 0, balance), { stahl: 1000, treibstoff: 100, elektronik: 0, proviant: 0 });
  const plain = { ...balance, building: { ...balance.building, costShift: undefined } };
  assert.deepEqual(upgradeCost("testwerk", 4, plain), { stahl: Math.ceil(1000 * 1.5 ** 4), treibstoff: Math.ceil(100 * 1.5 ** 4), elektronik: 0, proviant: 0 });
});

test("Stufe 2: 6 % des Stahls wandern wertgleich nach der Zielmischung", () => {
  // 1000 × 1,5² = 2250 Stahl, davon 6 % = 135 → 2115 Stahl; 135 × 0,75 / 3 = 33,75 Elektronik, 135 × 0,25 / 0,6 = 56,25 Proviant.
  assert.deepEqual(upgradeCost("testwerk", 2, balance), { stahl: 2115, treibstoff: 225, elektronik: 34, proviant: 57 });
});

test("Der Anteil wächst je Stufe und ist bei max gedeckelt", () => {
  const share = (l: number) => 1 - upgradeCost("testwerk", l, balance).stahl / (1000 * 1.5 ** l);
  assert.ok(share(4) > share(2) && share(8) > share(4));
  assert.ok(Math.abs(share(10) - 0.3) < 1e-3);
  assert.ok(Math.abs(share(15) - 0.3) < 1e-3);
});

test("Der Gesamtwert zum Richtpreis bleibt bis auf Rundung gleich", () => {
  for (const l of [1, 5, 9, 14]) {
    const raw = (1000 + 100 * 1.8) * 1.5 ** l;
    const v = value(upgradeCost("testwerk", l, balance));
    assert.ok(v >= raw - 1e-6 && v - raw <= 1 + 1.8 + 3 + 0.6, `Stufe ${l}: ${v} vs ${raw}`);
  }
});

test("costShiftTo eines Gebäudes ersetzt die allgemeine Zielmischung", () => {
  const c = upgradeCost("testkaserne", 5, balance);
  // 1000 × 1,5⁵ = 7593,75; 15 % = 1139,0625 Stahl → 1898,4375 Proviant
  assert.deepEqual(c, { stahl: Math.ceil(7593.75 - 1139.0625), treibstoff: 0, elektronik: 0, proviant: Math.ceil(1139.0625 / 0.6) });
});

test("Echte Balance: Stahl der Gebäude bis Stufe 12 sinkt um rund ein Viertel, Gesamtwert gleich", () => {
  let steelOld = 0, steelNew = 0, valueOld = 0, valueNew = 0;
  const plain = { ...real, building: { ...real.building, costShift: undefined } };
  const price = real.market.refPrice;
  for (const id of Object.keys(real.buildings)) {
    if (real.buildings[id].requires) continue;
    for (let l = 0; l < 12; l++) {
      const a = upgradeCost(id, l, plain), b = upgradeCost(id, l, real);
      steelOld += a.stahl; steelNew += b.stahl;
      for (const r of real.resources) { valueOld += a[r] * price[r]; valueNew += b[r] * price[r]; }
    }
  }
  const moved = 1 - steelNew / steelOld;
  assert.ok(moved > 0.18 && moved < 0.32, `verlagert ${moved}`);
  assert.ok(Math.abs(valueNew / valueOld - 1) < 0.002, `Wert ${valueNew / valueOld}`);
});

test("Aufholhilfe: Baugutschrift deckt auch beim verlagerten Mix denselben Anteil jeder Ressource (inkl. Proviant)", () => {
  const level = 8;
  const cost = upgradeCost("kommandozentrale", level, real);
  assert.ok(cost.proviant > 0 && cost.elektronik > 0, "hohe Stufe kostet Proviant und mehr Elektronik");
  const total = refValue(cost, real);
  const half = splitBuildCost(cost, total / 2, real);
  for (const r of real.resources) {
    assert.ok(Math.abs((half.fromCredit[r] ?? 0) - cost[r] / 2) <= 1, `${r}: ${half.fromCredit[r]} vs ${cost[r] / 2}`);
    assert.equal((half.fromCredit[r] ?? 0) + half.fromStock[r], cost[r]);
  }
  // Ganz aus der Gutschrift: das Lager (ohne Proviant) bleibt unberührt.
  const base = makeBase(real, {
    buildings: { kommandozentrale: level },
    resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 },
    catchUp: { ...emptyCatchUp(T0), credit: total + 10 },
  });
  const up = startUpgrade(base, "kommandozentrale", T0, real);
  assert.ok(up.ok, JSON.stringify(up));
  assert.ok(Math.abs(up.base.catchUp!.credit - 10) < 1e-6);
  assert.deepEqual(up.order.credit, Object.fromEntries(Object.entries(cost).filter(([, v]) => v > 0)));
});
