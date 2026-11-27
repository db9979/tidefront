// Einstieg: kleinster Verband für einen Nest-Überfall, abgeleitet aus dem Probekampf (resolveBattle über feste Seeds)
// statt aus dem Bestand. Rein, ohne Datenbank: genutzt von „Lohnende Ziele“ (Browser) und den Server-Tests zum
// Auftragsbuch (Vorschlag siegt gegen Nest Stufe 1).
import { resolveBattle } from "./combat.ts";
import { nestDefender } from "./pirates.ts";
import { liveNestDefender, midRoll, nestVaries, rollFactors, sampleRolls, stateOf, worstRoll, type NestRoll } from "./nest-living.ts";
import type { AttackerInput, Balance, Counts, DefenderInput } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import type { CombatWeather } from "./weather.ts";

/** Zielsicherheit des Vorschlags (Anteil gewonnener Probekämpfe; 90 %, damit die Streuung des echten Kampfes den ersten Überfall nicht unter ~85 % drückt). */
export const RAID_PLAN_TARGET = 0.9;
/** Probekämpfe je Prüfung (fester Seed je Lauf: gleiche Eingabe, gleiches Ergebnis; 100, damit die Halbierungssuche nicht auf wenige glückliche Seeds passt). */
export const RAID_PLAN_RUNS = 100;

/** Prüfung des Vorschlags mit anderen Seeds (ab diesem Index, so viele Läufe): die Suche passt sich nicht an ihre Seeds an. */
export const RAID_PLAN_VERIFY_OFFSET = 10000;
export const RAID_PLAN_VERIFY_RUNS = 200;

/** Fester Seed je Durchlauf (wie der Simulator im Browser). */
export const raidPlanSeed = (i: number): number => Math.imul(i + 1, 0x9e3779b1) >>> 0;

export interface RaidPlanOpts {
  versorgungsmangel?: boolean;
  modifiers?: Modifiers;
  target?: number;
  runs?: number;
  /**
   * Lebendige Nester: Verteidiger statt der festen Stufe. Ein Eintrag = genaues Lagebild; mehrere = Probekampf über die
   * Spanne (Lauf i gegen defenders[i mod n], je ein Seed). Fehlt es: Stufe wie im Handbuch (Mitte).
   */
  defenders?: DefenderInput[];
  /** Wetter am Ziel (Vorhersage zur Ankunft), sonst ohne Wetter. */
  weather?: CombatWeather;
  /** Erster Seed-Index (Prüf-Seeds). */
  seedOffset?: number;
}

/** Verteidiger für den Probekampf: „range“ Würfe aus der Verteilung, „worst“/„best“ ungünstigster/günstigster Wurf, „mid“ Mitte. */
export function nestDefenders(level: number, balance: Balance, mode: "range" | "worst" | "best" | "mid"): DefenderInput[] {
  const of = (r: NestRoll) => liveNestDefender(level, stateOf(r), 0, balance);
  if (mode === "worst") return [of(worstRoll(level, balance))];
  if (mode === "mid") return [of(midRoll(level, balance))];
  if (mode === "best") {
    const mid = midRoll(level, balance);
    const f = rollFactors(level, balance)[0];
    return [of(nestVaries(level, balance) ? { factor: f, defenses: Object.fromEntries(Object.entries(mid.defenses).map(([id, n]) => [id, Math.max(0, n - 1)])) } : mid)];
  }
  return sampleRolls(level, balance).map(of);
}

/** Siegchance über die Spanne: ungünstigster Wurf, Mittel über die Verteilung, günstigster Wurf (null: unbekannt). */
export function nestWinRange(units: Counts, level: number, balance: Balance, opts: RaidPlanOpts = {}): { min: number; mean: number; max: number } | null {
  const min = nestWinRate(units, level, balance, { ...opts, defenders: nestDefenders(level, balance, "worst") });
  const mean = nestWinRate(units, level, balance, { ...opts, defenders: nestDefenders(level, balance, "range") });
  const max = nestWinRate(units, level, balance, { ...opts, defenders: nestDefenders(level, balance, "best") });
  return min === null || mean === null || max === null ? null : { min, mean, max };
}

/** Siegquote eines Verbands gegen ein Nest der Stufe (null: Stufe oder Einheit unbekannt). */
export function nestWinRate(units: Counts, level: number, balance: Balance, opts: RaidPlanOpts = {}): number | null {
  const d = nestDefender(level, balance);
  if (!d.ok) return null;
  const defs = opts.defenders && opts.defenders.length > 0 ? opts.defenders : [d.defender];
  const runs = opts.runs ?? RAID_PLAN_RUNS;
  const att: AttackerInput = { units, ...(opts.versorgungsmangel ? { versorgungsmangel: true } : {}), ...(opts.modifiers ? { modifiers: opts.modifiers } : {}) };
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(att, defs[i % defs.length], balance, raidPlanSeed(i + (opts.seedOffset ?? 0)), opts.weather);
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
  return verifiedPlan(clean(cur), units, level, balance, opts, target);
}

/**
 * Prüft den Vorschlag gegen andere Seeds (RAID_PLAN_VERIFY_RUNS ab RAID_PLAN_VERIFY_OFFSET): Die Halbierungssuche
 * landet knapp über dem Ziel ihrer eigenen Seeds; hält der Vorschlag gegen frische Würfe nicht, wächst er zwischen
 * Vorschlag und vollem Bestand (Halbierung über den Anteil), bis er hält. Siegquote im Ergebnis: die geprüfte.
 */
function verifiedPlan(cur: Counts, full: Counts, level: number, balance: Balance, opts: RaidPlanOpts, target: number): RaidPlan {
  const vopts = { ...opts, runs: RAID_PLAN_VERIFY_RUNS, seedOffset: RAID_PLAN_VERIFY_OFFSET };
  const check = (c: Counts) => nestWinRate(c, level, balance, vopts) ?? 0;
  const at = (t: number): Counts => clean(Object.fromEntries(Object.keys(full).map((id) => [id, Math.min(full[id], Math.ceil((cur[id] ?? 0) + t * (full[id] - (cur[id] ?? 0)) - 1e-9))])));
  const first = check(cur);
  if (first >= target) return { units: cur, winRate: first, enough: true };
  const top = check(full);
  if (top < target) return { units: full, winRate: top, enough: false };
  let lo = 0, hi = 1;
  for (let k = 0; k < 6; k++) {
    const mid = (lo + hi) / 2;
    const c = at(mid);
    if (troopsFit(c, balance) && check(c) >= target) hi = mid;
    else lo = mid;
  }
  const out = at(hi);
  return { units: out, winRate: check(out), enough: true };
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
