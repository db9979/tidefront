// Kampfsimulator wie der Server: Siegregel je Kampfart (settleBattle), Sicht der eigenen Seite, Beute aus Berichten
// (fertige Beute, unbekannt), Phasen, Hinweise nur wenn zutreffend, Wetter aus der Vorhersage, Prüf-Seeds der Plansuche.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combatWeatherOf, composeArmada, forecastCombatWeather, lootByRule, nestDefender, reportSimPreset, resolveBattle, settleBattle,
  simNotConsidered, simulateBattle, smallestWinningRaid, strandTroops, victoryRuleOf, nestWinRate,
  RAID_PLAN_TARGET, type DefenderInput,
} from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const armada = composeArmada(5000, 0, balance).units; // Großflotte: Schnellboote mit Miliz an Bord
const fleet = { korvette: 30, zerstoerer: 12 };

test("Siegregel je Kampfart: Weltereignis, Feld, Konvoi, Blockade „Gegner vernichtet“, sonst Landung", () => {
  for (const k of ["weltereignis", "feld", "konvoi", "blockadekampf"]) assert.equal(victoryRuleOf(k), "vernichtung");
  for (const k of ["ueberfall", "sammelangriff", "kartell"]) assert.equal(victoryRuleOf(k), "landung");
  assert.equal(victoryRuleOf("sammelangriff", { worldEvent: { kind: "grossflotte" } }), "vernichtung");
});

test("settleBattle: gleiche Entscheidung wie strandTroops; resolveBattle allein verlangt Landung", () => {
  const r = resolveBattle({ units: fleet }, { units: armada, defenses: {} }, balance, 4242);
  assert.ok(r.ok);
  const s = settleBattle(r.report, balance, "vernichtung");
  const t = strandTroops(r.report, balance);
  assert.equal(s.report.winner, t.report.winner);
  assert.equal(s.destroyed, t.destroyed);
  assert.equal(r.report.winner, "defender", "ohne Landung kein Sieg nach resolveBattle");
  assert.equal(s.report.winner, "attacker", "Großflotte zerschlagen");
  assert.deepEqual(settleBattle(r.report, balance, "landung").report, r.report);
});

test("Simulator: Großflotte mit Siegregel „vernichtung“ gewinnt (vorher 0 %), Beute je LP aus dem Bericht", () => {
  const before = simulateBattle({ units: fleet }, { units: armada, defenses: {} }, balance);
  const after = simulateBattle({ units: { ...fleet, landungsschiff: 2 } }, { units: armada, defenses: {} }, balance, { rule: "vernichtung", loot: { kind: "jeLp", perHp: { stahl: 0.1 } } });
  assert.ok(before.ok && after.ok);
  assert.equal(before.stats.winRate, 0);
  assert.ok(after.stats.winRate > 0.9, String(after.stats.winRate));
  assert.ok((after.stats.loot.stahl?.avg ?? 0) > 0, "Beute im Laderaum der Landungsschiffe");
});

test("Sicht der eigenen Seite: Verteidiger-Sicht spiegelt Siegchance, Verluste und Restkampfkraft", () => {
  const d = nestDefender(2, balance);
  assert.ok(d.ok);
  const att = { units: { korvette: 4, landungsschiff: 1, schuetzen: 40 } };
  const a = simulateBattle(att, d.defender, balance, { mine: "attacker" });
  const v = simulateBattle(att, d.defender, balance, { mine: "defender" });
  assert.ok(a.ok && v.ok);
  assert.ok(Math.abs(a.stats.winRate + v.stats.winRate - 1) < 1e-9);
  assert.deepEqual(a.stats.ownLost, v.stats.enemyLost);
  assert.ok(v.stats.runsDetail.every((r, i) => r.won === !a.stats.runsDetail[i].won));
  assert.ok(Object.keys(v.stats.ownLost).every((id) => id in d.defender.units || id in d.defender.defenses));
  // Phasen: Seegefecht und Landung erscheinen.
  assert.ok(a.stats.phases.some((p) => p.phase === "seegefecht" && p.fought > 0));
  assert.ok(a.stats.phases.some((p) => p.phase === "landung"));
  const lostHere = a.stats.phases.reduce((s, p) => s + p.lostHere, 0);
  assert.equal(lostHere, a.stats.runs - Math.round(a.stats.winRate * a.stats.runs), "jede Niederlage hat genau eine Entscheidungsphase");
});

test("Beute aus einem Bericht: fertige Beute nicht erneut mit nestLoot (F3); unbekannt ohne Bestand (F4)", () => {
  const loot = { stahl: 300, treibstoff: 200, elektronik: 100, proviant: 0 };
  const def: DefenderInput = { units: {}, defenses: {}, fixedLoot: loot, fixedLootFinal: true };
  const att = { units: { landungsschiff: 2, schuetzen: 20 }, modifiers: { nestLoot: 1.25 } };
  const r = resolveBattle(att, def, balance, 1);
  assert.ok(r.ok && r.report.winner === "attacker");
  assert.equal(r.report.loot.stahl, 300);
  const raw = resolveBattle(att, { ...def, fixedLootFinal: false }, balance, 1);
  assert.ok(raw.ok);
  assert.equal(raw.report.loot.stahl, 375);
  assert.deepEqual(lootByRule(r.report, true, { kind: "unbekannt" }, balance), { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 });
});

