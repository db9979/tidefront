import type { Balance, BaseState, ResourceMap, Result, TrainingOrder } from "./types.ts";
import { buildingLevel, hasResources, settle, subtractResources } from "./economy.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry } from "./modifiers.ts";
import { diluteBase } from "./veterans.ts";
import { poweredFinishMs } from "./power.ts";

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

/** Bauzeit je Einheit in Sekunden bei Stufe `level` (>= 1) des Baugebäudes; `mods.trainingTime[builtIn]`. */
export function trainingSecondsPerUnit(unitId: string, level: number, balance: Balance, mods?: Modifiers): number {
  const def = balance.units[unitId];
  const speed = balance.buildings[def.builtIn ?? ""]?.buildSpeedPerLevel ?? 0;
  return ((def.seconds ?? 0) / (1 + speed * (level - 1))) * modEntry(mods, "trainingTime", def.builtIn ?? "");
}

/** Bauzeit je Verteidigungsanlage in Sekunden; `mods.trainingTime.anlagen`. */
export function defenseSecondsEach(defenseId: string, balance: Balance, mods?: Modifiers): number {
  return balance.defenses[defenseId].seconds * modEntry(mods, "trainingTime", DEFENSE_SLOT);
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
 * Codes: unknown_unit, bad_count, building_required, building_level (Stufe unter requiresLevel), supply_shortage, queue_busy,
 * no_aircraft_slots, harbor_level (Kolonieschiff: Hafenkommandantur unter expansion.harborLevelForShip), insufficient_resources.
 */
export function startTraining(
  base: BaseState,
  id: string,
  count: number,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; order: TrainingOrder }> {
  const isUnit = Object.hasOwn(balance.units, id);
  const isDefense = Object.hasOwn(balance.defenses, id);
  if (!isUnit && !isDefense) return { ok: false, code: "unknown_unit" };
  if (!isPositiveInt(count)) return { ok: false, code: "bad_count" };

  const next = settle(base, nowMs, balance, mods);
  let builtIn = DEFENSE_SLOT;
  let secondsEach = 0;
  if (isUnit) {
    const def = balance.units[id];
    builtIn = def.builtIn ?? "";
    const level = buildingLevel(base, builtIn);
    if (level < 1) return { ok: false, code: "building_required" };
    if (level < (def.requiresLevel ?? 1)) return { ok: false, code: "building_level" };
    const exp = balance.expansion; // Mehrere Häfen: Kolonieschiff erst ab einer Stufe der Hafenkommandantur
    if (exp && id === exp.colonyShip && buildingLevel(base, "hafenkommandantur") < exp.harborLevelForShip) return { ok: false, code: "harbor_level" };
    if (next.versorgungsmangel) return { ok: false, code: "supply_shortage" };
    secondsEach = trainingSecondsPerUnit(id, level, balance, mods);
  } else {
    secondsEach = defenseSecondsEach(id, balance, mods);
  }
  if (base.trainingQueue.some((o) => o.builtIn === builtIn)) return { ok: false, code: "queue_busy" };
  if (isUnit && balance.units[id].branch === "luft") {
    if (aircraftSlotsUsed(base, balance) + count > aircraftSlots(base, balance)) {
      return { ok: false, code: "no_aircraft_slots" };
    }
  }
  // Höchstzahl je Stufe (Spione): Bestand daheim, unterwegs und in Ausbildung zählt.
  if (isUnit && balance.units[id].maxPerLevel !== undefined) {
    let have = (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
    for (const o of base.trainingQueue) if (o.kind === "unit" && o.id === id) have += o.count;
    if (have + count > balance.units[id].maxPerLevel! * buildingLevel(base, builtIn)) return { ok: false, code: "unit_cap" };
  }
  const cost = trainingCost(id, count, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };

  next.resources = subtractResources(next.resources, cost);
  const workMs = Math.ceil(secondsEach * count * 1000);
  const order: TrainingOrder = {
    kind: isUnit ? "unit" : "defense",
    id,
    count,
    builtIn,
    startedAt: nowMs,
    finishesAt: nowMs + workMs,
  };
  // Strom (v1.6): Werft, Kaserne und Flugfeld sind Verbraucher im Rang 3. Die Fertigstellung wird beim Start
  // mit der Stromprognose (Wetter deterministisch) bestimmt und bleibt danach fest.
  if (isUnit && (balance.buildings[builtIn]?.powerPerLevel ?? 0) > 0) {
    const probe = { ...next, trainingQueue: [...next.trainingQueue, { ...order, finishesAt: Infinity }] };
    order.finishesAt = poweredFinishMs(probe, nowMs, workMs, "training", balance, mods);
  }
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
  mods?: Modifiers,
): Result<{ base: BaseState; completed: TrainingOrder[] }> {
  if (base.trainingQueue.length === 0) return { ok: false, code: "no_order" };
  const due = base.trainingQueue
    .filter((o) => o.finishesAt <= nowMs)
    .sort((a, b) => a.finishesAt - b.finishesAt);
  if (due.length === 0) return { ok: false, code: "not_finished" };
  let next = base;
  for (const order of due) {
    next = settle(next, order.finishesAt, balance, mods);
    // Veteranen: neue Rekruten verwässern die Erfahrung des Typs (gewichteter Mittelwert).
    if (order.kind === "unit") {
      const v = diluteBase(next, order.id, order.count);
      if (v) next.veterancy = v;
    }
    const target = order.kind === "unit" ? next.units : next.defenses;
    target[order.id] = (target[order.id] ?? 0) + order.count;
    next.trainingQueue = next.trainingQueue.filter(
      (o) => !(o.builtIn === order.builtIn && o.finishesAt === order.finishesAt && o.id === order.id),
    );
  }
  return { ok: true, base: settle(next, nowMs, balance, mods), completed: due.map((o) => ({ ...o })) };
}
