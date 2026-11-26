// Nachrichtendienst und Spionage: Würfel und Chancen, Spione (Höchstzahl, kein Kampf, keine Verbände), Planung,
// Sabotage-Wirkung und -Frist, Desinformation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeSabotage,
  addDisinfo,
  applySabotage,
  clearSabotage,
  defenderFromBase,
  falsifyScout,
  loseSpies,
  modPoints,
  planSpyMission,
  productionRates,
  radarWarningMinutes,
  recordSpySuccess,
  researchModifiers,
  resolveSpy,
  sabotageCooldownUntil,
  sabotageModifiers,
  scoutBase,
  settle,
  spyChance,
  spyDefenseValue,
  spyRollOf,
  spySuccessValue,
  spyThreshold,
  startTraining,
  takeDisinfo,
  trainingSecondsPerUnit,
  validateFleet,
  combineModifiers,
} from "../src/index.ts";
import { HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const E = balance.espionage!;
const rich = { stahl: 100000, treibstoff: 100000, elektronik: 100000, proviant: 100000 };
const origin = { lat: 50, lon: 0 };
const target = { lat: 50, lon: 2 };

test("Würfel: deterministisch aus dem Seed, gleichverteilt 1..20", () => {
  assert.equal(spyRollOf(12345, 20), spyRollOf(12345, 20));
  const seen = new Map<number, number>();
  for (let s = 0; s < 20000; s++) {
    const r = spyRollOf(s * 7919, 20);
    assert.ok(r >= 1 && r <= 20);
    seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  assert.equal(seen.size, 20);
  for (const n of seen.values()) assert.ok(n > 800 && n < 1200, `${n}`);
});

test("Zielzahl und Chance: E − A, begrenzt auf 1..19; Wurf ≤ Zielzahl gelingt", () => {
  assert.equal(spyThreshold(15, 5, 20), 10);
  assert.equal(spyChance(15, 5, 20), 0.5);
  assert.equal(spyThreshold(40, 0, 20), 19);
  assert.equal(spyThreshold(3, 10, 20), 1);
  for (let s = 0; s < 200; s++) {
    const r = resolveSpy(s, 15, 5, 20);
    assert.equal(r.success, r.roll <= 10);
    assert.equal(r.threshold, 10);
  }
  // Eine 1 gelingt immer, eine 20 scheitert immer.
  let one = -1, twenty = -1;
  for (let s = 0; one < 0 || twenty < 0; s++) {
    const r = spyRollOf(s, 20);
    if (r === 1 && one < 0) one = s;
    if (r === 20 && twenty < 0) twenty = s;
  }
  assert.equal(resolveSpy(one, 0, 50, 20).success, true);
  assert.equal(resolveSpy(twenty, 99, 0, 20).success, false);
});

test("Erfolgswert und Abwehr: Stufe, Forschung, Erfahrung, Auftragsart", () => {
  let a = makeBase(balance, { buildings: { nachrichtendienst: 3 } as never });
  const mods = researchModifiers({ agentenschulung: 2 }, balance);
  assert.equal(modPoints(1.2), 2);
  const v = spySuccessValue(a, "sabotage", balance, mods);
  assert.equal(v.total, E.base + 3 + 2 + 0 + E.kinds.sabotage.bonus);
  for (let i = 0; i < E.xpPerPoint; i++) a = recordSpySuccess(a);
  assert.equal(spySuccessValue(a, "sabotage", balance, mods).total, v.total + 1);
  const d = makeBase(balance, { buildings: { nachrichtendienst: 4 } as never });
  assert.equal(spyDefenseValue(d, "erkunden", balance, researchModifiers({ verschluesselung: 1 }, balance)).total, 5);
  assert.equal(spyDefenseValue(null, "kartell", balance).total, E.kinds.kartell.defense);
  assert.equal(spyDefenseValue(d, "kartell", balance).total, E.kinds.kartell.defense);
});

test("Spione: Ausbildung im Nachrichtendienst, Höchstzahl je Stufe, Unterhalt", () => {
  const b = makeBase(balance, { resources: rich, buildings: { nachrichtendienst: 1, lagerkomplex: 10 } as never });
  assert.deepEqual(startTraining(makeBase(balance, { resources: rich }), "spion", 1, T0, balance), { ok: false, code: "building_required" });
  assert.deepEqual(startTraining(b, "spion", 3, T0, balance), { ok: false, code: "unit_cap" });
  const r = startTraining(b, "spion", 2, T0, balance);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.order.builtIn, "nachrichtendienst");
  assert.deepEqual(startTraining({ ...r.base, trainingQueue: [] , units: { spion: 1 }, unitsAway: { spion: 1 } }, "spion", 1, T0, balance), { ok: false, code: "unit_cap" });
  assert.ok(trainingSecondsPerUnit("spion", 2, balance) < trainingSecondsPerUnit("spion", 1, balance));
  const withSpies = makeBase(balance, { units: { spion: 2 } });
  assert.equal(productionRates(withSpies, balance).upkeepPerHour, 2 * balance.units.spion.upkeepPerHour!);
});

test("Spione kämpfen nicht und fahren nicht in Verbänden mit", () => {
  const b = makeBase(balance, { units: { spion: 2, korvette: 1 } });
  assert.deepEqual(defenderFromBase(b, balance).units, { korvette: 1 });
  assert.deepEqual(validateFleet(b, { spion: 1, korvette: 1 }, 10, balance), { ok: false, code: "covert_unit" });
});

test("Planung: Stufe je Art, Spione, Missionsplatz, schnellere Reise ohne Treibstoff", () => {
  const b = makeBase(balance, { units: { spion: 2 }, buildings: { nachrichtendienst: 2 } as never });
  const input = { kind: "erkunden", origin, target, activeMissions: 0, seed: 7, chance: 0.5 };
  assert.deepEqual(planSpyMission(b, { ...input, kind: "sabotage", building: "kraftwerk" }, T0, balance), { ok: false, code: "spy_level" });
  assert.deepEqual(planSpyMission(b, { ...input, activeMissions: 1 }, T0, balance), { ok: false, code: "no_mission_slot" });
  assert.deepEqual(planSpyMission(b, { ...input, kind: "spionieren" }, T0, balance), { ok: false, code: "bad_spy_kind" });
  const r = planSpyMission(b, input, T0, balance);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.base.units.spion, 1);
  assert.equal(r.base.unitsAway.spion, 1);
  assert.equal(r.mission.fuelCost, 0);
  assert.equal(r.mission.type, "spionage");
  assert.ok(Math.abs(r.mission.travelSeconds - (r.mission.distanceKm / E.speedKmh) * 3600) < 1e-6);
  const k = planSpyMission(b, { ...input, kind: "kartell", target: null }, T0, balance);
  assert.ok(k.ok && k.mission.arriveAtMs === T0 + E.kinds.kartell.hours! * HOUR);
  const three = makeBase(balance, { units: { spion: 1 }, buildings: { nachrichtendienst: 3 } as never });
  assert.deepEqual(planSpyMission(three, { ...input, kind: "sabotage", building: "kraftwerk" }, T0, balance), { ok: false, code: "no_spies" });
  assert.deepEqual(planSpyMission(three, { ...input, kind: "sabotage", building: "lagerkomplex" }, T0, balance), { ok: false, code: "bad_sabotage_target" });
  const lost = loseSpies(r.base, 1, T0 + HOUR, balance);
  assert.equal(lost.unitsAway.spion, undefined);
  assert.equal(lost.units.spion, 1);
});

