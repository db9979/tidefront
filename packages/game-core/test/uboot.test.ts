import { test } from "node:test";
import assert from "node:assert/strict";
import type { AttackerInput, BattleReport, Counts, DefenderInput, MissionInput } from "../src/index.ts";
import {
  EARTH_RADIUS_KM,
  PHASE_NAMES,
  composeRaid,
  defenseHp,
  fuelCost,
  planMission,
  resolveBattle,
  startTraining,
  travelSeconds,
} from "../src/index.ts";
import { T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const rich = { stahl: 1e7, treibstoff: 1e7, elektronik: 1e7, proviant: 1e7 };

function fight(attacker: AttackerInput, defender: DefenderInput, seed = 1): BattleReport {
  const res = resolveBattle(attacker, defender, balance, seed);
  assert.ok(res.ok, "resolveBattle muss gelingen");
  return res.report;
}
const phase = (r: BattleReport, name: string) => r.phases.find((p) => p.phase === name)!;
const sea = (units: Counts, defenses: Counts = {}): DefenderInput => ({ units, defenses });

test("U-Boot: Werte und Phase in der festen Reihenfolge", () => {
  const u = balance.units.uboot;
  assert.equal(u.branch, "see");
  assert.equal(u.builtIn, "werft");
  assert.equal(u.submerged, true);
  assert.equal(u.cargo ?? 0, 0);
  assert.equal(u.troopSpace ?? 0, 0);
  assert.ok((balance.units.korvette.attack.uboot ?? 0) > 0);
  assert.ok((balance.units.zerstoerer.attack.uboot ?? 0) > 0);
  assert.deepEqual([...PHASE_NAMES], ["luftkampf", "luftschlag", "ubootangriff", "seegefecht", "landung"]);
});

test("Bau erst ab Werft-Stufe requiresLevel", () => {
  const need = balance.units.uboot.requiresLevel ?? 1;
  assert.equal(need, 3);
  const low = makeBase(balance, { resources: rich, buildings: { werft: need - 1 } });
  assert.deepEqual(startTraining(low, "uboot", 1, T0, balance), { ok: false, code: "building_level" });
  assert.ok(startTraining(low, "korvette", 1, T0, balance).ok);
  const none = makeBase(balance, { resources: rich });
  assert.deepEqual(startTraining(none, "uboot", 1, T0, balance), { ok: false, code: "building_required" });
  const ok = startTraining(makeBase(balance, { resources: rich, buildings: { werft: need } }), "uboot", 2, T0, balance);
  assert.ok(ok.ok);
});

test("U-Boot-Angriff: eine Torpedosalve aus dem Verborgenen, keine Gegenwehr", () => {
  // 2 U-Boote: 2 * 80 * 1,5 (Bonus) = 240 gegen Landungsschiffe (300 HP) -> noch kein Verlust, Rest bleibt
  const r = fight({ units: { uboot: 2 } }, sea({ landungsschiff: 2, korvette: 0 }), 3);
  const amb = phase(r, "ubootangriff");
  assert.equal(amb.skipped, false);
  assert.equal(amb.rounds, balance.combat.torpedoSalvos ?? 1);
  assert.equal(amb.entscheidend, "uboot");
  assert.equal(amb.entscheidendSide, "attacker");
  assert.deepEqual(amb.damage.defender, {});
  const d = amb.damage.attacker.uboot;
  assert.ok(d >= 240 * 0.95 - 1e-9 && d <= 240 * 1.05 + 1e-9);
  // Danach versenken die U-Boote die wehrlosen Landungsschiffe im Seegefecht
  assert.equal(r.defender.survivors.landungsschiff, 0);
  assert.equal(r.attacker.survivors.uboot, 2);
});

test("ohne U-Boote entfällt die Phase; ohne Überwasserziele ebenfalls", () => {
  const plain = fight({ units: { korvette: 3 } }, sea({ schnellboot: 3 }));
  assert.equal(phase(plain, "ubootangriff").skipReason, "no_submarines");
  const noTargets = fight({ units: { uboot: 2 } }, sea({}, { kuestenbatterie: 1 }));
  assert.equal(phase(noTargets, "ubootangriff").skipReason, "no_targets");
  // U-Boote treffen keine Küstenbatterie, die Batterie trifft keine U-Boote: Seegefecht ohne Schuss
  assert.equal(phase(noTargets, "seegefecht").skipReason, "no_targets");
  assert.equal(noTargets.attacker.survivors.uboot, 2);
  assert.equal(noTargets.defender.survivors.kuestenbatterie, 1);
});

test("unangreifbar ohne U-Jagd: Schnellboote, Landungsschiffe, Batterien und Bomber treffen nicht", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = fight(
      { units: { uboot: 3, jagdbomber: 0 } },
      { units: { schnellboot: 40, landungsschiff: 5, jagdbomber: 10 }, defenses: { kuestenbatterie: 5, flakstellung: 2 } },
      seed,
    );
    assert.equal(r.attacker.losses.uboot, 0, `Seed ${seed}`);
    for (const p of r.phases) assert.equal(p.after.attacker.uboot, 3);
    // Bomber haben kein Ziel: getauchte U-Boote sind keine Ziele des Luftschlags
    assert.equal(phase(r, "luftschlag").skipReason, "no_targets");
  }
});

