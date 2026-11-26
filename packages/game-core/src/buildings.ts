import type { Balance, BaseState, ResourceMap, Result } from "./types.ts";
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

/** Höchste derzeit erlaubte Stufe eines Gebäudes (maxLevel und Deckel über die Kommandozentrale). */
export function maxAllowedLevel(base: BaseState, buildingId: string, balance: Balance): number {
  const b = balance.building;
  if (buildingId === "kommandozentrale") return b.maxLevel;
  return Math.min(b.maxLevel, buildingLevel(base, "kommandozentrale") + b.levelCapAboveCommand);
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

/**
 * Startet einen Ausbau. Codes: unknown_building, queue_full, max_level, command_cap,
 * insufficient_resources.
 */
export function startUpgrade(
  base: BaseState,
  buildingId: string,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState }> {
  if (!Object.hasOwn(balance.buildings, buildingId)) return { ok: false, code: "unknown_building" };
  if (base.buildQueue.length >= 1) return { ok: false, code: "queue_full" };
  const level = buildingLevel(base, buildingId);
  if (level + 1 > balance.building.maxLevel) return { ok: false, code: "max_level" };
  if (level + 1 > maxAllowedLevel(base, buildingId, balance)) return { ok: false, code: "command_cap" };
  const next = settle(base, nowMs, balance);
  const cost = upgradeCost(buildingId, level, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };
  next.resources = subtractResources(next.resources, cost);
  const seconds = upgradeSeconds(buildingId, level, balance);
  next.buildQueue = [
    {
      buildingId,
      targetLevel: level + 1,
      startedAt: nowMs,
      finishesAt: nowMs + Math.ceil(seconds * 1000),
    },
  ];
  return { ok: true, base: next };
}

/**
 * Schließt den fälligen Bauauftrag ab. Bestände werden mit der alten Stufe bis zum
 * Fertigstellungszeitpunkt und mit der neuen Stufe bis nowMs fortgeschrieben.
 * Codes: no_order, not_finished.
 */
export function completeUpgrade(
  base: BaseState,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState }> {
  const order = base.buildQueue[0];
  if (order === undefined) return { ok: false, code: "no_order" };
  if (nowMs < order.finishesAt) return { ok: false, code: "not_finished" };
  const atFinish = settle(base, order.finishesAt, balance);
  atFinish.buildings[order.buildingId] = order.targetLevel;
  atFinish.buildQueue = atFinish.buildQueue.slice(1);
  return { ok: true, base: settle(atFinish, nowMs, balance) };
}
