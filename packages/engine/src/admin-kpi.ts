// Admin-Kennzahlen zur Spielerbindung: Menschen und KI-Spieler getrennt, Tages-Aktivität und Kohorten-Retention
// (Tag 1/7/14 nach Registrierung, aus player_activity_day), Meilensteine mit Saisontag, Abschlussquoten von
// Tagesbefehlen und Wochenzielen. Laufzeiten der tRPC-Aufrufe ergänzt der API-Router (rpc-timing.ts, im Speicher).
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@tidefront/db";
import { addDays, dayKey, gameTimeZone } from "./challenge-pool.ts";
import { dayList, type StatsDays } from "./adminstats.ts";
import { runningSeason } from "./season.ts";

export const KPI_CACHE_MS = 60_000;
/** Kohorten (Registrierungstage) der letzten so vielen Tage. */
export const COHORT_DAYS = 28;
export const RETENTION_OFFSETS = [1, 7, 14] as const;
const DAY_MS = 86400000;

export interface PlayerGroup { total: number; withBase: number; active24h: number; active7d: number }
export interface Cohort { day: string; size: number; /** Anteil 0–1 je Versatz; null = Tag noch nicht erreicht. */ d1: number | null; d7: number | null; d14: number | null }
export interface MilestoneGroup { count: number; firstDay: number | null; medianDay: number | null }
export interface MilestoneRow { id: string; label: string; humans: MilestoneGroup; bots: MilestoneGroup }
export interface Completion { assigned: number; completed: number; claimed: number }

export interface AdminKpi {
  at: string;
  days: StatsDays;
  tz: string;
  season: { number: number; startsAt: string; day: number } | null;
  players: { humans: PlayerGroup; bots: PlayerGroup };
  /** Menschen mit mindestens einem Aufruf je Tag (Tages-Aktivität). */
  activity: { d: string; v: number }[];
  /** Früheste Zeile der Aktivitätstabelle (Erfassung seit); ältere Kohorten sind unvollständig. */
  activitySince: string | null;
  retention: {
    cohorts: Cohort[];
    /** Über alle Kohorten, die den Versatz erreicht haben: zurückgekehrt / Kohortengröße. */
    total: Record<"d1" | "d7" | "d14", { back: number; of: number }>;
  };
  milestones: MilestoneRow[];
  completion: {
    daily: Completion & { bySlot: (Completion & { slot: number })[]; playerDays: number; fullDays: number };
    weekly: Completion & { playerWeeks: number };
  };
}

/** Aus Registrierungstagen und Aktivitätstagen je Spieler die Kohorten (rein, testbar). */
export function cohorts(players: { day: string; active: Set<string> }[], today: string, cohortDays: string[]): AdminKpi["retention"] {
  const byDay = new Map(cohortDays.map((d) => [d, [] as Set<string>[]]));
  for (const p of players) byDay.get(p.day)?.push(p.active);
  const total = { d1: { back: 0, of: 0 }, d7: { back: 0, of: 0 }, d14: { back: 0, of: 0 } };
  const list: Cohort[] = [];
  for (const [day, members] of byDay) {
    const c: Cohort = { day, size: members.length, d1: null, d7: null, d14: null };
    for (const off of RETENTION_OFFSETS) {
      const target = addDays(day, off);
      if (target > today || members.length === 0) continue;
      const back = members.filter((a) => a.has(target)).length;
      const k = `d${off}` as "d1" | "d7" | "d14";
      c[k] = back / members.length;
      total[k].back += back;
      total[k].of += members.length;
    }
    list.push(c);
  }
  return { cohorts: list.reverse(), total };
}

const MILESTONE_ORDER = ["kz", "slots", "nest", "hafen2", "startrampe", "satellit"];

export function milestoneLabel(id: string): string {
  const [k, n] = id.split(":");
  if (k === "kz") return `Kommandozentrale Stufe ${n}`;
  if (k === "slots") return `${n} Missionsplätze`;
  if (k === "nest") return `Erster Sieg Nest Stufe ${n}`;
  if (k === "hafen2") return "Zweiter Hafen";
  if (k === "startrampe") return "Startrampe gebaut";
  if (k === "satellit") return "Erster Satellit";
  return id;
}

