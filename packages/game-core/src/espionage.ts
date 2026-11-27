// Nachrichtendienst und Spionage (balance.espionage; REGELN.md, Abschnitt Nachrichtendienst). Rein und deterministisch:
// Der Wurf kommt aus dem beim Auslaufen gespeicherten Seed (eigener Würfelstrom), alle Werte aus Balance und Zustand.
//
// Probe (offener W20): Erfolgswert E = Grundwert + Stufe Nachrichtendienst des Absenders + Forschung (Agentenschulung)
// + Erfahrung + Zuschlag der Auftragsart. Abwehr A = Stufe Nachrichtendienst des Ziels + Forschung (Verschlüsselung)
// bzw. fester Wert des Kartells. Zielzahl Z = E − A, begrenzt auf 1 … die−1. Erfolg bei Wurf ≤ Z, sonst enttarnt.
// Damit gelingt eine 1 immer und eine 20 scheitert immer; Erfolgschance = Z / die.
import type { Balance, BaseState, Counts, GeoPoint, Mission, ResourceMap, Result } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { modValue } from "./modifiers.ts";
import { mulberry32 } from "./rng.ts";
import { rollDie } from "./luck.ts";
import { settle } from "./economy.ts";
import { missionSlots } from "./buildings.ts";
import { distanceKm } from "./geo.ts";
import type { ScoutReport } from "./resolution.ts";

export type SpyKind = "erkunden" | "sabotage" | "desinformation" | "kartell";
export const SPY_KINDS: readonly SpyKind[] = ["erkunden", "sabotage", "desinformation", "kartell"];
/** Sabotageziel „Bauschlange“: verzögert den laufenden Ausbau statt ein Gebäude stillzulegen. */
export const SABOTAGE_QUEUE = "bauschlange";

export interface SpyKindDef {
  /** Mindeststufe des Nachrichtendiensts. */
  minLevel: number;
  /** Spione je Auftrag (alle gehen bei Enttarnung verloren). */
  spies: number;
  /** Zuschlag auf den Erfolgswert (negativ = schwerer). */
  bonus: number;
  /** Nur Kartell: feste Reisedauer je Richtung in Stunden und Abwehr des Kartells. */
  hours?: number;
  defense?: number;
}

export interface EspionageBalance {
  building: string;
  unit: string;
  die: number;
  base: number;
  attackPerLevel: number;
  defensePerLevel: number;
  /** Erfahrung: je xpPerPoint erfolgreiche Aufträge +1, höchstens maxXpPoints. */
  xpPerPoint: number;
  maxXpPoints: number;
  /** Reisetempo der Spione (unauffällig mit Kurierbooten, ohne Treibstoff). */
  speedKmh: number;
  /** Ab dieser Stufe zeigt „Erkunden“ auch die laufenden Missionen des Ziels. */
  missionsFromLevel: number;
  kinds: Record<SpyKind, SpyKindDef>;
  sabotage: {
    hours: number;
    delayHours: number;
    cooldownHours: number;
    targets: string[];
    productionFactor: number;
    trainingFactor: number;
    researchFactor: number;
  };
  disinfo: { hours: number; forceFactor: number; resourceFactor: number };
}

export interface SabotageState {
  /** Gebäude-ID oder "bauschlange". */
  target: string;
  fromMs: number;
  untilMs: number;
}

/** Nachrichtendienst-Zustand eines Stützpunkts (BaseState.intel). */
export interface IntelState {
  /** Laufende Sabotage in diesem Hafen (nicht zerstörerisch, endet mit untilMs). */
  sabotage?: SabotageState | null;
  /** Letzte gelungene Sabotage gegen diesen Hafen (Sperrfrist). */
  lastSabotageAtMs?: number;
  /** Desinformation dieses Hafens: Spieler-ID → gültig bis. Dieser Spieler sieht im nächsten Lagebild verfälschte Zahlen. */
  disinfo?: Record<string, number>;
  /** Gelungene Spionageaufträge (Erfahrung). */
  successes?: number;
}

