// Planen vom Ziel her (UX-0.43 U-2): kleinster siegreicher Verband aus dem Bestand (≥ 90 % gegen frische Würfe),
// sonst, was fehlt, sonst ehrlich „nicht erreichbar“.
import { test } from "node:test";
import assert from "node:assert/strict";
import { combatUnitIds, nestDefenders, PLAN_SUGGEST_TARGET, simulateBattle, suggestPlan, troopsFit, type Counts } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const allowed = combatUnitIds(balance).filter((id) => id !== "uboot" && id !== "minenleger");
const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

test("Bestand reicht: Vorschlag ist eine echte Teilmenge und hält ≥ 90 % gegen fremde Würfe", () => {
  const have = { korvette: 8, landungsschiff: 3, schuetzen: 150 };
  const defenders = nestDefenders(1, balance, "range");
  const s = suggestPlan({ attacker: {}, defenders, have, allowed, commandPoints: 400 }, balance);
  assert.equal(s.status, "bestand");
  assert.deepEqual(s.extra, {});
  assert.ok(s.winRate >= PLAN_SUGGEST_TARGET, String(s.winRate));
  for (const [id, n] of Object.entries(s.units)) assert.ok(n <= (have as Counts)[id], `${id}: ${n} aus dem Bestand`);
  assert.ok(total(s.units) < total(have), `kleiner als der ganze Bestand: ${JSON.stringify(s.units)}`);
  assert.ok(troopsFit(s.units, balance));
  const other = simulateBattle({ units: s.units }, defenders, balance, { runs: 400, seedOffset: 70000 });
  assert.ok(other.ok && other.stats.winRate >= 0.86, `fremde Würfe: ${other.ok && other.stats.winRate}`);
});

test("Neulingspfad: der Auftragsverband (30 Schützen, 2 Korvetten, 1 Landungsschiff) reicht gegen Nest 1", () => {
  const s = suggestPlan({ attacker: {}, defenders: nestDefenders(1, balance, "range"), have: { schuetzen: 30, korvette: 2, landungsschiff: 1 }, allowed, commandPoints: 400 }, balance);
  assert.equal(s.status, "bestand", JSON.stringify(s));
});

test("Bestand reicht nicht: nennt, was fehlt; nichts ausbildbar: nicht erreichbar", () => {
  const defenders = nestDefenders(2, balance, "range");
  const s = suggestPlan({ attacker: {}, defenders, have: { schuetzen: 5 }, allowed, commandPoints: 400 }, balance);
  assert.equal(s.status, "fehlt");
  assert.ok(total(s.extra) > 0, JSON.stringify(s.extra));
  assert.ok(Object.values(s.extraCost).some((v) => v > 0));
  const none = suggestPlan({ attacker: {}, defenders, have: { schuetzen: 5 }, allowed: [], commandPoints: 400 }, balance);
  assert.equal(none.status, "unerreichbar");
});
