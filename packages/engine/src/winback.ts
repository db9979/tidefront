// Spielerbindung: Rückhol-E-Mail an Spieler, die WINBACK_FROM_DAYS bis WINBACK_TO_DAYS Tage nicht da waren.
// Einmal je Inaktivitätsphase: Schlüssel winback:<last_seen_at in ms> in player_nudge. last_seen_at ändert sich erst,
// wenn der Spieler wiederkommt – dann beginnt mit der nächsten Pause eine neue Phase.
// Nur mit bestätigter Adresse und eingeschalteter Art „comeback“ (der Abmeldelink schaltet sie mit ab). AN-06: zweite
// Stufe nach 10–14 Tagen; ohne bestätigte Adresse dieselben Stufen als Push.
import { sql } from "drizzle-orm";
import { settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { balance, type Engine } from "./context.ts";
import type { MailBlock } from "./mail-blocks.ts";
import type { MailContent } from "./mail-templates.ts";
import { EMAIL_DEFAULTS, mailReady, sendMail } from "./mail.ts";
import { pushToPlayer, wants, type Prefs } from "./push.ts";
import { publicUrl } from "./settings.ts";
import { amounts, fmtInt, nOf } from "./names.ts";
import { modsOf } from "./modifiers.ts";
import { computeStandings } from "./scoring.ts";
import { runningSeason } from "./season.ts";
import { claimNudge } from "./activity.ts";
import { gameHour } from "./retention.ts";
import { addDays, dayKey } from "./challenge-pool.ts";

export const WINBACK_FROM_DAYS = 3;
export const WINBACK_TO_DAYS = 7;
/**
 * AN-06: zweite Rückhol-Stufe nach 10–14 Tagen (Schlüssel winback2:<last_seen>), dazu für Spieler ohne bestätigte
 * Adresse dieselben Stufen als Push (Art comeback). Danach kein Kontakt mehr bis zum Saisonwechsel (season-notice.ts).
 */
export interface WinbackStage { stage: 1 | 2; from: number; to: number; prefix: string }
export const WINBACK_STAGES: readonly WinbackStage[] = [
  { stage: 1, from: WINBACK_FROM_DAYS, to: WINBACK_TO_DAYS, prefix: "winback" },
  { stage: 2, from: 10, to: 14, prefix: "winback2" },
];
/** Versand nur tagsüber (Spielzeitzone). */
export const WINBACK_HOURS: [number, number] = [10, 20];
const DAY_MS = 86400000;

export interface WinbackData {
  name: string;
  awayDays: number;
  season: { number: number; day: number; days: number } | null;
  rank: { rank: number; of: number; points: number } | null;
  attacks: { count: number; held: number; lost: Record<string, number> };
  /** Füllstand des fülligsten Lagers (0–1) und ob Produktion verloren geht. */
  storage: { fill: number; full: boolean } | null;
  /** Gerissene Tagesserie (Länge) oder null. */
  lostStreak: number | null;
  /** Leere Bauschlange im Heimathafen. */
  idleQueue: boolean;
}

/** Inhalt der Rückhol-E-Mail (rein, testbar). */
export function winbackMail(d: WinbackData, unsubscribeUrl: string, stage: 1 | 2 = 1): MailContent {
  const blocks: MailBlock[] = [];
  blocks.push({
    type: "banner", tone: "warn",
    kicker: d.season ? `Saison ${d.season.number} · Tag ${d.season.day} von ${d.season.days}` : "TIDEFRONT",
    title: stage === 2 ? "Deine Flotte liegt noch im Hafen" : "Dein Hafen wartet auf dich",
    sub: `Seit ${d.awayDays} Tagen ohne Kapitän`,
  });
  const tiles: { label: string; value: string; tone?: "win" | "loss" | "warn" }[] = [];
  if (d.rank) tiles.push({ label: "Rang", value: `${d.rank.rank} von ${d.rank.of}` });
  if (d.rank) tiles.push({ label: "Punkte", value: fmtInt(d.rank.points) });
  if (d.storage) tiles.push({ label: "Lager", value: `${Math.round(d.storage.fill * 100)} %`, tone: d.storage.full ? "loss" : undefined });
  if (tiles.length) blocks.push({ type: "tiles", tiles });
  const facts: [string, string][] = [];
  facts.push(["Angriffe auf dich", d.attacks.count ? `${d.attacks.count} (${d.attacks.held} abgewehrt)` : "keine"]);
  if (d.attacks.count > d.attacks.held) facts.push(["Geplündert", amounts(d.attacks.lost)]);
  if (d.storage?.full) facts.push(["Produktion", "Lager voll – Nachschub geht verloren"]);
  if (d.lostStreak) facts.push(["Tagesserie", `gerissen (${nOf(d.lostStreak, "Tag", "Tage")})`]);
  blocks.push({ type: "section", title: "Während du weg warst" }, { type: "facts", facts });
  const steps: string[] = ["Drei neue Tagesbefehle abholen – Rohstoffe und Saisonpunkte."];
  if (d.idleQueue) steps.push("Die Bauschlange ist leer: nächsten Ausbau in Auftrag geben.");
  if (d.storage?.full) steps.push("Vorräte ausgeben oder an der Börse verkaufen, bevor weitere Produktion verfällt.");
  if (d.season && d.season.days - d.season.day > 0) steps.push(`Noch ${nOf(d.season.days - d.season.day, "Tag", "Tage")} bis Saisonende – Zeit genug für Plätze in der Rangliste.`);
  blocks.push({ type: "section", title: "Was sich jetzt lohnt" }, { type: "list", items: steps });
  const head = stage === 2 ? "Noch da, Kapitän?" : "Dein Hafen wartet";
  return {
    subject: d.season ? `${head} – Saison ${d.season.number}, Tag ${d.season.day}` : head,
    heading: `Ahoi, ${d.name}`,
    paragraphs: [],
    preheader: `Seit ${d.awayDays} Tagen ohne Kapitän${d.rank ? ` · Rang ${d.rank.rank} von ${d.rank.of}` : ""}`,
    blocks,
    button: { label: "Zurück in den Hafen", url: `${publicUrl()}/?tab=basis` },
    unsubscribeUrl,
    footerNote: stage === 2
      ? "Das ist die letzte Erinnerung für diese Pause. Abschalten: Einstellungen → E-Mail → „Rückkehr-Erinnerung“."
      : "Diese Erinnerung kommt höchstens zweimal je Pause. Abschalten: Einstellungen → E-Mail → „Rückkehr-Erinnerung“.",
  };
}

interface Candidate { id: number; name: string; email: string; token: string; prefs: Prefs | null; seen: number; key: string }

/** Spieler im Rückhol-Fenster der Stufe mit bestätigter Adresse und ohne Rückhol-Mail dieser Stufe in dieser Phase. */
export async function winbackCandidates(engine: Engine, nowMs: number, st: WinbackStage = WINBACK_STAGES[0]): Promise<Candidate[]> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const rows = await engine.db.execute<{ id: number; name: string; email: string; token: string; prefs: Prefs | null; seen: number; key: string }>(sql`
    select * from (
    select p.id, p.name, e.email, e.unsubscribe_token as token, e.prefs, (extract(epoch from p.last_seen_at) * 1000)::float8 as seen,
      ${st.prefix + ":"}::text || ((extract(epoch from p.last_seen_at) * 1000)::bigint)::text as key
    from player p join player_email e on e.player_id = p.id
    where p.bot_profile is null and e.verified_at is not null
      and p.last_seen_at <= ${iso(nowMs - st.from * DAY_MS)}::timestamptz
      and p.last_seen_at > ${iso(nowMs - st.to * DAY_MS)}::timestamptz
      and exists (select 1 from base b where b.player_id = p.id)
    ) c where not exists (select 1 from player_nudge n where n.player_id = c.id and n.key = c.key)
    order by c.id`);
  return rows.map((r) => ({ ...r, seen: Math.round(r.seen) })).filter((r) => wants(r.prefs, EMAIL_DEFAULTS, "comeback"));
}

