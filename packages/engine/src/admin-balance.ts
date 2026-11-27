// Verwaltung → Statistik, Balance live beobachten (Welle 2, AN-03/TE-05): Karten „Rohstoffbilanz“ (Bestand, Füllgrad,
// Stunden Produktion je Rohstoff aus dem Tagesschnappschuss base_day), „Zuflüsse“ (Produktion, Belohnungen, Beute,
// Kartell, Börse je Tag und Rohstoff), „Welt & Worker“ (Weltereignisse und Marktnachrichten je Tag, Schrittdauer aus
// worker_step_day) und „Nutzung je System“ (usage_day). Rechnet PostgreSQL bzw. wenige Zeilen in JS; 60 s Zwischenspeicher.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { dayList, type StatsDays } from "./adminstats.ts";
import { gameTimeZone } from "./challenge-pool.ts";

const DAY_MS = 86400000;
type ResMap = Record<string, number>;

export interface StockCell { median: number; max: number; fillMedian: number; fillMax: number; hoursMedian: number }
export interface StockGroup { players: number; byResource: Record<string, StockCell> }
export interface InflowDay { d: string; production: ResMap; rewards: ResMap; loot: ResMap; kartell: ResMap; market: ResMap }
export interface StepRow { step: string; runs: number; avgMs: number; maxMs: number; slow: number; errors: number; totalMs: number }
export interface UsageRow { system: string; humans: number; humanUses: number; bots: number; botUses: number }

