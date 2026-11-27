// Mehrere Häfen im Client: Regeln der Gründung (balance.expansion, Rückfall auf die Planwerte, solange der Server
// den Block noch nicht liefert) und einfache Vorprüfungen auf der Karte. Die verbindliche Prüfung macht der Server.
import { TRADE_PORTS, hexAtLonLat, hexDistanceKm, terrainAt } from "@tidefront/world";
import type { BaseData, Balance, MapData } from "./trpc.ts";

export const FOUNDING = "gruendung";
export const TRANSFER = "verlegung";
export const COLONY_SHIP = "kolonieschiff";

export interface ExpansionRules {
  /** Server liefert den Block (Gründung freigeschaltet); sonst Planwerte nur zur Anzeige. */
  live: boolean;
  maxBases: number;
  unlockCommandLevels: number[];
  colonyShip: string;
  minDistanceHex: number;
  maxRangeKm: number;
}

const DEFAULTS: Omit<ExpansionRules, "live"> = {
  maxBases: 3,
  unlockCommandLevels: [5, 8],
  colonyShip: COLONY_SHIP,
  minDistanceHex: 4,
  maxRangeKm: 900,
};

export function expansionRules(balance: Balance | undefined): ExpansionRules {
  const e = (balance as { expansion?: Partial<ExpansionRules> } | undefined)?.expansion;
  return { ...DEFAULTS, ...(e ?? {}), live: !!e };
}

/** Kommandozentrale-Stufe, ab der der nächste Hafen gegründet werden darf (null: Höchstzahl erreicht). */
export function nextUnlockLevel(rules: ExpansionRules, baseCount: number): number | null {
  if (baseCount >= rules.maxBases) return null;
  return rules.unlockCommandLevels[baseCount - 1] ?? null;
}

export function buildingLevel(base: BaseData, id: string): number {
  return base.buildings.find((b) => b.id === id)?.level ?? 0;
}

/** Freischaltstand für den nächsten Hafen (Kommandozentrale gilt im Heimathafen). */
export function foundingState(base: BaseData, rules: ExpansionRules) {
  const need = nextUnlockLevel(rules, base.bases.length);
  // Kommandozentrale des Heimathafens: nur bekannt, wenn er gerade aktiv ist.
  const level = base.isHome ? buildingLevel(base, "kommandozentrale") : null;
  const ships = base.units.find((u) => u.id === rules.colonyShip)?.home ?? 0;
  const unlocked = need !== null && level !== null && level >= need;
  return { need, level, ships, unlocked, possible: rules.live && unlocked };
}

let portHexes: Set<string> | null = null;
function isTradePort(col: number, row: number): boolean {
  portHexes ??= new Set(TRADE_PORTS.map(([lon, lat]) => { const h = hexAtLonLat(lon, lat); return `${h.col},${h.row}`; }));
  return portHexes.has(`${col},${row}`);
}

/** Freies Küstenfeld (kein Hafen, Nest, Handelshafen oder Rohstofffeld) – Kandidat für einen Außenposten. */
export function isFreeCoast(t: { col: number; row: number }, map: MapData, fields?: { col: number; row: number }[]): boolean {
  if (terrainAt(t.col, t.row) !== "coast" || isTradePort(t.col, t.row)) return false;
  const same = (h: { col: number; row: number }) => h.col === t.col && h.row === t.row;
  return !map.bases.some(same) && !map.nests.some(same) && !(fields ?? []).some(same);
}

/** Reichweite der Gründung vom aktiven Hafen aus. */
export function inFoundingRange(from: { col: number; row: number }, t: { col: number; row: number }, rules: ExpansionRules): boolean {
  return hexDistanceKm(from, t) <= rules.maxRangeKm;
}

/**
 * Eingehender Verband, der eine Angriffswarnung verdient: weder Transport noch eigene Verlegung (Mehrere Häfen:
 * eigene Verlegungen und Transporte aus anderen Häfen stehen ebenfalls unter „Eingehend“, aber ohne Warnung).
 */
export function isThreat(i: { type: string; own?: boolean }): boolean {
  return !i.own && i.type !== "transport" && i.type !== TRANSFER;
}