async function winbackData(engine: Engine, c: Candidate, nowMs: number, ranks: Map<number, { rank: number; points: number }>, of: number,
  season: { number: number; startMs: number; endMs: number } | null): Promise<WinbackData> {
  const since = new Date(c.seen).toISOString();
  const att = await engine.db.execute<{ winner: string | null; loot: Record<string, number> | null }>(sql`
    select winner, report->'battle'->'loot' as loot from battle_report
    where defender_player_id = ${c.id} and report ? 'battle' and created_at > ${since}::timestamptz`);
  const lost: Record<string, number> = {};
  let held = 0;
  for (const a of att) {
    if (a.winner === "defender") held++;
    else for (const [k, v] of Object.entries(a.loot ?? {})) if (typeof v === "number") lost[k] = (lost[k] ?? 0) + v;
  }
  const [home] = await engine.db.execute<{ id: number; state: BaseState }>(sql`
    select id, state from base where player_id = ${c.id} order by is_home desc, id limit 1`);
  let storage: WinbackData["storage"] = null;
  let idleQueue = false;
  if (home) {
    const mods = await modsOf(engine.db, { playerId: c.id, state: home.state, id: home.id, isHome: true }, nowMs);
    const s = settle(home.state, nowMs, balance, mods);
    const cap = storageCapacity(s, balance, mods);
    const top = Math.max(0, ...balance.resources.map((r) => s.resources[r] ?? 0));
    if (cap > 0) storage = { fill: Math.min(1, top / cap), full: top >= cap * 0.999 };
    idleQueue = s.buildQueue.length === 0;
  }
  const [st] = await engine.db.execute<{ length: number }>(sql`
    select length from daily_streak where player_id = ${c.id} and length >= 2 and last_day < ${addDays(dayKey(nowMs), -1)}`);
  const r = ranks.get(c.id);
  return {
    name: c.name,
    awayDays: Math.floor((nowMs - c.seen) / DAY_MS),
    season: season ? { number: season.number, day: Math.floor((nowMs - season.startMs) / DAY_MS) + 1, days: Math.round((season.endMs - season.startMs) / DAY_MS) } : null,
    rank: r ? { rank: r.rank, of, points: r.points } : null,
    attacks: { count: att.length, held, lost },
    storage,
    lostStreak: st?.length ?? null,
    idleQueue,
  };
}

