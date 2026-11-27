// Spielerbindung: Erinnerungen, die der Worker jede Minute prüft. Entprellt über player_nudge (activity.ts):
// je Spieler und Ereignis höchstens eine Meldung. Versand über deliverNotice (Push/E-Mail je nach Einstellung der Art).
//  - daily „Tagesbefehle bereit“: ab DAILY_READY_HOUR, wenn der Spieler heute noch nicht da war (in den letzten 7 Tagen
//    aber schon) und kein Morgenbericht-Push heute kam. Schlüssel daily:<Tag>.
//  - daily „Serie in Gefahr“: ab STREAK_WARN_HOUR, wenn eine Serie ab STREAK_WARN_MIN Tagen heute reißen würde.
//    Schlüssel streak:<Tag>.
//  - nest „Nest wieder besetzt“: nur an den Spieler, der das Nest zuletzt besiegt hat, höchstens NEST_WINDOW_MS nach
//    der Wiederbesetzung. Schlüssel nest:<Nest>:<Besiegt-ms>.
// „Bauschlange leer“ meldet event-notices.ts direkt beim Abschluss des letzten Auftrags.
import { sql } from "drizzle-orm";
import { nestRespawnHours } from "@tidefront/game-core";
import { balance, type Engine, type Notice } from "./context.ts";
import { addDays, dayKey, dayStartMs } from "./challenge-pool.ts";
import { claimNudge } from "./activity.ts";
import { deliverNotice } from "./notices.ts";

export const DAILY_READY_HOUR = 9;
export const DAILY_READY_UNTIL_HOUR = 18;
export const STREAK_WARN_HOUR = 18;
export const STREAK_WARN_UNTIL_HOUR = 23;
export const STREAK_WARN_MIN = 2;
/** Nur an Spieler, die in diesem Zeitraum da waren (keine Erinnerungen an längst Abwesende). */
export const RECENT_MS = 7 * 86400000;
/** „Nest wieder besetzt“ nur so lange nach der Wiederbesetzung (Worker-Ausfall: keine alten Meldungen). */
export const NEST_WINDOW_MS = 3 * 3600000;
/** Wer gerade spielt, braucht keine Serien-Warnung. */
export const ONLINE_MS = 30 * 60000;

const iso = (ms: number) => new Date(ms).toISOString();

/** Stunde (0–23) in der Spielzeitzone, gemessen ab Tagesbeginn. */
export function gameHour(nowMs: number): number {
  return Math.floor((nowMs - dayStartMs(dayKey(nowMs))) / 3600000);
}

export interface Job { playerId: number; key: string; notice: Notice }

/** Fällige Erinnerungen zu den Tagesbefehlen (ohne Versand). */
export async function dailyReminderJobs(engine: Engine, nowMs: number): Promise<Job[]> {
  const today = dayKey(nowMs);
  const yesterday = addDays(today, -1);
  const hour = gameHour(nowMs);
  const jobs: Job[] = [];
  if (hour >= DAILY_READY_HOUR && hour < DAILY_READY_UNTIL_HOUR) {
    const rows = await engine.db.execute<{ id: number; streak: number | null }>(sql`
      select p.id, s.length as streak from player p
      left join daily_streak s on s.player_id = p.id and s.last_day = ${yesterday}
      where p.bot_profile is null
        and exists (select 1 from base b where b.player_id = p.id)
        and p.last_seen_at >= ${iso(nowMs - RECENT_MS)}::timestamptz and p.last_seen_at < ${iso(dayStartMs(today))}::timestamptz
        and not exists (select 1 from player_activity_day a where a.player_id = p.id and a.day = ${today})
        and not exists (select 1 from player_nudge n where n.player_id = p.id and n.key = ${`daily:${today}`})
        and not exists (select 1 from morning_summary m where m.player_id = p.id and m.enabled and m.push and m.last_sent_day = ${today})`);
    for (const r of rows) {
      const streak = r.streak ?? 0;
      jobs.push({ playerId: r.id, key: `daily:${today}`, notice: {
        kind: "daily", url: "/?tab=basis", tag: "daily", title: "Tagesbefehle bereit",
        body: streak > 0
          ? `Drei neue Tagesbefehle warten. Halte deine Serie von ${streak} ${streak === 1 ? "Tag" : "Tagen"}.`
          : "Drei neue Tagesbefehle warten auf dich – Belohnung und Saisonpunkte inklusive.",
        facts: streak > 0 ? [["Serie", `${streak} ${streak === 1 ? "Tag" : "Tage"}`]] : undefined,
      } });
    }
  }
  if (hour >= STREAK_WARN_HOUR && hour < STREAK_WARN_UNTIL_HOUR) {
    const rows = await engine.db.execute<{ id: number; length: number; claimed: number }>(sql`
      select p.id, s.length,
        (select count(*)::int from daily_challenge c where c.player_id = p.id and c.day = ${today} and c.claimed_at is not null) as claimed
      from player p join daily_streak s on s.player_id = p.id
      where p.bot_profile is null and s.last_day = ${yesterday} and s.length >= ${STREAK_WARN_MIN}
        and (p.last_seen_at is null or p.last_seen_at < ${iso(nowMs - ONLINE_MS)}::timestamptz)
        and not exists (select 1 from player_nudge n where n.player_id = p.id and n.key = ${`streak:${today}`})`);
    for (const r of rows) {
      const open = Math.max(1, 3 - r.claimed);
      jobs.push({ playerId: r.id, key: `streak:${today}`, notice: {
        kind: "daily", url: "/?tab=basis", tag: "daily", title: "Serie in Gefahr",
        body: `Deine Serie von ${r.length} Tagen reißt um Mitternacht. Noch ${open} von 3 Tagesbefehlen abholen.`,
        facts: [["Serie", `${r.length} Tage`], ["Offen", `${open} von 3`]],
      } });
    }
  }
  return jobs;
}

