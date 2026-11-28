// Balance v1.35 (Welle 3 der Abschlussprüfung 0.38): reine Regeln – Kolonien (Gebühr, Unterhalt), Saisonfinale
// (U-Jagd nur der Armada, KI × botKFactor, gewöhnliche Ereignisse bis 37,5), Aufholhilfe (Mindestzufluss), Börsenkonvoi
// (Chance nach Warenwert der letzten Stunden). Werte aus der Balance gelesen, keine festen Versionsnummern.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accrueCatchUp, catchUpOf, composeRaid, emptyCatchUp, expectedCartelGroup, finaleBalance, finaleBattleBalance, finaleOrdinaryUntil,
  finaleSchedule, finaleSumK, foundingFee, productionRates, resolveBattle, type Balance,
} from "../src/index.ts";
import { DAY, HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("Kolonien: Gründungsgebühr ab dem 3. Hafen (3. Hafen doppelt so teuer wie der 2.)", () => {
  const ship = balance.units[balance.expansion!.colonyShip].cost ?? {};
  assert.deepEqual(foundingFee(2, balance), {});
  const g = balance.expansion!.colonyCostGrowth!;
  assert.ok(g >= 2);
  for (const [r, v] of Object.entries(ship)) if (v > 0) assert.equal(foundingFee(3, balance)[r], Math.ceil(v * (g - 1)));
  assert.deepEqual(foundingFee(3, { ...balance, expansion: { ...balance.expansion!, colonyCostGrowth: undefined } } as Balance), {});
});

test("Kolonien: Unterhalt je Tag nur in Kolonien, je Ressource höchstens die Gebäudeproduktion", () => {
  const up = balance.expansion!.colonyUpkeepPerDay!;
  const built = makeBase(balance, { buildings: { stahlwerk: 10, raffinerie: 10, kraftwerk: 10 } });
  const home = productionRates(built, balance);
  const colony = productionRates({ ...built, colony: { foundedAtMs: T0 } }, balance);
  for (const [r, v] of Object.entries(up)) {
    const expected = Math.min(v / 24, home.buildingPerHour[r] ?? 0);
    assert.ok(Math.abs(home.perHour[r] - colony.perHour[r] - expected) < 1e-6, `${r}: ${home.perHour[r] - colony.perHour[r]} statt ${expected}`);
  }
  // Neue Kolonie ohne Gebäude: kein Unterhalt (gerät nie ins Minus).
  const bare = makeBase(balance);
  assert.deepEqual(productionRates({ ...bare, colony: { foundedAtMs: T0 } }, balance).perHour, productionRates(bare, balance).perHour);
});

test("Saisonfinale: nur die Armada hat U-Jagd; Kartell-Überfälle bleiben ohne", () => {
  const f = finaleBalance(balance)!;
  assert.ok((f.squadronUJagd ?? 0) > 0);
  const b = finaleBattleBalance(balance);
  assert.equal(b.npcUnits.schnellboot.attack.uboot, f.squadronUJagd);
  assert.equal(balance.npcUnits.schnellboot.attack.uboot ?? 0, 0, "Balance selbst unverändert");
  const sector = { units: { schnellboot: 60, piratenmiliz: 480 }, defenses: {} };
  let lostArmada = 0, lostNormal = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const a = resolveBattle({ units: { uboot: 20 } }, sector, b, seed);
    const n = resolveBattle({ units: { uboot: 20 } }, sector, balance, seed);
    assert.ok(a.ok && n.ok);
    lostArmada += a.report.attacker.losses.uboot ?? 0;
    lostNormal += n.report.attacker.losses.uboot ?? 0;
  }
  assert.equal(lostNormal, 0, "ohne U-Jagd verlustfrei (sim/armada.ts)");
  assert.ok(lostArmada > 0, "gegen die Armada sinken U-Boote");
  // Ein Kartell-Überfall nutzt weiter die Balance ohne U-Jagd.
  assert.equal(composeRaid({ uboot: 4 }, {}, balance).units.uboot, undefined);
});

test("Saisonfinale: KI zählt × botKFactor zur Stärke, gewöhnliche Ereignisse bis ordinaryEventsUntilDays", () => {
  const f = finaleBalance(balance)!;
  const bf = f.botKFactor ?? 1;
  assert.equal(finaleSumK([{ k: 1000, bot: false }, { k: 1000, bot: true }], balance), 1000 + 1000 * bf);
  const start = T0, end = T0 + 42 * DAY;
  const until = finaleOrdinaryUntil(start, end, balance);
  const sch = finaleSchedule(start, end, balance);
  assert.ok(until > sch.announceMs && until <= sch.appearMs);
  assert.equal(until, start + (f.ordinaryEventsUntilDays ?? f.announceAfterDays) * DAY);
});

test("Aufholhilfe: Mindestzufluss je Stunde, solange ein Bonus läuft", () => {
  const cu = catchUpOf(balance)!;
  const s = { ...emptyCatchUp(T0), bonus: 0.25, active: true, ratio: 0.5 };
  const low = accrueCatchUp(s, 10, T0 + HOUR, cu, true, 100);
  assert.ok(Math.abs(low.credit - 100) < 1e-6, "Mindestzufluss statt 0,25 × 10");
  const high = accrueCatchUp(s, 1000, T0 + HOUR, cu, true, 100);
  assert.ok(Math.abs(high.credit - 250) < 1e-6, "eigene Produktion, wenn größer");
  assert.equal(accrueCatchUp({ ...s, bonus: 0 }, 10, T0 + HOUR, cu, true, 100).credit, 0, "ohne Bonus kein Mindestzufluss");
});

test("Börsenkonvoi: Chance nach dem Warenwert der letzten Stunden, Verband nach der eigenen Ladung", () => {
  const one = expectedCartelGroup(5000, 180, balance, true);
  const agg = expectedCartelGroup(5000, 180, balance, true, 45000);
  assert.ok(agg.chance > one.chance);
  assert.deepEqual(agg.force, one.force, "Kartellverband hängt an der eigenen Ladung");
  assert.ok(agg.lossUnescorted > one.lossUnescorted);
});