/** Aufgeschlüsselter Wert einer Probe (für Vorschau und Bericht). */
export interface SpyValue {
  total: number;
  parts: { id: string; value: number }[];
}

export interface SpyRoll {
  roll: number;
  die: number;
  /** Zielzahl: Erfolg bei Wurf ≤ threshold. */
  threshold: number;
  success: boolean;
}

/** Spionage-Teil eines Missionsplans (mission.plan.spy). */
export interface SpyPlan {
  kind: SpyKind;
  /** Sabotageziel (Gebäude oder "bauschlange"). */
  building?: string;
  seed: number;
  spies: number;
  /** Chance beim Auslaufen (Anzeige); entschieden wird bei Ankunft mit den dann gültigen Werten. */
  chance: number;
}

export type SpyMission = Omit<Mission, "type"> & { type: "spionage"; spy: SpyPlan };

const HOUR_MS = 3600000;
/** Versatz des Spionage-Würfelstroms gegenüber dem Seed ("SPY!"). */
export const SPY_SEED_SALT = 0x53505921;

export function espionageOf(balance: Balance): EspionageBalance | null {
  return balance.espionage ?? null;
}

export function intelLevel(base: BaseState | null | undefined, balance: Balance): number {
  const e = espionageOf(balance);
  return e && base ? base.buildings[e.building] ?? 0 : 0;
}

/** Höchstzahl Spione eines Hafens (daheim, unterwegs und in Ausbildung). */
export function spyCap(base: BaseState, balance: Balance): number {
  const e = espionageOf(balance);
  if (!e) return 0;
  return (balance.units[e.unit]?.maxPerLevel ?? 0) * intelLevel(base, balance);
}

/** Modifikator-Faktor in Würfelpunkte: 1,1 → +1, 1,3 → +3 (Forschung mit perLevel 0,1). */
export function modPoints(factor: number): number {
  return Math.round((factor - 1) * 10);
}

function xpPoints(base: BaseState, e: EspionageBalance): number {
  return Math.min(e.maxXpPoints, Math.floor((base.intel?.successes ?? 0) / Math.max(1, e.xpPerPoint)));
}

/** Erfolgswert des Absenders für eine Auftragsart. */
export function spySuccessValue(base: BaseState, kind: SpyKind, balance: Balance, mods?: Modifiers): SpyValue {
  const e = espionageOf(balance)!;
  const parts = [
    { id: "grundwert", value: e.base },
    { id: "nachrichtendienst", value: intelLevel(base, balance) * e.attackPerLevel },
    { id: "forschung", value: modPoints(modValue(mods, "spyAttack")) },
    { id: "erfahrung", value: xpPoints(base, e) },
    { id: "auftrag", value: e.kinds[kind]?.bonus ?? 0 },
  ];
  return { total: parts.reduce((s, p) => s + p.value, 0), parts };
}

/** Abwehr des Ziels (Hafen) bzw. des Kartells (target null, Art kartell). */
export function spyDefenseValue(target: BaseState | null, kind: SpyKind, balance: Balance, targetMods?: Modifiers): SpyValue {
  const e = espionageOf(balance)!;
  if (kind === "kartell" || target === null) {
    const v = e.kinds.kartell?.defense ?? 0;
    return { total: v, parts: [{ id: "kartell", value: v }] };
  }
  const parts = [
    { id: "nachrichtendienst", value: intelLevel(target, balance) * e.defensePerLevel },
    { id: "forschung", value: modPoints(modValue(targetMods, "spyDefense")) },
  ];
  return { total: parts.reduce((s, p) => s + p.value, 0), parts };
}

/** Zielzahl 1 … die−1. */
export function spyThreshold(success: number, defense: number, die: number): number {
  return Math.min(die - 1, Math.max(1, Math.round(success - defense)));
}

/** Erfolgschance (0..1) einer Probe. */
export function spyChance(success: number, defense: number, die: number): number {
  return spyThreshold(success, defense, die) / die;
}

/** Wurf aus dem gespeicherten Seed (unabhängig von anderen Würfelströmen). */
export function spyRollOf(seed: number, die: number): number {
  return rollDie(mulberry32((seed ^ SPY_SEED_SALT) >>> 0), die);
}

