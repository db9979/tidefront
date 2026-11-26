import { test } from "node:test";
import assert from "node:assert/strict";
import type { AttackerInput, DefenderInput } from "../src/index.ts";
import { PHASE_NAMES, luckFactor, luckLabel, luckMean, resolveBattle } from "../src/index.ts";
import { approx, loadBalance, loadBalanceNoLuck } from "./helpers.ts";

const balance = loadBalance();
const plain = loadBalanceNoLuck();
const luck = balance.combat.luck!;

test("Würfel: 1 = Panne −20 %, 20 = Volltreffer +20 %, dazwischen linear −15 % … +15 %", () => {
  assert.equal(luck.die, 20);
  assert.equal(luckFactor(1, luck), 0.8);
  assert.equal(luckFactor(20, luck), 1.2);
  assert.ok(approx(luckFactor(2, luck), 0.85, 1e-12));
  assert.ok(approx(luckFactor(19, luck), 1.15, 1e-12));
  for (let r = 2; r <= 20; r++) assert.ok(luckFactor(r, luck) > luckFactor(r - 1, luck), `steigend bei ${r}`);
  // Gleiche Abstände zwischen 2 und 19
  const step = luckFactor(3, luck) - luckFactor(2, luck);
  for (let r = 3; r <= 19; r++) assert.ok(approx(luckFactor(r, luck) - luckFactor(r - 1, luck), step, 1e-12));
  assert.equal(luckLabel(1, luck), "panne");
  assert.equal(luckLabel(20, luck), "volltreffer");
  assert.equal(luckLabel(10, luck), null);
});

test("Würfel: im Mittel neutral (Erwartungswert exakt 1, Paare k und 21−k ergeben 2)", () => {
  assert.ok(approx(luckMean(luck), 1, 1e-12));
  for (let k = 1; k <= 10; k++) assert.ok(approx(luckFactor(k, luck) + luckFactor(21 - k, luck), 2, 1e-12));
  // Auch für andere Würfel, solange min + max = 2 und innerMin + innerMax = 2
  assert.ok(approx(luckMean({ die: 6, min: 0.7, max: 1.3, innerMin: 0.9, innerMax: 1.1 }), 1, 1e-12));
  // Empirisch über viele Kämpfe: Durchschnitt der Würfe nahe 10,5
  let sum = 0;
  let n = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = resolveBattle({ units: { korvette: 1 } }, { units: {}, defenses: {} }, balance, seed);
    assert.ok(r.ok);
    for (const p of r.report.phases) {
      sum += p.luck!.attacker + p.luck!.defender;
      n += 2;
    }
  }
  assert.ok(Math.abs(sum / n - 10.5) < 0.3, `Mittel ${sum / n}`);
});

test("Bericht: Würfe je Phase und Seite (1–20), deterministisch aus dem Seed", () => {
  const att: AttackerInput = { units: { korvette: 4, landungsschiff: 1, schuetzen: 60 } };
  const def: DefenderInput = { units: { schuetzen: 30, korvette: 2 }, defenses: { bunkerlinie: 1 } };
  const a = resolveBattle(att, def, balance, 77);
  const b = resolveBattle(att, def, balance, 77);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.report, b.report);
  assert.deepEqual(a.report.phases.map((p) => p.phase), [...PHASE_NAMES]);
  for (const p of a.report.phases) {
    assert.ok(p.luck, `${p.phase} hat Würfe`);
    for (const v of [p.luck.attacker, p.luck.defender]) assert.ok(Number.isInteger(v) && v >= 1 && v <= 20);
  }
  // Über viele Seeds kommen Panne und Volltreffer vor
  const seen = new Set<number>();
  for (let seed = 1; seed <= 100; seed++) {
    const r = resolveBattle(att, def, balance, seed);
    assert.ok(r.ok);
    for (const p of r.report.phases) seen.add(p.luck!.attacker);
  }
  assert.ok(seen.has(1) && seen.has(20));
});

test("Würfelfaktor wirkt auf den Schaden der Seite in der Phase; Rundenzufall unverändert", () => {
  // U-Boot-Angriff: eine Salve, keine Gegenwehr -> Schaden mit Würfel = Schaden ohne Würfel × Faktor
  for (const seed of [1, 2, 3, 4, 5, 11, 12]) {
    const att: AttackerInput = { units: { uboot: 2 } };
    const def: DefenderInput = { units: { landungsschiff: 3 }, defenses: {} };
    const withLuck = resolveBattle(att, def, balance, seed);
    const without = resolveBattle(att, def, plain, seed);
    assert.ok(withLuck.ok && without.ok);
    const p = withLuck.report.phases[2];
    const q = without.report.phases[2];
    assert.equal(p.phase, "ubootangriff");
    assert.ok(approx(p.damage.attacker.uboot, q.damage.attacker.uboot * luckFactor(p.luck!.attacker, luck), 1e-9));
  }
  // Minen (Schaden des Verteidigers in der Landung) mal Würfel des Verteidigers
  const mined = resolveBattle({ units: { landungsschiff: 1, schuetzen: 50 } }, { units: {}, defenses: { minensperre: 1 } }, balance, 9);
  assert.ok(mined.ok);
  const land = mined.report.phases[4];
  assert.ok(approx(land.damage.defender.minensperre, 300 * luckFactor(land.luck!.defender, luck), 1e-9));
});

test("ohne combat.luck: keine Würfe im Bericht (alte Berichte und Balance bleiben lesbar)", () => {
  const r = resolveBattle({ units: { korvette: 3 } }, { units: { schnellboot: 3 }, defenses: {} }, plain, 5);
  assert.ok(r.ok);
  for (const p of r.report.phases) assert.equal(p.luck, undefined);
});