test("Bericht → Vorbelegung: Spielerhafen mit Beute (fertig), Weltereignis (Regel, Beute je LP), Kartell-Abwehr ohne Hinweis", () => {
  const harbor = resolveBattle({ units: { korvette: 10, landungsschiff: 3, schuetzen: 120 }, modifiers: { nestLoot: 1.25, loot: 1.1 } }, { units: { schuetzen: 10 }, defenses: {}, resources: { stahl: 5000, treibstoff: 3000, elektronik: 1000, proviant: 2000 }, protectedPerResource: 500 }, balance, 7);
  assert.ok(harbor.ok && harbor.report.winner === "attacker");
  const p = reportSimPreset("ueberfall", "attacker", { battle: harbor.report }, balance, { opponentIsPlayer: true });
  assert.equal(p?.defender.fixedLootFinal, true);
  const replay = resolveBattle(p!.attacker!, p!.defender, balance, 7);
  assert.ok(replay.ok);
  assert.deepEqual(replay.report.loot, harbor.report.loot, "gleicher Seed, gleiche Beute");

  const ev = resolveBattle({ units: fleet }, { units: armada, defenses: {} }, balance, 9);
  assert.ok(ev.ok);
  const settled = settleBattle(ev.report, balance, "vernichtung").report;
  const w = reportSimPreset("weltereignis", "attacker", { battle: { ...settled, loot: { stahl: 3000, treibstoff: 0, elektronik: 500, proviant: 0 } }, worldEvent: { kind: "grossflotte", destroyed: true, destroyedHp: 5000 } }, balance);
  assert.equal(w?.rule, "vernichtung");
  assert.equal(w?.loot.kind, "jeLp");
  const sim = simulateBattle(w!.attacker!, w!.defender, balance, { rule: w!.rule, loot: w!.loot });
  assert.ok(sim.ok && sim.stats.winRate > 0.9);

  // Kartell-Abwehr (Leser verteidigt, Kartell verliert ohne Beute): kein Beute-Hinweis, kein Hinweis auf Modifikatoren des Kartells.
  const raid = resolveBattle({ units: { schnellboot: 4, piratenmiliz: 20 }, troopSpaceBonus: { schnellboot: 5 }, unlimitedCargo: true }, { units: { korvette: 4, schuetzen: 60 }, defenses: {}, resources: { stahl: 4000 }, protectedPerResource: 100 }, balance, 3);
  assert.ok(raid.ok && raid.report.winner === "defender");
  const { setup: _s, ...old } = raid.report;
  const k = reportSimPreset("kartell", "defender", { battle: old }, balance);
  assert.ok(k && !k.notes.some((n) => n.includes("Angreifers nicht gespeichert")), JSON.stringify(k?.notes));
  const k2 = reportSimPreset("kartell", "defender", { battle: raid.report }, balance);
  assert.ok(k2 && !k2.notes.some((n) => n.includes("Beute")), JSON.stringify(k2?.notes));
  assert.equal(k2?.ownStockNeeded, true);
});

test("Hinweis „Nicht berücksichtigt“ nur, wenn zutreffend", () => {
  const nest = nestDefender(1, balance);
  assert.ok(nest.ok);
  const weather = combatWeatherOf({ wind: 0.2, clouds: 0.5 }, balance.weather!);
  assert.deepEqual(simNotConsidered({ units: {} }, nest.defender, weather), []);
  assert.deepEqual(simNotConsidered({ units: {} }, nest.defender, undefined), ["Wetter am Kampfort"]);
  const harbor = { units: {}, defenses: {}, resources: { stahl: 100 } };
  assert.equal(simNotConsidered({ units: {} }, harbor, weather).length, 2);
  assert.deepEqual(simNotConsidered({ units: {}, priorAttacksInWindow: 0, weakTarget: false }, harbor, weather), []);
});

test("Wetter aus der Vorhersage: Mitte der Spanne; ohne Vorlauf das tatsächliche Wetter", () => {
  const wb = balance.weather!;
  const now = Date.UTC(2026, 3, 1, 12);
  const w = forecastCombatWeather({ lat: 40, lon: 5 }, now + 6 * 3600000, now, wb);
  assert.ok(w.air > 0 && w.air <= 1 && w.strike > 0 && w.strike <= 1);
  const c = combatWeatherOf({ wind: 0.1, clouds: 1 }, wb);
  assert.ok(Math.abs(c.strike - (1 - wb.cloudStrikePenalty)) < 1e-9);
});

test("Plansuche hält gegen andere Seeds: gemeldete Siegchance aus den Prüf-Seeds ≥ Ziel", () => {
  const full = { korvette: 20, zerstoerer: 6, landungsschiff: 8, schuetzen: 300, pioniere: 20 };
  for (const level of [2, 3]) {
    const p = smallestWinningRaid(full, level, balance);
    assert.ok(p.enough);
    assert.ok((p.winRate ?? 0) >= RAID_PLAN_TARGET, `Stufe ${level}: ${p.winRate}`);
    const other = nestWinRate(p.units, level, balance, { runs: 300, seedOffset: 77777 }) ?? 0;
    assert.ok(other >= RAID_PLAN_TARGET - 0.04, `Stufe ${level} gegen fremde Seeds: ${other}`);
  }
});
