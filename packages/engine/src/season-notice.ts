// Saisonwechsel-Nachricht (AN-06, Abschlussprüfung 0.38): Bisher meldete der Saisonwechsel nur in der App (notify).
// Jetzt bekommt jeder menschliche Spieler, der seit dem Start der neuen Saison noch nicht da war, einmal Mail und Push
// „Saison N hat begonnen“ (Art comeback: Mail nur mit bestätigter Adresse, Push nur mit Abo; beide abschaltbar).
// Versand tagsüber (SEASON_NOTICE_HOURS, Spielzeitzone) innerhalb von SEASON_NOTICE_WINDOW_MS nach dem Start;
// Schlüssel season:<Nummer> in player_nudge (einmal je Saison und Spieler).
import { sql } from "drizzle-orm";
import type { Engine, Notice } from "./context.ts";
import { claimNudge } from "./activity.ts";
import { deliverNotice } from "./notices.ts";
import { gameHour } from "./retention.ts";
import { runningSeason } from "./season.ts";
import { fmtInt } from "./names.ts";

export const SEASON_NOTICE_HOURS: [number, number] = [9, 21];
export const SEASON_NOTICE_WINDOW_MS = 48 * 3_600_000;
const DAY_MS = 86_400_000;

/** Inhalt der Nachricht (rein, testbar). prev: Platz in der Vorsaison, falls vorhanden. */
export function seasonNotice(s: { number: number; days: number }, prev: { rank: number; of: number; total: number } | null): Notice {
  const facts: [string, string][] = [["Dauer", `${s.days} Tage`]];
  if (prev) facts.push(["Vorsaison", `Platz ${prev.rank} von ${prev.of} (${fmtInt(prev.total)} Punkte)`]);
  return {
    kind: "comeback", url: "/?tab=basis", tag: "season",
    title: `Saison ${s.number} hat begonnen`,
    body: `${prev ? `Saison ${s.number - 1} ist vorbei – du warst auf Platz ${prev.rank} von ${prev.of}. ` : ""}` +
      `Neue Saison, neue Rangliste: Alle starten mit frischem Hafen. Sichere dir früh die guten Nester.`,
    facts,
  };
}

/** Worker: Saisonwechsel-Nachrichten versenden. Rückgabe: Anzahl benachrichtigter Spieler. */
export async function runSeasonNotice(engine: Engine, nowMs: number): Promise<number> {
  const hour = gameHour(nowMs);
  if (hour < SEASON_NOTICE_HOURS[0] || hour >= SEASON_NOTICE_HOURS[1]) return 0;
  const s = await runningSeason(engine.db);
  if (!s) return 0;
  const start = s.startsAt.getTime();
  if (nowMs < start || nowMs - start > SEASON_NOTICE_WINDOW_MS) return 0;
  const key = `season:${s.number}`;
  const iso = new Date(start).toISOString();
  const rows = await engine.db.execute<{ id: number; rank: number | null; total: number | null; of: number | null }>(sql`
    select p.id, r.rank, r.total, (select count(*)::int from season_result x where x.season_id = r.season_id) as of
    from player p
    left join lateral (
      select sr.rank, sr.total, sr.season_id from season_result sr join season se on se.id = sr.season_id
      where sr.player_id = p.id and se.number = ${s.number - 1} limit 1
    ) r on true
    where p.bot_profile is null
      and (p.last_seen_at is null or p.last_seen_at < ${iso}::timestamptz)
      and not exists (select 1 from player_nudge n where n.player_id = p.id and n.key = ${key})
      and (exists (select 1 from push_subscription ps where ps.player_id = p.id)
        or exists (select 1 from player_email e where e.player_id = p.id and e.verified_at is not null))
    order by p.id`);
  const days = Math.round((s.endsAt.getTime() - start) / DAY_MS);
  let n = 0;
  for (const r of rows) {
    if (!(await claimNudge(engine.db, r.id, key))) continue;
    const prev = r.rank !== null && r.total !== null && r.of ? { rank: r.rank, of: r.of, total: r.total } : null;
    await deliverNotice(engine, r.id, seasonNotice({ number: s.number, days }, prev));
    n++;
  }
  return n;
}
