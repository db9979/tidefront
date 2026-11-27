// Kampfsimulator im Browser: rechnet resolveBattle aus dem Regelkern über feste Seeds durch.
// Nur reine Funktionen aus @tidefront/game-core; die Balance kommt vom Server (trpc.meta).
// Wird nur aus dem nachgeladenen Simulator-Chunk importiert.
import {
  composeRaid,
  nestDefender,
  resolveBattle,
  type AttackerInput,
  type Balance as CoreBalance,
  type CombatWeather,
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
  /** Je Durchlauf: eigene Restkampfkraft (Lebenspunkte der Überlebenden / vorher, 0..1) und Sieg. */
  runsDetail: { remaining: number; won: boolean }[];
  /** Spannweite der Siegchance (Wilson-Intervall, 90 %) bei `runs` Durchläufen. */
  winInterval: [number, number];
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

/** Lebenspunkte einer Zählung (Grundwerte aus der Balance). */
function hpOf(c: Counts, b: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(c)) s += (b.units[id]?.hp ?? b.npcUnits[id]?.hp ?? b.defenses[id]?.hp ?? 0) * n;
  return s;
}

/** Wilson-Intervall für eine Quote p aus n Versuchen (z = 1,645 für 90 %). */
export function wilson(p: number, n: number, z = 1.645): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/**
 * Rechnet den Kampf über `runs` Seeds; Fehlercode (unknown_unit, bad_count) statt Ausnahme.
 * Kriegsglück (W20 je Phase und Seite) steckt in resolveBattle und wirkt automatisch, sobald die Balance es enthält.
 */
export function simulate(attacker: AttackerInput, defender: DefenderInput, balance: Balance, runs = SIM_RUNS, weather?: CombatWeather): { ok: true; stats: SimStats } | { ok: false; code: string } {
  const b = core(balance);
  const aLost: Counts[] = [];
  const dLost: Counts[] = [];
  const loot: Counts[] = [];
  let wins = 0, landed = 0;
  const runsDetail: SimStats["runsDetail"] = [];
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(attacker, defender, b, simSeed(i), weather); // Wetter: aus dem Bericht (sonst ohne)
    if (!r.ok) return { ok: false, code: r.code };
    const rep = r.report;
    if (rep.winner === "attacker") wins++;
    if (rep.landed) landed++;
    aLost.push(netLost(rep.attacker.before, rep.attacker.final));
    dLost.push(netLost(rep.defender.before, rep.defender.final));
    loot.push(rep.loot);
    const before = hpOf(rep.attacker.before, balance);
    runsDetail.push({ remaining: before > 0 ? hpOf(rep.attacker.survivors, balance) / before : 0, won: rep.winner === "attacker" });
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
      runsDetail,
      winInterval: wilson(wins / runs, runs),
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