/** Worker: fällige Rückhol-E-Mails versenden. Rückgabe: Anzahl versandter Mails. */
export async function runWinback(engine: Engine, nowMs: number): Promise<number> {
  const hour = gameHour(nowMs);
  if (hour < WINBACK_HOURS[0] || hour >= WINBACK_HOURS[1]) return 0;
  let sent = 0;
  for (const st of WINBACK_STAGES) sent += await winbackPushes(engine, nowMs, st); // AN-06: ohne Adresse per Push
  if (!(await mailReady(engine.db))) return sent;
  const byStage = await Promise.all(WINBACK_STAGES.map(async (st) => ({ st, cands: await winbackCandidates(engine, nowMs, st) })));
  if (byStage.every((x) => x.cands.length === 0)) return sent;
  const s = await runningSeason(engine.db);
  const season = s ? { number: s.number, startMs: s.startsAt.getTime(), endMs: s.endsAt.getTime() } : null;
  const standings = s ? await computeStandings(engine.db, s.startsAt.getTime(), nowMs) : [];
  const ranks = new Map(standings.map((x) => [x.playerId, { rank: x.rank, points: x.total }]));
  for (const { st, cands } of byStage) for (const c of cands) {
    // Erst sperren, dann senden: lieber eine Mail zu wenig als zwei.
    if (!(await claimNudge(engine.db, c.id, c.key))) continue;
    try {
      const data = await winbackData(engine, c, nowMs, ranks, standings.length, season);
      const r = await sendMail(engine, c.email, winbackMail(data, `${publicUrl()}/api/mail/unsubscribe?t=${c.token}`, st.stage));
      if (r.ok) sent++;
    } catch (err) {
      engine.log("winback failed", { playerId: c.id, err: String(err) });
    }
  }
  return sent;
}

/**
 * AN-06: Rückholung als Push für Spieler ohne bestätigte Adresse (mit Push-Abo), gleiche Stufen und Schlüssel wie
 * die Mail. Rückgabe: Anzahl zugestellter Pushes.
 */
export async function winbackPushes(engine: Engine, nowMs: number, st: WinbackStage): Promise<number> {
  const iso = (ms: number) => new Date(ms).toISOString();
  const rows = await engine.db.execute<{ id: number; seen: number }>(sql`
    select p.id, (extract(epoch from p.last_seen_at) * 1000)::float8 as seen from player p
    where p.bot_profile is null
      and p.last_seen_at <= ${iso(nowMs - st.from * DAY_MS)}::timestamptz and p.last_seen_at > ${iso(nowMs - st.to * DAY_MS)}::timestamptz
      and exists (select 1 from base b where b.player_id = p.id)
      and exists (select 1 from push_subscription s where s.player_id = p.id)
      and not exists (select 1 from player_email e where e.player_id = p.id and e.verified_at is not null)`);
  let sent = 0;
  for (const r of rows) {
    const key = `${st.prefix}:${Math.round(r.seen)}`;
    if (!(await claimNudge(engine.db, r.id, key))) continue;
    const days = Math.floor((nowMs - Math.round(r.seen)) / DAY_MS);
    sent += await pushToPlayer(engine, r.id, {
      kind: "comeback", url: "/?tab=basis", tag: "comeback",
      title: st.stage === 2 ? "Noch da, Kapitän?" : "Dein Hafen wartet",
      body: st.stage === 2
        ? `Seit ${days} Tagen ohne Kapitän. Deine Flotte liegt im Hafen – neue Tagesbefehle und Ziele warten.`
        : `Seit ${days} Tagen ohne Kapitän. Drei neue Tagesbefehle warten, die Bauschlange auch.`,
    }, { nowMs }).catch(() => 0);
  }
  return sent;
}