export interface AdminBalance {
  at: string;
  days: StatsDays;
  resources: string[];
  refPrice: ResMap;
  /** Rohstoffbilanz: letzter Schnappschuss (Tag) je Gruppe; Zeitreihe Median-Füllgrad je Rohstoff (alle Spieler). */
  stock: { day: string | null; humans: StockGroup; bots: StockGroup; perDay: { d: string; fill: ResMap; hours: ResMap }[] };
  /** Zuflüsse je Tag und Rohstoff (alle Spieler). Kartell = an das Kartell verloren (positiv), Börse = netto gekauft. */
  inflow: { perDay: InflowDay[]; total: Omit<InflowDay, "d"> };
  world: {
    events: { d: string; schatzschiff: number; grossflotte: number; belagerung: number; finale: number }[];
    /** Neue Zeilen in market_news je Tag (nach Beginn). */
    news: { d: string; v: number }[];
    newsRows: number;
    steps: StepRow[];
    /** Summe aller Worker-Schritte je Tag (ms) und langsame Läufe. */
    stepsPerDay: { d: string; ms: number; slow: number }[];
  };
  usage: { days: number; rows: UsageRow[] };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const addTo = (m: ResMap, k: string, v: number) => { m[k] = (m[k] ?? 0) + v; };

type SnapRow = { day: string; player_id: number; bot: boolean; resources: ResMap; per_hour: ResMap; capacity: number };

/** Je Spieler (Häfen summiert): Bestand, Kapazität, Netto-Produktion je Rohstoff. */
function perPlayer(rows: SnapRow[]): Map<number, { bot: boolean; res: ResMap; rate: ResMap; cap: number }> {
  const out = new Map<number, { bot: boolean; res: ResMap; rate: ResMap; cap: number }>();
  for (const r of rows) {
    const p = out.get(r.player_id) ?? { bot: r.bot, res: {}, rate: {}, cap: 0 };
    for (const [k, v] of Object.entries(r.resources ?? {})) addTo(p.res, k, Number(v) || 0);
    for (const [k, v] of Object.entries(r.per_hour ?? {})) addTo(p.rate, k, Number(v) || 0);
    p.cap += Number(r.capacity) || 0;
    out.set(r.player_id, p);
  }
  return out;
}

/** Rohstoffbilanz einer Gruppe (rein, testbar): Median/Max Bestand, Füllgrad und Stunden Produktion je Rohstoff. */
export function stockGroup(players: { res: ResMap; rate: ResMap; cap: number }[], resources: readonly string[]): StockGroup {
  const byResource: Record<string, StockCell> = {};
  for (const r of resources) {
    const stock = players.map((p) => p.res[r] ?? 0);
    const fill = players.map((p) => (p.cap > 0 ? (p.res[r] ?? 0) / p.cap : 0));
    const hours = players.map((p) => (p.res[r] ?? 0) / Math.max(1, p.rate[r] ?? 0));
    byResource[r] = {
      median: Math.round(median(stock)), max: Math.round(Math.max(0, ...stock)),
      fillMedian: r3(median(fill)), fillMax: r3(Math.max(0, ...fill)), hoursMedian: r1(median(hours)),
    };
  }
  return { players: players.length, byResource };
}

export async function adminBalance(db: DbOrTx, days: StatsDays, nowMs = Date.now()): Promise<AdminBalance> {
  const tz = gameTimeZone();
  const dayKeys = dayList(nowMs, days, tz);
  const first = dayKeys[0];
  const since = new Date(nowMs - days * DAY_MS).toISOString();
  const resources = [...balance.resources];
  const day = (col: string) => sql`to_char(${sql.raw(col)} at time zone ${tz}, 'YYYY-MM-DD')`;

  // ---------------------------------------------------------------- Rohstoffbilanz (Tagesschnappschuss)
  const snaps = await db.execute<SnapRow>(sql`
    select day, player_id, bot, resources, per_hour, capacity from base_day where day >= ${first} order by day`);
  const byDay = new Map<string, SnapRow[]>();
  for (const s of snaps) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const lastDay = [...byDay.keys()].sort().at(-1) ?? null;
  const last = [...perPlayer(lastDay ? byDay.get(lastDay)! : []).values()];
  const perDayStock = dayKeys.map((d) => {
    const g = stockGroup([...perPlayer(byDay.get(d) ?? []).values()], resources);
    return { d, fill: Object.fromEntries(resources.map((r) => [r, g.byResource[r].fillMedian])), hours: Object.fromEntries(resources.map((r) => [r, g.byResource[r].hoursMedian])) };
  });

  // ---------------------------------------------------------------- Zuflüsse
  const blank = (d: string): InflowDay => ({ d, production: {}, rewards: {}, loot: {}, kartell: {}, market: {} });
  const flow = new Map(dayKeys.map((d) => [d, blank(d)]));
  for (const s of snaps) {
    const f = flow.get(s.day);
    if (f) for (const [r, v] of Object.entries(s.per_hour ?? {})) addTo(f.production, r, (Number(v) || 0) * 24);
  }
  const resRows = await db.execute<{ d: string; kind: string; res: string; v: number }>(sql`
    select ${day("c.claimed_at")} as d, 'rewards' as kind, x.key as res, sum((x.value)::text::float8)::float8 as v
    from daily_challenge c, jsonb_each(c.reward) x
    where c.claimed_at >= ${since}::timestamptz and jsonb_typeof(x.value) = 'number' group by 1, 2, 3
    union all
    select ${day("w.claimed_at")}, 'rewards', x.key, sum((x.value)::text::float8)::float8
    from weekly_goal w, jsonb_each(w.reward || coalesce(w.bonus, '{}'::jsonb)) x
    where w.claimed_at >= ${since}::timestamptz and jsonb_typeof(x.value) = 'number' group by 1, 2, 3
    union all
    select ${day("br.created_at")}, case when br.attacker_player_id is null then 'kartell' else 'loot' end, l.key,
      sum(case when jsonb_typeof(l.value) = 'number' then (l.value)::text::float8 else 0 end)::float8
    from battle_report br, jsonb_each(coalesce(br.report->'battle'->'loot', '{}'::jsonb)) l
    where br.report ? 'battle' and br.created_at >= ${since}::timestamptz group by 1, 2, 3
    union all
    select ${day("to_timestamp(t_ms / 1000.0)")}, 'market', asset, (-sum(amount))::float8
    from trade_ledger where account = 'market' and asset <> 'credits' and t_ms >= ${nowMs - days * DAY_MS} group by 1, 2, 3`);
  for (const r of resRows) {
    const f = flow.get(r.d);
    if (f && r.res !== "credits") addTo(f[r.kind as "rewards" | "loot" | "kartell" | "market"], r.res, r.v);
  }
  const total = blank("");
  for (const f of flow.values()) for (const k of ["production", "rewards", "loot", "kartell", "market"] as const) for (const [r, v] of Object.entries(f[k])) addTo(total[k], r, v);
  const { d: _d, ...totalRest } = total;

  // ---------------------------------------------------------------- Welt & Worker
  const ev = await db.execute<{ d: string; kind: string; n: number }>(sql`
    select ${day("starts_at")} as d, kind, count(*)::int as n from world_event where starts_at >= ${since}::timestamptz group by 1, 2`);
  const evMap = new Map(dayKeys.map((d) => [d, { d, schatzschiff: 0, grossflotte: 0, belagerung: 0, finale: 0 }]));
  for (const r of ev) { const e = evMap.get(r.d); if (e && r.kind in e) (e as unknown as Record<string, number>)[r.kind] += r.n; }
  const news = await db.execute<{ d: string; n: number }>(sql`
    select ${day("starts_at")} as d, count(*)::int as n from market_news where starts_at >= ${since}::timestamptz group by 1`);
  const newsMap = new Map(news.map((r) => [r.d, r.n]));
  const [nr] = await db.execute<{ n: number }>(sql`select count(*)::int as n from market_news`);
  const st = await db.execute<{ day: string; step: string; runs: number; total_ms: number; max_ms: number; slow: number; errors: number }>(sql`
    select day, step, runs, total_ms, max_ms, slow, errors from worker_step_day where day >= ${first}`);
  const steps = new Map<string, StepRow>();
  const perDayMs = new Map(dayKeys.map((d) => [d, { d, ms: 0, slow: 0 }]));
  for (const r of st) {
    const s = steps.get(r.step) ?? { step: r.step, runs: 0, avgMs: 0, maxMs: 0, slow: 0, errors: 0, totalMs: 0 };
    s.runs += r.runs; s.totalMs += r.total_ms; s.maxMs = Math.max(s.maxMs, r.max_ms); s.slow += r.slow; s.errors += r.errors;
    steps.set(r.step, s);
    const p = perDayMs.get(r.day);
    if (p) { p.ms += r.total_ms; p.slow += r.slow; }
  }
  const stepRows = [...steps.values()].map((s) => ({ ...s, avgMs: r1(s.totalMs / Math.max(1, s.runs)), totalMs: Math.round(s.totalMs), maxMs: r1(s.maxMs) }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // ---------------------------------------------------------------- Nutzung je System (verdichtete Tage)
  const us = await db.execute<{ system: string; humans: number; human_uses: number; bots: number; bot_uses: number; days: number }>(sql`
    select system, max(humans)::int as humans, sum(human_uses)::int as human_uses, max(bots)::int as bots, sum(bot_uses)::int as bot_uses,
      count(*)::int as days from usage_day where day >= ${first} group by 1`);
  const usageDays = us.find((r) => r.system === "gesamt")?.days ?? 0;

  return {
    at: new Date(nowMs).toISOString(),
    days,
    resources,
    refPrice: Object.fromEntries(resources.map((r) => [r, balance.market.refPrice[r] ?? 1])),
    stock: { day: lastDay, humans: stockGroup(last.filter((p) => !p.bot), resources), bots: stockGroup(last.filter((p) => p.bot), resources), perDay: perDayStock },
    inflow: { perDay: [...flow.values()], total: totalRest },
    world: {
      events: [...evMap.values()],
      news: dayKeys.map((d) => ({ d, v: newsMap.get(d) ?? 0 })),
      newsRows: nr?.n ?? 0,
      steps: stepRows,
      stepsPerDay: [...perDayMs.values()].map((p) => ({ ...p, ms: Math.round(p.ms) })),
    },
    usage: {
      days: usageDays,
      rows: us.map((r) => ({ system: r.system, humans: r.humans, humanUses: r.human_uses, bots: r.bots, botUses: r.bot_uses }))
        .sort((a, b) => (a.system === "gesamt" ? -1 : b.system === "gesamt" ? 1 : b.humanUses - a.humanUses || b.botUses - a.botUses)),
    },
  };
}

const cache = new Map<number, { at: number; value: Promise<AdminBalance> }>();

/** Wie adminBalance, je Zeitraum höchstens einmal je Minute berechnet. */
/** Zwischenspeicher der Verwaltungsansicht (ADMIN_CACHE_MS, Standard 60 s; 0 = aus, z. B. in der E2E-Umgebung). */
const ADMIN_BALANCE_CACHE_MS = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ADMIN_CACHE_MS ?? 60_000);

export function adminBalanceCached(db: DbOrTx, days: StatsDays, nowMs = Date.now()): Promise<AdminBalance> {
  const hit = cache.get(days);
  if (hit && nowMs - hit.at < ADMIN_BALANCE_CACHE_MS) return hit.value;
  const value = adminBalance(db, days, nowMs);
  cache.set(days, { at: nowMs, value });
  value.catch(() => cache.delete(days));
  return value;
}

export function clearAdminBalanceCache(): void {
  cache.clear();
}
