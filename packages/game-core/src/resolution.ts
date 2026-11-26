// Abläufe nach Ankunft und Kampf: Ergebnis auf Stützpunkte anwenden, Aufklärung, Transport,
// Schwachziel, Wracks, Radar-Vorwarnzeit, Abbruch von Bau und Ausbildung.
import type { Balance, BaseState, BattleReport, Counts, DefenderInput, ResourceMap, Result } from "./types.ts";
import { addResources, bunkerProtection, buildingLevel, settle } from "./economy.ts";
import { upgradeCost } from "./buildings.ts";
import { trainingCost } from "./units.ts";
import { applyDefeatShield } from "./protection.ts";

const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// ---------------------------------------------------------------- Kampf vorbereiten

/** Ein Stützpunkt als Verteidiger: Einheiten daheim, Anlagen, Bestände, Bunkerschutz. */
export function defenderFromBase(base: BaseState, balance: Balance): DefenderInput {
  return {
    units: { ...base.units },
    defenses: { ...base.defenses },
    versorgungsmangel: base.versorgungsmangel,
    resources: { ...base.resources },
    protectedPerResource: bunkerProtection(base, balance),
  };
}

/** Stärke eines Stützpunkts für die Schwachziel-Regel: Summe aller Gebäudestufen. */
export function baseStrength(base: BaseState): number {
  let sum = 0;
  for (const level of Object.values(base.buildings)) sum += level;
  return sum;
}

/** Schwachziel: Stärke des Ziels unter weakTargetBelowShare der Stärke des Angreifers. */
export function isWeakTarget(attackerStrength: number, targetStrength: number, balance: Balance): boolean {
  return targetStrength < attackerStrength * balance.loot.weakTargetBelowShare;
}

// ---------------------------------------------------------------- Ergebnis anwenden

/**
 * Verteidiger nach dem Kampf: Einheiten und Anlagen auf den Endbestand (Überlebende plus Rückkehrer),
 * Beute abziehen (nie unter 0), bei verlorener Verteidigung Schutz nach Niederlage.
 * Der Stützpunkt wird zuvor auf nowMs fortgeschrieben.
 */
export function applyDefenseResult(base: BaseState, report: BattleReport, nowMs: number, balance: Balance): BaseState {
  const next = settle(base, nowMs, balance);
  for (const [id, n] of Object.entries(report.defender.final)) {
    if (Object.hasOwn(balance.defenses, id)) next.defenses[id] = n;
    else next.units[id] = n;
  }
  for (const [r, amount] of Object.entries(report.loot)) {
    next.resources[r] = Math.max(0, (next.resources[r] ?? 0) - amount);
  }
  if (report.winner === "attacker") {
    next.protection = applyDefeatShield(next.protection, nowMs, balance);
  }
  return next;
}

/**
 * Rückkehr einer Mission: `sent` verlässt unitsAway, `returning` kommt in den Bestand,
 * `cargo` (Beute, Wrackgut) wird gutgeschrieben, auch über die Lagerkapazität.
 */
export function returnMission(
  base: BaseState,
  sent: Counts,
  returning: Counts,
  cargo: ResourceMap,
  nowMs: number,
  balance: Balance,
): BaseState {
  const next = settle(base, nowMs, balance);
  for (const [id, n] of Object.entries(sent)) {
    next.unitsAway[id] = Math.max(0, (next.unitsAway[id] ?? 0) - n);
    if (next.unitsAway[id] === 0) delete next.unitsAway[id];
  }
  for (const [id, n] of Object.entries(returning)) {
    if (n > 0) next.units[id] = (next.units[id] ?? 0) + n;
  }
  next.resources = addResources(next.resources, cargo);
  return next;
}

/** Einheiten des Angreifers, die nach dem Kampf heimkehren (nur Einheiten des Verbands). */
export function attackerReturning(report: BattleReport): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(report.attacker.final)) if (n > 0) out[id] = n;
  return out;
}

/** Transport am Ziel: Ladung wird dem Zielstützpunkt gutgeschrieben (auch über die Kapazität). */
export function deliverCargo(base: BaseState, cargo: ResourceMap, nowMs: number, balance: Balance): BaseState {
  const next = settle(base, nowMs, balance);
  next.resources = addResources(next.resources, cargo);
  return next;
}

export interface ScoutReport {
  atMs: number;
  resources: ResourceMap;
  buildings: Counts;
  units: Counts;
  defenses: Counts;
  protectedPerResource: number;
}

/** Aufklärung am Ziel: Lagebild des fortgeschriebenen Zielstützpunkts. Bestände abgerundet. */
export function scoutBase(target: BaseState, nowMs: number, balance: Balance): ScoutReport {
  const s = settle(target, nowMs, balance);
  const resources: ResourceMap = {};
  for (const r of balance.resources) resources[r] = Math.floor(s.resources[r] ?? 0);
  return {
    atMs: nowMs,
    resources,
    buildings: { ...s.buildings },
    units: { ...s.units },
    defenses: { ...s.defenses },
    protectedPerResource: bunkerProtection(s, balance),
  };
}

