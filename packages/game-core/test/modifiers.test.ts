import { test } from "node:test";
import assert from "node:assert/strict";
import type { Modifiers } from "../src/index.ts";
import {
  NEUTRAL_MODIFIERS,
  bunkerProtection,
  combineModifiers,
  computeLoot,
  fuelCost,
  isModPath,
  planMission,
  productionRates,
  radarWarningMinutes,
  resolveBattle,
  settle,
  startTraining,
  startUpgrade,
  storageCapacity,
  trainingSecondsPerUnit,
  travelSeconds,
  upgradeSeconds,
  warningMinutesAgainst,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, loadBalanceNoLuck, makeBase } from "./helpers.ts";

const balance = loadBalance();

test("combineModifiers: multiplikativ je Schlüssel, Quellen bleiben unverändert", () => {
  const a: Modifiers = { fuel: 0.9, attack: { see: 1.1 }, production: { stahl: 1.2 } };
  const b: Modifiers = { fuel: 0.9, attack: { see: 1.1, land: 1.05 } };
  const c = combineModifiers(a, b, undefined, null);
  assert.ok(approx(c.fuel!, 0.81));
  assert.ok(approx(c.attack!.see!, 1.21));
  assert.equal(c.attack!.land, 1.05);
  assert.equal(c.production!.stahl, 1.2);
  assert.equal(a.fuel, 0.9);
  assert.equal(a.attack!.see, 1.1);
  assert.deepEqual(combineModifiers(), {});
  assert.ok(isModPath("production.stahl") && isModPath("fuel") && !isModPath("fuel.x") && !isModPath("attack") && !isModPath("bogus"));
});

test("neutrale Modifikatoren ändern nichts (bit-gleich)", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 5, kraftwerk: 4, lagerkomplex: 3, tiefbunker: 2, radarstation: 2, werft: 2 } });
  assert.deepEqual(productionRates(base, balance, NEUTRAL_MODIFIERS), productionRates(base, balance));
  assert.deepEqual(settle(base, T0 + 7 * HOUR, balance, {}), settle(base, T0 + 7 * HOUR, balance));
  assert.equal(storageCapacity(base, balance, {}), storageCapacity(base, balance));
  assert.equal(upgradeSeconds("stahlwerk", 4, balance, {}), upgradeSeconds("stahlwerk", 4, balance));
  const units = { korvette: 3, landungsschiff: 1, schuetzen: 50 };
  assert.equal(fuelCost(units, 333, balance, {}), fuelCost(units, 333, balance));
  const a = { units: { korvette: 5, landungsschiff: 2, schuetzen: 120, pioniere: 20 } };
  const d = { units: { schuetzen: 40 }, defenses: { minensperre: 2, bunkerlinie: 1 }, resources: { stahl: 9000 }, protectedPerResource: 300 };
  for (let seed = 1; seed < 20; seed++) {
    assert.deepEqual(resolveBattle({ ...a, modifiers: {} }, { ...d, modifiers: {} }, balance, seed), resolveBattle(a, d, balance, seed));
  }
});

test("Wirtschaft: Produktion, Lager, Bunker, Bauzeit, Ausbildung", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 3, kraftwerk: 3, lagerkomplex: 2, tiefbunker: 1, kaserne: 2 } });
  const plain = productionRates(base, balance);
  const boosted = productionRates(base, balance, { production: { stahl: 1.2 } });
  assert.ok(approx(boosted.buildingPerHour.stahl, plain.buildingPerHour.stahl * 1.2));
  assert.equal(boosted.buildingPerHour.treibstoff, plain.buildingPerHour.treibstoff);
  // Die Grundrate bleibt unverändert.
  assert.ok(approx(boosted.perHour.stahl - plain.perHour.stahl, plain.buildingPerHour.stahl * 0.2));
  assert.ok(approx(storageCapacity(base, balance, { storage: 1.1 }), storageCapacity(base, balance) * 1.1));
  assert.ok(approx(bunkerProtection(base, balance, { bunker: 1.24 }), bunkerProtection(base, balance) * 1.24));
  assert.ok(approx(upgradeSeconds("werft", 3, balance, { buildTime: 0.8 }), upgradeSeconds("werft", 3, balance) * 0.8));
  const fast = startUpgrade(base, "werft", T0, balance, { buildTime: 0.5 });
  const slow = startUpgrade(base, "werft", T0, balance);
  assert.ok(fast.ok && slow.ok);
  assert.equal(fast.order.finishesAt - T0, Math.ceil((slow.order.finishesAt - T0) / 2));
  assert.ok(approx(trainingSecondsPerUnit("schuetzen", 2, balance, { trainingTime: { kaserne: 0.9 } }), trainingSecondsPerUnit("schuetzen", 2, balance) * 0.9));
  const t = startTraining(base, "schuetzen", 10, T0, balance, { trainingTime: { kaserne: 0.5, werft: 0.1 } });
  assert.ok(t.ok);
  assert.equal(t.order.finishesAt - T0, Math.ceil(trainingSecondsPerUnit("schuetzen", 2, balance) * 0.5 * 10 * 1000));
  // Mehr Produktion schlägt sich in settle nieder.
  const later = settle(base, T0 + 10 * HOUR, balance, { production: { stahl: 1.2 } });
  const ref = settle(base, T0 + 10 * HOUR, balance);
  assert.ok(later.resources.stahl > ref.resources.stahl);
});