test("Sabotage Kraftwerk: Produktion halbiert bis zum Ende, Sperrfrist 24 h, nicht zerstörerisch", () => {
  const b = makeBase(balance, { buildings: { kraftwerk: 3, stahlwerk: 3, lagerkomplex: 10 } as never });
  const r = applySabotage(b, "kraftwerk", T0, balance);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.base.buildings.kraftwerk, 3);
  assert.equal(r.sabotage.untilMs, T0 + E.sabotage.hours * HOUR);
  assert.equal(sabotageCooldownUntil(r.base, balance), T0 + E.sabotage.cooldownHours * HOUR);
  const during = sabotageModifiers(r.base, T0 + HOUR, balance);
  const normal = productionRates(r.base, balance).buildingPerHour.stahl;
  assert.ok(Math.abs(productionRates(r.base, balance, during).buildingPerHour.stahl - normal * E.sabotage.productionFactor) < 1e-9);
  assert.deepEqual(sabotageModifiers(r.base, r.sabotage.untilMs, balance), {});
  assert.equal(activeSabotage(r.base, r.sabotage.untilMs), null);
  // Fortschreiben über die Sabotage: die Hälfte der Gebäudeproduktion fehlt (die Grundrate bleibt).
  const s1 = settle(r.base, T0 + 2 * HOUR, balance, during);
  const s0 = settle(b, T0 + 2 * HOUR, balance);
  assert.ok(Math.abs(s0.resources.stahl - s1.resources.stahl - normal * (1 - E.sabotage.productionFactor) * 2) < 1e-6);
  assert.equal(clearSabotage(r.base, T0 + HOUR).intel?.sabotage?.target, "kraftwerk");
  assert.equal(clearSabotage(r.base, r.sabotage.untilMs).intel?.sabotage, undefined);
  assert.equal(clearSabotage(r.base, r.sabotage.untilMs).intel?.lastSabotageAtMs, T0);
  assert.equal(settle(r.base, T0 + HOUR, balance).intel?.sabotage?.target, "kraftwerk", "settle behält den Zustand");
});

