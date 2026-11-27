// See: Empfohlenes Geleit je Frachtwert (escort-advice.ts, escort-search.ts; ENTSCHEIDUNGEN-5.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cartelChance, cartelConvoyForce, convoysOf, escortCapable, escortCost, escortTradeoff, expectedCartelGroup, probeEscort, recommendEscort,
  resolveBattle, settleBattle, simSeed, victoryRuleOf, ESCORT_TARGET, type Counts,
} from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const c = convoysOf(balance)!;
const trip = { km: 300, awayHours: 4 };
const fleet: Counts = { korvette: 10, zerstoerer: 5, uboot: 3, minenraeumer: 2 };

test("Erwartete Kartellgruppe: wie der Server (Schnellboote nach Warenwert, Grenzen), Chance und Verlust ohne Geleit", () => {
  for (const value of [500, 1000, 5000, 10000, 15000, 100000]) {
    const t = expectedCartelGroup(value, 180, balance, true);
    assert.deepEqual(t.force, cartelConvoyForce(value, balance));
    assert.equal(t.chance, cartelChance(180, value, balance, true));
    assert.ok(Math.abs(t.lossUnescorted - t.chance * c.lossShareUnescorted * value) < 1e-9);
    assert.ok(Math.abs(t.lossIfBeaten - c.lossShareEscortBeaten * value) < 1e-9);
  }
  assert.equal(expectedCartelGroup(1000, 180, balance).force.schnellboot, c.cartelMinBoats);
  assert.equal(expectedCartelGroup(10000, 180, balance).force.schnellboot, Math.round(10 * c.cartelBoatsPer1000Value));
  assert.equal(expectedCartelGroup(1e6, 180, balance).force.schnellboot, c.cartelMaxBoats);
  // Mehr Wert, mehr Boote (bis zur Grenze).
  const boats = [1000, 4000, 8000, 12000, 20000].map((v) => expectedCartelGroup(v, 180, balance).force.schnellboot);
  for (let i = 1; i < boats.length; i++) assert.ok(boats[i] >= boats[i - 1]);
  // Unter der Mindeststrecke: keine Chance, keine Empfehlung.
  const near = recommendEscort({ value: 20000, riskKm: c.cartelMinDistanceKm - 1, market: false, trip, home: fleet }, balance);
  assert.equal(near.status, "none");
  assert.equal(near.threat.chance, 0);
});

test("Probekampf: gleiche Siegregel wie der Server (settleBattle, victoryRuleOf(konvoi))", () => {
  const force = cartelConvoyForce(10000, balance);
  const escort = { korvette: 3 };
  const p = probeEscort(escort, force, balance, { runs: 50 })!;
  let held = 0;
  for (let i = 0; i < 50; i++) {
    const r = resolveBattle({ units: force }, { units: escort, defenses: {} }, balance, simSeed(i));
    assert.ok(r.ok);
    if (!settleBattle(r.report, balance, victoryRuleOf("konvoi")).destroyed) held++;
  }
  assert.equal(p.winRate, held / 50);
});

test("Empfehlung hält ≥ 90 % gegen die erwartete Gruppe – auch mit Prüf-Seeds, die die Suche nicht kannte", () => {
  for (const value of [1000, 4000, 8000, 12000, 30000]) {
    const a = recommendEscort({ value, riskKm: 180, market: true, trip, home: fleet }, balance);
    assert.equal(a.status, "ok", `Wert ${value}`);
    assert.ok(a.winRate! >= ESCORT_TARGET);
    for (const [id, n] of Object.entries(a.units)) assert.ok(n <= (fleet[id] ?? 0), "nur aus dem Bestand");
    // Weitere frische Seeds (anderer Block): hält im Rahmen der Streuung.
    const fresh = probeEscort(a.units, a.threat.force, balance, { runs: 300, seedOffset: 50000 })!;
    assert.ok(fresh.winRate >= ESCORT_TARGET - 0.05, `Wert ${value}: ${fresh.winRate}`);
  }
});

