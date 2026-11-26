// Statistik für Admins: Aktivität, Registrierungen, Ressourcenfluss, Kampf, Nester, Wirtschaft, Auffälligkeiten.
// Zählungen und Summen rechnet PostgreSQL (eine Abfrage je Bereich); nur Stützpunkt-Zustände (JSON) werden in JS
// fortgeschrieben (wenige Dutzend Spieler). Ergebnis wird im API-Prozess 60 s zwischengespeichert.
import { sql } from "drizzle-orm";
import { productionRates, settle, type BaseState } from "@tidefront/game-core";
import type { Db } from "@tidefront/db";
import { balance } from "./context.ts";

export const STATS_CACHE_MS = 60_000;
/** Auffällig: Ressourcen über dem Vielfachen des Medians (ab 3 Spielern und Mindestmenge). */
export const RICH_FACTOR = 3;
export const RICH_MIN_TOTAL = 1000;
/** Auffällig: so viele Überfälle oder mehr an einem Tag auf dasselbe Ziel. */
export const REPEAT_ATTACKS_PER_DAY = 5;

export type StatsDays = 7 | 28;
export interface DayValue { d: string; v: number }
export type ResMap = Record<string, number>;

export interface AdminStats {
  at: string;
  days: StatsDays;
  tz: string;
  season: { number: number; startsAt: string } | null;
  players: { total: number; withBase: number; active24h: number; active7d: number; activeSeason: number };
  registrations: { total: number; inRange: number; perDay: DayValue[] };
  flow: {
    /** Netto-Produktion je Stunde, Summe aller Stützpunkte. */
    productionPerHour: ResMap;
    loot: { players: ResMap; kartell: ResMap; perDay: DayValue[] };
    market: { trades: number; creditVolume: number; fees: number; byResource: ResMap; perDay: DayValue[] };
  };
  combat: {
    pvp: { count: number; attackerWins: number };
    nests: { count: number; attackerWins: number };
    kartell: { count: number; kartellWins: number };
    perDay: { d: string; pvp: number; nests: number; kartell: number }[];
  };
  /** Seit Saisonbeginn: höchste besiegte Neststufe je Spieler. */
  nests: { playerId: number; name: string; maxLevel: number | null; wins: number; attempts: number }[];
  economy: {
    bases: number;
    avgKommandozentrale: number;
    /** levels[i] = Anzahl Stützpunkte mit Stufe i. */
    buildings: { id: string; avg: number; max: number; levels: number[] }[];
  };
  anomalies: {
    richPlayers: { playerId: number; name: string; total: number; ratio: number }[];
    repeatedAttacks: { attacker: string; defender: string; maxPerDay: number; total: number }[];
    failedEvents: { count: number; recent: { id: number; type: string; error: string | null; at: string }[] };
  };
}