function milestoneSort(a: string, b: string): number {
  const [ka, na] = a.split(":");
  const [kb, nb] = b.split(":");
  return MILESTONE_ORDER.indexOf(ka) - MILESTONE_ORDER.indexOf(kb) || Number(na ?? 0) - Number(nb ?? 0);
}

/** Meilensteine (Spieler, Schlüssel, Zeitpunkt) zu Zeilen mit Saisontag (Tag 1 = Saisonstart). */
export function milestoneRows(rows: { key: string; bot: boolean; t: number }[], seasonStartMs: number): MilestoneRow[] {
  const groups = new Map<string, { humans: number[]; bots: number[] }>();
  for (const r of rows) {
    const g = groups.get(r.key) ?? { humans: [], bots: [] };
    (r.bot ? g.bots : g.humans).push(Math.max(1, Math.floor((r.t - seasonStartMs) / DAY_MS) + 1));
    groups.set(r.key, g);
  }
  const sum = (xs: number[]): MilestoneGroup => {
    const s = [...xs].sort((a, b) => a - b);
    return { count: s.length, firstDay: s[0] ?? null, medianDay: s.length ? s[Math.floor((s.length - 1) / 2)] : null };
  };
  return [...groups.keys()].sort(milestoneSort).map((id) => ({ id, label: milestoneLabel(id), humans: sum(groups.get(id)!.humans), bots: sum(groups.get(id)!.bots) }));
}

