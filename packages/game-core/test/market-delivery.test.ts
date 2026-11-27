// Feste Lieferzeit der Börse (market.deliveryHours): Ankunft und Kartellstrecke unabhängig von der Entfernung.
// Entscheidung „Feste Lieferzeit für Börsenlieferungen“ (ENTSCHEIDUNGEN-5.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cartelExpectedLoss, market } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const M = (balance as unknown as market.MarketBalance).market;
const HOUR = 3_600_000;

test("Börsenlieferung: feste Fahrzeit und Kartellstrecke, egal wie weit der Handelshafen ist", () => {
  assert.ok(M.deliveryHours && M.deliveryHours > 0, "deliveryHours gesetzt");
  for (const km of [0, 40, 180, 900, 2500]) {
    assert.equal(market.deliveryTravelMs(M, km), M.deliveryHours! * HOUR);
    assert.equal(market.deliveryRiskKm(M, km), M.deliveryHours! * M.convoySpeedKmh);
  }
});

test("ohne deliveryHours: alte Regel nach Seeweg", () => {
  const old = { convoySpeedKmh: 45 };
  assert.equal(market.deliveryTravelMs(old, 90), 2 * HOUR);
  assert.equal(market.deliveryRiskKm(old, 90), 90);
});

test("erwarteter Kartellverlust ohne Geleit bleibt klein (≤ 2 % bis Warenwert 20.000, Obergrenze 2,4 %)", () => {
  const km = market.deliveryRiskKm(M, 1234);
  assert.ok(cartelExpectedLoss(km, 5000, balance, true) < 0.01);
  assert.ok(cartelExpectedLoss(km, 20000, balance, true) <= 0.02);
  assert.ok(cartelExpectedLoss(km, 1e7, balance, true) <= 0.025);
  assert.ok(cartelExpectedLoss(km, 1000, balance, true) > 0, "nie risikofrei");
});
