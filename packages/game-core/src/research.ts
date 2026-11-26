// Forschung: Technikbaum je Saison im Forschungsamt, ein Auftrag gleichzeitig, Wirkung als Modifikatoren,
// Durchbruch-Würfel beim Abschluss (deterministisch über den gespeicherten Seed des Auftrags).
import type {
  Balance,
  BaseState,
  BreakthroughChoice,
  Counts,
  ResearchOrder,
  ResearchRoll,
  ResearchState,
  ResourceMap,
  Result,
  TechDef,
} from "./types.ts";
import { addResources, buildingLevel, hasResources, settle, subtractResources } from "./economy.ts";
import type { Modifiers } from "./modifiers.ts";
import { applyModPath, modValue } from "./modifiers.ts";
import { mulberry32, randomInt } from "./rng.ts";

/** Forschungsstand eines Stützpunkts (leer, wenn nichts erforscht). */
export function researchState(base: BaseState): ResearchState {
  return base.research ?? { levels: {}, order: null };
}

export function techLevel(base: BaseState, techId: string): number {
  return researchState(base).levels[techId] ?? 0;
}

/** Faktor einer Wirkung auf Stufe `level`: 1 + perLevel * Stufe (innerhalb einer Technik additiv). */
export function techEffectFactor(perLevel: number, level: number): number {
  return 1 + perLevel * level;
}

/**
 * Modifikatoren aus erforschten Stufen. Verschiedene Techniken auf denselben Schlüssel werden
 * multipliziert (wie alle Quellen, siehe combineModifiers).
 */
export function researchModifiers(levels: Counts, balance: Balance): Modifiers {
  const mods: Modifiers = {};
  const techs = balance.research?.techs ?? {};
  for (const [id, def] of Object.entries(techs)) {
    const level = Math.min(levels[id] ?? 0, def.maxLevel);
    if (level <= 0) continue;
    for (const e of def.effects) applyModPath(mods, e.path, techEffectFactor(e.perLevel, level));
  }
  return mods;
}

/** Kosten der nächsten Stufe (von `level` auf `level + 1`), je Ressource aufgerundet. */
export function researchCost(techId: string, level: number, balance: Balance): ResourceMap {
  const r = balance.research!;
  const def = r.techs[techId];
  const cost: ResourceMap = {};
  for (const res of balance.resources) cost[res] = Math.ceil((def.cost[res] ?? 0) * r.costFactor ** level);
  return cost;
}

/** Dauer der nächsten Stufe in Sekunden bei Stufe `buildingLvl` (>= 1) des Forschungsamts; `mods.researchTime`. */
export function researchSeconds(techId: string, level: number, buildingLvl: number, balance: Balance, mods?: Modifiers): number {
  const r = balance.research!;
  const def = r.techs[techId];
  const speed = balance.buildings[r.building]?.researchSpeedPerLevel ?? 0;
  return ((def.seconds * r.timeFactor ** level) / (1 + speed * (Math.max(1, buildingLvl) - 1))) * modValue(mods, "researchTime");
}

/** Durchbruch-Chance (0..1) bei der aktuellen Stufe des Forschungsamts. */
export function breakthroughChance(base: BaseState, balance: Balance): number {
  const b = balance.research?.breakthrough;
  if (!b) return 0;
  const level = buildingLevel(base, balance.research!.building);
  return Math.min(b.maxChance, b.baseChance + b.perBuildingLevel * level);
}

/** Wartet ein Durchbruch auf die Wahl der Belohnung? */
export function breakthroughPending(base: BaseState): boolean {
  const roll = researchState(base).lastRoll;
  return !!roll && roll.breakthrough && roll.choice === null;
}

/**
 * Warum eine Technik jetzt nicht erforscht werden kann (null = möglich, Ressourcen ausgenommen).
 * Codes: no_research, unknown_tech, building_required, building_level, max_level, requires_tech,
 * research_busy, breakthrough_pending.
 */
export function researchBlocker(base: BaseState, techId: string, balance: Balance): string | null {
  const r = balance.research;
  if (!r) return "no_research";
  if (!Object.hasOwn(r.techs, techId)) return "unknown_tech";
  const def: TechDef = r.techs[techId];
  const lvl = buildingLevel(base, r.building);
  if (lvl < 1) return "building_required";
  if (lvl < (def.requiresBuildingLevel ?? 1)) return "building_level";
  if (techLevel(base, techId) >= def.maxLevel) return "max_level";
  for (const [req, need] of Object.entries(def.requires ?? {})) if (techLevel(base, req) < need) return "requires_tech";
  const state = researchState(base);
  if (state.order) return "research_busy";
  if (breakthroughPending(base)) return "breakthrough_pending";
  return null;
}

/**
 * Startet die nächste Stufe einer Technik: Kosten sofort, Dauer nach Stufe des Forschungsamts. Liegt die
 * Belohnung „halbe Dauer“ bereit, wird sie genau hier eingelöst. `seed` bestimmt den Durchbruch-Wurf beim
 * Abschluss. Codes: wie researchBlocker, dazu insufficient_resources.
 */