function validTz(tz: string | undefined): string {
  if (!tz || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Die letzten `days` Kalendertage in der Zeitzone, ältester zuerst (YYYY-MM-DD). */
export function dayList(nowMs: number, days: number, tz: string): string[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
  const [y, m, d] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function add(m: ResMap, k: string, v: number) {
  m[k] = (m[k] ?? 0) + v;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

export async function adminStats(db: Db, days: StatsDays, nowMs = Date.now(), tzRaw = process.env.TZ): Promise<AdminStats> {
  const tz = validTz(tzRaw);
  const iso = (ms: number) => new Date(ms).toISOString();
  const since = iso(nowMs - days * 86400000);
  const dayKeys = dayList(nowMs, days, tz);
  const series = () => new Map(dayKeys.map((d) => [d, 0]));
  const toList = (m: Map<string, number>): DayValue[] => [...m].map(([d, v]) => ({ d, v: r2(v) }));
  const day = (col: string) => sql`to_char(${sql.raw(col)} at time zone ${tz}, 'YYYY-MM-DD')`;

  const [seasonRow] = await db.execute<{ number: number; t: number }>(sql`
    select number, (extract(epoch from starts_at) * 1000)::float8 as t from season where status = 'running' order by id desc limit 1`);
  const seasonStartMs = seasonRow?.t ?? 0;

  // ---------------------------------------------------------------- Spieler, Registrierungen
  const [pl] = await db.execute<{ total: number; with_base: number; a1: number; a7: number; as: number; reg: number }>(sql`
    select count(*)::int as total,
      count(*) filter (where exists (select 1 from base b where b.player_id = p.id))::int as with_base,
      count(*) filter (where last_seen_at >= ${iso(nowMs - 86400000)}::timestamptz)::int as a1,
      count(*) filter (where last_seen_at >= ${iso(nowMs - 7 * 86400000)}::timestamptz)::int as a7,
      count(*) filter (where last_seen_at >= ${iso(seasonStartMs)}::timestamptz)::int as "as",
      count(*) filter (where created_at >= ${since}::timestamptz)::int as reg
    from player p`);
  const regRows = await db.execute<{ d: string; n: number }>(sql`
    select ${day("created_at")} as d, count(*)::int as n
    from player where created_at >= ${since}::timestamptz group by 1`);
  const reg = series();
  for (const r of regRows) if (reg.has(r.d)) reg.set(r.d, r.n);

  // ---------------------------------------------------------------- Beute (Kampfberichte mit Kampf)
  const lootRows = await db.execute<{ d: string; kartell: boolean; res: string; v: number }>(sql`
    select ${day("br.created_at")} as d, (br.attacker_player_id is null) as kartell, l.key as res,
      sum(case when jsonb_typeof(l.value) = 'number' then (l.value)::text::float8 else 0 end)::float8 as v
    from battle_report br, jsonb_each(coalesce(br.report->'battle'->'loot', '{}'::jsonb)) l
    where br.report ? 'battle' and br.created_at >= ${since}::timestamptz group by 1, 2, 3`);
  const lootPlayers: ResMap = {};
  const lootKartell: ResMap = {};
  const lootDay = series();
  for (const r of lootRows) {
    add(r.kartell ? lootKartell : lootPlayers, r.res, r.v);
    if (lootDay.has(r.d)) lootDay.set(r.d, lootDay.get(r.d)! + r.v);
  }

  // ---------------------------------------------------------------- Börse (Journal; Umsatz = Marktseite ohne Gebühr)
  const mRows = await db.execute<{ d: string; account: string; asset: string; abs: number; s: number; trades: number }>(sql`
    select ${day("to_timestamp(t_ms / 1000.0)")} as d, account, asset,
      sum(abs(amount))::float8 as abs, sum(amount)::float8 as s, count(distinct trade_id)::int as trades
    from trade_ledger where t_ms >= ${nowMs - days * 86400000} and account in ('market', 'fees') group by 1, 2, 3`);
  const market = { trades: 0, creditVolume: 0, fees: 0, byResource: {} as ResMap };
  const mDay = series();
  for (const r of mRows) {
    if (r.account === "fees") {
      market.fees += r.s;
      market.trades += r.trades;
    } else if (r.asset === "credits") {
      market.creditVolume += r.abs;
      if (mDay.has(r.d)) mDay.set(r.d, mDay.get(r.d)! + r.abs);
    } else add(market.byResource, r.asset, r.abs);
  }

  // ---------------------------------------------------------------- Kampf
  const cRows = await db.execute<{ d: string; typ: "pvp" | "nest" | "kartell"; n: number; wins: number }>(sql`
    select ${day("created_at")} as d,
      case when kind = 'kartell' then 'kartell' when nest_id is not null then 'nest' else 'pvp' end as typ,
      count(*)::int as n, count(*) filter (where winner = 'attacker')::int as wins
    from battle_report where kind in ('ueberfall', 'kartell') and report ? 'battle' and created_at >= ${since}::timestamptz
    group by 1, 2`);
  const combat: AdminStats["combat"] = {
    pvp: { count: 0, attackerWins: 0 },
    nests: { count: 0, attackerWins: 0 },
    kartell: { count: 0, kartellWins: 0 },
    perDay: dayKeys.map((d) => ({ d, pvp: 0, nests: 0, kartell: 0 })),
  };
  const cDay = new Map(combat.perDay.map((x) => [x.d, x]));
  for (const r of cRows) {
    const slot = cDay.get(r.d);
    if (r.typ === "kartell") {
      combat.kartell.count += r.n;
      combat.kartell.kartellWins += r.wins;
      if (slot) slot.kartell += r.n;
    } else if (r.typ === "nest") {
      combat.nests.count += r.n;
      combat.nests.attackerWins += r.wins;
      if (slot) slot.nests += r.n;
    } else {
      combat.pvp.count += r.n;
      combat.pvp.attackerWins += r.wins;
      if (slot) slot.pvp += r.n;
    }
  }

  // ---------------------------------------------------------------- Nester seit Saisonbeginn
  const nestRows = await db.execute<{ id: number; name: string; maxl: number | null; wins: number; attempts: number }>(sql`
    select p.id, p.name, max(n.level) filter (where br.winner = 'attacker') as maxl,
      count(*) filter (where br.winner = 'attacker')::int as wins, count(*)::int as attempts
    from battle_report br join nest n on n.id = br.nest_id join player p on p.id = br.attacker_player_id
    where br.kind = 'ueberfall' and br.created_at >= ${iso(seasonStartMs)}::timestamptz
    group by p.id, p.name order by maxl desc nulls last, wins desc, p.name`);

  // ---------------------------------------------------------------- Wirtschaft (Stützpunkt-Zustände)
  const bases = await db.execute<{ player_id: number; name: string; state: BaseState }>(sql`
    select b.player_id, p.name, b.state from base b join player p on p.id = b.player_id order by b.id`);
  const production: ResMap = {};
  const buildingIds = Object.keys(balance.buildings);
  const levels = new Map(buildingIds.map((id) => [id, [] as number[]]));
  const totals: { playerId: number; name: string; total: number }[] = [];
  for (const b of bases) {
    const s = settle(b.state, nowMs, balance);
    for (const [r, v] of Object.entries(productionRates(s, balance).perHour)) add(production, r, v);
    let total = 0;
    for (const r of balance.resources) total += s.resources[r] ?? 0;
    totals.push({ playerId: b.player_id, name: b.name, total });
    for (const id of buildingIds) levels.get(id)!.push(s.buildings[id] ?? 0);
  }
  const buildings = buildingIds.map((id) => {
    const ls = levels.get(id)!;
    const max = ls.reduce((a, b) => Math.max(a, b), 0);
    const hist = Array.from({ length: max + 1 }, () => 0);
    for (const l of ls) hist[l]++;
    return { id, avg: ls.length ? r2(ls.reduce((a, b) => a + b, 0) / ls.length) : 0, max, levels: hist };
  });
  const kz = buildings.find((b) => b.id === "kommandozentrale");

  // ---------------------------------------------------------------- Auffälligkeiten
  const med = median(totals.map((t) => t.total));
  const richPlayers = totals.length >= 3
    ? totals
      .filter((t) => t.total >= RICH_MIN_TOTAL && t.total > RICH_FACTOR * med)
      .map((t) => ({ playerId: t.playerId, name: t.name, total: Math.round(t.total), ratio: med > 0 ? r1(t.total / med) : 0 }))
      .sort((a, b) => b.total - a.total)
    : [];
  const rep = await db.execute<{ attacker: string; defender: string; maxday: number; total: number }>(sql`
    select a.name as attacker, d.name as defender, max(x.n)::int as maxday, sum(x.n)::int as total
    from (
      select attacker_player_id, defender_player_id, ${day("created_at")} as dd, count(*) as n
      from battle_report
      where kind = 'ueberfall' and attacker_player_id is not null and defender_player_id is not null
        and created_at >= ${since}::timestamptz
      group by 1, 2, 3
    ) x join player a on a.id = x.attacker_player_id join player d on d.id = x.defender_player_id
    group by a.name, d.name having max(x.n) >= ${REPEAT_ATTACKS_PER_DAY} order by maxday desc, total desc limit 20`);
  const [fc] = await db.execute<{ n: number }>(sql`select count(*)::int as n from game_event where status = 'failed'`);
  const failed = await db.execute<{ id: string; type: string; last_error: string | null; t: number }>(sql`
    select id::text, type, last_error, (extract(epoch from created_at) * 1000)::float8 as t
    from game_event where status = 'failed' order by id desc limit 5`);

  const roundMap = (m: ResMap) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r1(v)]));
  return {
    at: iso(nowMs),
    days,
    tz,
    season: seasonRow ? { number: seasonRow.number, startsAt: iso(seasonRow.t) } : null,
    players: { total: pl.total, withBase: pl.with_base, active24h: pl.a1, active7d: pl.a7, activeSeason: pl.as },
    registrations: { total: pl.total, inRange: pl.reg, perDay: toList(reg) },
    flow: {
      productionPerHour: roundMap(production),
      loot: { players: roundMap(lootPlayers), kartell: roundMap(lootKartell), perDay: toList(lootDay) },
      market: { trades: market.trades, creditVolume: r2(market.creditVolume), fees: r2(market.fees), byResource: roundMap(market.byResource), perDay: toList(mDay) },
    },
    combat,
    nests: nestRows.map((r) => ({ playerId: r.id, name: r.name, maxLevel: r.maxl, wins: r.wins, attempts: r.attempts })),
    economy: { bases: bases.length, avgKommandozentrale: kz?.avg ?? 0, buildings },
    anomalies: {
      richPlayers,
      repeatedAttacks: rep.map((r) => ({ attacker: r.attacker, defender: r.defender, maxPerDay: r.maxday, total: r.total })),
      failedEvents: {
        count: fc?.n ?? 0,
        recent: failed.map((f) => ({ id: Number(f.id), type: f.type, error: f.last_error ? f.last_error.split("\n")[0].slice(0, 200) : null, at: iso(f.t) })),
      },
    },
  };
}

const cache = new Map<number, { at: number; value: Promise<AdminStats> }>();

/** Wie adminStats, je Zeitraum höchstens einmal je STATS_CACHE_MS berechnet. */
export function adminStatsCached(db: Db, days: StatsDays, nowMs = Date.now()): Promise<AdminStats> {
  const hit = cache.get(days);
  if (hit && nowMs - hit.at < STATS_CACHE_MS) return hit.value;
  const value = adminStats(db, days, nowMs);
  cache.set(days, { at: nowMs, value });
  value.catch(() => cache.delete(days));
  return value;
}

export function clearAdminStatsCache(): void {
  cache.clear();
}
