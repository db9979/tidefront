// Admirale (Welle 2): Ränge, Spezialisierungen, Modifikatoren, Erfahrung und Risiko – rein und deterministisch.
// Ein Admiral führt einen Verband auf Mission (Rolle "mission") oder als Hafenkommandant die Verteidigung
// (Rolle "defense"); ein stationierter, bereiter Hafenkommandant wirkt zusätzlich passiv auf den Hafen ("harbor",
// z. B. Radar-Vorwarnzeit). Werte aus balance.admirals; ein Bonus wächst mit dem Rang (Faktor des Rangs).
import type { Balance, BattleReport, Counts, Side } from "./types.ts";
import { applyModPath, type Modifiers } from "./modifiers.ts";
import { buildStats } from "./combat-stats.ts";
import { mulberry32, randomInt } from "./rng.ts";

export type AdmiralRole = "mission" | "defense" | "harbor";
export type AdmiralFate = "unversehrt" | "verwundet" | "gefangen" | "gefallen";

export interface AdmiralRankDef {
  id: string;
  name: string;
  minXp: number;
  /** Anteil des vollen Spezialisierungsbonus auf diesem Rang (1 = voll). */
  factor: number;
}

export interface AdmiralSpecDef {
  name: string;
  text: string;
  /** Modifikator-Pfad → Bonus bei voller Stärke (0,1 = +10 %, −0,15 = −15 %). */
  mission?: Record<string, number>;
  defense?: Record<string, number>;
  harbor?: Record<string, number>;
}

export interface AdmiralBalance {
  /** Plätze: base + 1 je perHarborLevels Stufen Hafenkommandantur, höchstens max. */
  slots: { base: number; perHarborLevels: number; max: number };
  cost: { credits: number; elektronik: number };
  ranks: AdmiralRankDef[];
  /** Zweite Spezialisierung ab diesem Rang (1 = erster Rang). */
  secondSpecFromRank: number;
  specs: Record<string, AdmiralSpecDef>;
  /** Erfahrung nur bei Sieg: zerstörte gegnerische Lebenspunkte / hpPerXp, begrenzt auf [minWin, maxPerBattle]. */
  xp: { hpPerXp: number; minWin: number; maxPerBattle: number };
  risk: {
    /** Gewürfelt wird nur nach einer Niederlage mit mehr als diesem Anteil verlorener Lebenspunkte. */
    lossShare: number;
    die: number;
    /** Wurf ≤ fallenMax: gefallen; ≤ capturedMax: gefangen; ≤ woundedMax: verwundet; sonst unversehrt. */
    fallenMax: number;
    capturedMax: number;
    woundedMax: number;
    woundedHours: number;
    captiveHours: number;
    ransomCredits: number;
  };
}

/** Deutsche Namensliste (erfunden, keine realen historischen Personen). */
export const ADMIRAL_NAMES: readonly string[] = [
  "Henrik Albers", "Matthias Brenneke", "Konrad Dählmann", "Jost Eilers", "Friedrich Gerdau", "Hinrich Harmsen",
  "Lorenz Jessen", "Ole Kampmann", "Arnold Lüders", "Bernd Mahnke", "Carsten Nolting", "Detlef Ottens",
  "Edzard Petersen", "Gunnar Quade", "Helmut Rickers", "Ingo Sander", "Jasper Thielke", "Klaas Uhde",
  "Ludger Voss", "Magnus Wiebe", "Nils Wöhlert", "Rasmus Ahlers", "Theda Brunken", "Wiebke Carstens",
  "Frauke Dierks", "Greta Ehlers", "Hanna Feddersen", "Imke Gössling", "Silke Hollmann", "Antje Iwersen",
];

/** Plätze für Admirale bei dieser Stufe der Hafenkommandantur. */
export function admiralSlots(harborLevel: number, balance: Balance): number {
  const a = balance.admirals;
  if (!a) return 0;
  const per = Math.max(1, a.slots.perHarborLevels);
  return Math.min(a.slots.max, a.slots.base + Math.floor(Math.max(0, harborLevel) / per));
}

/** Rang zur Erfahrung: Index ab 1 und Definition (höchster Rang mit minXp ≤ xp). */
export function admiralRank(xp: number, balance: Balance): { index: number; def: AdmiralRankDef } {
  const ranks = balance.admirals?.ranks ?? [];
  let index = 1;
  for (let i = 0; i < ranks.length; i++) if (xp + 1e-9 >= ranks[i].minXp) index = i + 1;
  return { index, def: ranks[index - 1] ?? { id: "kzs", name: "Kapitän zur See", minXp: 0, factor: 0 } };
}

/** Nächster Rang oder null auf dem höchsten Rang. */
export function nextAdmiralRank(xp: number, balance: Balance): AdmiralRankDef | null {
  const ranks = balance.admirals?.ranks ?? [];
  return ranks.find((r) => r.minXp > xp + 1e-9) ?? null;
}