// ---------------------------------------------------------------- Wracks

export interface WreckField {
  stahl: number;
  elektronik: number;
  createdAtMs: number;
}

/** Wrackgut verfällt linear über wreckHours; je Ressource abgerundet. */
export function wreckRemaining(w: WreckField, nowMs: number, balance: Balance): ResourceMap {
  const hours = Math.max(0, nowMs - w.createdAtMs) / HOUR_MS;
  const share = Math.max(0, 1 - hours / balance.combat.wreckHours);
  return { stahl: Math.floor(w.stahl * share + 1e-9), elektronik: Math.floor(w.elektronik * share + 1e-9) };
}

/**
 * Bergung: Ein Verband nimmt Wrackgut bis zur freien Ladekapazität mit, bei Knappheit
 * proportional gekürzt. Rückgabe: geborgen und verbleibend (verbleibend auf nowMs bezogen).
 */
export function salvageWreck(
  w: WreckField,
  freeCargo: number,
  nowMs: number,
  balance: Balance,
): { taken: ResourceMap; rest: WreckField } {
  const avail = wreckRemaining(w, nowMs, balance);
  const total = avail.stahl + avail.elektronik;
  const scale = total > freeCargo ? Math.max(0, freeCargo) / total : 1;
  const taken = { stahl: Math.floor(avail.stahl * scale + 1e-9), elektronik: Math.floor(avail.elektronik * scale + 1e-9) };
  // Der Rest behält das Alter des Felds: auf den ursprünglichen Bestand zurückgerechnet.
  const share = Math.max(0, 1 - Math.max(0, nowMs - w.createdAtMs) / HOUR_MS / balance.combat.wreckHours);
  const rest: WreckField = {
    stahl: share > 0 ? (avail.stahl - taken.stahl) / share : 0,
    elektronik: share > 0 ? (avail.elektronik - taken.elektronik) / share : 0,
    createdAtMs: w.createdAtMs,
  };
  return { taken, rest };
}

// ---------------------------------------------------------------- Radar

/** Vorwarnzeit in Minuten: ohne Radarstation 0, sonst warningMinutesBase + warningMinutesPerLevel * L. */
export function radarWarningMinutes(base: BaseState, balance: Balance): number {
  const level = buildingLevel(base, "radarstation");
  if (level < 1) return 0;
  const def = balance.buildings.radarstation;
  return (def.warningMinutesBase ?? 0) + (def.warningMinutesPerLevel ?? 0) * level;
}

/** Ein anfliegender Angriff ist erkannt, sobald er innerhalb der Vorwarnzeit liegt (spätestens bei Ankunft). */
export function isAttackDetected(arriveAtMs: number, nowMs: number, warningMinutes: number): boolean {
  return nowMs >= arriveAtMs - warningMinutes * MINUTE_MS;
}

// ---------------------------------------------------------------- Abbruch

function refundShare(startedAt: number, finishesAt: number, nowMs: number): number {
  const total = finishesAt - startedAt;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (finishesAt - nowMs) / total));
}

function scaled(cost: ResourceMap, share: number): ResourceMap {
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(cost)) out[r] = Math.floor(v * share + 1e-9);
  return out;
}

/**
 * Bricht den laufenden Ausbau ab. Erstattet wird der Anteil der Kosten, der der Restzeit entspricht
 * (abgerundet). Codes: no_order, already_finished.
 */
export function cancelUpgrade(
  base: BaseState,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; refund: ResourceMap }> {
  const order = base.buildQueue[0];
  if (order === undefined) return { ok: false, code: "no_order" };
  if (nowMs >= order.finishesAt) return { ok: false, code: "already_finished" };
  const cost = upgradeCost(order.buildingId, order.targetLevel - 1, balance);
  const refund = scaled(cost, refundShare(order.startedAt, order.finishesAt, nowMs));
  const next = settle(base, nowMs, balance);
  next.buildQueue = next.buildQueue.slice(1);
  next.resources = addResources(next.resources, refund);
  return { ok: true, base: next, refund };
}

/**
 * Bricht den Ausbildungsauftrag eines Baugebäudes (oder des Platzes "anlagen") ab; Erstattung wie
 * beim Ausbau. Codes: no_order, already_finished.
 */
export function cancelTraining(
  base: BaseState,
  builtIn: string,
  nowMs: number,
  balance: Balance,
): Result<{ base: BaseState; refund: ResourceMap }> {
  const order = base.trainingQueue.find((o) => o.builtIn === builtIn);
  if (order === undefined) return { ok: false, code: "no_order" };
  if (nowMs >= order.finishesAt) return { ok: false, code: "already_finished" };
  const cost = trainingCost(order.id, order.count, balance);
  const refund = scaled(cost, refundShare(order.startedAt, order.finishesAt, nowMs));
  const next = settle(base, nowMs, balance);
  next.trainingQueue = next.trainingQueue.filter((o) => o !== order && o.builtIn !== builtIn);
  next.resources = addResources(next.resources, refund);
  return { ok: true, base: next, refund };
}
