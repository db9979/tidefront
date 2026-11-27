// Kampfsimulator im Browser: rechnet mit simulateBattle aus dem Regelkern über feste Seeds (Siegregel und Beute je
// Kampfart wie der Server, Sicht der eigenen Seite). Nur reine Funktionen aus @tidefront/game-core; die Balance kommt
// vom Server (trpc.meta). Wird nur aus dem nachgeladenen Simulator-Chunk importiert.
import {
  composeRaid,
  nestDefender,
  simulateBattle,
  type AttackerInput,
  type Balance as CoreBalance,
  type DefenderInput,
  type Modifiers,
  type SimOpts,
  type SimStats,
} from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";

export type { Range, SimStats, PhaseStat } from "@tidefront/game-core";
export { SIM_RUNS } from "@tidefront/game-core";
export type Counts = Record<string, number>;

const core = (b: Balance) => b as unknown as CoreBalance;

/** Rechnet den Kampf über die Seeds; Fehlercode (unknown_unit, bad_count) statt Ausnahme. */
export function simulate(attacker: AttackerInput, defender: DefenderInput | DefenderInput[], balance: Balance, opts: SimOpts = {}): { ok: true; stats: SimStats } | { ok: false; code: string } {
  return simulateBattle(attacker, defender, core(balance), opts);
}

/** Besatzung eines Nests als Verteidiger (feste Beute); null bei unbekannter Stufe. */
export function nestAsDefender(level: number, balance: Balance): DefenderInput | null {
  const r = nestDefender(level, core(balance));
  return r.ok ? r.defender : null;
}

/**
 * Kartell-Überfall, wie er gegen diese Verteidigung zusammengestellt würde: mit den Modifikatoren des Verteidigers
 * (die Forschung hebt die Stärke an) und der Stärke in Prozent (Schwankung des Kartells, 100 = Mitte).
 */
export function raidAgainst(units: Counts, defenses: Counts, balance: Balance, mods?: unknown, strengthPct = 100): AttackerInput {
  const b = core(balance);
  const scaled = strengthPct === 100 ? b : { ...b, pirates: { ...b.pirates, raidStrengthShareOfDefense: b.pirates.raidStrengthShareOfDefense * (strengthPct / 100) } };
  return composeRaid(units, defenses, scaled, undefined, mods as Modifiers | undefined).attacker;
}

/** Teilt Zählungen in Einheiten und Anlagen. */
export function splitDefender(all: Counts, balance: Balance): { units: Counts; defenses: Counts } {
  const units: Counts = {};
  const defenses: Counts = {};
  for (const [id, n] of Object.entries(all)) {
    if (n <= 0) continue;
    if (balance.defenses[id]) defenses[id] = n;
    else units[id] = n;
  }
  return { units, defenses };
}

export function positive(c: Counts): Counts {
  return Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));
}
