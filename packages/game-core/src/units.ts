import type { Balance, BaseState, ResourceMap, Result, TrainingOrder } from "./types.ts";
import { buildingLevel, hasResources, settle, subtractResources } from "./economy.ts";

/** Pseudo-Bauplatz für Verteidigungsanlagen (haben in balance.json kein builtIn). */
export const DEFENSE_SLOT = "anlagen";

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** Baukosten für `count` Einheiten oder Anlagen eines Typs. */
export function trainingCost(id: string, count: number, balance: Balance): ResourceMap {
  const def = balance.units[id] ?? balance.defenses[id];
  const cost: ResourceMap = {};
  for (const r of balance.resources) cost[r] = (def.cost?.[r] ?? 0) * count;
  return cost;
}

/** Bauzeit je Einheit in Sekunden bei Stufe `level` (>= 1) des Baugebäudes. */
export function trainingSecondsPerUnit(unitId: string, level: number, balance: Balance): number {
  const def = balance.units[unitId];
  const speed = balance.buildings[def.builtIn ?? ""]?.buildSpeedPerLevel ?? 0;
  return (def.seconds ?? 0) / (1 + speed * (level - 1));
}

/** Stellplätze für Flugzeuge (Flugfeld). */
export function aircraftSlots(base: BaseState, balance: Balance): number {
  return (balance.buildings.flugfeld.slotsPerLevel ?? 0) * buildingLevel(base, "flugfeld");
}

/** Belegte Stellplätze: Flugzeuge daheim, auf Mission und in Ausbildung. */
export function aircraftSlotsUsed(base: BaseState, balance: Balance): number {
  let used = 0;
  for (const [id, def] of Object.entries(balance.units)) {
    if (def.branch !== "luft") continue;
    used += (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
  }
  for (const order of base.trainingQueue) {
    if (order.kind === "unit" && balance.units[order.id]?.branch === "luft") used += order.count;
  }
  return used;
}

/**
 * Startet die Ausbildung von Einheiten oder den Bau von Verteidigungsanlagen.
 * Codes: unknown_unit, bad_count, building_required, supply_shortage, queue_busy,
 * no_aircraft_slots, insufficient_resources.
 */
export function startTraining(
  base: BaseState,
  id: string,
  count: number,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; order: TrainingOrder }> {
  const isUnit = Object.hasOwn(balance.units, id);
  const isDefense = Object.hasOwn(balance.defenses, id);
  if (!isUnit && !isDefense) return { ok: false, code: "unknown_unit" };
  if (!isPositiveInt(count)) return { ok: false, code: "bad_count" };

  const next = settle(base, nowMs, balance);
  let builtIn = DEFENSE_SLOT;
  let secondsEach = 0;
  if (isUnit) {
    const def = balance.units[id];
    builtIn = def.builtIn ?? "";
    const level = buildingLevel(base, builtIn);
    if (level < 1) return { ok: false, code: "building_required" };
    if (next.versorgungsmangel) return { ok: false, code: "supply_shortage" };
    secondsEach = trainingSecondsPerUnit(id, level, balance);
  } else {
    secondsEach = balance.defenses[id].seconds;
  }
  if (base.trainingQueue.some((o) => o.builtIn === builtIn)) return { ok: false, code: "queue_busy" };
  if (isUnit && balance.units[id].branch === "luft") {
    if (aircraftSlotsUsed(base, balance) + count > aircraftSlots(base, balance)) {
      return { ok: false, code: "no_aircraft_slots" };
    }
  }
  const cost = trainingCost(id, count, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };

  next.resources = subtractResources(next.resources, cost);
  const order: TrainingOrder = {
    kind: isUnit ? "unit" : "defense",
    id,
    count,
    builtIn,
    startedAt: nowMs,
    finishesAt: nowMs + Math.ceil(secondsEach * count * 1000),
  };
  next.trainingQueue = [...next.trainingQueue, order];
  return { ok: true, base: next, order: { ...order } };
}

/**
 * Schließt alle fälligen Ausbildungsaufträge ab (in Reihenfolge der Fertigstellung; die
 * Bestände werden jeweils bis zum Fertigstellungszeitpunkt fortgeschrieben, weil neue
 * Einheiten den Unterhalt ändern). Codes: no_order, not_finished.
 */
export function completeTraining(
  base: BaseState,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; completed: TrainingOrder[] }> {
  if (base.trainingQueue.length === 0) return { ok: false, code: "no_order" };
  const due = base.trainingQueue
    .filter((o) => o.finishesAt <= nowMs)
    .sort((a, b) => a.finishesAt - b.finishesAt);
  if (due.length === 0) return { ok: false, code: "not_finished" };
  let next = base;
  for (const order of due) {
    next = settle(next, order.finishesAt, balance);
    const target = order.kind === "unit" ? next.units : next.defenses;
    target[order.id] = (target[order.id] ?? 0) + order.count;
    next.trainingQueue = next.trainingQueue.filter(
      (o) => !(o.builtIn === order.builtIn && o.finishesAt === order.finishesAt && o.id === order.id),
    );
  }
  return { ok: true, base: settle(next, nowMs, balance), completed: due.map((o) => ({ ...o })) };
}
