// Kampfsimulator im Browser: rechnet resolveBattle aus dem Regelkern über feste Seeds durch.
// Nur reine Funktionen aus @tidefront/game-core; die Balance kommt vom Server (trpc.meta).
// Wird nur aus dem nachgeladenen Simulator-Chunk importiert.
import {
  composeRaid,
  nestDefender,
  resolveBattle,
  type AttackerInput,
  type Balance as CoreBalance,
  type DefenderInput,
} from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";

export type Counts = Record<string, number>;
export const SIM_RUNS = 50;

export interface Range { avg: number; min: number; max: number }

export interface SimStats {
  runs: number;
  winRate: number;
  landedRate: number;
  /** Eigene dauerhafte Verluste je Typ (Verluste minus Rückkehrer). */
  attackerLost: Record<string, Range>;
  defenderLost: Record<string, Range>;
  /** Summe der verlorenen Einheiten des Angreifers je Durchlauf. */
  attackerLostTotal: Range;
  loot: Record<string, Range>;
  lootTotal: Range;
}

const core = (b: Balance) => b as unknown as CoreBalance;

/** Fester Seed je Durchlauf: gleiche Eingabe, gleiches Ergebnis. */
export function simSeed(i: number): number {
  return Math.imul(i + 1, 0x9e3779b1) >>> 0;
}

function range(values: number[]): Range {
  if (values.length === 0) return { avg: 0, min: 0, max: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { avg: sum / values.length, min, max };
}

function perKey(samples: Counts[], keys: string[]): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const k of keys) {
    const r = range(samples.map((s) => s[k] ?? 0));
    if (r.max > 0) out[k] = r;
  }
  return out;
}

function netLost(before: Counts, final: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(before)) out[id] = Math.max(0, n - (final[id] ?? 0));
  return out;
}

/** Rechnet den Kampf über `runs` Seeds; Fehlercode (unknown_unit, bad_count) statt Ausnahme. */
export function simulate(attacker: AttackerInput, defender: DefenderInput, balance: Balance, runs = SIM_RUNS): { ok: true; stats: SimStats } | { ok: false; code: string } {
  const b = core(balance);
  const aLost: Counts[] = [];
  const dLost: Counts[] = [];
  const loot: Counts[] = [];
  let wins = 0, landed = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(attacker, defender, b, simSeed(i));
    if (!r.ok) return { ok: false, code: r.code };
    const rep = r.report;
    if (rep.winner === "attacker") wins++;
    if (rep.landed) landed++;
    aLost.push(netLost(rep.attacker.before, rep.attacker.final));
    dLost.push(netLost(rep.defender.before, rep.defender.final));
    loot.push(rep.loot);
  }
  const aKeys = Object.keys(attacker.units);
  const dKeys = [...Object.keys(defender.units), ...Object.keys(defender.defenses)];
  return {
    ok: true,
    stats: {
      runs,
      winRate: wins / runs,
      landedRate: landed / runs,
      attackerLost: perKey(aLost, aKeys),
      defenderLost: perKey(dLost, dKeys),
      attackerLostTotal: range(aLost.map((c) => Object.values(c).reduce((s, v) => s + v, 0))),
      loot: perKey(loot, balance.resources),
      lootTotal: range(loot.map((c) => Object.values(c).reduce((s, v) => s + v, 0))),
    },
  };
}

/** Besatzung eines Nests als Verteidiger (feste Beute); null bei unbekannter Stufe. */
export function nestAsDefender(level: number, balance: Balance): DefenderInput | null {
  const r = nestDefender(level, core(balance));
  return r.ok ? r.defender : null;
}

/** Kartell-Überfall, wie er gegen diese Verteidigung zusammengestellt würde (ohne Schwankung). */
export function raidAgainst(units: Counts, defenses: Counts, balance: Balance): AttackerInput {
  return composeRaid(units, defenses, core(balance)).attacker;
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
