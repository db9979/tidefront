// Balance v1.38 (Welle 5 der Abschlussprüfung 0.38): Elektrolyse-Rat (M-06), Kostenmischung mit mehr Proviant (AN-04),
// Verträge bleiben ohne Geldmaschine (M-08, geprüft in market-contracts.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { electrolysisAdvice, ELECTROLYSIS_GOOD_DAYS, upgradeCost, type AdviceHour } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const HOUR = 3_600_000;
const curve = (fuel: number, wasted: number, n = 24): AdviceHour[] => Array.from({ length: n }, (_, i) => ({ atMs: i * HOUR, surplus: { fuel }, greenWasted: wasted }));

test("Elektrolyse-Rat: ohne Überschuss nichts, mit viel Überschuss lohnend, die Stufe nimmt höchstens ihre Leistung", () => {
  const def = balance.buildings.elektrolyse;
  const none = electrolysisAdvice(curve(0, 0), 0, balance)!;
  assert.equal(none.extraFuelPerDay, 0);
  assert.equal(none.paybackDays, null);
  assert.equal(none.worth, false);
  // Überschuss weit über der Stufenleistung: Stufe 1 nimmt genau electrolysisPerLevel je Stunde.
  const rich = electrolysisAdvice(curve(0, 10_000), 0, balance)!;
  assert.ok(Math.abs(rich.extraFuelPerDay - (def.electrolysisPerLevel! / def.electrolysisRatio!) * 24) < 1e-9);
  assert.ok(rich.worth, `Amortisation ${rich.paybackDays} Tage`);
  // Stufe 3 → 4: der Teil, den Stufe 3 schon nimmt, zählt nicht doppelt.
  const used = def.electrolysisPerLevel! * 3;
  const step = electrolysisAdvice(curve(used, 10_000), 3, balance)!;
  assert.ok(Math.abs(step.extraFuelPerDay - (def.electrolysisPerLevel! / def.electrolysisRatio!) * 24) < 1e-9);
  // Wenig verfallender Ökostrom (2 Strom je Stunde): weit über der Lohngrenze.
  const thin = electrolysisAdvice(curve(0, 2), 0, balance)!;
  assert.ok(thin.paybackDays! > ELECTROLYSIS_GOOD_DAYS && !thin.worth);
  const cost = upgradeCost("elektrolyse", 0, balance);
  assert.ok(Math.abs(thin.costValue - Object.entries(cost).reduce((a, [r, n]) => a + n * balance.market.refPrice[r], 0)) < 1e-9);
});

test("Kostenmischung v1.38: mehr Proviant, weniger Elektronik als bis v1.37 (wertgleich)", () => {
  const to = balance.building.costShift!.to;
  const w = Object.values(to).reduce((a, x) => a + x, 0);
  assert.ok((to.proviant ?? 0) / w > 0.25, "Proviant über 25 % (Proviant läuft im Saisonlauf über)");
  assert.ok((to.elektronik ?? 0) / w < 0.75, "Elektronik unter 75 %");
  const old = { ...balance, building: { ...balance.building, costShift: { ...balance.building.costShift!, to: { elektronik: 0.75, proviant: 0.25 } } } };
  const p = balance.market.refPrice;
  const val = (c: Record<string, number>) => Object.entries(c).reduce((s, [r, n]) => s + n * p[r], 0);
  const a = upgradeCost("stahlwerk", 8, balance), b = upgradeCost("stahlwerk", 8, old);
  assert.ok(a.proviant > b.proviant && a.elektronik < b.elektronik && a.stahl === b.stahl);
  assert.ok(Math.abs(val(a) - val(b)) <= 4, "wertgleich bis auf Rundung");
});
