import { test } from "node:test";
import assert from "node:assert/strict";
import { assetValue, creditsPerUnit, STRONG_DEVIATION_PCT, tradeValue } from "../src/market/index.ts";

const prices = { stahl: 2, elektronik: 8 };

test("Börsenwert: Ressourcen zum Kurs, Taler 1:1, unbekannt ergibt null", () => {
  assert.equal(assetValue("stahl", 100, prices), 200);
  assert.equal(assetValue("credits", 55.5, prices), 55.5);
  assert.equal(assetValue("proviant", 10, prices), null);
});

test("Tauschwert aus Sicht des Lesers mit Differenz und Prozent", () => {
  const v = tradeValue("stahl", 620, "credits", 1180, prices)!;
  assert.equal(v.give, 1240);
  assert.equal(v.get, 1180);
  assert.equal(v.diff, -60);
  assert.ok(Math.abs(v.pct - -4.8387) < 1e-3);
  assert.equal(v.strong, false);
  const gut = tradeValue("credits", 100, "elektronik", 20, prices)!;
  assert.ok(Math.abs(gut.pct - 60) < 1e-9);
  assert.equal(gut.strong, true);
  // Grenze: genau 20 % ist noch nicht deutlich.
  assert.equal(tradeValue("credits", 100, "credits", 100 - STRONG_DEVIATION_PCT, {})!.strong, false);
  assert.equal(tradeValue("stahl", 0, "credits", 5, prices), null);
  assert.equal(tradeValue("proviant", 1, "credits", 5, prices), null);
});

test("Taler je Einheit aus einem Tauschverhältnis", () => {
  assert.equal(creditsPerUnit(100, "credits", 250, prices), 2.5);
  assert.equal(creditsPerUnit(400, "elektronik", 100, prices), 2);
  assert.equal(creditsPerUnit(0, "credits", 5, prices), null);
});
