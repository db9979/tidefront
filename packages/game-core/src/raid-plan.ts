// Einstieg: kleinster Verband für einen Nest-Überfall, abgeleitet aus dem Probekampf (resolveBattle über feste Seeds)
// statt aus dem Bestand. Rein, ohne Datenbank: genutzt von „Lohnende Ziele“ (Browser) und den Server-Tests zum
// Auftragsbuch (Vorschlag siegt gegen Nest Stufe 1).
import { resolveBattle } from "./combat.ts";
import { nestDefender } from "./pirates.ts";
import type { AttackerInput, Balance, Counts } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";

/** Zielsicherheit des Vorschlags (Anteil gewonnener Probekämpfe; 90 %, damit die Streuung des echten Kampfes den ersten Überfall nicht unter ~85 % drückt). */
export const RAID_PLAN_TARGET = 0.9;
/** Probekämpfe je Prüfung (fester Seed je Lauf: gleiche Eingabe, gleiches Ergebnis; 100, damit die Halbierungssuche nicht auf wenige glückliche Seeds passt). */
export const RAID_PLAN_RUNS = 100;

/** Fester Seed je Durchlauf (wie der Simulator im Browser). */
export const raidPlanSeed = (i: number): number => Math.imul(i + 1, 0x9e3779b1) >>> 0;

export interface RaidPlanOpts {
  versorgungsmangel?: boolean;
  modifiers?: Modifiers;
  target?: number;
  runs?: number;
}

/** Siegquote eines Verbands gegen ein Nest der Stufe (null: Stufe oder Einheit unbekannt). */
export function nestWinRate(units: Counts, level: number, balance: Balance, opts: RaidPlanOpts = {}): number | null {
  const d = nestDefender(level, balance);
  if (!d.ok) return null;
  const runs = opts.runs ?? RAID_PLAN_RUNS;
  const att: AttackerInput = { units, ...(opts.versorgungsmangel ? { versorgungsmangel: true } : {}), ...(opts.modifiers ? { modifiers: opts.modifiers } : {}) };
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(att, d.defender, balance, raidPlanSeed(i));
    if (!r.ok) return null;
    if (r.report.winner === "attacker") wins++;
  }
  return wins / runs;
}

/** Passen die Bodentruppen auf die Landungsschiffe? */
export function troopsFit(units: Counts, balance: Balance): boolean {
  let space = 0, need = 0;
  for (const [id, n] of Object.entries(units)) {
    const d = balance.units[id];
    if (!d || n <= 0) continue;
    space += (d.troopSpace ?? 0) * n;
    if (d.branch === "land") need += (d.size ?? 1) * n;
  }
  return need <= space;
}

const valueOf = (balance: Balance, id: string) => Object.values(balance.units[id]?.cost ?? {}).reduce((s, v) => s + (v ?? 0), 0);
const clean = (c: Counts): Counts => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));

export interface RaidPlan {
  /** Vorgeschlagener Verband (Teilmenge von `full`). */
  units: Counts;
  /** Siegquote des Vorschlags im Probekampf; null ohne Kampfeinheiten oder bei unbekannter Stufe. */
  winRate: number | null;
  /** Erreicht der Vorschlag die Zielsicherheit? */
  enough: boolean;
}

/**
 * Kleinster Verband aus `full` (alles, was für den Überfall in Frage kommt), der im Probekampf mindestens `target`
 * gewinnt. Reicht `full` nicht, ist der Vorschlag `full` selbst (enough = false). Verkleinert wird je Typ, teure
 * zuerst (Landungsschiffe, Kriegsschiffe, dann Truppen), per Halbierungssuche; danach überzählige Landungsschiffe weg.
 * Bodentruppen müssen auf die Landungsschiffe passen.
 */
export function smallestWinningRaid(full: Counts, level: number, balance: Balance, opts: RaidPlanOpts = {}): RaidPlan {
  const target = opts.target ?? RAID_PLAN_TARGET;
  const units = clean(full);
  if (Object.keys(units).length === 0) return { units, winRate: null, enough: false };
  const memo = new Map<string, number | null>();
  const rate = (c: Counts) => {
    const k = JSON.stringify(Object.entries(clean(c)).sort());
    if (!memo.has(k)) memo.set(k, nestWinRate(clean(c), level, balance, opts));
    return memo.get(k)!;
  };
  const fullRate = rate(units);
  if (fullRate === null || fullRate < target) return { units, winRate: fullRate, enough: false };
  const ok = (c: Counts) => troopsFit(c, balance) && (rate(c) ?? 0) >= target;
  const carrier = (id: string) => (balance.units[id]?.troopSpace ?? 0) > 0;
  const order = Object.keys(units).sort((a, b) => Number(carrier(b)) - Number(carrier(a)) || valueOf(balance, b) - valueOf(balance, a));
  const cur: Counts = { ...units };
  const shrink = (id: string) => {
    let lo = 0, hi = cur[id]; // hi erfüllt die Bedingung
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok({ ...cur, [id]: mid })) hi = mid;
      else lo = mid + 1;
    }
    cur[id] = hi;
  };
  for (const id of order) shrink(id);
  for (const id of order.filter(carrier)) shrink(id); // Truppen sind weniger geworden: Landungsschiffe nachziehen
  const out = clean(cur);
  return { units: out, winRate: rate(out), enough: true };
}

/**
 * Wie viele Einheiten `id` zusätzlich (in Schritten von `step`, höchstens `max` mehr) brauchte `full`, um die
 * Zielsicherheit zu erreichen? null, wenn auch `max` nicht reicht. Für den Hinweis „noch N Schützen ausbilden“.
 */
export function extraNeeded(full: Counts, id: string, level: number, balance: Balance, opts: RaidPlanOpts & { step?: number; max?: number } = {}): number | null {
  const target = opts.target ?? RAID_PLAN_TARGET;
  const step = opts.step ?? 5, max = opts.max ?? 60;
  for (let extra = step; extra <= max; extra += step) {
    const c = { ...full, [id]: (full[id] ?? 0) + extra };
    if (!troopsFit(c, balance)) return null;
    if ((nestWinRate(c, level, balance, opts) ?? 0) >= target) return extra;
  }
  return null;
}
