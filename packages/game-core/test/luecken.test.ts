// Lücken Felder/See: Aufteilung der Geleitabteilung auf gleichzeitige Ertragskonvois, Ladungsverlust von
// Handelskonvois in Minenfeldern, eigener Würfelstrom der Rückfahrt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convoyMineLoss, mineReturnSeed, mineSeed, minesOf, splitEscort } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();

const sum = (m: Map<number, Record<string, number>>, id: string) => [...m.values()].reduce((s, c) => s + (c[id] ?? 0), 0);

test("Geleit aufteilen: anteilig nach Warenwert, jedes Schiff genau einmal", () => {
  const s = splitEscort({ korvette: 4, zerstoerer: 1 }, [{ id: 7, value: 300 }, { id: 5, value: 100 }]);
  assert.deepEqual(s.get(7), { korvette: 3, zerstoerer: 1 });
  assert.deepEqual(s.get(5), { korvette: 1 });
  assert.equal(sum(s, "korvette"), 4);
  assert.equal(sum(s, "zerstoerer"), 1);
});

test("Geleit aufteilen: ein Konvoi erhält alles, Gleichstand geht an den älteren", () => {
  assert.deepEqual(splitEscort({ korvette: 3 }, [{ id: 1, value: 50 }]).get(1), { korvette: 3 });
  const tie = splitEscort({ korvette: 1 }, [{ id: 9, value: 100 }, { id: 4, value: 100 }]);
  assert.deepEqual(tie.get(4), { korvette: 1 });
  assert.deepEqual(tie.get(9), {});
  const zero = splitEscort({ korvette: 2 }, [{ id: 2, value: 0 }, { id: 3, value: 0 }]);
  assert.deepEqual([zero.get(2), zero.get(3)], [{ korvette: 1 }, { korvette: 1 }]);
  assert.equal(splitEscort({ korvette: 2 }, []).size, 0);
});

test("Geleit aufteilen: viele Konvois, Summe bleibt erhalten", () => {
  const convoys = [1, 2, 3, 4, 5].map((id) => ({ id, value: id * 137 }));
  const s = splitEscort({ korvette: 7, zerstoerer: 3, uboot: 0 }, convoys);
  assert.equal(sum(s, "korvette"), 7);
  assert.equal(sum(s, "zerstoerer"), 3);
  assert.equal(sum(s, "uboot"), 0);
});

test("Minen: Handelskonvoi verliert Ladung nach Feldstärke, Räumer im Geleit schützen", () => {
  const m = minesOf(balance)!;
  const k = m.cargoLossFactor ?? 0;
  assert.ok(k > 0);
  const full = convoyMineLoss(150, {}, balance);
  assert.ok(Math.abs(full.share - Math.min(m.maxLossShare, 150 * m.lossPerStrength) * k) < 1e-9);
  assert.equal(full.consumed, m.strengthPerHit);
  const weak = convoyMineLoss(25, {}, balance);
  assert.ok(weak.share < full.share);
  const swept = convoyMineLoss(150, { minenraeumer: 1, korvette: 1 }, balance);
  assert.ok(swept.share < full.share);
  assert.deepEqual(convoyMineLoss(0, {}, balance), { share: 0, consumed: 0 });
  const off = { ...balance, mines: { ...m, cargoLossFactor: undefined } } as typeof balance;
  assert.equal(convoyMineLoss(150, {}, off).share, 0);
});

test("Minen: Rückfahrt würfelt mit eigenem Seed", () => {
  assert.notEqual(mineReturnSeed(12, 3), mineSeed(12, 3));
  assert.equal(mineReturnSeed(12, 3), mineReturnSeed(12, 3));
});
