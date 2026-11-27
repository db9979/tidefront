// Lebendige Nester im Kampfsimulator (nachgeladener Chunk): Verteidiger für Vorlagen und Siegchance über die Spanne.
import { nestDefenders, nestWinRange, simulateBattle, type AttackerInput, type Balance as CoreBalance, type CombatWeather, type DefenderInput } from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";
import { nestProbeDefenders, type MapNestLagebild } from "./nest-intel.ts";

const core = (b: Balance) => b as unknown as CoreBalance;

/** Nest der Stufe als Verteidiger: Mitte (wie im Handbuch) oder ungünstigster Wurf. */
export function nestDefenderOf(level: number, mode: "mid" | "worst", balance: Balance): DefenderInput | null {
  return nestDefenders(level, core(balance), mode)[0] ?? null;
}

/** Siegchance über die Spanne (ungünstigster Wurf, Mittel, günstigster Wurf). */
export function nestRangeRates(attacker: AttackerInput, level: number, balance: Balance, weather?: CombatWeather) {
  return nestWinRange(attacker.units, level, core(balance), { versorgungsmangel: attacker.versorgungsmangel, modifiers: attacker.modifiers, ...(weather ? { weather } : {}) });
}

/**
 * Siegchance des Probekampfs gegen ein Nest (dieselbe Rechnung wie die Karte „Probekampf“: Lagebild genau, sonst die
 * Mitte; gleiche Seeds) – für die „Einschätzung“ in der Missionsplanung, damit beide dieselbe Zahl nennen.
 */
export function nestProbeRate(attacker: AttackerInput, level: number, lagebild: MapNestLagebild | null | undefined, balance: Balance, weather?: CombatWeather): number | null {
  const d = lagebild ? nestProbeDefenders(level, lagebild, Date.now(), balance)[0] : nestDefenderOf(level, "mid", balance);
  if (!d) return null;
  const r = simulateBattle(attacker, d, core(balance), weather ? { weather } : {});
  return r.ok ? r.stats.winRate : null;
}