test("U-Jagd: Korvetten und Zerstörer versenken U-Boote im Seegefecht", () => {
  const r = fight({ units: { korvette: 10 } }, sea({ uboot: 3 }), 5);
  const s = phase(r, "seegefecht");
  assert.ok(r.defender.losses.uboot >= 2, `versenkt: ${r.defender.losses.uboot}`);
  assert.ok(s.damage.attacker.korvette > 0);
  // Der Verteidiger hat im Hafen zuerst aus dem Verborgenen getroffen
  assert.ok(phase(r, "ubootangriff").damage.defender.uboot > 0);
  const z = fight({ units: { zerstoerer: 4 } }, sea({ uboot: 2 }), 5);
  assert.ok(z.defender.losses.uboot >= 1);
  // Gesunkene U-Boote hinterlassen Wracks wie Schiffe
  assert.ok(r.wreck.stahl >= r.defender.losses.uboot * (balance.units.uboot.cost?.stahl ?? 0) * balance.combat.wreckShare - 1);
});

test("U-Jagd nachgerechnet: 4 Korvetten gegen 1 U-Boot", () => {
  // U-Boot-Angriff: 80 auf die Korvetten. Seegefecht: je Runde 4 * 40 = 160 Wasserbomben auf das U-Boot (250 HP),
  // das U-Boot schießt weiter 80. Runde 2: U-Boot versenkt (320), Korvetten haben 240 Schaden -> eine verloren.
  const r = fight({ units: { korvette: 4 } }, sea({ uboot: 1 }), 7);
  const s = phase(r, "seegefecht");
  assert.equal(s.rounds, 2);
  assert.ok(s.damage.attacker.korvette >= 320 * 0.95 - 1e-9 && s.damage.attacker.korvette <= 320 * 1.05 + 1e-9);
  assert.equal(r.defender.losses.uboot, 1);
  assert.equal(r.attacker.losses.korvette, 1);
});

test("Determinismus mit U-Booten: gleicher Seed, gleicher Bericht", () => {
  const att: AttackerInput = { units: { uboot: 4, korvette: 6, landungsschiff: 2, schuetzen: 100 } };
  const def: DefenderInput = { units: { uboot: 3, zerstoerer: 2, schuetzen: 40 }, defenses: { kuestenbatterie: 1 } };
  const a = fight(att, def, 4242);
  const b = fight({ units: { ...att.units } }, { units: { ...def.units }, defenses: { ...def.defenses } }, 4242);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("keine negativen Bestände bei U-Booten auf beiden Seiten", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = fight(
      { units: { uboot: seed % 7, korvette: seed % 5, zerstoerer: seed % 3, landungsschiff: 1, schuetzen: 50 } },
      { units: { uboot: (seed * 3) % 6, korvette: seed % 4, schuetzen: 20 }, defenses: { kuestenbatterie: seed % 2 } },
      seed,
    );
    for (const p of r.phases) {
      for (const side of ["attacker", "defender"] as const) {
        for (const [id, n] of Object.entries(p.after[side])) {
          assert.ok(Number.isInteger(n) && n >= 0 && n <= p.before[side][id], `Seed ${seed} ${id}`);
        }
      }
    }
    for (const o of [r.attacker, r.defender]) {
      for (const g of [o.survivors, o.losses, o.returned, o.final]) for (const n of Object.values(g)) assert.ok(n >= 0);
    }
  }
});

test("Mission: Reisezeit und Treibstoff generisch, U-Boote tragen nichts", () => {
  const km = 450;
  assert.equal(travelSeconds({ uboot: 2 }, km, balance), (km / balance.units.uboot.speedKmh!) * 3600);
  assert.equal(fuelCost({ uboot: 2 }, km, balance), Math.ceil(((balance.units.uboot.fuelPer100Km ?? 0) * 2 * km) / 100 * 2));
  const base = makeBase(balance, { resources: rich, buildings: { kommandozentrale: 5 }, units: { uboot: 2, schuetzen: 10 } });
  const target = { lat: 0, lon: km / ((EARTH_RADIUS_KM * Math.PI) / 180) };
  const input = (units: Counts): MissionInput => ({ type: "ueberfall", units, origin: { lat: 0, lon: 0 }, target, activeMissions: 0 });
  assert.ok(planMission(base, input({ uboot: 2 }), T0, balance).ok);
  assert.deepEqual(planMission(base, input({ uboot: 2, schuetzen: 10 }), T0, balance), { ok: false, code: "troop_capacity" });
});

test("Kartell: U-Boote daheim zählen zur Verteidigungsstärke", () => {
  assert.equal(defenseHp({ uboot: 2 }, {}, balance), 2 * balance.units.uboot.hp);
  const without = composeRaid({ schuetzen: 30 }, {}, balance);
  const withSubs = composeRaid({ schuetzen: 30, uboot: 4 }, {}, balance);
  assert.ok(withSubs.units.schnellboot > without.units.schnellboot);
  assert.equal(withSubs.units.uboot, undefined);
});