/** Wirksame Spezialisierungen: die zweite erst ab secondSpecFromRank. Unbekannte werden übergangen. */
export function activeSpecs(specs: readonly (string | null | undefined)[], xp: number, balance: Balance): string[] {
  const a = balance.admirals;
  if (!a) return [];
  const rank = admiralRank(xp, balance).index;
  const out: string[] = [];
  specs.forEach((s, i) => {
    if (!s || !Object.hasOwn(a.specs, s) || out.includes(s)) return;
    if (i >= 1 && rank < a.secondSpecFromRank) return;
    out.push(s);
  });
  return out.slice(0, 2);
}

/** Eine Zeile der Aufschlüsselung: Spezialisierung, Modifikator-Pfad, Faktor. */
export interface AdmiralModLine {
  spec: string;
  path: string;
  factor: number;
}

/** Einzelne Faktoren eines Admirals in einer Rolle (für Berichte und Ansicht). */
export function admiralModLines(specs: readonly (string | null | undefined)[], xp: number, role: AdmiralRole, balance: Balance): AdmiralModLine[] {
  const a = balance.admirals;
  if (!a) return [];
  const rf = admiralRank(xp, balance).def.factor;
  const out: AdmiralModLine[] = [];
  for (const s of activeSpecs(specs, xp, balance)) {
    for (const [path, bonus] of Object.entries(a.specs[s][role] ?? {})) {
      out.push({ spec: s, path, factor: Math.round((1 + bonus * rf) * 1e6) / 1e6 });
    }
  }
  return out;
}

/** Modifikatoren eines Admirals in einer Rolle (multiplikativ über die Spezialisierungen). */
export function admiralModifiers(specs: readonly (string | null | undefined)[], xp: number, role: AdmiralRole, balance: Balance): Modifiers {
  const mods: Modifiers = {};
  for (const l of admiralModLines(specs, xp, role, balance)) applyModPath(mods, l.path, l.factor);
  return mods;
}

function hpOf(c: Counts, balance: Balance): number {
  const t = buildStats(balance);
  return Object.entries(c).reduce((s, [id, n]) => s + (t.byId[id]?.hp ?? 0) * Math.max(0, n), 0);
}

/** Vom Gegner der Seite im Kampf zerstörte Lebenspunkte (vor Lazarett und Reparatur). */
export function destroyedEnemyHp(report: BattleReport, side: Side, balance: Balance): number {
  const e = report[side === "attacker" ? "defender" : "attacker"];
  const lost: Counts = {};
  for (const [id, n] of Object.entries(e.before)) lost[id] = n - (e.survivors[id] ?? 0);
  return hpOf(lost, balance);
}

/** Anteil endgültig verlorener Lebenspunkte einer Seite (0 … 1). */
export function sideLossShare(report: BattleReport, side: Side, balance: Balance): number {
  const o = report[side];
  const before = hpOf(o.before, balance);
  if (before <= 0) return 0;
  const lost: Counts = {};
  for (const [id, n] of Object.entries(o.before)) lost[id] = n - (o.final[id] ?? 0);
  return Math.min(1, Math.max(0, hpOf(lost, balance) / before));
}

/** Erfahrung aus einem Kampf: nur bei Sieg, abhängig vom besiegten Wert. */
export function admiralXpGain(report: BattleReport, side: Side, balance: Balance): number {
  const a = balance.admirals;
  if (!a || report.winner !== side) return 0;
  const raw = Math.round(destroyedEnemyHp(report, side, balance) / Math.max(1, a.xp.hpPerXp));
  return Math.min(a.xp.maxPerBattle, Math.max(a.xp.minWin, raw));
}

/** Wurf über das Schicksal: deterministisch aus dem Kampf-Seed (je Seite eigener Strom). */
export function admiralFateRoll(seed: number, side: Side, die: number): number {
  const rng = mulberry32((seed ^ (side === "attacker" ? 0x0ad31a01 : 0x0ad31d02)) >>> 0);
  return randomInt(rng, 1, Math.max(2, Math.floor(die)));
}

export interface AdmiralFateResult {
  lossShare: number;
  /** W-Wurf oder null, wenn nicht gewürfelt wurde (Sieg oder Verluste unter der Schwelle). */
  roll: number | null;
  fate: AdmiralFate;
}

/** Schicksal des Admirals einer Seite nach dem Kampf. */
export function admiralFate(report: BattleReport, side: Side, seed: number, balance: Balance): AdmiralFateResult {
  const a = balance.admirals;
  const lossShare = sideLossShare(report, side, balance);
  if (!a || report.winner === side || lossShare <= a.risk.lossShare) return { lossShare, roll: null, fate: "unversehrt" };
  const roll = admiralFateRoll(seed, side, a.risk.die);
  const r = a.risk;
  const fate: AdmiralFate = roll <= r.fallenMax ? "gefallen" : roll <= r.capturedMax ? "gefangen" : roll <= r.woundedMax ? "verwundet" : "unversehrt";
  return { lossShare, roll, fate };
}

/** Zufälliger freier Name aus der Liste (deterministisch aus dem Seed). */
export function pickAdmiralName(seed: number, used: readonly string[]): string {
  const free = ADMIRAL_NAMES.filter((n) => !used.includes(n));
  const pool = free.length > 0 ? free : ADMIRAL_NAMES;
  return pool[randomInt(mulberry32(seed >>> 0), 0, pool.length - 1)];
}