export function resolveSpy(seed: number, success: number, defense: number, die: number): SpyRoll {
  const roll = spyRollOf(seed, die);
  const threshold = spyThreshold(success, defense, die);
  return { roll, die, threshold, success: roll <= threshold };
}

/** Spione eines Hafens: daheim, unterwegs, in Ausbildung. */
export function spyCount(base: BaseState, balance: Balance): { home: number; away: number; training: number } {
  const id = espionageOf(balance)?.unit ?? "";
  let training = 0;
  for (const o of base.trainingQueue) if (o.kind === "unit" && o.id === id) training += o.count;
  return { home: base.units[id] ?? 0, away: base.unitsAway[id] ?? 0, training };
}

/** Ende der Sabotage-Sperrfrist eines Hafens (0, wenn nie sabotiert). */
export function sabotageCooldownUntil(base: BaseState, balance: Balance): number {
  const e = espionageOf(balance);
  const last = base.intel?.lastSabotageAtMs;
  return e && last !== undefined ? last + e.sabotage.cooldownHours * HOUR_MS : 0;
}

/** Laufende Sabotage zum Zeitpunkt nowMs (sonst null). */
export function activeSabotage(base: BaseState | null | undefined, nowMs: number): SabotageState | null {
  const s = base?.intel?.sabotage;
  return s && s.fromMs <= nowMs && nowMs < s.untilMs ? s : null;
}

/**
 * Wirkung einer laufenden Sabotage als Modifikatoren: Kraftwerk → Gebäudeproduktion mal productionFactor,
 * Radarstation → keine Vorwarnung, Werft/Kaserne/Flugfeld → neue Ausbildung dort mal trainingFactor,
 * Forschungsamt → neue Forschung mal researchFactor. Bauschlange: keine Dauerwirkung (nur Verzögerung).
 * Seekabel: Kabel unterbrochen (in der Fortschreibung, power-green.ts).
 */
export function sabotageModifiers(base: BaseState | null | undefined, nowMs: number, balance: Balance): Modifiers {
  const e = espionageOf(balance);
  const s = activeSabotage(base, nowMs);
  if (!e || !s) return {};
  const t = e.sabotage;
  if (s.target === "kraftwerk") return { production: Object.fromEntries(balance.resources.map((r) => [r, t.productionFactor])) };
  if (s.target === "radarstation") return { radarWarning: 0 };
  if (s.target === "forschungsamt") return { researchTime: t.researchFactor };
  if (s.target === SABOTAGE_QUEUE) return {};
  // Seekabel (v1.21): Die Station liefert und bezieht nichts (power-green.ts cableSabotaged), keine Modifikatoren.
  if (balance.buildings[s.target]?.cablePerLevel) return {};
  return { trainingTime: { [s.target]: t.trainingFactor } };
}

function cloneIntel(base: BaseState): IntelState {
  const i = base.intel ?? {};
  return { ...i, ...(i.sabotage ? { sabotage: { ...i.sabotage } } : {}), ...(i.disinfo ? { disinfo: { ...i.disinfo } } : {}) };
}

export interface SabotageResult {
  base: BaseState;
  sabotage: SabotageState;
  /** Verschobene Aufträge: neue Fertigstellungszeiten (der Server plant dafür Ereignisse). */
  training: number[];
  research: number | null;
  build: number[];
}

/**
 * Gelungene Sabotage am Ziel. `mods`: Modifikatoren des Ziels ohne die neue Sabotage (fortschreiben bis nowMs).
 * Gebäude: Ausfall für sabotage.hours; laufende Ausbildung bzw. Forschung dort verschiebt sich um diese Dauer.
 * Bauschlange: alle Bauaufträge verschieben sich um delayHours. Codes: unknown_target.
 */
