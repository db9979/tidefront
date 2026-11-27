// Lebendige Nester (docs/VORLAGE-NESTER.md 3, ENTSCHEIDUNGEN-5.md): Wurf und Spanne, Stufe 1 fest, Erholung nach
// gewonnener Abwehr, Beutewachstum, Probekampf über die Spanne.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterDefense, garrisonAt, garrisonFull, liveNestDefender, lootFactorAt, mulberry32, nestGarrison, nestSpan, nestVaries,
  nestWinRange, nestWinRate, rollFactors, rollNest, rolledGarrison, smallestWinningRaid, stateOf, worstRoll, nestDefenders,
} from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const H = 3600000;

test("Wurf: Faktor 80–120 % in 5-%-Schritten, Anlagen −1/0/+1 je vorhandener Art, Stufe 1 fest", () => {
  assert.deepEqual(rollFactors(4, balance), [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]);
  assert.equal(nestVaries(1, balance), false);
  assert.deepEqual(rollFactors(1, balance), [1]);
  const rng = mulberry32(7);
  const seen = new Set<number>();
  const shifts = { "-1": 0, "0": 0, "1": 0 } as Record<string, number>;
  const base = nestGarrison(3, balance);
  assert.ok(base.ok);
  for (let i = 0; i < 4000; i++) {
    const r = rollNest(3, balance, rng);
    seen.add(r.factor);
    for (const [id, n] of Object.entries(base.nest.defenses)) {
      const d = r.defenses[id] - n;
      if (n === 0) assert.equal(r.defenses[id], 0, "fehlende Art bleibt 0");
      else shifts[String(d)]++;
    }
    assert.deepEqual(rollNest(1, balance, rng), { factor: 1, defenses: nestGarrison(1, balance).ok ? (nestGarrison(1, balance) as { nest: { defenses: Record<string, number> } }).nest.defenses : {} });
  }
  assert.equal(seen.size, 9);
  const total = shifts["-1"] + shifts["0"] + shifts["1"];
  assert.ok(Math.abs(shifts["0"] / total - 0.5) < 0.03 && Math.abs(shifts["-1"] / total - 0.25) < 0.03);
});

test("Spanne der Erkennung: Stufe 4 18–26 Schnellboote, 172–258 Miliz; Stufe 1 genau", () => {
  const s4 = nestSpan(4, balance);
  assert.deepEqual(s4.units.schnellboot, [18, 26]);
  assert.deepEqual(s4.units.piratenmiliz, [172, 258]);
  assert.deepEqual(s4.defenses.flakstellung, [1, 3]);
  assert.deepEqual(s4.loot, [1, 1.3]);
  const s1 = nestSpan(1, balance);
  assert.deepEqual(s1.units.schnellboot, [4, 4]);
  assert.deepEqual(s1.defenses.flakstellung, [0, 0]);
  const w = rolledGarrison(4, worstRoll(4, balance), balance);
  assert.equal(w.units.schnellboot, 26);
  assert.equal(w.defenses.kuestenbatterie, 2);
});

test("Erholung: sofort ≥ 70 %, dann +5 %/h bis voll; Anlagen nach 12 h", () => {
  const roll = { factor: 1, defenses: { flakstellung: 2, kuestenbatterie: 1, bunkerlinie: 1 } };
  const full = rolledGarrison(4, roll, balance);
  const st = afterDefense(4, stateOf(roll), { schnellboot: 3, piratenmiliz: 200, flakstellung: 0, kuestenbatterie: 1, bunkerlinie: 0 }, 0, balance);
  const now = garrisonAt(4, st, 0, balance);
  assert.equal(now.units.schnellboot, Math.round(0.7 * full.units.schnellboot), "Verstärkung auf 70 %");
  assert.equal(now.units.piratenmiliz, 200, "mehr als 70 % überlebt: bleibt");
  assert.equal(now.defenses.flakstellung, 0);
  const h2 = garrisonAt(4, st, 2 * H, balance);
  assert.equal(h2.units.schnellboot, Math.round(0.8 * full.units.schnellboot));
  assert.deepEqual(garrisonAt(4, st, 6 * H, balance).units, full.units, "nach 6 h voll");
  assert.equal(garrisonAt(4, st, 11.9 * H, balance).defenses.flakstellung, 0);
  assert.deepEqual(garrisonAt(4, st, 12 * H, balance).defenses, full.defenses, "Anlagen nach 12 h zurück");
  assert.equal(garrisonFull(4, st, 6 * H, balance), false);
  assert.equal(garrisonFull(4, st, 12 * H, balance), true);
});

test("Beute: 100 % bei Besetzung, +1 %/h, Deckel 130 %; Beutemeister wirkt darauf (höchstens 143 %)", () => {
  assert.equal(lootFactorAt(0, 0, balance), 1);
  assert.ok(Math.abs(lootFactorAt(0, 10 * H, balance) - 1.1) < 1e-9);
  assert.equal(lootFactorAt(0, 40 * H, balance), 1.3);
  assert.equal(lootFactorAt(null, 40 * H, balance), 1, "alter Stand ohne Besetzung: 100 %");
  const d = liveNestDefender(3, stateOf(null, 0), 30 * H, balance);
  assert.equal(d.fixedLoot!.stahl, Math.floor(6500 * 1.3));
});

test("Probekampf über die Spanne: ungünstig ≤ Mittel ≤ günstig; Vorschlag im Mittel ≥ 90 %", () => {
  const full = { korvette: 50, zerstoerer: 25, landungsschiff: 16, schuetzen: 480 };
  const r = nestWinRange(full, 3, balance, { runs: 40 })!;
  assert.ok(r.min <= r.mean && r.mean <= r.max, JSON.stringify(r));
  const plan = smallestWinningRaid(full, 3, balance, { defenders: nestDefenders(3, balance, "range") });
  assert.ok(plan.enough);
  assert.ok((nestWinRate(plan.units, 3, balance, { defenders: nestDefenders(3, balance, "range") }) ?? 0) >= 0.9);
  // Stufe 1: Spanne = genau.
  const one = nestWinRange({ landungsschiff: 1, schuetzen: 28 }, 1, balance)!;
  assert.equal(one.min, one.max);
});
