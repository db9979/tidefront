// Bauempfehlung (UX 0.43, E-4): „Bauhof frei: Stahlwerk 7 · 3 min · Bauen“ auf der Lage und „Empfohlen“ im Hafen.
// Rein und deterministisch: nur der übergebene Stand (settle vorher), keine Zufälle. Reihenfolge der Gründe:
// Strommangel → Lager fast voll → Engpass (Rohstoff mit der kleinsten Rate) → günstigster Ausbau.
// Strom und Lager stehen immer vorn (auch mit „fehlt …“); sonst gehen bezahlbare Vorschläge vor.
import type { Balance, BaseState, ResourceMap } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { productionRates, storageCapacity } from "./economy.ts";
import { maxAllowedLevel, missingRequirement, plannedLevel, startUpgrade, upgradeCost, upgradeDurationMs } from "./buildings.ts";
import { homeOnlyBlocked } from "./expansion.ts";

/** Lager „fast voll“ für die Empfehlung (wie die KI-Spieler, etwas vor der Lagewarnung bei 90 %). */
export const ADVICE_STORAGE_SHARE = 0.85;
/** Strom gilt unter diesem Anteil versorgter Nachfrage als knapp. */
export const ADVICE_POWER_SHORT = 0.995;
/** Gebäude, die auch auf Stufe 0 vorgeschlagen werden (Grundausstattung); sonst nur schon gebaute. */
export const ADVICE_CORE = ["kraftwerk", "stahlwerk", "raffinerie", "chipfabrik", "versorgungshof", "lagerkomplex", "kommandozentrale"];

export type AdviceReason = "strom" | "lager" | "engpass" | "guenstig";

export interface BuildAdvice {
  buildingId: string;
  /** Zielstufe (1 = neu bauen). */
  level: number;
  durationMs: number;
  cost: ResourceMap;
  affordable: boolean;
  /** Fehlende Mengen (nur wenn nicht bezahlbar). */
  missing: ResourceMap;
  reason: AdviceReason;
  /** Rohstoff des Engpasses bzw. des vollen Lagers. */
  resource?: string;
}

function missingOf(stock: ResourceMap, cost: ResourceMap): ResourceMap {
  const out: ResourceMap = {};
  for (const [r, n] of Object.entries(cost)) if (n > (stock[r] ?? 0)) out[r] = Math.ceil(n - (stock[r] ?? 0));
  return out;
}

function costValue(cost: ResourceMap, balance: Balance): number {
  return Object.entries(cost).reduce((a, [r, n]) => a + n * (balance.market.refPrice[r] ?? 1), 0);
}

/**
 * Bis zu `limit` Vorschläge für den nächsten Ausbau (Reihenfolge = Empfehlung). `state` ist bereits fortgeschrieben.
 * Leer, wenn die Bauschlange voll ist oder nichts offen steht.
 */
export function buildAdvice(state: BaseState, balance: Balance, nowMs: number, mods?: Modifiers, limit = 3): BuildAdvice[] {
  if (state.buildQueue.length >= balance.building.queueSlots) return [];
  const open = Object.keys(balance.buildings).filter((id) =>
    (plannedLevel(state, id) >= 1 || ADVICE_CORE.includes(id))
    && plannedLevel(state, id) < Math.min(balance.building.maxLevel, maxAllowedLevel(state, id, balance))
    && !missingRequirement(state, id, balance) && !homeOnlyBlocked(state, id, balance));
  if (open.length === 0) return [];
  const rates = productionRates(state, balance, mods, nowMs);
  const cap = storageCapacity(state, balance, mods);
  const reasons = new Map<string, { reason: AdviceReason; resource?: string; rank: number }>();
  const mark = (id: string, reason: AdviceReason, rank: number, resource?: string) => {
    if (open.includes(id) && !reasons.has(id)) reasons.set(id, { reason, resource, rank });
  };
  // 1. Strom: Kraftwerk, je nach Breite Wind oder Sonne.
  if (rates.powerFactor < ADVICE_POWER_SHORT || (rates.grid?.served?.training ?? 1) < ADVICE_POWER_SHORT) {
    mark("kraftwerk", "strom", 0);
    mark((state.site?.lat ?? 50) >= 47 ? "windpark" : "solarfeld", "strom", 0);
  }
  // 2. Lager fast voll.
  const full = balance.resources.filter((r) => cap > 0 && (state.resources[r] ?? 0) >= ADVICE_STORAGE_SHARE * cap);
  if (full.length > 0) mark("lagerkomplex", "lager", 1, full[0]);
  // 3. Engpass: Erzeuger des Rohstoffs mit der kleinsten Netto-Rate (relativ zum Richtwert).
  const producers = open.filter((id) => balance.buildings[id].produces && balance.resources.includes(balance.buildings[id].produces!));
  const byRate = [...producers].sort((a, b) => {
    const ra = balance.buildings[a].produces!, rb = balance.buildings[b].produces!;
    const va = (rates.perHour[ra] ?? 0) * (balance.market.refPrice[ra] ?? 1), vb = (rates.perHour[rb] ?? 0) * (balance.market.refPrice[rb] ?? 1);
    return va - vb || a.localeCompare(b);
  });
  if (byRate[0]) mark(byRate[0], "engpass", 2, balance.buildings[byRate[0]].produces);
  // 4. Rest nach Warenwert der Kosten.
  for (const id of open) mark(id, "guenstig", 3);
  const all: BuildAdvice[] = open.map((id) => {
    const lvl = plannedLevel(state, id);
    const cost = upgradeCost(id, lvl, balance);
    const ok = startUpgrade(state, id, nowMs, balance, mods).ok;
    const r = reasons.get(id)!;
    return { buildingId: id, level: lvl + 1, durationMs: upgradeDurationMs(id, lvl + 1, balance, mods), cost, affordable: ok,
      missing: ok ? {} : missingOf(state.resources, cost), reason: r.reason, ...(r.resource ? { resource: r.resource } : {}) };
  });
  // Strom und Lager bleiben vorn, auch wenn noch Rohstoffe fehlen; sonst Bezahlbares vor Unbezahlbarem.
  const tier = (a: BuildAdvice) => { const r = reasons.get(a.buildingId)!.rank; return r <= 1 ? r : r + (a.affordable ? 0 : 2); };
  all.sort((a, b) => tier(a) - tier(b)
    || costValue(a.cost, balance) - costValue(b.cost, balance) || a.buildingId.localeCompare(b.buildingId));
  return all.slice(0, limit);
}