export function applySabotage(base: BaseState, target: string, nowMs: number, balance: Balance, mods?: Modifiers): Result<SabotageResult> {
  const e = espionageOf(balance);
  if (!e || !e.sabotage.targets.includes(target)) return { ok: false, code: "bad_sabotage_target" };
  const next = settle(base, nowMs, balance, mods);
  const queue = target === SABOTAGE_QUEUE;
  const shift = (queue ? e.sabotage.delayHours : e.sabotage.hours) * HOUR_MS;
  const sabotage: SabotageState = { target, fromMs: nowMs, untilMs: nowMs + shift };
  next.intel = { ...cloneIntel(next), sabotage, lastSabotageAtMs: nowMs };
  const training: number[] = [];
  let research: number | null = null;
  const build: number[] = [];
  if (queue) {
    next.buildQueue = next.buildQueue.map((o) => {
      const moved = { ...o, startedAt: o.startedAt > nowMs ? o.startedAt + shift : o.startedAt, finishesAt: o.finishesAt + shift };
      build.push(moved.finishesAt);
      return moved;
    });
  } else if (target === "forschungsamt") {
    const order = next.research?.order;
    if (next.research && order && order.finishesAt > nowMs) {
      next.research = { ...next.research, order: { ...order, finishesAt: order.finishesAt + shift } };
      research = order.finishesAt + shift;
    }
  } else {
    next.trainingQueue = next.trainingQueue.map((o) => {
      if (o.builtIn !== target || o.finishesAt <= nowMs) return o;
      training.push(o.finishesAt + shift);
      return { ...o, finishesAt: o.finishesAt + shift };
    });
  }
  return { ok: true, base: next, sabotage, training, research, build };
}

/** Sabotage beendet (Ereignis zum Ende): Zustand entfernen, wenn abgelaufen. */
export function clearSabotage(base: BaseState, nowMs: number): BaseState {
  const s = base.intel?.sabotage;
  if (!s || s.untilMs > nowMs) return base;
  const intel = cloneIntel(base);
  delete intel.sabotage;
  return { ...base, intel };
}

/** Desinformation hinterlegen: `viewerPlayerId` sieht bis untilMs im nächsten Lagebild dieses Hafens falsche Zahlen. */
export function addDisinfo(base: BaseState, viewerPlayerId: number, untilMs: number): BaseState {
  const intel = cloneIntel(base);
  intel.disinfo = { ...(intel.disinfo ?? {}), [String(viewerPlayerId)]: untilMs };
  return { ...base, intel };
}

/** Desinformation einlösen (einmalig): wirkt sie für diesen Betrachter? Abgelaufene Einträge fallen weg. */
export function takeDisinfo(base: BaseState, viewerPlayerId: number, nowMs: number): { base: BaseState; active: boolean; changed: boolean } {
  const d = base.intel?.disinfo;
  if (!d) return { base, active: false, changed: false };
  const left: Record<string, number> = {};
  for (const [k, until] of Object.entries(d)) if (until > nowMs) left[k] = until;
  const key = String(viewerPlayerId);
  const active = (left[key] ?? 0) > nowMs;
  if (active) delete left[key];
  const changed = Object.keys(left).length !== Object.keys(d).length;
  if (!changed) return { base, active, changed };
  const intel = cloneIntel(base);
  if (Object.keys(left).length > 0) intel.disinfo = left;
  else delete intel.disinfo;
  return { base: { ...base, intel }, active, changed };
}

function scale(c: Counts | ResourceMap, f: number, round: (x: number) => number): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(c)) out[k] = round(v * f);
  return out;
}

/** Verfälschtes Lagebild: Truppen und Anlagen mal forceFactor (gerundet), Bestände mal resourceFactor (abgerundet). */
export function falsifyScout(scout: ScoutReport, balance: Balance): ScoutReport {
  const d = espionageOf(balance)?.disinfo;
  if (!d) return scout;
  return {
    ...scout,
    units: scale(scout.units, d.forceFactor, Math.round),
    defenses: scale(scout.defenses, d.forceFactor, Math.round),
    resources: scale(scout.resources, d.resourceFactor, Math.floor),
    protectedPerResource: Math.floor(scout.protectedPerResource * d.resourceFactor),
  };
}

/** Erfahrung nach einem gelungenen Auftrag. */
export function recordSpySuccess(base: BaseState): BaseState {
  const intel = cloneIntel(base);
  intel.successes = (intel.successes ?? 0) + 1;
  return { ...base, intel };
}

