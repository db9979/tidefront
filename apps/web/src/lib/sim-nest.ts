// Lebendige Nester im Kampfsimulator (nachgeladener Chunk): Verteidiger für Vorlagen und Siegchance über die Spanne.
import { nestDefenders, nestWinRange, type AttackerInput, type Balance as CoreBalance, type DefenderInput } from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";

const core = (b: Balance) => b as unknown as CoreBalance;

/** Nest der Stufe als Verteidiger: Mitte (wie im Handbuch) oder ungünstigster Wurf. */
export function nestDefenderOf(level: number, mode: "mid" | "worst", balance: Balance): DefenderInput | null {
  return nestDefenders(level, core(balance), mode)[0] ?? null;
}

/** Siegchance über die Spanne (ungünstigster Wurf, Mittel, günstigster Wurf). */
export function nestRangeRates(attacker: AttackerInput, level: number, balance: Balance) {
  return nestWinRange(attacker.units, level, core(balance), { versorgungsmangel: attacker.versorgungsmangel, modifiers: attacker.modifiers });
}
