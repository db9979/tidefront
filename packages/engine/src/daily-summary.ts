// Abschnitt „Tagesbefehle“ im Morgenbericht: erfüllte Befehle seit dem letzten Bericht, Abholbereites,
// die Befehle des neuen Tages (falls schon vergeben) und die Serie. Angemeldet über registerSummarySection.
import { and, asc, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";
import { addDays, challengeText, dayKey } from "./challenge-pool.ts";
import { registerSummarySection, type SummarySection } from "./summary.ts";

const dc = tables.dailyChallenge;

export const dailySummarySection: SummarySection = async (db: DbOrTx, playerId, sinceMs, nowMs) => {
  const lines: string[] = [];
  const done = await db
    .select({ kind: dc.kind, target: dc.target, param: dc.param })
    .from(dc)
    .where(and(eq(dc.playerId, playerId), gt(dc.completedAt, new Date(sinceMs)), lte(dc.completedAt, new Date(nowMs))))
    .orderBy(asc(dc.completedAt));
  for (const r of done) lines.push(`Erfüllt: ${challengeText(r.kind, r.target, r.param)}`);

  const open = await db
    .select({ id: dc.id })
    .from(dc)
    .where(and(eq(dc.playerId, playerId), isNotNull(dc.completedAt), isNull(dc.claimedAt)));
  if (open.length > 0) {
    lines.push(`${open.length} ${open.length === 1 ? "erfüllter Befehl wartet" : "erfüllte Befehle warten"} auf das Abholen der Belohnung.`);
  }

  const today = dayKey(nowMs);
  const todays = await db
    .select({ kind: dc.kind, target: dc.target, param: dc.param, progress: dc.progress, completedAt: dc.completedAt })
    .from(dc)
    .where(and(eq(dc.playerId, playerId), eq(dc.day, today)))
    .orderBy(asc(dc.slot));
  for (const r of todays) {
    if (r.completedAt) continue;
    lines.push(`Heute: ${challengeText(r.kind, r.target, r.param)} (${Math.min(r.progress, r.target)}/${r.target})`);
  }
  if (todays.length === 0) lines.push("Die neuen Tagesbefehle liegen auf der Basis bereit.");

  const [s] = await db.select().from(tables.dailyStreak).where(eq(tables.dailyStreak.playerId, playerId));
  if (s && (s.lastDay === today || s.lastDay === addDays(today, -1)) && s.length > 0) {
    lines.push(`Serie: ${s.length} ${s.length === 1 ? "Tag" : "Tage"} in Folge.`);
  }
  return { title: "Tagesbefehle", lines };
};

registerSummarySection(dailySummarySection);
