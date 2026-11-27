// Weltpolitik: Saisonplan (docs/REGELN-WELTPOLITIK.md, Abschnitte 2 und 5). Beim Saisonstart einmal ausgewürfelt:
// 3 Gezeit-Fenster zu je 72 h (Beginn Tag 10 / 19 / 28 ± 0,5 Tag, Arten nie doppelt, Kartellfehde nie zuerst), je
// Fenster eine Seerat-Sitzung 36 h bis 12 h vorher, dazu Wochensitzungen an Tag 7 / 14 / 21 / 28 mit eigener
// Wirkzeit. Bei anderer Saisonlänge werden alle Tage proportional umgerechnet. Nichts wirkt nach der Finale-Sperre
// (Ankündigung des Finales minus 48 h).
import type { Balance } from "./types.ts";
import { mulberry32 } from "./rng.ts";
import { finaleBalance, finaleSchedule } from "./finale.ts";
import { politikOf, type BeschlussKind, type GezeitKind, type PolitikBalance } from "./politik-balance.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface GezeitDraft {
  idx: number;
  kind: GezeitKind;
  good: string | null;
  startMs: number;
  endMs: number;
}

export interface SitzungDraft {
  kind: "fenster" | "woche";
  idx: number;
  opensMs: number;
  closesMs: number;
  /** Wirkzeit (bei fenster: das Gezeit-Fenster). */
  effectStartMs: number;
  effectEndMs: number;
  options: string[];
}

function need(balance: Balance): PolitikBalance {
  const p = politikOf(balance);
  if (!p) throw new Error("balance.politik fehlt");
  return p;
}

/** Umrechnung der Tage auf die tatsächliche Saisonlänge (1 bei referenceSeasonDays). */
export function politikScale(seasonStartMs: number, seasonEndMs: number, balance: Balance): number {
  const p = need(balance);
  return (seasonEndMs - seasonStartMs) / DAY_MS / p.referenceSeasonDays;
}

/** Spätestes Ende jeder Wirkung: Finale-Ankündigung minus finaleGapHours (ohne Finale: Saisonende minus Abstand). */
export function politikLimitMs(seasonStartMs: number, seasonEndMs: number, balance: Balance): number {
  const p = need(balance);
  const anchor = finaleBalance(balance) ? finaleSchedule(seasonStartMs, seasonEndMs, balance).announceMs : seasonEndMs;
  return anchor - p.finaleGapHours * HOUR_MS * politikScale(seasonStartMs, seasonEndMs, balance);
}

/** Reihenfolge der Arten: gleichverteilt unter allen Permutationen, deren erste Art nicht in notFirst steht. */
function orderKinds(rng: () => number, kinds: GezeitKind[], notFirst: GezeitKind[]): GezeitKind[] {
  const perms: GezeitKind[][] = [];
  const rec = (rest: GezeitKind[], acc: GezeitKind[]) => {
    if (rest.length === 0) {
      if (!notFirst.includes(acc[0])) perms.push(acc);
      return;
    }
    rest.forEach((k, i) => rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, k]));
  };
  rec(kinds, []);
  if (perms.length === 0) return kinds;
  return perms[Math.floor(rng() * perms.length) % perms.length];
}

/**
 * Die Gezeit-Fenster einer Saison, deterministisch aus dem Seed. Fenster, die die Regeln verletzen würden (zu früh,
 * zu dicht, nach der Finale-Sperre), entfallen statt verschoben zu werden.
 */
export function weltlagePlan(seasonStartMs: number, seasonEndMs: number, seed: number, balance: Balance): GezeitDraft[] {
  const p = need(balance).gezeit;
  const scale = politikScale(seasonStartMs, seasonEndMs, balance);
  const rng = mulberry32(seed >>> 0);
  const kinds = orderKinds(rng, p.kinds, p.notFirst);
  const limit = Math.min(politikLimitMs(seasonStartMs, seasonEndMs, balance), seasonStartMs + p.latestEndDays * DAY_MS * scale);
  const duration = p.durationHours * HOUR_MS * scale;
  const out: GezeitDraft[] = [];
  let lastEnd = -Infinity;
  p.windowStartDays.forEach((day, i) => {
    const jitter = (rng() * 2 - 1) * p.spreadDays;
    const goodRoll = rng();
    const kind = kinds[i % kinds.length];
    const startMs = Math.round(seasonStartMs + (day + jitter) * DAY_MS * scale);
    const endMs = startMs + Math.round(duration);
    if (startMs < seasonStartMs + p.earliestStartDays * DAY_MS * scale) return;
    if (startMs - lastEnd < p.minGapDays * DAY_MS * scale - 1) return;
    if (endMs > limit + 1) return;
    const good = kind === "rohstoffboom" ? p.boomGoods[Math.floor(goodRoll * p.boomGoods.length) % p.boomGoods.length] : null;
    out.push({ idx: i + 1, kind, good, startMs, endMs });
    lastEnd = endMs;
  });
  return out;
}

/** Beschluss zur Wahl in der Sitzung vor Gezeit-Fenster idx (reihum aus dem Katalog, Start per Seed). */
export function windowBeschluss(idx: number, seed: number, balance: Balance): BeschlussKind {
  const cat = need(balance).seerat.windowCatalog;
  return cat[((seed >>> 0) + idx - 1) % cat.length];
}

/** Sitzungen des Seerats: vor jedem Gezeit-Fenster und wöchentlich (eigener Katalog, eigene Wirkzeit). */
export function seeratPlan(seasonStartMs: number, seasonEndMs: number, gezeit: GezeitDraft[], seed: number, balance: Balance): SitzungDraft[] {
  const s = need(balance).seerat;
  const scale = politikScale(seasonStartMs, seasonEndMs, balance);
  const limit = politikLimitMs(seasonStartMs, seasonEndMs, balance);
  const out: SitzungDraft[] = gezeit.map((g) => ({
    kind: "fenster" as const, idx: g.idx,
    opensMs: g.startMs - Math.round(s.openBeforeHours * HOUR_MS * scale),
    closesMs: g.startMs - Math.round(s.closeBeforeHours * HOUR_MS * scale),
    effectStartMs: g.startMs, effectEndMs: g.endMs,
    options: ["plan", windowBeschluss(g.idx, seed, balance), "ruhig"],
  }));
  s.weeklyDays.forEach((day, i) => {
    const opensMs = Math.round(seasonStartMs + day * DAY_MS * scale);
    const closesMs = opensMs + Math.round(s.weeklyVoteHours * HOUR_MS * scale);
    const effectEndMs = closesMs + Math.round(s.weeklyEffectHours * HOUR_MS * scale);
    if (effectEndMs > limit + 1 || opensMs >= seasonEndMs) return;
    out.push({ kind: "woche", idx: i + 1, opensMs, closesMs, effectStartMs: closesMs, effectEndMs, options: [...s.weeklyCatalog, "ruhig"] });
  });
  return out;
}

/** Seed des Saisonplans aus Saison-ID und Start (fest, damit ein zweiter Planer-Lauf dasselbe ergibt). */
export function planSeed(seasonId: number, seasonStartMs: number): number {
  let h = 2166136261 ^ seasonId;
  for (const c of String(seasonStartMs)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
