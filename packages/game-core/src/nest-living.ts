// Lebendige Nester (docs/VORLAGE-NESTER.md 3, ENTSCHEIDUNGEN-5.md): Wurf je Besetzung (Besatzungsfaktor ±20 % in
// 5-%-Schritten, Anlagen je vorhandener Art −1/0/+1), Erholung nach gewonnener Abwehr (sofort ≥ 70 %, dann +5 %/h,
// zerstörte Anlagen nach 12 h), Beute +1 %/h ab Besetzung bis 130 %. Alles aus Zeitstempeln, ohne Takt; rein, damit
// Server (Kampf, Lagebild, Bots) und Browser (Karte, Probekampf) gleich rechnen. Stufe 1 schwankt nicht.
import { nestGarrison } from "./pirates.ts";
import { mulberry32, type Rng } from "./rng.ts";
import type { Balance, Counts, DefenderInput, ResourceMap } from "./types.ts";

/** Balance-Block `pirates.living`; fehlt er, sind Nester fest wie bis v1.30. */
export interface LivingBalance {
  /** Schwankung des Besatzungsfaktors (0,2 = 80 … 120 %) in Schritten von `step`. */
  spread: number;
  step: number;
  /** Wahrscheinlichkeit für −1 / 0 / +1 je vorhandener Anlagenart. */
  defenseShift: [number, number, number];
  /** Stufen ohne Schwankung (Einstieg). */
  fixedLevels: number[];
  /** Nach gewonnener Abwehr sofort mindestens dieser Anteil des Wurfs, dann `recoverPerHour` je Stunde. */
  recoverMin: number;
  recoverPerHour: number;
  /** Zerstörte Anlagen kommen so viele Stunden nach dem Kampf vollständig zurück. */
  defenseReturnHours: number;
  /** Beute: +lootPerHour je Stunde ab Besetzung bis lootMax (Faktor auf die Stufenbeute). */
  lootPerHour: number;
  lootMax: number;
  /** Probekampf ohne Lagebild: so viele Würfe aus der Verteilung. */
  rangeSamples: number;
  /** KI: höchstens so viele Nester je Zug mit Probekampf prüfen. */
  botMaxNests: number;
}

/** Wurf einer Besetzung: ein Faktor für Schnellboote und Miliz, Anlagen je Art als Anzahl. */
export interface NestRoll {
  factor: number;
  defenses: Counts;
}

/** Gespeicherter Zustand eines Nests (Spalten nest.roll, garrison, garrison_at, loot_at). */
export interface NestLiveState {
  roll: NestRoll | null;
  /** Bestand nach der letzten gewonnenen Abwehr (Überlebende), null = voller Wurf. */
  garrison: { units: Counts; defenses: Counts } | null;
  garrisonAtMs: number | null;
  /** Besetzung (Saisonbeginn oder Wiederbesetzung): ab hier wächst die Beute. null = keine Angabe (100 %). */
  lootAtMs: number | null;
}

export interface Garrison {
  units: Counts;
  defenses: Counts;
}

const HOUR_MS = 3600000;

export const livingOf = (balance: Balance): LivingBalance | null => balance.pirates.living ?? null;

/** Schwankt die Stufe (Stufe 1 fest, ohne Block alles fest)? */
export function nestVaries(level: number, balance: Balance): boolean {
  const lb = livingOf(balance);
  return !!lb && !lb.fixedLevels.includes(level);
}

/** Mögliche Besatzungsfaktoren (80 … 120 % in 5-%-Schritten). */
export function rollFactors(level: number, balance: Balance): number[] {
  const lb = livingOf(balance);
  if (!lb || !nestVaries(level, balance)) return [1];
  const n = Math.round(lb.spread / lb.step);
  const out: number[] = [];
  for (let i = -n; i <= n; i++) out.push(Math.round((1 + i * lb.step) * 1000) / 1000);
  return out;
}

