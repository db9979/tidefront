import type { Balance, BaseState, BuildOrder, ResourceMap, Result } from "./types.ts";
import { buildingLevel, hasResources, settle, subtractResources } from "./economy.ts";

/** Kosten für den Ausbau von Stufe `level` auf `level + 1`, je Ressource aufgerundet. */
export function upgradeCost(buildingId: string, level: number, balance: Balance): ResourceMap {
  const def = balance.buildings[buildingId];
  const cost: ResourceMap = {};
  for (const r of balance.resources) {
    cost[r] = Math.ceil((def.cost[r] ?? 0) * balance.building.costFactor ** level);
  }
  return cost;
}

/** Bauzeit in Sekunden für den Ausbau von Stufe `level` auf `level + 1`. */
export function upgradeSeconds(buildingId: string, level: number, balance: Balance): number {
  const def = balance.buildings[buildingId];
  return Math.min(balance.building.maxBuildSeconds, def.seconds * balance.building.timeFactor ** level);
}

/** Stufe nach allen eingereihten Aufträgen dieses Gebäudes (ohne Auftrag: die aktuelle Stufe). */
export function plannedLevel(base: BaseState, buildingId: string): number {
  let level = buildingLevel(base, buildingId);
  for (const o of base.buildQueue) if (o.buildingId === buildingId) level = Math.max(level, o.targetLevel);
  return level;
}

/**
 * Höchste erlaubte Stufe eines Gebäudes (maxLevel und Deckel über die Kommandozentrale).
 * Eingereihte Ausbauten der Kommandozentrale zählen mit.
 */
export function maxAllowedLevel(base: BaseState, buildingId: string, balance: Balance): number {
  const b = balance.building;
  if (buildingId === "kommandozentrale") return b.maxLevel;
  return Math.min(b.maxLevel, plannedLevel(base, "kommandozentrale") + b.levelCapAboveCommand);
}

export function commandPoints(base: BaseState, balance: Balance): number {
  const def = balance.buildings.kommandozentrale;
  return (
    (def.commandPointsBase ?? 0) +
    (def.commandPointsPerLevel ?? 0) * buildingLevel(base, "kommandozentrale")
  );
}

export function missionSlots(base: BaseState, balance: Balance): number {
  const def = balance.buildings.hafenkommandantur;
  const level = buildingLevel(base, "hafenkommandantur");
  return (def.missionSlotsBase ?? 0) + Math.floor(level / 2) * (def.missionSlotsPerTwoLevels ?? 0);
}

/** Börse freigeschaltet (Hafenkommandantur ab marketFromLevel)? */
export function harborMarketUnlocked(base: BaseState, balance: Balance): boolean {
  const def = balance.buildings.hafenkommandantur;
  return buildingLevel(base, "hafenkommandantur") >= (def.marketFromLevel ?? Infinity);
}

export function harborCreditLimit(base: BaseState, balance: Balance): number {
  const def = balance.buildings.hafenkommandantur;
  return (def.creditLimitPerLevel ?? 0) * buildingLevel(base, "hafenkommandantur");
}

/** Dauer eines Ausbauauftrags in Millisekunden (Bauzeit nach der Zielstufe). */
export function upgradeDurationMs(buildingId: string, targetLevel: number, balance: Balance): number {
  return Math.ceil(upgradeSeconds(buildingId, targetLevel - 1, balance) * 1000);
}

/**
 * Reiht einen Ausbau in die Bauschlange ein (höchstens building.queueSlots Aufträge). Die Zielstufe
 * berücksichtigt bereits eingereihte Aufträge desselben Gebäudes; die Kosten werden sofort bezahlt.
 * Der Auftrag beginnt, wenn der vorige fertig ist (frühestens jetzt).
 * Codes: unknown_building, queue_full, max_level, command_cap, insufficient_resources.
 */
export function startUpgrade(
  base: BaseState,
  buildingId: string,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; order: BuildOrder }> {
  if (!Object.hasOwn(balance.buildings, buildingId)) return { ok: false, code: "unknown_building" };
  if (base.buildQueue.length >= balance.building.queueSlots) return { ok: false, code: "queue_full" };
  const level = plannedLevel(base, buildingId);
  if (level + 1 > balance.building.maxLevel) return { ok: false, code: "max_level" };
  if (level + 1 > maxAllowedLevel(base, buildingId, balance)) return { ok: false, code: "command_cap" };
  const next = settle(base, nowMs, balance);
  const cost = upgradeCost(buildingId, level, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };
  next.resources = subtractResources(next.resources, cost);
  const last = next.buildQueue[next.buildQueue.length - 1];
  const startedAt = last === undefined ? nowMs : Math.max(nowMs, last.finishesAt);
  const order: BuildOrder = {
    buildingId,
    targetLevel: level + 1,
    startedAt,
    finishesAt: startedAt + upgradeDurationMs(buildingId, level + 1, balance),
  };
  next.buildQueue = [...next.buildQueue, order];
  return { ok: true, base: next, order: { ...order } };
}

/**
 * Schließt alle fälligen Bauaufträge der Reihe nach ab. Bestände werden jeweils bis zur
 * Fertigstellung mit den bisherigen Stufen und danach mit der neuen Stufe fortgeschrieben, zuletzt bis nowMs.
 * Codes: no_order, not_finished.
 */
export function completeUpgrade(
  base: BaseState,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; completed: BuildOrder[] }> {
  const first = base.buildQueue[0];
  if (first === undefined) return { ok: false, code: "no_order" };
  if (nowMs < first.finishesAt) return { ok: false, code: "not_finished" };
  let cur = base;
  const completed: BuildOrder[] = [];
  while (cur.buildQueue.length > 0 && cur.buildQueue[0].finishesAt <= nowMs) {
    const order = cur.buildQueue[0];
    const atFinish = settle(cur, order.finishesAt, balance);
    atFinish.buildings[order.buildingId] = Math.max(atFinish.buildings[order.buildingId] ?? 0, order.targetLevel);
    atFinish.buildQueue = atFinish.buildQueue.slice(1);
    completed.push({ ...order });
    cur = atFinish;
  }
  return { ok: true, base: settle(cur, nowMs, balance), completed };
}
