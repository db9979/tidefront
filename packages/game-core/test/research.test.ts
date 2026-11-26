import { test } from "node:test";
import assert from "node:assert/strict";
import type { BaseState } from "../src/index.ts";
import {
  breakthroughChance,
  cancelResearch,
  chooseBreakthrough,
  cloneBase,
  completeResearch,
  modEntry,
  modValue,
  productionRates,
  researchBlocker,
  researchCost,
  researchModifiers,
  researchSeconds,
  rollBreakthrough,
  startResearch,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const R = balance.research!;
const rich = { stahl: 1e6, treibstoff: 1e6, elektronik: 1e6, proviant: 1e6 };

function lab(level = 5, patch: Partial<BaseState> = {}): BaseState {
  return makeBase(balance, { buildings: { forschungsamt: level, kraftwerk: 5, stahlwerk: 5 }, resources: rich, ...patch });
}

/** Sucht einen Seed mit (oder ohne) Durchbruch für die gegebene Chance. */
function seedWith(breakthrough: boolean, chance: number): number {
  for (let s = 1; s < 10000; s++) {
    if (rollBreakthrough({ techId: "x", targetLevel: 1, startedAt: 0, finishesAt: 0, cost: {}, chance, seed: s }).breakthrough === breakthrough) return s;
  }
  throw new Error("kein Seed");
}

test("Technikbaum: 15–22 Techniken in 5 Zweigen (mit Nachrichtendienst), Wirkungen gültig und moderat", () => {
  const ids = Object.keys(R.techs);
  assert.ok(ids.length >= 15 && ids.length <= 22, `${ids.length} Techniken`);
  assert.deepEqual([...new Set(ids.map((id) => R.techs[id].branch))].sort(), [...R.branches].sort());
  for (const [id, t] of Object.entries(R.techs)) {
    assert.ok(t.maxLevel >= 1 && t.maxLevel <= 3, id);
    for (const e of t.effects) {
      assert.ok(Math.abs(e.perLevel) >= 0.05 && Math.abs(e.perLevel) <= 0.15, `${id} ${e.path}`);
      assert.ok(researchModifiers({ [id]: 1 }, balance) !== null);
    }
    for (const req of Object.keys(t.requires ?? {})) assert.ok(R.techs[req], `${id} braucht ${req}`);
  }
  // Voll erforscht: kein Bereich über +25 % bzw. unter −25 %.
  const all: Record<string, number> = {};
  for (const [id, t] of Object.entries(R.techs)) all[id] = t.maxLevel;
  const mods = researchModifiers(all, balance);
  const factors: number[] = [];
  for (const v of Object.values(mods)) {
    if (typeof v === "number") factors.push(v);
    else for (const f of Object.values(v as Record<string, number>)) factors.push(f);
  }
  for (const f of factors) assert.ok(f <= 1.25 + 1e-9 && f >= 0.75 - 1e-9, `Faktor ${f}`);
});

test("Wirkung: Stufe L gibt 1 + perLevel * L, unbekannte und Stufe 0 ohne Wirkung", () => {
  assert.ok(approx(modEntry(researchModifiers({ hochofen: 2 }, balance), "production", "stahl"), 1.16));
  assert.ok(approx(modValue(researchModifiers({ logistik: 3 }, balance), "fuel"), 0.76));
  assert.ok(approx(modValue(researchModifiers({ logistik: 3 }, balance), "cargo"), 1.24));
  assert.deepEqual(researchModifiers({ hochofen: 0, gibtsnicht: 3 }, balance), {});
  const base = lab(1, { research: { levels: { hochofen: 3 }, order: null } });
  const mods = researchModifiers(base.research!.levels, balance);
  assert.ok(approx(productionRates(base, balance, mods).buildingPerHour.stahl, productionRates(base, balance).buildingPerHour.stahl * 1.24));
});

test("Voraussetzungen: Forschungsamt, Stufe, Technik, ein Auftrag gleichzeitig", () => {
  assert.equal(researchBlocker(makeBase(balance), "hochofen", balance), "building_required");
  assert.equal(researchBlocker(lab(1), "fertigbau", balance), "building_level");
  assert.equal(researchBlocker(lab(3), "fertigbau", balance), "requires_tech");
  assert.equal(researchBlocker(lab(3), "gibtsnicht", balance), "unknown_tech");
  assert.equal(researchBlocker(lab(1, { research: { levels: { lagertechnik: 2 }, order: null } }), "lagertechnik", balance), "max_level");
  const r = startResearch(lab(3), "hochofen", T0, balance);
  assert.ok(r.ok);
  assert.equal(researchBlocker(r.base, "logistik", balance), "research_busy");
  const poor = startResearch(lab(3, { resources: { stahl: 10, treibstoff: 0, elektronik: 0, proviant: 0 } }), "hochofen", T0, balance);
  assert.deepEqual(poor, { ok: false, code: "insufficient_resources" });
});

test("Kosten und Dauer je Stufe, Tempo durch das Forschungsamt", () => {
  assert.deepEqual(researchCost("hochofen", 0, balance), { stahl: 600, treibstoff: 150, elektronik: 150, proviant: 0 });
  assert.equal(researchCost("hochofen", 2, balance).stahl, 600 * R.costFactor ** 2);
  assert.equal(researchSeconds("hochofen", 0, 1, balance), 7200);
  assert.ok(approx(researchSeconds("hochofen", 1, 1, balance), 7200 * R.timeFactor));
  assert.ok(approx(researchSeconds("hochofen", 0, 6, balance), 7200 / 1.5));
  const r = startResearch(lab(1), "hochofen", T0, balance);
  assert.ok(r.ok);
  assert.equal(r.order.finishesAt, T0 + 7200 * 1000);
  assert.equal(r.base.resources.stahl, rich.stahl - 600 + 0); // keine Zeit vergangen
});

test("Abschluss: Stufe steigt, Bestände bis zur Fertigstellung mit alten Modifikatoren", () => {
  const s = startResearch(lab(1), "hochofen", T0, balance, undefined, seedWith(false, 0.12));
  assert.ok(s.ok);
  assert.deepEqual(completeResearch(s.base, T0 + HOUR, balance), { ok: false, code: "not_finished" });
  const c = completeResearch(s.base, T0 + 5 * HOUR, balance);
  assert.ok(c.ok);
  assert.equal(c.base.research!.levels.hochofen, 1);
  assert.equal(c.base.research!.order, null);
  assert.equal(c.base.resUpdatedAt, s.order.finishesAt);
  assert.equal(c.roll.breakthrough, false);
  assert.equal(c.roll.choice, null);
  assert.deepEqual(completeResearch(c.base, T0 + 6 * HOUR, balance), { ok: false, code: "no_order" });
});

test("Abbruch: Erstattung nach Restzeit", () => {
  const s = startResearch(lab(1), "hochofen", T0, balance);
  assert.ok(s.ok);
  const c = cancelResearch(s.base, T0 + 3600 * 1000, balance);
  assert.ok(c.ok);
  assert.deepEqual(c.refund, { stahl: 300, treibstoff: 75, elektronik: 75, proviant: 0 });
  assert.equal(c.base.research!.order, null);
  assert.deepEqual(cancelResearch(c.base, T0, balance), { ok: false, code: "no_order" });
});

test("Durchbruch-Chance: 10 % + 2 Punkte je Stufe, höchstens 25 %", () => {
  assert.ok(approx(breakthroughChance(lab(1), balance), 0.12));
  assert.ok(approx(breakthroughChance(lab(5), balance), 0.2));
  assert.equal(breakthroughChance(lab(20), balance), 0.25);
  const s = startResearch(lab(5), "hochofen", T0, balance, undefined, 42);
  assert.ok(s.ok);
  assert.ok(approx(s.order.chance!, 0.2));
  assert.equal(s.order.seed, 42);
});

test("Durchbruch-Wurf: deterministisch, Häufigkeit über viele Seeds im Rahmen", () => {
  const order = { techId: "x", targetLevel: 1, startedAt: 0, finishesAt: 0, cost: {}, chance: 0.2, seed: 7 };
  assert.deepEqual(rollBreakthrough(order), rollBreakthrough({ ...order }));
  for (const chance of [0.12, 0.2, 0.25]) {
    let hits = 0;
    const n = 5000;
    for (let s = 1; s <= n; s++) {
      const r = rollBreakthrough({ ...order, chance, seed: s * 7919 });
      assert.ok(r.roll >= 1 && r.roll <= 100);
      if (r.breakthrough) hits++;
    }
    const rate = hits / n;
    assert.ok(Math.abs(rate - chance) < 0.02, `Chance ${chance}: ${rate}`);
  }
});

test("Durchbruch: Wahl Stufe oder halbe Dauer, idempotent", () => {
  const s = startResearch(lab(5), "hochofen", T0, balance, undefined, seedWith(true, 0.2));
  assert.ok(s.ok);
  const c = completeResearch(s.base, s.order.finishesAt, balance);
  assert.ok(c.ok && c.roll.breakthrough);
  assert.equal(c.roll.choice, null);
  assert.equal(researchBlocker(c.base, "logistik", balance), "breakthrough_pending");
  const lvl = chooseBreakthrough(c.base, "level", s.order.finishesAt + 1000, balance);
  assert.ok(lvl.ok && lvl.changed);
  assert.equal(lvl.base.research!.levels.hochofen, 2);
  const again = chooseBreakthrough(lvl.base, "level", s.order.finishesAt + 2000, balance);
  assert.ok(again.ok && !again.changed);
  assert.equal(again.base.research!.levels.hochofen, 2);
  assert.deepEqual(chooseBreakthrough(lvl.base, "speed", T0, balance), { ok: false, code: "already_chosen" });
  assert.equal(researchBlocker(lvl.base, "logistik", balance), null);
  assert.deepEqual(chooseBreakthrough(lab(1), "level", T0, balance), { ok: false, code: "no_breakthrough" });
  assert.deepEqual(chooseBreakthrough(c.base, "mehr", T0, balance), { ok: false, code: "bad_choice" });
});

test("Durchbruch auf Höchststufe: automatisch halbe Dauer, genau einmal angewendet", () => {
  const base = lab(5, { research: { levels: { lagertechnik: 1 }, order: null } });
  const s = startResearch(base, "lagertechnik", T0, balance, undefined, seedWith(true, 0.2));
  assert.ok(s.ok);
  const c = completeResearch(s.base, s.order.finishesAt, balance);
  assert.ok(c.ok && c.roll.breakthrough);
  assert.equal(c.roll.choice, "speed");
  assert.equal(c.base.research!.halfNext, true);
  // Wahl "level" ist nach automatischer Belohnung nicht mehr möglich.
  assert.deepEqual(chooseBreakthrough(c.base, "level", T0, balance), { ok: false, code: "already_chosen" });
  const t = c.base.resUpdatedAt;
  const next = startResearch(c.base, "hochofen", t, balance, undefined, seedWith(false, 0.2));
  assert.ok(next.ok);
  assert.equal(next.order.finishesAt - t, Math.ceil(researchSeconds("hochofen", 0, 5, balance) * 0.5 * 1000));
  assert.equal(next.order.halved, true);
  assert.equal(next.base.research!.halfNext, false);
  // Abbruch gibt die Belohnung zurück, danach wieder volle Dauer nach einmaligem Einlösen.
  const cancel = cancelResearch(next.base, t + 1000, balance);
  assert.ok(cancel.ok);
  assert.equal(cancel.base.research!.halfNext, true);
  const again = startResearch(cancel.base, "hochofen", t + 1000, balance, undefined, seedWith(false, 0.2));
  assert.ok(again.ok && again.order.halved);
  const done = completeResearch(again.base, again.order.finishesAt, balance);
  assert.ok(done.ok);
  const third = startResearch(done.base, "logistik", again.order.finishesAt, balance);
  assert.ok(third.ok);
  assert.equal(third.order.halved, undefined);
  assert.equal(third.order.finishesAt - again.order.finishesAt, Math.ceil(researchSeconds("logistik", 0, 5, balance) * 1000));
});

test("Durchbruch-Stufe auf Höchststufe wird zu halber Dauer", () => {
  const base = lab(5, { research: { levels: { lagertechnik: 1 }, order: null, lastRoll: { techId: "lagertechnik", level: 1, roll: 3, chance: 0.2, breakthrough: true, choice: null, atMs: T0 } } });
  base.research!.levels.lagertechnik = 2;
  const r = chooseBreakthrough(base, "level", T0, balance);
  assert.ok(r.ok);
  assert.equal(r.choice, "speed");
  assert.equal(r.base.research!.levels.lagertechnik, 2);
  assert.equal(r.base.research!.halfNext, true);
});

test("cloneBase kopiert den Forschungsstand tief, ohne Forschung kein Feld", () => {
  assert.equal("research" in cloneBase(makeBase(balance)), false);
  const b = lab(1, { research: { levels: { hochofen: 1 }, order: null } });
  const c = cloneBase(b);
  c.research!.levels.hochofen = 3;
  assert.equal(b.research!.levels.hochofen, 1);
});