/** Wurf ohne Schwankung (Stufe fest, Mitte der Verteilung). */
export function midRoll(level: number, balance: Balance): NestRoll {
  const g = nestGarrison(level, balance);
  return { factor: 1, defenses: g.ok ? { ...g.nest.defenses } : {} };
}

/** Ungünstigster Wurf (für Bots und den unteren Rand der Siegchance): Faktor max., jede Anlage +1. */
export function worstRoll(level: number, balance: Balance): NestRoll {
  if (!nestVaries(level, balance)) return midRoll(level, balance);
  const fs = rollFactors(level, balance);
  const mid = midRoll(level, balance);
  return { factor: fs[fs.length - 1], defenses: Object.fromEntries(Object.entries(mid.defenses).map(([id, n]) => [id, n > 0 ? n + 1 : 0])) };
}

/** Wurf aus der Verteilung (Server: Math.random; Probekampf: fester Seed). */
export function rollNest(level: number, balance: Balance, rand: Rng): NestRoll {
  const lb = livingOf(balance);
  const mid = midRoll(level, balance);
  if (!lb || !nestVaries(level, balance)) return mid;
  const fs = rollFactors(level, balance);
  const factor = fs[Math.min(fs.length - 1, Math.floor(rand() * fs.length))];
  const defenses: Counts = {};
  for (const [id, n] of Object.entries(mid.defenses)) {
    if (n <= 0) { defenses[id] = 0; continue; }
    const r = rand();
    defenses[id] = Math.max(0, n + (r < lb.defenseShift[0] ? -1 : r < lb.defenseShift[0] + lb.defenseShift[1] ? 0 : 1));
  }
  return { factor, defenses };
}

/** Volle Besatzung eines Wurfs: Einheiten × Faktor (gerundet, mindestens 1), Anlagen wie gewürfelt. */
export function rolledGarrison(level: number, roll: NestRoll | null, balance: Balance): Garrison {
  const g = nestGarrison(level, balance);
  if (!g.ok) return { units: {}, defenses: {} };
  const r = roll ?? midRoll(level, balance);
  const units: Counts = {};
  for (const [id, n] of Object.entries(g.nest.units)) units[id] = n > 0 ? Math.max(1, Math.round(n * r.factor)) : 0;
  const defenses: Counts = {};
  for (const id of Object.keys(g.nest.defenses)) defenses[id] = r.defenses[id] ?? g.nest.defenses[id];
  return { units, defenses };
}

/**
 * Besatzung zum Zeitpunkt: ohne Kampf der volle Wurf; nach gewonnener Abwehr je Einheit sofort mindestens recoverMin
 * des Wurfs, dann +recoverPerHour je Stunde bis zum Wurf; zerstörte Anlagen nach defenseReturnHours vollständig.
 */
export function garrisonAt(level: number, st: NestLiveState, nowMs: number, balance: Balance): Garrison {
  const full = rolledGarrison(level, st.roll, balance);
  const lb = livingOf(balance);
  if (!lb || !st.garrison || st.garrisonAtMs === null) return full;
  const h = Math.max(0, (nowMs - st.garrisonAtMs) / HOUR_MS);
  const units: Counts = {};
  for (const [id, r] of Object.entries(full.units)) {
    const s = st.garrison.units[id] ?? 0;
    units[id] = Math.min(r, Math.round(Math.max(s, lb.recoverMin * r) + lb.recoverPerHour * r * h + 1e-9));
  }
  const back = h >= lb.defenseReturnHours;
  const defenses: Counts = {};
  for (const [id, r] of Object.entries(full.defenses)) defenses[id] = back ? r : Math.min(r, st.garrison.defenses[id] ?? r);
  return { units, defenses };
}

/** Ist die Besatzung voll (keine Schwächung mehr)? */
export function garrisonFull(level: number, st: NestLiveState, nowMs: number, balance: Balance): boolean {
  const now = garrisonAt(level, st, nowMs, balance);
  const full = rolledGarrison(level, st.roll, balance);
  return Object.entries(full.units).every(([id, n]) => (now.units[id] ?? 0) >= n) && Object.entries(full.defenses).every(([id, n]) => (now.defenses[id] ?? 0) >= n);
}

