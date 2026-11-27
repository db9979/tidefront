// „Was fehlt zum Sieg?“ (searchWinningForce): günstiger als naives Hochskalieren, hält die Sicherheit gegen fremde
// Seeds, beachtet Truppenplatz, Kommandopunkte und ausbildbare Arten, sagt ehrlich „nicht erreichbar“.
import { test } from "node:test";
import assert from "node:assert/strict";
import { combatUnitIds, nestDefenders, simulateBattle, searchWinningForce, troopsFit, unitRefValue, type Counts } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const allowed = combatUnitIds(balance).filter((id) => id !== "uboot" && id !== "minenleger");
const cp = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + (balance.units[id].commandPoints ?? 0) * n, 0);
const extraValue = (c: Counts, have: Counts) => Object.entries(c).reduce((s, [id, n]) => s + unitRefValue(id, balance) * Math.max(0, n - (have[id] ?? 0)), 0);

/** Naiv: den Bestand gleichmäßig hochskalieren (mit genug Landungsschiffen), bis er gegen die Prüf-Seeds hält. */
function naive(have: Counts, level: number, target: number): Counts {
  for (let f = 1; f < 40; f += 0.25) {
    const c: Counts = Object.fromEntries(Object.entries(have).map(([id, n]) => [id, Math.ceil(n * f)]));
    let need = 0;
    for (const [id, n] of Object.entries(c)) if (balance.units[id].branch === "land") need += n * (balance.units[id].size ?? 1);
    c.landungsschiff = Math.max(c.landungsschiff ?? 0, Math.ceil(need / (balance.units.landungsschiff.troopSpace ?? 100)));
    const s = simulateBattle({ units: c }, nestDefenders(level, balance, "mid"), balance, { runs: 300, seedOffset: 20000 });
    if (s.ok && s.stats.winRate >= target) return c;
  }
  throw new Error("naiv nicht erreichbar");
}

test("findet eine günstigere Lösung als naives Hochskalieren und hält gegen fremde Seeds", () => {
  for (const [level, have] of [[3, { korvette: 4, landungsschiff: 1, schuetzen: 40 }], [4, { korvette: 6, zerstoerer: 2, landungsschiff: 2, schuetzen: 80, jagdbomber: 2 }]] as const) {
    const r = searchWinningForce({ attacker: {}, defenders: nestDefenders(level, balance, "mid"), have: { ...have }, allowed, commandPoints: 400, target: 0.9 }, balance);
    assert.ok(r.reachable, `Stufe ${level}: ${r.reason}`);
    assert.ok(r.winRate >= 0.9);
    const n = naive({ ...have }, level, 0.9);
    assert.ok(r.extraValue < extraValue(n, have), `Stufe ${level}: Suche ${r.extraValue} gegen naiv ${extraValue(n, have)}`);
    // Fremde Seeds (weder Suche noch Prüfung): die Sicherheit hält (kleine Streuung erlaubt).
    const other = simulateBattle({ units: r.units }, nestDefenders(level, balance, "mid"), balance, { runs: 400, seedOffset: 90000 });
    assert.ok(other.ok && other.stats.winRate >= 0.86, `Stufe ${level}: ${other.ok && other.stats.winRate}`);
    assert.ok(troopsFit(r.units, balance), "Truppen passen auf die Landungsschiffe");
    for (const [id, n] of Object.entries(r.extra)) assert.equal(r.units[id] - ((have as Counts)[id] ?? 0), n);
    assert.ok(r.trainSeconds > 0 && r.losses && r.lootValue > 0);
  }
});

test("Bestand zuerst: reicht der Bestand, ist nichts auszubilden", () => {
  const have = { korvette: 10, landungsschiff: 3, schuetzen: 200, pioniere: 10 };
  const r = searchWinningForce({ attacker: {}, defenders: nestDefenders(1, balance, "mid"), have, allowed, commandPoints: 400, target: 0.9 }, balance);
  assert.ok(r.reachable);
  assert.deepEqual(r.extra, {});
  assert.equal(r.extraValue, 0);
  for (const [id, n] of Object.entries(r.units)) assert.ok(n <= (have as Counts)[id], `${id} nur aus dem Bestand`);
});

test("Grenzen: Kommandopunkte und ausbildbare Arten; sonst ehrlich nicht erreichbar", () => {
  const defs = nestDefenders(3, balance, "mid");
  const limited = searchWinningForce({ attacker: {}, defenders: defs, have: {}, allowed, commandPoints: 60, target: 0.9 }, balance);
  assert.ok(cp(limited.units) <= 60 + 1e-9, `KP ${cp(limited.units)}`);
  const tiny = searchWinningForce({ attacker: {}, defenders: defs, have: {}, allowed, commandPoints: 8, target: 0.9 }, balance);
  assert.equal(tiny.reachable, false);
  assert.equal(tiny.reason, "command_points");
  // Nur Schiffe ausbildbar (keine Kaserne): ohne Truppen keine Landung, kein Sieg.
  const ships = searchWinningForce({ attacker: {}, defenders: defs, have: {}, allowed: ["korvette", "zerstoerer"], commandPoints: 400, target: 0.7 }, balance);
  assert.equal(ships.reachable, false);
  for (const id of Object.keys(ships.extra)) assert.ok(["korvette", "zerstoerer"].includes(id));
  // Stellplätze: keine neuen Flugzeuge über die freien Plätze.
  const air = searchWinningForce({ attacker: {}, defenders: defs, have: {}, allowed, maxExtraAir: 0, commandPoints: 400, target: 0.9 }, balance);
  assert.ok(Object.keys(air.extra).every((id) => balance.units[id].branch !== "luft"));
});

test("Spanne (lebendige Nester ohne Lagebild): Mittel über die Würfe ≥ Ziel", () => {
  const defs = nestDefenders(2, balance, "range");
  const r = searchWinningForce({ attacker: {}, defenders: defs, have: { korvette: 3, landungsschiff: 1, schuetzen: 30 }, allowed, commandPoints: 400, target: 0.7 }, balance);
  assert.ok(r.reachable);
  const check = simulateBattle({ units: r.units }, defs, balance, { runs: 300, seedOffset: 20000 });
  assert.ok(check.ok && Math.abs(check.stats.winRate - r.winRate) < 1e-9);
});
