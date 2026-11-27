// Aufholhilfe: Kurve, Deckel, Wegfall (Hysterese), Baugutschrift beim Bauen und beim Abbruch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accrueCatchUp,
  cancelUpgrade,
  catchUpBonus,
  catchUpCurve,
  emptyCatchUp,
  median,
  refValue,
  settle,
  splitBuildCost,
  startUpgrade,
  startTraining,
  upgradeCost,
  type CatchUpBalance,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const cu = balance.catchUp as CatchUpBalance;

test("Balance: Deckel +50 %, Beginn unter 70 %, voll ab 30 %, Startpaket 15 % ab Tag 8", () => {
  assert.equal(cu.cap, 0.5);
  assert.equal(cu.from, 0.7);
  assert.equal(cu.full, 0.3);
  assert.equal(cu.latePackFromDay, 8);
  assert.equal(cu.latePackShare, 0.15);
});

test("Kurve: linear von 0 (70 %) bis zum Deckel 50 % (≤ 30 %)", () => {
  const at = (r: number) => catchUpCurve(r, cu);
  assert.equal(at(0.7), 0);
  assert.equal(at(0.9), 0);
  assert.ok(approx(at(0.6), 0.125));
  assert.ok(approx(at(0.5), 0.25));
  assert.ok(approx(at(0.4), 0.375));
  assert.ok(approx(at(0.3), 0.5));
  assert.ok(approx(at(0), 0.5), "nie über den Deckel");
});

test("Wegfall ab 70 %, Wiederbeginn erst unter 60 % (Hysterese)", () => {
  assert.deepEqual(catchUpBonus(null, cu, null), { bonus: 0, active: false });
  // Erste Messung unter 70 %: Hilfe beginnt sofort.
  assert.equal(catchUpBonus(0.65, cu, null).active, true);
  const on = { active: true, ratio: 0.5 };
  const off = { active: false, ratio: 0.8 };
  // Konto ohne Messung (nur Startpaket): wie erste Messung.
  assert.equal(catchUpBonus(0.65, cu, { active: false, ratio: null }).active, true);
  assert.equal(catchUpBonus(0.69, cu, on).active, true);
  assert.equal(catchUpBonus(0.7, cu, on).active, false);
  assert.deepEqual(catchUpBonus(0.65, cu, off), { bonus: 0, active: false });
  const back = catchUpBonus(0.55, cu, off);
  assert.equal(back.active, true);
  assert.ok(approx(back.bonus, 0.5 * (0.15 / 0.4)));
});

test("Median: gerade und ungerade Anzahl, leer", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("Zufluss: Bonus × Gebäudeproduktion je Stunde, gedeckelt auf storeHours, höchstens maxCatchUpHours", () => {
  const s = { ...emptyCatchUp(T0), bonus: 0.5 };
  const a = accrueCatchUp(s, 1000, T0 + HOUR, cu);
  assert.ok(approx(a.credit, 500));
  assert.ok(approx(a.earned, 500));
  // Worker stand 10 Stunden: höchstens maxCatchUpHours.
  assert.ok(approx(accrueCatchUp(s, 1000, T0 + 10 * HOUR, cu).credit, 500 * cu.maxCatchUpHours));
  // Höchstbestand erreicht: Zufluss ruht.
  const full = accrueCatchUp({ ...s, credit: 24 * 500 }, 1000, T0 + HOUR, cu);
  assert.equal(full.credit, 24 * 500);
  // Ab stopDay (flowing = false) kein Zufluss.
  assert.equal(accrueCatchUp(s, 1000, T0 + HOUR, cu, false).credit, 0);
});

test("Aufteilung: Gutschrift zuerst, gleicher Anteil jeder Ressource, nie mehr als der Bestand", () => {
  const cost = { stahl: 1000, treibstoff: 200, elektronik: 100, proviant: 0 };
  const total = refValue(cost, balance); // 1000 + 360 + 300 = 1660
  const half = splitBuildCost(cost, total / 2, balance);
  assert.deepEqual(half.fromCredit, { stahl: 500, treibstoff: 100, elektronik: 50 });
  assert.deepEqual(half.fromStock, { stahl: 500, treibstoff: 100, elektronik: 50, proviant: 0 });
  assert.ok(half.used <= total / 2 + 1e-9);
  const all = splitBuildCost(cost, 1e9, balance);
  assert.deepEqual(all.fromStock, { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 });
  assert.ok(approx(all.used, total));
  assert.equal(splitBuildCost(cost, 0, balance).used, 0);
});

test("Ausbau verbraucht die Gutschrift zuerst; der Rest kommt aus dem Lager", () => {
  const cost = upgradeCost("stahlwerk", 0, balance);
  const base = makeBase(balance, { resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 }, catchUp: { ...emptyCatchUp(T0), credit: 100000 } });
  const r = startUpgrade(base, "stahlwerk", T0, balance);
  assert.ok(r.ok);
  assert.ok(approx(r.base.catchUp!.credit, 100000 - refValue(cost, balance)));
  assert.deepEqual(r.order.credit, Object.fromEntries(Object.entries(cost).filter(([, v]) => v > 0)));
  // Ohne Lager und ohne Gutschrift: abgelehnt.
  const poor = makeBase(balance, { resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 } });
  assert.equal(startUpgrade(poor, "stahlwerk", T0, balance).ok, false);
});

test("Gutschrift bezahlt keine Einheiten", () => {
  const base = makeBase(balance, {
    buildings: { kaserne: 1 },
    resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 },
    catchUp: { ...emptyCatchUp(T0), credit: 1e6 },
  });
  const r = startTraining(base, "schuetzen", 1, T0, balance);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "insufficient_resources");
});

test("Abbruch erstattet den Gutschrift-Anteil in die Gutschrift, nicht ins Lager", () => {
  const cost = upgradeCost("stahlwerk", 0, balance);
  const base = makeBase(balance, { resources: { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 }, catchUp: { ...emptyCatchUp(T0), credit: 5000 } });
  const up = startUpgrade(base, "stahlwerk", T0, balance);
  assert.ok(up.ok);
  // Zweiter Auftrag wartet: voller Abbruch.
  const up2 = startUpgrade(up.base, "stahlwerk", T0, balance);
  assert.ok(up2.ok);
  const c = cancelUpgrade(up2.base, T0, balance, 1);
  assert.ok(c.ok);
  assert.ok(approx(c.creditRefund, refValue(upgradeCost("stahlwerk", 1, balance), balance)));
  assert.deepEqual(Object.values(c.refund).filter((v) => v > 0), [], "nichts ins Lager");
  assert.ok(approx(c.base.catchUp!.credit, 5000 - refValue(cost, balance)));
  const stahl = settle(up2.base, T0, balance).resources.stahl;
  assert.equal(c.base.resources.stahl, stahl);
});

test("Konto übersteht das Fortschreiben (settle) und zählt nicht zum Lager", () => {
  const base = makeBase(balance, { catchUp: { ...emptyCatchUp(T0), credit: 1234 } });
  const s = settle(base, T0 + 5 * HOUR, balance);
  assert.equal(s.catchUp?.credit, 1234);
  assert.equal(Object.values(s.resources).includes(1234), false);
});