test("Sabotage Radar, Werft, Forschungsamt und Bauschlange", () => {
  const b = makeBase(balance, { buildings: { radarstation: 4, werft: 2, forschungsamt: 2 } as never });
  const radar = applySabotage(b, "radarstation", T0, balance);
  assert.ok(radar.ok);
  if (radar.ok) assert.equal(radarWarningMinutes(radar.base, balance, sabotageModifiers(radar.base, T0 + 1, balance)), 0);
  const training = { ...b, trainingQueue: [{ kind: "unit" as const, id: "korvette", count: 1, builtIn: "werft", startedAt: T0 - HOUR, finishesAt: T0 + HOUR }] };
  const w = applySabotage(training, "werft", T0, balance);
  assert.ok(w.ok);
  if (w.ok) {
    assert.equal(w.base.trainingQueue[0].finishesAt, T0 + HOUR + E.sabotage.hours * HOUR);
    assert.deepEqual(w.training, [T0 + HOUR + E.sabotage.hours * HOUR]);
    assert.equal(sabotageModifiers(w.base, T0 + 1, balance).trainingTime?.werft, E.sabotage.trainingFactor);
  }
  const researching = { ...b, research: { levels: {}, order: { techId: "hochofen", targetLevel: 1, startedAt: T0 - HOUR, finishesAt: T0 + HOUR, cost: {} } } };
  const f = applySabotage(researching, "forschungsamt", T0, balance);
  assert.ok(f.ok && f.research === T0 + HOUR + E.sabotage.hours * HOUR && f.base.research!.order!.finishesAt === f.research);
  const queued = { ...b, buildQueue: [
    { buildingId: "werft", targetLevel: 3, startedAt: T0 - HOUR, finishesAt: T0 + HOUR },
    { buildingId: "kraftwerk", targetLevel: 1, startedAt: T0 + HOUR, finishesAt: T0 + 2 * HOUR },
  ] };
  const q = applySabotage(queued, "bauschlange", T0, balance);
  assert.ok(q.ok);
  if (q.ok) {
    const d = E.sabotage.delayHours * HOUR;
    assert.deepEqual(q.base.buildQueue.map((o) => [o.startedAt, o.finishesAt]), [[T0 - HOUR, T0 + HOUR + d], [T0 + HOUR + d, T0 + 2 * HOUR + d]]);
    assert.deepEqual(sabotageModifiers(q.base, T0 + 1, balance), {});
  }
  assert.deepEqual(applySabotage(b, "lagerkomplex", T0, balance), { ok: false, code: "bad_sabotage_target" });
});

test("Desinformation: einmalig für den Betrachter, mit Frist; verfälschte Zahlen", () => {
  const b = makeBase(balance, { units: { korvette: 10 }, defenses: { kuestenbatterie: 2 }, resources: { stahl: 1000 } });
  const d = addDisinfo(b, 42, T0 + 24 * HOUR);
  assert.equal(takeDisinfo(d, 7, T0).active, false, "anderer Betrachter");
  const t = takeDisinfo(d, 42, T0 + HOUR);
  assert.equal(t.active, true);
  assert.equal(takeDisinfo(t.base, 42, T0 + HOUR).active, false, "verbraucht");
  assert.equal(takeDisinfo(d, 42, T0 + 25 * HOUR).active, false, "abgelaufen");
  const scout = scoutBase(b, T0, balance);
  const fake = falsifyScout(scout, balance);
  assert.equal(fake.units.korvette, Math.round(10 * E.disinfo.forceFactor));
  assert.equal(fake.defenses.kuestenbatterie, Math.round(2 * E.disinfo.forceFactor));
  assert.equal(fake.resources.stahl, Math.floor(scout.resources.stahl * E.disinfo.resourceFactor));
  assert.deepEqual(falsifyScout(scout, balance), fake, "deterministisch");
});

test("Forschung: Agentenschulung und Verschlüsselung als Modifikatoren", () => {
  const m = combineModifiers(researchModifiers({ agentenschulung: 2, verschluesselung: 1 }, balance));
  assert.equal(modPoints(m.spyAttack!), 2);
  assert.equal(modPoints(m.spyDefense!), 1);
});
