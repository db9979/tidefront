// Wochenziele, Datenbankseite: Vergabe (lazy, deterministisch, idempotent) und Fortschritt. Der Fortschritt
// kommt über recordAchievement (achievements.ts): derselbe Zähler schreibt Erfolge und Wochenziele fort.
import { and, asc, count, countDistinct, eq, gte, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { protectionStatus, settle } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseOfPlayer } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { addDays, poolContext } from "./challenge-pool.ts";
import { drawWeek, weekKey, weeklyReward, weekStartMs, WEEKLY_DERIVED, type WeeklyContext } from "./achievement-defs.ts";

export type WeeklyRow = typeof tables.weeklyGoal.$inferSelect;
const wg = tables.weeklyGoal;

/** Kontext für die Auswahl aus dem Stützpunkt des Spielers; null ohne Hafen. */
export async function weeklyContextFor(tx: DbOrTx, playerId: number, atMs: number): Promise<WeeklyContext | null> {
  const b = await baseOfPlayer(tx, playerId);
  if (!b) return null;
  const mods = await modsOf(tx, b, atMs);
  const state = settle(b.state, atMs, balance, mods);
  const [o] = await tx.select({ n: countDistinct(tables.base.playerId) }).from(tables.base).where(ne(tables.base.playerId, playerId));
  const raidsPossible = protectionStatus(state.protection, atMs, balance).reason !== "anfaengerschutz";
  const [m] = await tx.select({ allianceId: tables.allianceMember.allianceId }).from(tables.allianceMember).where(eq(tables.allianceMember.playerId, playerId));
  let allied = false;
  if (m) {
    const [n] = await tx.select({ n: count() }).from(tables.allianceMember).where(eq(tables.allianceMember.allianceId, m.allianceId));
    allied = (n?.n ?? 0) >= 2;
  }
  return { ...poolContext(state, { others: (o?.n ?? 0) > 0, raidsPossible }, mods), allied };
}

export async function weekRows(tx: DbOrTx, playerId: number, week: string): Promise<WeeklyRow[]> {
  return tx.select().from(wg).where(and(eq(wg.playerId, playerId), eq(wg.week, week))).orderBy(asc(wg.slot));
}

/** Vergibt die drei Ziele der Woche, falls noch nicht geschehen. Gleichzeitige Aufrufe sind harmlos. */
export async function ensureWeekly(tx: DbOrTx, playerId: number, week: string, atMs: number): Promise<WeeklyRow[]> {
  const existing = await weekRows(tx, playerId, week);
  if (existing.length >= 3) return existing;
  const c = await weeklyContextFor(tx, playerId, atMs);
  if (!c) return existing;
  const reward = weeklyReward(c.stage);
  await tx
    .insert(wg)
    .values(drawWeek(c, `${playerId}|${week}`).map((d) => ({ playerId, week, slot: d.slot, kind: d.kind, param: d.param, target: d.target, reward })))
    .onConflictDoNothing();
  return weekRows(tx, playerId, week);
}

/**
 * Fortschritt auf die offenen Wochenziele der Art `kind` in der Woche von atMs (vergibt die laufende Woche bei
 * Bedarf). level: nur Ziele, deren Zusatz als Zahl höchstens so groß ist (Nest-Stufe).
 */
export async function advanceWeekly(tx: DbOrTx, playerId: number, kind: string, amount: number, atMs: number, level?: number): Promise<number> {
  const week = weekKey(atMs);
  if (week === weekKey(Date.now())) await ensureWeekly(tx, playerId, week, atMs);
  const conds = [eq(wg.playerId, playerId), eq(wg.week, week), eq(wg.kind, kind), isNull(wg.completedAt)];
  if (level !== undefined) conds.push(sql`(${wg.param} is null or (${wg.param})::int <= ${level})`);
  const amt = Math.floor(amount);
  const next = sql`least(${wg.target}, ${wg.progress} + ${amt}::int)`;
  const at = new Date(atMs).toISOString();
  const done = await tx
    .update(wg)
    .set({ progress: next, completedAt: sql`case when ${next} >= ${wg.target} then ${at}::timestamptz else null end` })
    .where(and(...conds))
    .returning({ id: wg.id });
  return done.length;
}

/** Ziele, deren Stand aus dem Zustand gelesen wird (abgeholte Tagesbefehle der Woche): beim Abruf fortschreiben. */
export async function refreshWeeklyDerived(tx: DbOrTx, playerId: number, rows: WeeklyRow[], nowMs: number): Promise<WeeklyRow[]> {
  const open = rows.filter((r) => !r.completedAt && WEEKLY_DERIVED.has(r.kind));
  if (open.length === 0) return rows;
  const out = new Map(rows.map((r) => [r.id, r]));
  for (const r of open) {
    const dc = tables.dailyChallenge;
    const [n] = await tx
      .select({ n: count() })
      .from(dc)
      .where(and(
        eq(dc.playerId, playerId),
        isNotNull(dc.claimedAt),
        gte(dc.claimedAt, new Date(weekStartMs(r.week))),
        lt(dc.claimedAt, new Date(weekStartMs(addDays(r.week, 7)))),
      ));
    const progress = Math.min(r.target, Math.max(r.progress, n?.n ?? 0));
    if (progress === r.progress) continue;
    const completedAt = progress >= r.target ? new Date(nowMs) : null;
    await tx.update(wg).set({ progress, completedAt }).where(and(eq(wg.id, r.id), isNull(wg.completedAt)));
    out.set(r.id, { ...r, progress, completedAt });
  }
  return rows.map((r) => out.get(r.id)!);
}
