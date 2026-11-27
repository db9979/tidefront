// Bericht → Kampfsimulator: Kampfbedingungen im Bericht (setup) und Umwandlung in eine Vorbelegung, auch für alte Berichte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { battleSetup, combatModifiers, nestDefender, reportSimPreset, resolveBattle, splitForces } from "../src/index.ts";
import type { AttackerInput, DefenderInput } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const weather = { air: 0.8, strike: 0.9, wind: 0.5, clouds: 0.6, storm: false };

function battle(attacker: AttackerInput, defender: DefenderInput) {
  const r = resolveBattle(attacker, defender, balance, 4711, weather);
  assert.ok(r.ok);
  return r.report;
}

test("combatModifiers: nur kampfwirksame, nicht neutrale Werte", () => {
  assert.equal(combatModifiers(undefined), undefined);
  assert.equal(combatModifiers({ buildTime: 0.9, fuel: 0.8 }), undefined);
  assert.deepEqual(combatModifiers({ attack: { see: 1.1, luft: 1 }, hp: { land: 1.05 }, cargo: 1.2, storage: 2 }), { attack: { see: 1.1 }, hp: { land: 1.05 }, cargo: 1.2 });
});

test("resolveBattle legt die Kampfbedingungen ab (setup)", () => {
  const d = nestDefender(2, balance);
  assert.ok(d.ok);
  const rep = battle({ units: { korvette: 6, landungsschiff: 2, schuetzen: 30 }, versorgungsmangel: true, modifiers: { attack: { see: 1.2 }, fuel: 0.9 } }, d.defender);
  assert.deepEqual(rep.setup?.attacker, { versorgungsmangel: true, modifiers: { attack: { see: 1.2 } } });
  assert.deepEqual(rep.setup?.defender.fixedLoot, d.defender.fixedLoot);
  const base = battleSetup({ units: {} }, { units: {}, defenses: {}, resources: { stahl: 5 }, protectedPerResource: 100 });
  assert.deepEqual(base.defender, { protectedPerResource: 100, shareLoot: true });
});

test("Neuer Kampfbericht: Verbände vor dem Kampf, Anlagen, Wetter, Modifikatoren, Kriegsglück", () => {
  const rep = battle(
    { units: { korvette: 8, zerstoerer: 2 }, modifiers: { attack: { see: 1.15 } } },
    { units: { korvette: 3 }, defenses: Object.fromEntries([[Object.keys(balance.defenses)[0], 4]]), modifiers: { hp: { see: 1.1 } }, resources: { stahl: 1000 }, protectedPerResource: 200 },
  );
  const phases = rep.phases.map((p) => (p.luck ? { ...p, luckFactor: { attacker: 1.1, defender: 0.9 } } : p));
  const data = { battle: { ...rep, phases }, attackerName: "Ich", defenderName: "Du" };
  const p = reportSimPreset("ueberfall", "attacker", data, balance);
  assert.ok(p && p.attacker);
  assert.equal(p.source, "kampf");
  assert.deepEqual(p.attacker.units, { korvette: 8, zerstoerer: 2 });
  assert.deepEqual(p.attacker.modifiers, { attack: { see: 1.15 } });
  assert.deepEqual(p.defender.units, { korvette: 3 });
  assert.equal(Object.values(p.defender.defenses)[0], 4);
  assert.deepEqual(p.defender.modifiers, { hp: { see: 1.1 } });
  assert.equal(p.defender.protectedPerResource, 200);
  assert.deepEqual(p.weather, weather);
  if (phases.some((x) => "luckFactor" in x)) assert.deepEqual(p.luck, { attacker: 1.1, defender: 0.9 });
  assert.ok(p.notes.some((n) => n.includes("tatsächlichen Beute")));
  // Gegner ist ein Spieler: seine Forschung bleibt unbekannt.
  const hidden = reportSimPreset("ueberfall", "attacker", data, balance, { opponentIsPlayer: true });
  assert.equal(hidden?.defender.modifiers, undefined);
  assert.ok(hidden?.notes.some((n) => n.includes("unbekannt – mit 0 gerechnet")));
  // Verteidiger-Sicht: Angreifer ist Spieler → dessen Modifikatoren fallen weg, eigene bleiben.
  const def = reportSimPreset("ueberfall", "defender", data, balance, { opponentIsPlayer: true });
  assert.equal(def?.mine, "defender");
  assert.equal(def?.attacker?.modifiers, undefined);
  assert.deepEqual(def?.defender.modifiers, { hp: { see: 1.1 } });
});

test("Alter Bericht ohne setup: Angreifer aus data.attacker, Verteidiger neutral, Hinweise", () => {
  const rep = battle({ units: { korvette: 5 } }, { units: { korvette: 2 }, defenses: {} });
  const { setup: _drop, weather: _w, ...old } = rep;
  const data = { battle: old, attacker: { units: { korvette: 5 }, versorgungsmangel: true, modifiers: { attack: { see: 1.3 } } }, protectedPerResource: 150 };
  const p = reportSimPreset("ueberfall", "attacker", data, balance);
  assert.ok(p && p.attacker);
  assert.equal(p.attacker.versorgungsmangel, true);
  assert.deepEqual(p.attacker.modifiers, { attack: { see: 1.3 } });
  assert.equal(p.defender.modifiers, undefined);
  assert.equal(p.defender.protectedPerResource, 150);
  assert.equal(p.weather, undefined);
  assert.ok(p.notes.some((n) => n.startsWith("Älterer Bericht")));
  assert.ok(p.notes.some((n) => n.includes("Wetter nicht gespeichert")));
  // Ganz alt: ohne data.attacker.
  const bare = reportSimPreset("kartell", "defender", { battle: old }, balance);
  assert.ok(bare?.notes.some((n) => n.includes("Angreifers nicht gespeichert")));
});

test("Aufklärung: Nest-Besatzung bzw. Lagebild als Verteidiger, Angreifer offen; Sichtung ohne Kampf → null", () => {
  const nest = reportSimPreset("aufklaerung", "attacker", { nest: { level: 3, empty: false, garrison: { units: { schnellboot: 4 }, defenses: { kuestenbatterie: 1 }, loot: { stahl: 500 } } } }, balance);
  assert.equal(nest?.source, "aufklaerung");
  assert.equal(nest?.attacker, null);
  assert.deepEqual(nest?.defender.fixedLoot, { stahl: 500 });
  assert.equal(reportSimPreset("aufklaerung", "attacker", { nest: { level: 3, empty: true, garrison: null } }, balance), null);
  const base = reportSimPreset("aufklaerung", "attacker", { scout: { units: { korvette: 2 }, defenses: {}, resources: { stahl: 900 }, protectedPerResource: 300, uncertain: { fog: 0.4, heavy: false } }, targetName: "Hafen X" }, balance);
  assert.deepEqual(base?.defender.resources, { stahl: 900 });
  assert.equal(base?.names[1], "Hafen X");
  assert.ok(base?.notes.some((n) => n.includes("unsicher")));
  assert.equal(reportSimPreset("sichtung", "attacker", { sighting: { units: { korvette: 1 } } }, balance), null);
  assert.equal(reportSimPreset("spionage", "attacker", { battle: { attacker: { before: { spion: 1 } } } }, balance), null);
});

test("splitForces trennt Einheiten und Anlagen", () => {
  const def = Object.keys(balance.defenses)[0];
  assert.deepEqual(splitForces({ korvette: 2, [def]: 3, x: 0 }, balance), { units: { korvette: 2 }, defenses: { [def]: 3 } });
});