export function startResearch(
  base: BaseState,
  techId: string,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
  seed?: number,
): Result<{ base: BaseState; order: ResearchOrder }> {
  const blocked = researchBlocker(base, techId, balance);
  if (blocked) return { ok: false, code: blocked };
  const next = settle(base, nowMs, balance, mods);
  const level = techLevel(base, techId);
  const cost = researchCost(techId, level, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };
  next.resources = subtractResources(next.resources, cost);
  const state = researchState(next);
  const halved = state.halfNext === true;
  const factor = halved ? (balance.research!.breakthrough?.speedFactor ?? 1) : 1;
  const seconds = researchSeconds(techId, level, buildingLevel(base, balance.research!.building), balance, mods) * factor;
  const order: ResearchOrder = {
    techId,
    targetLevel: level + 1,
    startedAt: nowMs,
    finishesAt: nowMs + Math.ceil(seconds * 1000),
    cost,
    chance: breakthroughChance(base, balance),
    seed: (seed ?? nowMs) >>> 0,
    ...(halved ? { halved: true } : {}),
  };
  next.research = { ...state, levels: { ...state.levels }, order, halfNext: false };
  return { ok: true, base: next, order: { ...order } };
}

/** Durchbruch-Wurf eines Auftrags: W100 aus dem gespeicherten Seed. */
export function rollBreakthrough(order: ResearchOrder): { roll: number; breakthrough: boolean } {
  const roll = randomInt(mulberry32(order.seed ?? order.startedAt >>> 0), 1, 100);
  return { roll, breakthrough: roll <= Math.round((order.chance ?? 0) * 100) };
}

/**
 * Schließt eine fällige Forschung ab: Bestände bis zur Fertigstellung mit den bisherigen Modifikatoren
 * fortschreiben (resUpdatedAt = Fertigstellung), Stufe erhöhen, Durchbruch würfeln und speichern.
 * Durchbruch auf Höchststufe: Belohnung automatisch „halbe Dauer“. Codes: no_order, not_finished.
 */
export function completeResearch(
  base: BaseState,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; completed: ResearchOrder; roll: ResearchRoll }> {
  const order = researchState(base).order;
  if (!order) return { ok: false, code: "no_order" };
  if (nowMs < order.finishesAt) return { ok: false, code: "not_finished" };
  const next = settle(base, order.finishesAt, balance, mods);
  const state = researchState(next);
  const levels = { ...state.levels, [order.techId]: Math.max(state.levels[order.techId] ?? 0, order.targetLevel) };
  const { roll, breakthrough } = rollBreakthrough(order);
  const atMax = levels[order.techId] >= (balance.research?.techs[order.techId]?.maxLevel ?? 0);
  const choice: BreakthroughChoice | null = breakthrough && atMax ? "speed" : null;
  const lastRoll: ResearchRoll = {
    techId: order.techId, level: order.targetLevel, roll, chance: order.chance ?? 0, breakthrough, choice, atMs: order.finishesAt,
  };
  next.research = { ...state, levels, order: null, lastRoll, halfNext: (state.halfNext ?? false) || choice === "speed" };
  return { ok: true, base: next, completed: { ...order }, roll: { ...lastRoll } };
}

/**
 * Wahl der Durchbruch-Belohnung: "level" = eine Stufe mehr für die gerade erforschte Technik (auf Höchststufe
 * automatisch "speed"), "speed" = nächste Forschung halb so lang. Idempotent: dieselbe Wahl noch einmal
 * ändert nichts. Bestände werden vorher mit den bisherigen Modifikatoren auf nowMs fortgeschrieben.
 * Codes: no_breakthrough, bad_choice, already_chosen.
 */
export function chooseBreakthrough(
  base: BaseState,
  choice: string,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; choice: BreakthroughChoice; changed: boolean }> {
  const state = researchState(base);
  const roll = state.lastRoll;
  if (!roll || !roll.breakthrough) return { ok: false, code: "no_breakthrough" };
  if (choice !== "level" && choice !== "speed") return { ok: false, code: "bad_choice" };
  if (roll.choice !== null) {
    return roll.choice === choice ? { ok: true, base, choice: roll.choice, changed: false } : { ok: false, code: "already_chosen" };
  }
  const next = settle(base, nowMs, balance, mods);
  const s = researchState(next);
  const max = balance.research?.techs[roll.techId]?.maxLevel ?? 0;
  const levels = { ...s.levels };
  let final: BreakthroughChoice = choice;
  if (final === "level" && (levels[roll.techId] ?? 0) >= max) final = "speed";
  if (final === "level") levels[roll.techId] = (levels[roll.techId] ?? 0) + 1;
  next.research = { ...s, levels, lastRoll: { ...roll, choice: final }, halfNext: (s.halfNext ?? false) || final === "speed" };
  return { ok: true, base: next, choice: final, changed: true };
}

/**
 * Bricht die laufende Forschung ab; Erstattung nach Restzeit (abgerundet). War die halbe Dauer eingelöst,
 * liegt sie wieder bereit. Codes: no_order, already_finished.
 */
export function cancelResearch(
  base: BaseState,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; refund: ResourceMap }> {
  const order = researchState(base).order;
  if (!order) return { ok: false, code: "no_order" };
  if (nowMs >= order.finishesAt) return { ok: false, code: "already_finished" };
  const total = order.finishesAt - order.startedAt;
  const share = total <= 0 ? 0 : Math.min(1, Math.max(0, (order.finishesAt - nowMs) / total));
  const refund: ResourceMap = {};
  for (const [r, v] of Object.entries(order.cost)) refund[r] = Math.floor(v * share + 1e-9);
  const next = settle(base, nowMs, balance, mods);
  const s = researchState(next);
  next.research = { ...s, order: null, halfNext: (s.halfNext ?? false) || order.halved === true };
  next.resources = addResources(next.resources, refund);
  return { ok: true, base: next, refund };
}
