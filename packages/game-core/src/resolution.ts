// Abläufe nach Ankunft und Kampf: Ergebnis auf Stützpunkte anwenden, Aufklärung, Transport,
// Schwachziel, Wracks, Radar-Vorwarnzeit, Abbruch von Bau und Ausbildung.
import type {
  Balance,
  BaseState,
  BattleReport,
  BuildOrder,
  Counts,
  DefenderInput,
  ResourceMap,
  Result,
} from "./types.ts";
import { addResources, bunkerProtection, buildingLevel, settle } from "./economy.ts";
import { upgradeCost } from "./buildings.ts";
import { trainingCost } from "./units.ts";
import { applyDefeatShield } from "./protection.ts";
import { battleVeterancy } from "./veterans.ts";
import type { Modifiers } from "./modifiers.ts";
import { modValue } from "./modifiers.ts";
import { powerAt } from "./power.ts";

const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// ---------------------------------------------------------------- Kampf vorbereiten

/** Ein Stützpunkt als Verteidiger: Einheiten daheim, Anlagen, Bestände, Bunkerschutz (mit `mods`, die auch im Kampf wirken). */
export function defenderFromBase(base: BaseState, balance: Balance, mods?: Modifiers): DefenderInput {
  return {
    units: { ...base.units },
    defenses: { ...base.defenses },
    versorgungsmangel: base.versorgungsmangel,
    resources: { ...base.resources },
    protectedPerResource: bunkerProtection(base, balance, mods),
    ...(mods ? { modifiers: mods } : {}),
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
export function applyDefenseResult(base: BaseState, report: BattleReport, nowMs: number, balance: Balance, mods?: Modifiers): BaseState {
  const next = settle(base, nowMs, balance, mods);
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
  // Veteranen: Erfahrung der verteidigenden Einheiten (Bestand ist schon der Endbestand).
  const v = battleVeterancy(next, report, "defender", balance);
  if (v && Object.keys(v).length > 0) next.veterancy = v;
  else delete next.veterancy;
  return next;
}

/**
 * Erfahrung des Angreifers nach der Rückkehr seines Verbands anwenden (`base` nach returnMission).
 * Der Server ruft das mit dem gespeicherten Kampfbericht der Mission auf.
 */
export function applyAttackExperience(base: BaseState, report: BattleReport, balance: Balance): BaseState {
  const v = battleVeterancy(base, report, "attacker", balance);
  const next = { ...base };
  if (v && Object.keys(v).length > 0) next.veterancy = v;
  else delete next.veterancy;
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
  mods?: Modifiers,
): BaseState {
  const next = settle(base, nowMs, balance, mods);
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
export function deliverCargo(base: BaseState, cargo: ResourceMap, nowMs: number, balance: Balance, mods?: Modifiers): BaseState {
  const next = settle(base, nowMs, balance, mods);
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
  /** Nebel am Ziel (v1.6): Sichtung unsicher, Zahlen gerundet; fehlt bei klarer Sicht. */
  uncertain?: { fog: number; heavy: boolean };
}

/** Rundet eine Zahl auf `digits` gültige Stellen (Nebel im Lagebild). */
function roughly(n: number, digits: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) + 1 - digits);
  return Math.max(1, Math.round(n / p) * p);
}

/** Zählung im Nebel: kleine Zahlen auf 5 (dichter Nebel: 10) gerundet, mindestens 1, wenn etwas da ist. */
function roughCount(n: number, heavy: boolean): number {
  if (n <= 0) return 0;
  const step = heavy ? 10 : 5;
  return n < step ? (heavy ? step : n) : Math.round(n / step) * step;
}

/**
 * Aufklärung am Ziel: Lagebild des fortgeschriebenen Zielstützpunkts. Bestände abgerundet.
 * Nebel am Ziel (`fog`, v1.6): ab weather.fogScoutFrom ist die Sichtung unsicher (Bestände auf zwei gültige
 * Stellen, Einheiten und Anlagen auf 5 gerundet), ab fogScoutHeavy grob (eine Stelle, auf 10). Gebäude bleiben sichtbar.
 */
export function scoutBase(target: BaseState, nowMs: number, balance: Balance, targetMods?: Modifiers, fog = 0): ScoutReport {
  const s = settle(target, nowMs, balance, targetMods);
  const wb = balance.weather;
  const blur = !!wb && fog >= wb.fogScoutFrom;
  const heavy = !!wb && fog >= wb.fogScoutHeavy;
  const resources: ResourceMap = {};
  for (const r of balance.resources) {
    const v = Math.floor(s.resources[r] ?? 0);
    resources[r] = blur ? roughly(v, heavy ? 1 : 2) : v;
  }
  const count = (c: Counts): Counts => {
    if (!blur) return { ...c };
    const out: Counts = {};
    for (const [id, n] of Object.entries(c)) out[id] = roughCount(n, heavy);
    return out;
  };
  return {
    atMs: nowMs,
    resources,
    buildings: { ...s.buildings },
    units: count(s.units),
    defenses: count(s.defenses),
    protectedPerResource: bunkerProtection(s, balance, targetMods),
    ...(blur ? { uncertain: { fog: Math.round(fog * 100) / 100, heavy } } : {}),
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

/**
 * Vorwarnzeit in Minuten: ohne Radarstation 0, sonst (warningMinutesBase + warningMinutesPerLevel * L) mal `mods.radarWarning`
 * (Forschung, Nebel als Quelle „Wetter“) mal versorgtem Stromanteil des Radars zum Stand des Stützpunkts (v1.6, ohne Strom 0).
 */
export function radarWarningMinutes(base: BaseState, balance: Balance, mods?: Modifiers): number {
  const level = buildingLevel(base, "radarstation");
  if (level < 1) return 0;
  const def = balance.buildings.radarstation;
  const powered = def.powerPerLevel ? powerAt(base, base.resUpdatedAt, balance, mods).served.radar : 1;
  return ((def.warningMinutesBase ?? 0) + (def.warningMinutesPerLevel ?? 0) * level) * modValue(mods, "radarWarning") * powered;
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
 * Bricht einen Auftrag der Bauschlange ab (Index, 0 = laufender Auftrag). Der laufende Auftrag wird
 * nach Restzeit erstattet (abgerundet), ein noch nicht begonnener voll. Die Aufträge dahinter rücken nach
 * (Start frühestens jetzt). Hätte ein späterer Auftrag danach eine ungültige Stufe (Stufenfolge oder
 * Deckel über die Kommandozentrale), wird er ebenfalls voll erstattet und entfernt, ebenso alle
 * folgenden desselben Gebäudes. Codes: no_order, already_finished.
 */
export function cancelUpgrade(
  base: BaseState,
  nowMs: number,
  balance: Balance,
  index = 0,
  mods?: Modifiers,
): Result<{ base: BaseState; refund: ResourceMap; removed: BuildOrder[] }> {
  const order = Number.isInteger(index) && index >= 0 ? base.buildQueue[index] : undefined;
  if (order === undefined) return { ok: false, code: "no_order" };
  if (nowMs >= order.finishesAt) return { ok: false, code: "already_finished" };
  const cost = upgradeCost(order.buildingId, order.targetLevel - 1, balance);
  const share = order.startedAt <= nowMs ? refundShare(order.startedAt, order.finishesAt, nowMs) : 1;
  let refund = scaled(cost, share);
  const removed: BuildOrder[] = [{ ...order }];

  const next = settle(base, nowMs, balance, mods);
  const levels: Counts = { ...next.buildings };
  const queue: BuildOrder[] = [];
  let prevEnd: number | null = null;
  next.buildQueue.forEach((o, i) => {
    if (i === index) return;
    const level = levels[o.buildingId] ?? 0;
    const cap =
      o.buildingId === "kommandozentrale"
        ? balance.building.maxLevel
        : Math.min(balance.building.maxLevel, (levels.kommandozentrale ?? 0) + balance.building.levelCapAboveCommand);
    if (o.targetLevel !== level + 1 || o.targetLevel > cap) {
      // Nicht mehr gültig: noch nicht begonnen, also voll erstatten.
      refund = addResources(refund, upgradeCost(o.buildingId, o.targetLevel - 1, balance));
      removed.push({ ...o });
      return;
    }
    levels[o.buildingId] = o.targetLevel;
    if (i > index) {
      const duration = o.finishesAt - o.startedAt;
      const startedAt = Math.max(nowMs, prevEnd ?? nowMs);
      queue.push({ ...o, startedAt, finishesAt: startedAt + duration });
    } else {
      queue.push({ ...o });
    }
    prevEnd = queue[queue.length - 1].finishesAt;
  });
  next.buildQueue = queue;
  next.resources = addResources(next.resources, refund);
  return { ok: true, base: next, refund, removed };
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
  mods?: Modifiers,
): Result<{ base: BaseState; refund: ResourceMap }> {
  const order = base.trainingQueue.find((o) => o.builtIn === builtIn);
  if (order === undefined) return { ok: false, code: "no_order" };
  if (nowMs >= order.finishesAt) return { ok: false, code: "already_finished" };
  const cost = trainingCost(order.id, order.count, balance);
  const refund = scaled(cost, refundShare(order.startedAt, order.finishesAt, nowMs));
  const next = settle(base, nowMs, balance, mods);
  next.trainingQueue = next.trainingQueue.filter((o) => o !== order && o.builtIn !== builtIn);
  next.resources = addResources(next.resources, refund);
  return { ok: true, base: next, refund };
}
