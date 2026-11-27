// KI-Spieler: Tagesbefehle und Wochenziele (Welle 2, AN-08). Früher holten Bots nie eine Belohnung ab – die Bot-Kurve
// unterschätzte aktive Menschen deutlich (Belohnungen in Woche 1–2 rund 75 % der Produktion). Jetzt „schaut“ ein Bot an
// etwa DAILY_QUOTE der Tage in die Tagesbefehle (deterministisch aus Bot und Tag): dann werden die Befehle vergeben
// (wie beim ersten Abruf eines Menschen, erst danach zählt der Fortschritt) und erledigte Befehle und Wochenziele
// abgeholt. An den übrigen Tagen nicht – wie ein Mensch, der nicht jeden Tag hineinsieht.
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { mulberry32 } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { dayKey } from "./challenge-pool.ts";
import { weekKey } from "./achievement-defs.ts";
import { ensureAssigned, refreshDerived } from "./challenges.ts";
import { ensureWeekly, refreshWeeklyDerived } from "./weekly.ts";
import { claimChallenge } from "./daily.ts";
import { claimWeekly } from "./achievements-view.ts";
import type { TurnCtx } from "./bots-war.ts";

/** Anteil der Tage, an denen ein Bot seine Tagesbefehle ansieht und abholt. */
export const DAILY_QUOTE = 0.6;
/** Höchstens so oft sieht ein Bot hinein (Stunden; Pi-Last). */
export const DAILY_EVERY_HOURS = 3;

/** Sieht der Bot an diesem Spieltag in die Tagesbefehle? (Fest je Bot und Tag, etwa DAILY_QUOTE der Tage.) */
export function dailyEngaged(botId: number, day: string): boolean {
  let h = botId * 2654435761;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return mulberry32(h >>> 0)() < DAILY_QUOTE;
}

/** Tagesbefehle und Wochenziele: vergeben, Fortschritt fortschreiben, Erledigtes abholen. Rückgabe: Anzahl Abholungen. */
export async function dailyTurn(c: TurnCtx): Promise<number> {
  const day = dayKey(c.nowMs);
  if (!dailyEngaged(c.bot.id, day)) return 0;
  if (c.nowMs - (c.state.dailyAtMs ?? 0) < DAILY_EVERY_HOURS * 3600000) return 0;
  c.state.dailyAtMs = c.nowMs;
  const db = c.engine.db;
  const pid = c.bot.id;
  await db.transaction(async (tx) => {
    await refreshDerived(tx, pid, await ensureAssigned(tx, pid, day, c.nowMs), c.nowMs);
    await refreshWeeklyDerived(tx, pid, await ensureWeekly(tx, pid, weekKey(c.nowMs), c.nowMs), c.nowMs);
  });
  const dc = tables.dailyChallenge;
  const done = await db.select({ id: dc.id }).from(dc)
    .where(and(eq(dc.playerId, pid), isNotNull(dc.completedAt), isNull(dc.claimedAt))).orderBy(asc(dc.day), asc(dc.slot));
  let n = 0;
  for (const r of done) {
    const res = await claimChallenge(c.engine, pid, c.key("daily"), r.id);
    if (res.ok) n++;
  }
  const wg = tables.weeklyGoal;
  const goals = await db.select({ id: wg.id }).from(wg).where(and(eq(wg.playerId, pid), isNotNull(wg.completedAt), isNull(wg.claimedAt)));
  for (const g of goals) {
    const res = await claimWeekly(c.engine, pid, c.key("weekly"), g.id);
    if (res.ok) n++;
  }
  if (n > 0) c.log.push(`Tagesbefehle: ${n} Belohnung${n === 1 ? "" : "en"} abgeholt.`);
  return n;
}
