import { test } from "node:test";
import assert from "node:assert/strict";
import type { BattleReport } from "../src/index.ts";
import {
  ADMIRAL_NAMES,
  activeSpecs,
  admiralFate,
  admiralFateRoll,
  admiralModifiers,
  admiralRank,
  admiralSlots,
  admiralXpGain,
  combineModifiers,
  fuelCost,
  pickAdmiralName,
  resolveBattle,
  sideLossShare,
} from "../src/index.ts";
import { approx, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const cfg = balance.admirals!;

test("Plätze: 1 + 1 je 5 Stufen Hafenkommandantur, höchstens 3", () => {
  assert.equal(admiralSlots(0, balance), 1);
  assert.equal(admiralSlots(4, balance), 1);
  assert.equal(admiralSlots(5, balance), 2);
  assert.equal(admiralSlots(10, balance), 3);
  assert.equal(admiralSlots(30, balance), 3);
});

test("Ränge: Kapitän zur See → Konteradmiral → Vizeadmiral → Admiral", () => {
  assert.equal(admiralRank(0, balance).def.name, "Kapitän zur See");
  assert.equal(admiralRank(99, balance).index, 1);
  assert.equal(admiralRank(100, balance).def.name, "Konteradmiral");
  assert.equal(admiralRank(300, balance).def.name, "Vizeadmiral");
  assert.equal(admiralRank(5000, balance).def.name, "Admiral");
});

test("Zweite Spezialisierung wirkt erst ab Rang 3", () => {
  assert.deepEqual(activeSpecs(["angriff", "verteidigung"], 150, balance), ["angriff"]);
  assert.deepEqual(activeSpecs(["angriff", "verteidigung"], 300, balance), ["angriff", "verteidigung"]);
  assert.deepEqual(activeSpecs(["unbekannt", null], 900, balance), []);
});

test("Modifikatoren skalieren mit dem Rang; Rolle bestimmt die Werte", () => {
  const low = admiralModifiers(["angriff"], 0, "mission", balance);
  const full = admiralModifiers(["angriff"], 700, "mission", balance);
  assert.ok(approx(low.attack!.see!, 1 + cfg.specs.angriff.mission!["attack.see"] * cfg.ranks[0].factor));
  assert.ok(approx(full.attack!.see!, 1 + cfg.specs.angriff.mission!["attack.see"]));
  assert.equal(full.attack!.anlage, undefined);
  assert.ok(approx(admiralModifiers(["angriff"], 700, "defense", balance).attack!.anlage!, 1 + cfg.specs.angriff.defense!["attack.anlage"]));
  // Logistik senkt den Treibstoff
  const log = admiralModifiers(["logistik"], 700, "mission", balance);
  assert.ok(approx(log.fuel!, 0.85));
  assert.ok(fuelCost({ korvette: 10 }, 500, balance, log) < fuelCost({ korvette: 10 }, 500, balance));
  // Aufklärung: daheim Radar, auf Mission Tarnung
  assert.ok(approx(admiralModifiers(["aufklaerung"], 700, "harbor", balance).radarWarning!, 1.25));
  assert.ok(approx(admiralModifiers(["aufklaerung"], 700, "mission", balance).stealth!, 0.75));
});

test("Voll ausgebildet (Admiral, Angriff + Verteidigung) bleibt im Rahmen von +10–20 % Kampfwert", () => {
  const m = admiralModifiers(["angriff", "verteidigung"], 700, "mission", balance);
  const value = m.attack!.see! * m.hp!.see!;
  assert.ok(value >= 1.1 && value <= 1.2, `Kampfwert-Faktor ${value}`);
});

function battle(attacker: Record<string, number>, defender: Record<string, number>, seed: number): BattleReport {
  const r = resolveBattle({ units: attacker }, { units: defender, defenses: {} }, balance, seed);
  if (!r.ok) throw new Error(r.code);
  return r.report;
}

test("Erfahrung nur bei Sieg, abhängig vom besiegten Wert, begrenzt", () => {
  // Ohne Landung gewinnt der Verteidiger; sein Admiral erhält Erfahrung, der des Angreifers nicht.
  const win = battle({ korvette: 3 }, { zerstoerer: 10 }, 7);
  assert.equal(win.winner, "defender");
  const gain = admiralXpGain(win, "defender", balance);
  assert.ok(gain >= cfg.xp.minWin && gain <= cfg.xp.maxPerBattle);
  assert.equal(admiralXpGain(win, "attacker", balance), 0);
  const bigger = battle({ korvette: 12 }, { zerstoerer: 30 }, 7);
  assert.ok(admiralXpGain(bigger, "defender", balance) > gain);
});

test("Schicksal: nur bei deutlicher Niederlage gewürfelt, deterministisch aus dem Seed", () => {
  const lost = battle({ korvette: 3 }, { zerstoerer: 12 }, 11);
  assert.equal(lost.winner, "defender");
  assert.ok(sideLossShare(lost, "attacker", balance) > cfg.risk.lossShare);
  const f1 = admiralFate(lost, "attacker", 11, balance);
  const f2 = admiralFate(lost, "attacker", 11, balance);
  assert.deepEqual(f1, f2);
  assert.ok(f1.roll !== null && f1.roll >= 1 && f1.roll <= 20);
  assert.equal(admiralFate(lost, "defender", 11, balance).roll, null);
  // Verteilung über viele Seeds: alle Ausgänge kommen vor, „gefallen“ selten (1 von 20).
  const seen = new Map<string, number>();
  for (let s = 1; s <= 2000; s++) {
    const roll = admiralFateRoll(s, "attacker", 20);
    const fate = roll <= cfg.risk.fallenMax ? "gefallen" : roll <= cfg.risk.capturedMax ? "gefangen" : roll <= cfg.risk.woundedMax ? "verwundet" : "unversehrt";
    seen.set(fate, (seen.get(fate) ?? 0) + 1);
  }
  assert.equal(seen.size, 4);
  assert.ok((seen.get("gefallen") ?? 0) < 200);
});

test("Namen: aus der Liste, frei gewählt, deterministisch", () => {
  const n = pickAdmiralName(42, []);
  assert.ok(ADMIRAL_NAMES.includes(n));
  assert.equal(pickAdmiralName(42, []), n);
  assert.notEqual(pickAdmiralName(42, [n]), n);
});

test("Kombination mit Forschung multiplikativ", () => {
  const m = combineModifiers({ attack: { see: 1.1 } }, admiralModifiers(["angriff"], 700, "mission", balance));
  assert.ok(approx(m.attack!.see!, 1.1 * (1 + cfg.specs.angriff.mission!["attack.see"])));
});