test("Reise: Tempo je Gattung, Treibstoff, Ladung", () => {
  const units = { korvette: 2, landungsschiff: 1 };
  assert.ok(approx(travelSeconds(units, 400, balance, { speed: { see: 1.25 } })!, travelSeconds(units, 400, balance)! / 1.25));
  // Tempo der Luftfahrt wirkt nicht auf Schiffe.
  assert.equal(travelSeconds(units, 400, balance, { speed: { luft: 2 } }), travelSeconds(units, 400, balance));
  assert.equal(fuelCost(units, 400, balance, { fuel: 0.76 }), Math.ceil(fuelCost(units, 400, balance) * 0.76 - 1e-9) );
  const base = makeBase(balance, { buildings: { hafenkommandantur: 1 }, units: { landungsschiff: 1, korvette: 1 }, resources: { stahl: 9000, treibstoff: 9000 } });
  const input = { type: "transport", units: { landungsschiff: 1 }, origin: { lat: 54, lon: 10 }, target: { lat: 54, lon: 12 }, activeMissions: 0, cargo: { stahl: 4300 } };
  assert.equal(planMission(base, input, T0, balance).ok, false);
  assert.ok(planMission(base, input, T0, balance, { cargo: 1.08 }).ok);
});

test("Radar, Tarnung, Beute-Anteil", () => {
  // v1.6: Das Radar braucht Strom (Kraftwerk).
  const base = makeBase(balance, { buildings: { radarstation: 2, kraftwerk: 1 } });
  assert.equal(radarWarningMinutes(base, balance, { radarWarning: 1.2 }), 24);
  assert.equal(warningMinutesAgainst(24, { stealth: 0.8 }), 24 * 0.8);
  assert.equal(warningMinutesAgainst(24), 24);
  const def = { resources: { stahl: 10300, treibstoff: 300 }, protectedPerResource: 300 };
  assert.equal(computeLoot(def, 99999, 0, balance).stahl, 3000);
  assert.equal(computeLoot(def, 99999, 0, balance, false, { loot: 1.2 }).stahl, 3600);
  // Feste Nestbeute bleibt unverändert.
  assert.deepEqual(computeLoot({ fixedLoot: { stahl: 500 } }, 99999, 0, balance, false, { loot: 2 }).stahl, 500);
});

test("Kampf: Modifikatoren wirken je Seite getrennt", () => {
  const a = { units: { korvette: 6 } };
  const d = { units: { korvette: 6 }, defenses: {} };
  const seeds = 60;
  let plainLossA = 0;
  let hpLossA = 0;
  let atkLossD = 0;
  let plainLossD = 0;
  for (let s = 1; s <= seeds; s++) {
    const p = resolveBattle(a, d, balance, s);
    const hp = resolveBattle({ ...a, modifiers: { hp: { see: 1.5 } } }, d, balance, s);
    const atk = resolveBattle({ ...a, modifiers: { attack: { see: 1.5 } } }, d, balance, s);
    assert.ok(p.ok && hp.ok && atk.ok);
    plainLossA += p.report.attacker.losses.korvette;
    plainLossD += p.report.defender.losses.korvette;
    hpLossA += hp.report.attacker.losses.korvette;
    atkLossD += atk.report.defender.losses.korvette;
    // Die Lebenspunkte des Verteidigers bleiben unberührt: gleicher Schaden kostet ihn gleich viele Schiffe je Treffer.
    assert.equal(hp.report.defender.before.korvette, 6);
  }
  assert.ok(hpLossA < plainLossA, "mehr Lebenspunkte: weniger Verluste");
  assert.ok(atkLossD > plainLossD, "mehr Angriff: mehr gegnerische Verluste");
});

test("Kampf: U-Jagd, Einheitentyp, Minenschaden", () => {
  const sub = resolveBattle({ units: { korvette: 4 } }, { units: { uboot: 6 }, defenses: {} }, balance, 3);
  const subMod = resolveBattle({ units: { korvette: 4 }, modifiers: { attackVs: { uboot: 1.2 } } }, { units: { uboot: 6 }, defenses: {} }, balance, 3);
  assert.ok(sub.ok && subMod.ok);
  const dmg = (r: typeof sub) => (r.ok ? r.report.phases[3].damage.attacker.korvette ?? 0 : 0);
  assert.ok(approx(dmg(subMod), dmg(sub) * 1.2, 1e-6));
  const torp = resolveBattle({ units: { uboot: 2 }, modifiers: { attackUnit: { uboot: 1.24, korvette: 9 } } }, { units: { landungsschiff: 3 }, defenses: {} }, balance, 5);
  const torpPlain = resolveBattle({ units: { uboot: 2 } }, { units: { landungsschiff: 3 }, defenses: {} }, balance, 5);
  assert.ok(torp.ok && torpPlain.ok);
  assert.ok(approx(torp.report.phases[2].damage.attacker.uboot, torpPlain.report.phases[2].damage.attacker.uboot * 1.24));
  const land = { units: { landungsschiff: 1, schuetzen: 50 } };
  const mined = { units: {}, defenses: { minensperre: 1 } };
  // Minenschaden exakt nachgerechnet: ohne Kriegsglück (sonst mal Würfelfaktor des Verteidigers).
  const exact = loadBalanceNoLuck();
  const m1 = resolveBattle(land, mined, exact, 1);
  const m2 = resolveBattle({ ...land, modifiers: { mineDamage: 0.76 } }, mined, exact, 1);
  assert.ok(m1.ok && m2.ok);
  assert.equal(m1.report.phases[4].damage.defender.minensperre, 300);
  assert.ok(approx(m2.report.phases[4].damage.defender.minensperre, 228));
});
