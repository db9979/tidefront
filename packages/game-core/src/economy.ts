import type { Balance, BaseState, Counts, GeoPoint, ProductionInfo, ResearchState, ResourceMap } from "./types.ts";
import { createProtection } from "./protection.ts";
import type { Modifiers } from "./modifiers.ts";
import { modValue } from "./modifiers.ts";
import { integrateGrid, powerAt } from "./power.ts";
import { clonePowerLog } from "./power-green.ts";

/** Angriffswert-Faktor bei Versorgungsmangel (REGELN.md, Abschnitt Ressourcen; nicht in balance.json). */
export const SUPPLY_SHORTAGE_ATTACK_FACTOR = 0.8;

function cloneResearch(r: ResearchState): ResearchState {
  return {
    ...r,
    levels: { ...r.levels },
    order: r.order ? { ...r.order, cost: { ...r.order.cost } } : null,
    ...(r.lastRoll ? { lastRoll: { ...r.lastRoll } } : {}),
  };
}

export function cloneBase(base: BaseState): BaseState {
  return {
    resources: { ...base.resources },
    resUpdatedAt: base.resUpdatedAt,
    buildings: { ...base.buildings },
    units: { ...base.units },
    unitsAway: { ...base.unitsAway },
    defenses: { ...base.defenses },
    buildQueue: base.buildQueue.map((o) => ({ ...o })),
    trainingQueue: base.trainingQueue.map((o) => ({ ...o })),
    versorgungsmangel: base.versorgungsmangel,
    protection: { ...base.protection },
    ...(base.research
      ? { research: cloneResearch(base.research) }
      : {}),
    ...(base.veterancy ? { veterancy: { ...base.veterancy } } : {}),
    ...(base.intel ? { intel: structuredClone(base.intel) } : {}),
    ...(base.site ? { site: { ...base.site } } : {}),
    ...(base.powerStored !== undefined ? { powerStored: base.powerStored } : {}),
    ...(base.powerLog ? { powerLog: clonePowerLog(base.powerLog) } : {}),
    ...(base.cable ? { cable: { ...base.cable } } : {}),
    // Außenposten-Markierung: ohne sie greifen die Sperren für Gebäude nur im Heimathafen nach jedem settle nicht mehr.
    ...(base.colony ? { colony: { ...base.colony } } : {}),
    // Lagebild Stufe 3: gestartete Satelliten (sonst verschwänden sie beim nächsten settle).
    ...(base.satellites ? { satellites: base.satellites.map((s) => ({ ...s, ...(s.last ? { last: { ...s.last } } : {}) })) } : {}),
  };
}

/** Neuer Stützpunkt: Startbestände, alle Gebäude auf Stufe 0, keine Einheiten. */
export function createBase(balance: Balance, nowMs: number, site?: GeoPoint): BaseState {
  const resources: ResourceMap = {};
  for (const r of balance.resources) resources[r] = balance.start[r] ?? 0;
  const buildings: Counts = {};
  for (const id of Object.keys(balance.buildings)) buildings[id] = 0;
  return {
    resources,
    resUpdatedAt: nowMs,
    buildings,
    units: {},
    unitsAway: {},
    defenses: {},
    buildQueue: [],
    trainingQueue: [],
    versorgungsmangel: false,
    protection: createProtection(nowMs),
    ...(site ? { site: { lat: site.lat, lon: site.lon } } : {}),
  };
}

export function buildingLevel(base: BaseState, buildingId: string): number {
  return base.buildings[buildingId] ?? 0;
}

/** Proviant-Unterhalt je Stunde aller Einheiten des Stützpunkts (daheim und auf Mission). */
export function upkeepPerHour(base: BaseState, balance: Balance): number {
  let sum = 0;
  for (const [id, def] of Object.entries(balance.units)) {
    const n = (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
    sum += (def.upkeepPerHour ?? 0) * n;
  }
  return sum;
}

/** Nennleistung der Kraftwerke (ohne Wind, Sonne, Speicher und Treibstoffmangel). */
export function powerSupply(base: BaseState, balance: Balance): number {
  let sum = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    sum += (def.powerSupplyPerLevel ?? 0) * buildingLevel(base, id);
  }
  return sum;
}

/**
 * Produktionsraten je Stunde im Augenblick `atMs` (Vorgabe: resUpdatedAt) inklusive Stromnetz (Rangfolge,
 * Wind, Sonne, Speicher, Kraftwerk-Treibstoff) und Proviant-Unterhalt; `mods.production` wirkt auf die Gebäudeproduktion.
 * powerSupply = Angebot einschließlich Entladung, powerDemand = Bedarf aller Ränge, powerFactor = versorgter Anteil der Produktion.
 */
export function productionRates(base: BaseState, balance: Balance, mods?: Modifiers, atMs = base.resUpdatedAt): ProductionInfo {
  const grid = powerAt(base, atMs, balance, mods);
  const s = grid.supply;
  const d = grid.demand;
  return {
    perHour: grid.perHour,
    buildingPerHour: grid.buildingPerHour,
    powerSupply: s.kraftwerk + s.wind + s.solar + s.storage,
    powerDemand: d.radar + d.production + d.training + d.research,
    powerFactor: grid.served.production,
    upkeepPerHour: upkeepPerHour(base, balance),
    grid,
  };
}

/** Lagerkapazität je Ressource (für alle Ressourcen gleich). */
export function storageCapacity(base: BaseState, balance: Balance, mods?: Modifiers): number {
  const def = balance.buildings.lagerkomplex;
  return (def.capacityBase ?? 0) * (def.capacityGrowth ?? 1) ** buildingLevel(base, "lagerkomplex") * modValue(mods, "storage");
}

/** Vor Plünderung geschützte Menge je Ressource (Tiefbunker). */
export function bunkerProtection(base: BaseState, balance: Balance, mods?: Modifiers): number {
  const def = balance.buildings.tiefbunker;
  return (def.protectedBase ?? 0) * (def.protectedGrowth ?? 1) ** buildingLevel(base, "tiefbunker") * modValue(mods, "bunker");
}

/**
 * Schreibt die Bestände von resUpdatedAt auf nowMs fort (Lazy Evaluation, Stromnetz in Zeitschritten, power.ts).
 * Produktion füllt nur bis zur Lagerkapazität; Bestände über der Kapazität bleiben erhalten.
 * Der Bestand fällt nie unter 0; Bestand 0 bei negativer Rate setzt versorgungsmangel.
 * `mods` (Produktion, Lager) müssen für das ganze Intervall gelten; ändern sie sich, vorher fortschreiben.
 */
export function settle(base: BaseState, nowMs: number, balance: Balance, mods?: Modifiers): BaseState {
  return integrateGrid(base, nowMs, balance, mods);
}

export function hasResources(stock: ResourceMap, cost: ResourceMap): boolean {
  for (const [r, amount] of Object.entries(cost)) {
    if (amount > 0 && (stock[r] ?? 0) < amount) return false;
  }
  return true;
}

export function subtractResources(stock: ResourceMap, cost: ResourceMap): ResourceMap {
  const out: ResourceMap = { ...stock };
  for (const [r, amount] of Object.entries(cost)) out[r] = (out[r] ?? 0) - amount;
  return out;
}

export function addResources(stock: ResourceMap, gain: ResourceMap): ResourceMap {
  const out: ResourceMap = { ...stock };
  for (const [r, amount] of Object.entries(gain)) out[r] = (out[r] ?? 0) + amount;
  return out;
}