/** Enttarnt: die Spione des Auftrags gehen verloren (verlassen unitsAway). `mods` für das Fortschreiben (Unterhalt). */
export function loseSpies(base: BaseState, n: number, nowMs: number, balance: Balance, mods?: Modifiers): BaseState {
  const id = espionageOf(balance)?.unit ?? "";
  const next = settle(base, nowMs, balance, mods);
  next.unitsAway[id] = Math.max(0, (next.unitsAway[id] ?? 0) - n);
  if (next.unitsAway[id] === 0) delete next.unitsAway[id];
  return next;
}

export interface SpyLaunchInput {
  kind: string;
  origin: GeoPoint;
  /** Zielpunkt; beim Kartell ohne (feste Reisedauer). */
  target: GeoPoint | null;
  activeMissions: number;
  building?: string;
  seed: number;
  /** Chance zur Anzeige (vom Aufrufer berechnet). */
  chance: number;
}

/** Prüft Art, Stufe und Spione ohne Änderung. Codes: no_espionage, bad_spy_kind, building_required, spy_level, no_spies, bad_sabotage_target. */
export function spyLaunchCheck(base: BaseState, kind: string, building: string | undefined, balance: Balance): Result<{ kind: SpyKind; def: SpyKindDef }> {
  const e = espionageOf(balance);
  if (!e) return { ok: false, code: "no_espionage" };
  if (!(SPY_KINDS as readonly string[]).includes(kind)) return { ok: false, code: "bad_spy_kind" };
  const k = kind as SpyKind;
  const def = e.kinds[k];
  const level = intelLevel(base, balance);
  if (level < 1) return { ok: false, code: "building_required" };
  if (level < def.minLevel) return { ok: false, code: "spy_level" };
  if (k === "sabotage" && (building === undefined || !e.sabotage.targets.includes(building))) return { ok: false, code: "bad_sabotage_target" };
  if ((base.units[e.unit] ?? 0) < def.spies) return { ok: false, code: "no_spies" };
  return { ok: true, kind: k, def };
}

/**
 * Plant einen Spionageauftrag: prüft Art, Stufe, Spione und Missionsplatz, verschiebt die Spione nach unitsAway.
 * Reise ohne Treibstoff mit speedKmh, beim Kartell feste Dauer je Richtung. Codes: siehe spyLaunchCheck, no_mission_slot.
 */
export function planSpyMission(base: BaseState, input: SpyLaunchInput, nowMs: number, balance: Balance, mods?: Modifiers): Result<{ base: BaseState; mission: SpyMission }> {
  const c = spyLaunchCheck(base, input.kind, input.building, balance);
  if (!c.ok) return c;
  if (input.activeMissions >= missionSlots(base, balance)) return { ok: false, code: "no_mission_slot" };
  const e = espionageOf(balance)!;
  const dist = input.target ? distanceKm(input.origin, input.target) : 0;
  const seconds = c.kind === "kartell" ? (c.def.hours ?? 1) * 3600 : (dist / e.speedKmh) * 3600;
  const travelMs = Math.ceil(seconds * 1000);
  const next = settle(base, nowMs, balance, mods);
  next.units[e.unit] = (next.units[e.unit] ?? 0) - c.def.spies;
  next.unitsAway[e.unit] = (next.unitsAway[e.unit] ?? 0) + c.def.spies;
  const mission: SpyMission = {
    type: "spionage",
    units: { [e.unit]: c.def.spies },
    origin: { ...input.origin },
    target: { ...(input.target ?? input.origin) },
    distanceKm: dist,
    travelSeconds: seconds,
    fuelCost: 0,
    cargo: {},
    departAtMs: nowMs,
    arriveAtMs: nowMs + travelMs,
    returnAtMs: nowMs + 2 * travelMs,
    spy: { kind: c.kind, ...(c.kind === "sabotage" ? { building: input.building } : {}), seed: input.seed >>> 0, spies: c.def.spies, chance: input.chance },
  };
  return { ok: true, base: next, mission };
}
