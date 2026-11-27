// Admirale: Spezialisierung „Landungstrupp“ und Beutemeister bei fester Nestbeute (docs/VORLAGE-ADMIRALE.md).
// Probekampf-Zahlen der Vorlage: knapper Nest-5-Verband (T28-Bot-Verband × 0,49, 200 Seeds) und Kampfwert-Bonus.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Counts, DefenderInput, Modifiers } from "../src/index.ts";
import { admiralModifiers, combineModifiers, computeLoot, nestDefender, resolveBattle } from "../src/index.ts";
import { approx, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const FULL = balance.admirals!.ranks.at(-1)!.minXp;
const SEEDS = 200;

function nest(level: number): DefenderInput {
  const n = nestDefender(level, balance);
  if (!n.ok) throw new Error(n.code);
  return n.defender;
}

function winRate(units: Counts, def: DefenderInput, mods: Modifiers): number {
  let w = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle({ units, modifiers: mods }, def, balance, seed);
    assert.ok(r.ok);
    if (r.report.winner === "attacker") w++;
  }
  return w / SEEDS;
}

test("Landungstrupp: Angriff Landtruppen +10 %, LP +8 %, Minenschaden −30 %; Hafen LP +6 %; Rang 50 … 100 %", () => {
  assert.deepEqual(admiralModifiers(["landung"], FULL, "mission", balance), { attack: { land: 1.1 }, hp: { land: 1.08 }, mineDamage: 0.7 });
  assert.deepEqual(admiralModifiers(["landung"], FULL, "defense", balance), { hp: { land: 1.06 } });
  const kzs = admiralModifiers(["landung"], 0, "mission", balance);
  assert.ok(approx(kzs.attack!.land!, 1.05) && approx(kzs.hp!.land!, 1.04) && approx(kzs.mineDamage!, 0.85));
  assert.deepEqual(admiralModifiers(["landung"], FULL, "harbor", balance), {});
});

test("Landungstrupp hebt den Sieg eines knappen Nest-5-Verbands deutlich (Vorlage: 59 → 79 %)", () => {
  const knapp = { schuetzen: 369, landungsschiff: 5, korvette: 16, pioniere: 49, jagdbomber: 6, kampfpanzer: 7, zerstoerer: 3 };
  const def = nest(5);
  const ohne = winRate(knapp, def, {});
  const kapitaen = winRate(knapp, def, admiralModifiers(["landung"], 0, "mission", balance));
  const admiral = winRate(knapp, def, admiralModifiers(["landung"], FULL, "mission", balance));
  assert.ok(ohne >= 0.45 && ohne <= 0.7, `ohne Admiral knapp: ${ohne}`);
  assert.ok(kapitaen > ohne, `Kapitän ${kapitaen} > ohne ${ohne}`);
  assert.ok(admiral >= ohne + 0.12, `Admiral ${admiral} gegen ohne ${ohne}`);
  // Heute (Angriff): bei der Landung fast wirkungslos.
  const angriff = winRate(knapp, def, admiralModifiers(["angriff"], FULL, "mission", balance));
  assert.ok(admiral > angriff, `Landungstrupp ${admiral} > Angriff ${angriff}`);
});

test("Kampfwert-Bonus Nest 5 (voller Rang) etwa +10 % wie „Angriff“ zur See (Vorlage +10,6 %)", () => {
  const c = { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 };
  const def = nest(5);
  const power = (f: number): Modifiers => ({ attack: { see: f, land: f, luft: f, anlage: f } });
  const even = (adm: Modifiers) => {
    let lo = 0.2, hi = 5;
    for (let i = 0; i < 12; i++) {
      const mid = Math.sqrt(lo * hi);
      if (winRate(c, def, combineModifiers(power(mid), adm)) < 0.5) lo = mid;
      else hi = mid;
    }
    return Math.sqrt(lo * hi);
  };
  const bonus = even({}) / even(admiralModifiers(["landung"], FULL, "mission", balance)) - 1;
  assert.ok(bonus > 0.07 && bonus < 0.14, `Bonus ${bonus}`);
});

test("Landungstrupp: Minenschaden der Landungstruppen −30 %, im Seegefecht keine Wirkung", () => {
  const land = { units: { landungsschiff: 1, schuetzen: 50 } };
  const mined = { units: {}, defenses: { minensperre: 1 } };
  const m1 = resolveBattle(land, mined, balance, 1);
  const m2 = resolveBattle({ ...land, modifiers: admiralModifiers(["landung"], FULL, "mission", balance) }, mined, balance, 1);
  assert.ok(m1.ok && m2.ok);
  assert.ok(approx(m2.report.phases[4].damage.defender.minensperre, m1.report.phases[4].damage.defender.minensperre * 0.7));
  const sea = { units: { korvette: 10 } };
  const foe = { units: { zerstoerer: 4 }, defenses: {} };
  const s1 = resolveBattle(sea, foe, balance, 3);
  const s2 = resolveBattle({ ...sea, modifiers: admiralModifiers(["landung"], FULL, "mission", balance) }, foe, balance, 3);
  assert.deepEqual(s1, s2);
});

test("Beutemeister: +10 % feste Nestbeute (Rangfaktor), weiter durch den Laderaum begrenzt", () => {
  const mods = admiralModifiers(["beutemeister"], FULL, "mission", balance);
  assert.ok(approx(mods.nestLoot!, 1.1));
  const fixed = { fixedLoot: { stahl: 500, treibstoff: 300 } };
  assert.deepEqual(computeLoot(fixed, 99999, 0, balance, false, mods), { stahl: 550, treibstoff: 330, elektronik: 0, proviant: 0 });
  assert.equal(computeLoot(fixed, 99999, 0, balance, false, admiralModifiers(["beutemeister"], 0, "mission", balance)).stahl, 525);
  // Laderaum begrenzt weiter: 880 Platz für 880 Beute (550 + 330).
  const capped = computeLoot(fixed, 440, 0, balance, false, mods);
  assert.equal(capped.stahl + capped.treibstoff, 440);
  // Ohne Beutemeister unverändert.
  assert.equal(computeLoot(fixed, 99999, 0, balance).stahl, 500);
});