export async function adminKpi(db: DbOrTx, days: StatsDays, nowMs = Date.now()): Promise<AdminKpi> {
  const tz = gameTimeZone();
  const iso = (ms: number) => new Date(ms).toISOString();
  const today = dayKey(nowMs);
  const season = await runningSeason(db);
  const seasonStartMs = season?.startsAt.getTime() ?? 0;

  // ---------------------------------------------------------------- Spieler: Menschen und KI getrennt
  const pl = await db.execute<{ bot: boolean; total: number; with_base: number; a1: number; a7: number }>(sql`
    select p.bot_profile is not null as bot, count(*)::int as total,
      count(*) filter (where exists (select 1 from base b where b.player_id = p.id))::int as with_base,
      count(*) filter (where p.last_seen_at >= ${iso(nowMs - DAY_MS)}::timestamptz)::int as a1,
      count(*) filter (where p.last_seen_at >= ${iso(nowMs - 7 * DAY_MS)}::timestamptz)::int as a7
    from player p group by 1`);
  const group = (bot: boolean): PlayerGroup => {
    const r = pl.find((x) => x.bot === bot);
    return { total: r?.total ?? 0, withBase: r?.with_base ?? 0, active24h: r?.a1 ?? 0, active7d: r?.a7 ?? 0 };
  };

  // ---------------------------------------------------------------- Tages-Aktivität (nur Menschen)
  const dayKeys = dayList(nowMs, days, tz);
  const act = await db.execute<{ day: string; n: number }>(sql`
    select a.day, count(*)::int as n from player_activity_day a join player p on p.id = a.player_id
    where p.bot_profile is null and a.day >= ${dayKeys[0]} group by a.day`);
  const actMap = new Map(act.map((r) => [r.day, r.n]));
  const [first] = await db.execute<{ day: string | null }>(sql`select min(day) as day from player_activity_day`);

  // ---------------------------------------------------------------- Kohorten-Retention (Menschen)
  const cohortDays = dayList(nowMs, COHORT_DAYS, tz);
  const regs = await db.execute<{ id: number; day: string }>(sql`
    select id, to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') as day from player
    where bot_profile is null and created_at >= ${iso(nowMs - (COHORT_DAYS + 1) * DAY_MS)}::timestamptz`);
  const actRows = regs.length ? await db.execute<{ player_id: number; day: string }>(sql`
    select player_id, day from player_activity_day
    where player_id in (${sql.join(regs.map((r) => sql`${r.id}`), sql`, `)})`) : [];
  const activeOf = new Map<number, Set<string>>();
  for (const a of actRows) activeOf.set(a.player_id, (activeOf.get(a.player_id) ?? new Set()).add(a.day));
  const retention = cohorts(regs.map((r) => ({ day: r.day, active: activeOf.get(r.id) ?? new Set() })), today, cohortDays);

  // ---------------------------------------------------------------- Meilensteine der Saison
  let milestones: MilestoneRow[] = [];
  if (season) {
    const since = iso(seasonStartMs);
    const ms = await db.execute<{ key: string; bot: boolean; t: number }>(sql`
      select m.key, p.bot_profile is not null as bot, (extract(epoch from m.reached_at) * 1000)::float8 as t
      from player_milestone m join player p on p.id = m.player_id where m.season_id = ${season.id}
      union all
      select 'nest:' || x.level, x.bot, (extract(epoch from x.t) * 1000)::float8 from (
        select br.attacker_player_id, n.level, p.bot_profile is not null as bot, min(br.created_at) as t
        from battle_report br join nest n on n.id = br.nest_id join player p on p.id = br.attacker_player_id
        where br.winner = 'attacker' and br.created_at >= ${since}::timestamptz
        group by 1, 2, 3) x
      union all
      select 'hafen2', y.bot, (extract(epoch from greatest(y.created_at, ${since}::timestamptz)) * 1000)::float8 from (
        select b.created_at, p.bot_profile is not null as bot, row_number() over (partition by b.player_id order by b.created_at, b.id) as rn
        from base b join player p on p.id = b.player_id) y
      where y.rn = 2`);
    milestones = milestoneRows(ms, seasonStartMs);
  }

  // ---------------------------------------------------------------- Abschlussquoten (Menschen)
  const dc = await db.execute<{ slot: number; assigned: number; completed: number; claimed: number }>(sql`
    select c.slot, count(*)::int as assigned, count(c.completed_at)::int as completed, count(c.claimed_at)::int as claimed
    from daily_challenge c join player p on p.id = c.player_id
    where p.bot_profile is null and c.day >= ${dayKeys[0]} group by c.slot order by c.slot`);
  const [pd] = await db.execute<{ player_days: number; full_days: number }>(sql`
    select count(*)::int as player_days, count(*) filter (where n = 3)::int as full_days from (
      select c.player_id, c.day, count(c.claimed_at) as n from daily_challenge c join player p on p.id = c.player_id
      where p.bot_profile is null and c.day >= ${dayKeys[0]} group by 1, 2) x`);
  const [wk] = await db.execute<{ assigned: number; completed: number; claimed: number; weeks: number }>(sql`
    select count(*)::int as assigned, count(w.completed_at)::int as completed, count(w.claimed_at)::int as claimed,
      count(distinct (w.player_id, w.week))::int as weeks
    from weekly_goal w join player p on p.id = w.player_id
    where p.bot_profile is null and w.created_at >= ${iso(nowMs - days * DAY_MS)}::timestamptz`);
  const sumC = (xs: Completion[]): Completion => xs.reduce((a, b) => ({ assigned: a.assigned + b.assigned, completed: a.completed + b.completed, claimed: a.claimed + b.claimed }), { assigned: 0, completed: 0, claimed: 0 });

  return {
    at: iso(nowMs),
    days,
    tz,
    season: season ? { number: season.number, startsAt: iso(seasonStartMs), day: Math.floor((nowMs - seasonStartMs) / DAY_MS) + 1 } : null,
    players: { humans: group(false), bots: group(true) },
    activity: dayKeys.map((d) => ({ d, v: actMap.get(d) ?? 0 })),
    activitySince: first?.day ?? null,
    retention,
    milestones,
    completion: {
      daily: { ...sumC(dc), bySlot: dc.map((r) => ({ slot: r.slot, assigned: r.assigned, completed: r.completed, claimed: r.claimed })), playerDays: pd?.player_days ?? 0, fullDays: pd?.full_days ?? 0 },
      weekly: { assigned: wk?.assigned ?? 0, completed: wk?.completed ?? 0, claimed: wk?.claimed ?? 0, playerWeeks: wk?.weeks ?? 0 },
    },
  };
}

const cache = new Map<number, { at: number; value: Promise<AdminKpi> }>();

/** Wie adminKpi, je Zeitraum höchstens einmal je KPI_CACHE_MS berechnet. */
export function adminKpiCached(db: DbOrTx, days: StatsDays, nowMs = Date.now()): Promise<AdminKpi> {
  const hit = cache.get(days);
  if (hit && nowMs - hit.at < KPI_CACHE_MS) return hit.value;
  const value = adminKpi(db, days, nowMs);
  cache.set(days, { at: nowMs, value });
  value.catch(() => cache.delete(days));
  return value;
}

export function clearAdminKpiCache(): void {
  cache.clear();
}
