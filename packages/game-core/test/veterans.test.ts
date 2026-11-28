import { test } from "node:test";
import assert from "node:assert/strict";
import type { BattleReport, TrainingOrder } from "../src/index.ts";
import {
  applyAttackExperience,
  applyDefenseResult,
  battleVeterancy,
  combineModifiers,
  completeTraining,
  diluteXp,
  nextXp,
  resolveBattle,
  returnMission,
  strengthRatio,
  veteranModifiers,
  veteranRank,
  xpPerSurvivor,
} from "../src/index.ts";
import { T0, approx, loadBalance, loadBalanceNoLuck, makeBase } from "./helpers.ts";

const balance = loadBalance();
const cfg = balance.veterans!;

test("Rang aus Erfahrung: Rekrut, Erprobt (+5 %), Veteran (+10 %), Elite (+15 %)", () => {
  assert.equal(veteranRank(0, balance)?.id, "rekrut");
  assert.equal(veteranRank(14.9, balance)?.id, "rekrut");
  assert.equal(veteranRank(15, balance)?.id, "erprobt");
  assert.equal(veteranRank(40, balance)?.id, "veteran");
  assert.equal(veteranRank(80, balance)?.id, "elite");
  assert.equal(veteranRank(100, balance)?.attackBonus, 0.15);
  const { veterans: _v, ...noVet } = balance;
  assert.equal(veteranRank(50, noVet), null);
});

test("Modifikatoren: attackUnit nur für Typen mit Rang über Rekrut", () => {
  const m = veteranModifiers({ korvette: 20, schuetzen: 45, zerstoerer: 5, kuestenbatterie: 90 }, balance);
  assert.deepEqual(m, { attackUnit: { korvette: 1.05, schuetzen: 1.1 } });
  assert.deepEqual(veteranModifiers(undefined, balance), {});
  // Kombiniert multiplikativ mit Forschung (z. B. Torpedoleitsysteme)
  const c = combineModifiers({ attackUnit: { uboot: 1.16 } }, veteranModifiers({ uboot: 85 }, balance));
  assert.ok(approx(c.attackUnit!.uboot, 1.16 * 1.15));
});

test("Kampfwirkung: Veteranenbonus erhöht genau den Schaden des Typs", () => {
  const exact = loadBalanceNoLuck();
  const def = { units: { landungsschiff: 3 }, defenses: {} };
  const plain = resolveBattle({ units: { uboot: 2, korvette: 2 } }, def, exact, 4);
  const vet = resolveBattle({ units: { uboot: 2, korvette: 2 }, modifiers: veteranModifiers({ uboot: 45 }, exact) }, def, exact, 4);
  assert.ok(plain.ok && vet.ok);
  const amb = (r: typeof plain) => (r.ok ? r.report.phases[2].damage.attacker.uboot : 0);
  assert.ok(approx(amb(vet), amb(plain) * 1.1));
});

test("Erfahrungsgewinn: mehr bei Sieg, mehr gegen stärkere Gegner (begrenzt)", () => {
  assert.equal(xpPerSurvivor(true, 1, cfg), cfg.xpWin);
  assert.equal(xpPerSurvivor(false, 1, cfg), cfg.xpLoss);
  assert.ok(xpPerSurvivor(true, 2, cfg) > xpPerSurvivor(true, 1, cfg));
  // Ganzer Bestand kämpft, keiner fällt, Sieg gegen gleich Starke: +xpWin
  assert.equal(nextXp(0, 10, 0, 10, xpPerSurvivor(true, 1, cfg), cfg), cfg.xpWin);
  // Nur die Hälfte kämpft: Gewinn verteilt sich auf alle (gewichteter Mittelwert)
  assert.equal(nextXp(0, 20, 0, 10, cfg.xpWin, cfg), cfg.xpWin / 2);
  // Obergrenze
  assert.equal(nextXp(99, 10, 0, 10, 50, cfg), cfg.maxXp);
  // Stärkefaktor aus den Lebenspunkten vorher, begrenzt auf [ratioMin, ratioMax]
  const r = { attacker: { before: { korvette: 1 } }, defender: { before: { korvette: 10 } } } as unknown as BattleReport;
  assert.equal(strengthRatio(r, "attacker", balance), cfg.ratioMax);
  assert.equal(strengthRatio(r, "defender", balance), cfg.ratioMin);
});

