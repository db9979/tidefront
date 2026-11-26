import type { Balance, BaseState, Counts, ProductionInfo, ResearchState, ResourceMap } from "./types.ts";
import { createProtection } from "./protection.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry, modValue } from "./modifiers.ts";

const HOUR_MS = 3600000;

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
  };
}

/** Neuer Stützpunkt: Startbestände, alle Gebäude auf Stufe 0, keine Einheiten. */
export function createBase(balance: Balance, nowMs: number): BaseState {
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

export function powerSupply(base: BaseState, balance: Balance): number {
  let sum = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    sum += (def.powerSupplyPerLevel ?? 0) * buildingLevel(base, id);
  }
  return sum;
}

export function powerDemand(base: BaseState, balance: Balance): number {
  let sum = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    if (def.produces === undefined) continue;
    sum += (def.powerPerLevel ?? 0) * buildingLevel(base, id);
  }
  return sum;
}

/** Produktionsraten je Stunde inklusive Strom-Drosselung und Proviant-Unterhalt; `mods.production` wirkt auf die Gebäudeproduktion. */
export function productionRates(base: BaseState, balance: Balance, mods?: Modifiers): ProductionInfo {
  const supply = powerSupply(base, balance);
  const demand = powerDemand(base, balance);
  const powerFactor = demand > supply ? supply / demand : 1;
  const buildingPerHour: ResourceMap = {};
  for (const r of balance.resources) buildingPerHour[r] = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    const level = buildingLevel(base, id);
    if (def.produces === undefined || level < 1) continue;
    const raw = (def.perHour ?? 0) * balance.building.productionGrowth ** (level - 1);
    buildingPerHour[def.produces] = (buildingPerHour[def.produces] ?? 0) + raw * powerFactor * modEntry(mods, "production", def.produces);
  }
  const upkeep = upkeepPerHour(base, balance);
  const perHour: ResourceMap = {};
  for (const r of balance.resources) {
    perHour[r] = (balance.baseTricklePerHour[r] ?? 0) + buildingPerHour[r];
  }
  if ("proviant" in perHour) perHour.proviant -= upkeep;
  return { perHour, buildingPerHour, powerSupply: supply, powerDemand: demand, powerFactor, upkeepPerHour: upkeep };
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
 * Schreibt die Bestände von resUpdatedAt auf nowMs fort (Lazy Evaluation).
 * Produktion füllt nur bis zur Lagerkapazität; Bestände über der Kapazität bleiben erhalten.
 * Der Bestand fällt nie unter 0; Bestand 0 bei negativer Rate setzt versorgungsmangel.
 * `mods` (Produktion, Lager) müssen für das ganze Intervall gelten; ändern sie sich, vorher fortschreiben.
 */
export function settle(base: BaseState, nowMs: number, balance: Balance, mods?: Modifiers): BaseState {
  const next = cloneBase(base);
  const rates = productionRates(base, balance, mods).perHour;
  const capacity = storageCapacity(base, balance, mods);
  const hours = Math.max(0, nowMs - base.resUpdatedAt) / HOUR_MS;
  for (const r of balance.resources) {
    const stock = base.resources[r] ?? 0;
    const rate = rates[r];
    let value = stock;
    if (rate >= 0) {
      if (stock < capacity) value = Math.min(capacity, stock + rate * hours);
    } else {
      value = Math.max(0, stock + rate * hours);
    }
    next.resources[r] = value;
  }
  next.versorgungsmangel = (next.resources.proviant ?? 0) <= 0 && (rates.proviant ?? 0) < 0;
  next.resUpdatedAt = Math.max(base.resUpdatedAt, nowMs);
  return next;
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