/** Beutefaktor: 1 bei Besetzung, +lootPerHour je Stunde, höchstens lootMax; ohne Block oder Zeitpunkt 1. */
export function lootFactorAt(lootAtMs: number | null, nowMs: number, balance: Balance): number {
  const lb = livingOf(balance);
  if (!lb || lootAtMs === null) return 1;
  const h = Math.max(0, (nowMs - lootAtMs) / HOUR_MS);
  return Math.min(lb.lootMax, 1 + lb.lootPerHour * h);
}

/** Beute der Stufe mal Faktor (abgerundet). */
export function nestLootTimes(level: number, factor: number, balance: Balance): ResourceMap {
  const g = nestGarrison(level, balance);
  const out: ResourceMap = {};
  if (!g.ok) return out;
  for (const [r, v] of Object.entries(g.nest.loot)) out[r] = Math.floor(v * factor + 1e-9);
  return out;
}

/** Nest als Verteidiger zum Zeitpunkt (Besatzung mit Erholung, wachsende Beute). */
export function liveNestDefender(level: number, st: NestLiveState, nowMs: number, balance: Balance): DefenderInput {
  const g = garrisonAt(level, st, nowMs, balance);
  return { units: g.units, defenses: g.defenses, fixedLoot: nestLootTimes(level, lootFactorAt(st.lootAtMs, nowMs, balance), balance) };
}

/** Nach gewonnener Abwehr: Überlebende (Einheiten und Anlagen) speichern; Wurf und Beute bleiben. */
export function afterDefense(level: number, st: NestLiveState, final: Counts, nowMs: number, balance: Balance): NestLiveState {
  const full = rolledGarrison(level, st.roll, balance);
  const units: Counts = {};
  for (const id of Object.keys(full.units)) units[id] = Math.max(0, final[id] ?? 0);
  const defenses: Counts = {};
  for (const id of Object.keys(full.defenses)) defenses[id] = Math.max(0, final[id] ?? 0);
  return { ...st, garrison: { units, defenses }, garrisonAtMs: nowMs };
}

/** Spanne, die die Erkennung zeigt: Einheiten und Anlagen je Art [min, max], Beute [1, lootMax]. */
export function nestSpan(level: number, balance: Balance): { units: Record<string, [number, number]>; defenses: Record<string, [number, number]>; loot: [number, number] } {
  const lb = livingOf(balance);
  const lo = rolledGarrison(level, { ...midRoll(level, balance), factor: rollFactors(level, balance)[0] }, balance);
  const worst = worstRoll(level, balance);
  const hi = rolledGarrison(level, worst, balance);
  const mid = midRoll(level, balance);
  const units: Record<string, [number, number]> = {};
  for (const id of Object.keys(hi.units)) units[id] = [lo.units[id] ?? 0, hi.units[id] ?? 0];
  const defenses: Record<string, [number, number]> = {};
  const varies = nestVaries(level, balance);
  for (const [id, n] of Object.entries(mid.defenses)) defenses[id] = varies && n > 0 ? [n - 1, n + 1] : [n, n];
  return { units, defenses, loot: [1, lb ? lb.lootMax : 1] };
}

/** Würfe für den Probekampf über die Spanne (fester Seed: gleiche Eingabe, gleiche Würfe). */
export function sampleRolls(level: number, balance: Balance, n?: number, seed = 0x5eed): NestRoll[] {
  const count = n ?? livingOf(balance)?.rangeSamples ?? 100;
  if (!nestVaries(level, balance)) return [midRoll(level, balance)];
  const rng = mulberry32(seed + level);
  return Array.from({ length: count }, () => rollNest(level, balance, rng));
}

/** Zustand für einen festen Wurf ohne Schwächung (Probekampf, Simulator). */
export function stateOf(roll: NestRoll | null, lootAtMs: number | null = null): NestLiveState {
  return { roll, garrison: null, garrisonAtMs: null, lootAtMs };
}