test("Verluste kosten anteilig Erfahrung", () => {
  // 40 XP, Hälfte des Bestands verloren (10 von 20, 10 bleiben): 40 × (1 − 0,5 × 0,5) = 30
  assert.equal(nextXp(40, 10, 10, 0, 0, cfg), 30);
  // Alles verloren: Bestand 0 -> keine Erfahrung mehr
  assert.equal(nextXp(40, 0, 10, 0, 0, cfg), 0);
});

test("Verwässerung: neue Rekruten senken den Schnitt (gewichteter Mittelwert)", () => {
  assert.equal(diluteXp(30, 10, 10), 15);
  assert.equal(diluteXp(30, 10, 0), 30);
  assert.equal(diluteXp(30, 0, 5), 0);
  // Über completeTraining: 10 daheim + 10 unterwegs mit 40 XP, 20 neue -> 20 XP
  const order: TrainingOrder = { kind: "unit", id: "korvette", count: 20, builtIn: "werft", startedAt: T0, finishesAt: T0 + 1000 };
  const base = makeBase(balance, {
    units: { korvette: 10 },
    unitsAway: { korvette: 10 },
    trainingQueue: [order],
    veterancy: { korvette: 40, schuetzen: 20 },
  });
  const r = completeTraining(base, T0 + 2000, balance);
  assert.ok(r.ok);
  assert.equal(r.base.units.korvette, 30);
  // Teillieferung: je Einheit verwässert – der gewichtete Mittelwert ist derselbe (bis auf Rundung).
  assert.ok(approx(r.base.veterancy!.korvette, 20));
  assert.equal(r.base.veterancy?.schuetzen, 20);
  assert.equal(base.veterancy?.korvette, 40, "Eingabe unverändert");
});

test("Nach dem Kampf: Verteidiger (applyDefenseResult) und Angreifer (nach Rückkehr) sammeln Erfahrung", () => {
  const def = makeBase(balance, { units: { schuetzen: 60 }, defenses: { bunkerlinie: 1 } });
  const att = { units: { landungsschiff: 1, schuetzen: 30 } };
  const res = resolveBattle(att, { units: def.units, defenses: def.defenses }, balance, 3);
  assert.ok(res.ok);
  const rep = res.report;
  assert.equal(rep.winner, "defender");
  const after = applyDefenseResult(def, rep, T0, balance);
  const xpD = after.veterancy?.schuetzen ?? 0;
  assert.ok(xpD > 0, "Verteidiger gewinnt Erfahrung");
  assert.ok(xpD <= cfg.xpWin * cfg.ratioMax);
  assert.equal(after.veterancy?.landungsschiff, undefined);
  // Angreifer: Verband kehrt heim, dann Erfahrung (Niederlage: weniger)
  const home = makeBase(balance, { units: {}, unitsAway: { landungsschiff: 1, schuetzen: 30 } });
  const back = returnMission(home, att.units, rep.attacker.final, {}, T0, balance);
  const withXp = applyAttackExperience(back, rep, balance);
  const xpA = withXp.veterancy?.landungsschiff ?? 0;
  if ((rep.attacker.survivors.landungsschiff ?? 0) > 0) assert.ok(xpA > 0 && xpA <= cfg.xpLoss * cfg.ratioMax);
  // Ohne Balance-Abschnitt: nichts
  const { veterans: _v, ...noVet } = balance;
  assert.equal(battleVeterancy(def, rep, "defender", noVet), def.veterancy);
});