test("Günstigste Mischung: keine Teilmenge des Bestands (je Typ allein oder einzeln verkleinert) ist billiger und hält", () => {
  const value = 10000;
  const a = recommendEscort({ value, riskKm: 180, market: true, trip, home: fleet }, balance);
  assert.equal(a.status, "ok");
  const cost = (u: Counts) => escortCost(u, trip, a.threat, balance, undefined, probeEscort(u, a.threat.force, balance)).total;
  const best = a.tradeoff!.cost.total;
  // Je Typ allein, jede Anzahl: was hält, ist nicht billiger (Kosten mit Such-Seeds).
  for (const [id, max] of Object.entries(fleet)) for (let n = 1; n <= max; n++) {
    const u = { [id]: n };
    if ((probeEscort(u, a.threat.force, balance)?.winRate ?? 0) >= ESCORT_TARGET) assert.ok(cost(u) >= best - 1e-6 || probeEscort(u, a.threat.force, balance, { runs: 200, seedOffset: 20000 })!.winRate < ESCORT_TARGET, `${id} ${n}`);
  }
  // Ein Schiff weniger hält nicht mehr (oder wäre nicht billiger).
  for (const id of Object.keys(a.units)) {
    const u = { ...a.units, [id]: a.units[id] - 1 };
    if (Object.values(u).every((n) => n <= 0)) continue;
    assert.ok((probeEscort(u, a.threat.force, balance, { runs: 200, seedOffset: 20000 })?.winRate ?? 0) < ESCORT_TARGET || cost(u) >= best);
  }
  // Nur Korvetten daheim: die kleinste Zahl, die hält.
  const k = recommendEscort({ value, riskKm: 180, market: true, trip, home: { korvette: 20 } }, balance);
  assert.equal(k.status, "ok");
  const n = k.units.korvette;
  assert.ok((probeEscort({ korvette: n - 1 }, k.threat.force, balance)?.winRate ?? 0) < ESCORT_TARGET);
});

test("Bestand reicht nicht: ehrlich short, Siegchance des ganzen Bestands und was fehlt", () => {
  const a = recommendEscort({ value: 15000, riskKm: 180, market: true, trip, home: { korvette: 2 } }, balance);
  assert.equal(a.status, "short");
  assert.deepEqual(a.units, { korvette: 2 });
  assert.ok(a.winRate! < ESCORT_TARGET);
  assert.ok(a.missing.length > 0);
  for (const m of a.missing) {
    const more = { korvette: 2, [m.unit]: (m.unit === "korvette" ? 2 : 0) + m.extra };
    assert.ok(probeEscort(more, a.threat.force, balance)!.winRate >= ESCORT_TARGET, JSON.stringify(m));
  }
  const none = recommendEscort({ value: 15000, riskKm: 180, market: true, trip, home: { schuetzen: 50 } }, balance);
  assert.equal(none.status, "no_ships");
  // Kommandopunkte: der ganze Bestand gewönne, darf aber nicht auslaufen.
  const cp = recommendEscort({ value: 15000, riskKm: 180, market: true, trip, home: { korvette: 10 }, commandPoints: 3 }, balance);
  assert.equal(cp.status, "short");
  assert.equal(cp.commandPointsShort, true);
  // Treibstoff knapp: Hinweis.
  const fuel = recommendEscort({ value: 15000, riskKm: 180, market: true, trip, home: fleet, fuelAvailable: 0 }, balance);
  assert.equal(fuel.status, "ok");
  assert.equal(fuel.fuelShort, true);
});

test("Abwägung: erwarteter Verlust ohne Geleit gegen Kosten – kleine Fracht lohnt nicht, große lohnt", () => {
  const small = recommendEscort({ value: 1000, riskKm: 180, market: true, trip, home: fleet }, balance);
  assert.equal(small.tradeoff!.worth, false);
  assert.ok(small.tradeoff!.lossUnescorted < small.tradeoff!.cost.total);
  const big = recommendEscort({ value: 40000, riskKm: 180, market: true, trip, home: fleet }, balance);
  assert.equal(big.tradeoff!.worth, true);
  // Rechnung: Chance × Anteil × Wert; mit Geleit nur der Teil, in dem es unterliegt.
  const t = expectedCartelGroup(20000, 400, balance);
  const cost = escortCost({ korvette: 4 }, trip, t, balance);
  assert.equal(cost.fuel, Math.ceil(4 * (balance.units.korvette.fuelPer100Km ?? 0) * 3 * 2));
  assert.equal(cost.upkeep, 4 * (balance.units.korvette.upkeepPerHour ?? 0) * 4);
  const off = escortTradeoff(t, 0.95, cost);
  assert.ok(Math.abs(off.lossEscorted - t.chance * 0.05 * c.lossShareEscortBeaten * 20000) < 1e-9);
  assert.ok(Math.abs(off.saving - (t.lossUnescorted - off.lossEscorted)) < 1e-9);
  assert.equal(off.worth, off.saving > cost.total);
});

test("Hotfix TST-01: U-Boote sind kein empfohlenes Geleit; reines U-Boot-Geleit hält nie", () => {
  assert.equal(escortCapable("uboot", balance), false);
  for (const value of [1000, 8000, 30000]) {
    const a = recommendEscort({ value, riskKm: 180, market: true, trip, home: fleet }, balance);
    assert.equal(a.units?.uboot ?? 0, 0, `Wert ${value}: kein U-Boot in der Empfehlung`);
    const onlySubs = recommendEscort({ value, riskKm: 180, market: true, trip, home: { uboot: 40 } }, balance);
    assert.notEqual(onlySubs.status, "ok", `Wert ${value}: nur U-Boote daheim, keine Empfehlung`);
    const p = probeEscort({ uboot: 10 }, cartelConvoyForce(value, balance), balance, { runs: 30 })!;
    assert.equal(p.winRate, 0, "U-Boote halten den Konvoi nicht");
  }
});