/** Wiederbesetzte Nester für den Spieler, der sie zuletzt besiegt hat (ohne Versand). */
export async function nestRespawnJobs(engine: Engine, nowMs: number): Promise<Job[]> {
  const maxHours = Math.max(balance.pirates.nestRespawnHours, ...Object.values(balance.pirates.nestLevels ?? {}).map((l) => l.respawnHours ?? 0));
  const rows = await engine.db.execute<{ id: number; col: number; row: number; level: number; t: number; player_id: number }>(sql`
    select n.id, n.col, n.row, n.level, (extract(epoch from n.defeated_at) * 1000)::float8 as t, w.player_id
    from nest n
    join lateral (
      select br.attacker_player_id as player_id from battle_report br
      where br.nest_id = n.id and br.winner = 'attacker' and br.attacker_player_id is not null
      order by br.id desc limit 1
    ) w on true
    join player p on p.id = w.player_id
    where n.defeated_at is not null and n.defeated_at >= ${iso(nowMs - (maxHours * 3600000 + NEST_WINDOW_MS))}::timestamptz
      and p.bot_profile is null and p.last_seen_at >= ${iso(nowMs - RECENT_MS)}::timestamptz`);
  const jobs: Job[] = [];
  for (const r of rows) {
    const t = Math.round(r.t);
    const back = t + nestRespawnHours(balance, r.level) * 3600000;
    if (back > nowMs || nowMs - back > NEST_WINDOW_MS) continue;
    jobs.push({ playerId: r.player_id, key: `nest:${r.id}:${t}`, notice: {
      kind: "nest", url: "/?tab=karte", tag: `nest-${r.id}`, title: "Nest wieder besetzt",
      body: `Das Piratennest Stufe ${r.level} (Feld ${r.col}/${r.row}), das du zuletzt besiegt hast, ist wieder besetzt.`,
      facts: [["Stufe", String(r.level)], ["Feld", `${r.col}/${r.row}`]],
    } });
  }
  return jobs;
}

/** Sperre je Schlüssel holen und versenden; Rückgabe: Anzahl versandter Meldungen. */
export async function deliverJobs(engine: Engine, jobs: Job[]): Promise<number> {
  let n = 0;
  for (const j of jobs) {
    if (!(await claimNudge(engine.db, j.playerId, j.key))) continue;
    await deliverNotice(engine, j.playerId, j.notice);
    n++;
  }
  return n;
}

/** Worker, jede Minute: Erinnerungen zu Tagesbefehlen und wiederbesetzten Nestern. */
export async function runReminders(engine: Engine, nowMs: number): Promise<number> {
  const jobs = [...(await dailyReminderJobs(engine, nowMs)), ...(await nestRespawnJobs(engine, nowMs))];
  return deliverJobs(engine, jobs);
}
