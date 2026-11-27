// Morgenbericht: täglich zur gewählten Uhrzeit (Zeitzone je Spieler) eine Zusammenfassung per E-Mail und optional Push.
// Der Worker ruft runMorningSummaries jede Minute auf. Idempotent je Spieler und Tag über morning_summary.last_sent_day:
// Der Tag wird vor dem Versand per bedingtem UPDATE beansprucht; nur ein Aufrufer gewinnt.
import { and, asc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Counts, ResourceMap } from "@tidefront/game-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tables, type Db, type DbOrTx } from "@tidefront/db";
import type { Engine } from "./context.ts";
import type { MailBlock, MailContent } from "./mail-templates.ts";
import { mailReady, sendMail } from "./mail.ts";
import { pushToPlayer } from "./push.ts";
import { publicUrl } from "./settings.ts";
import { rankingView } from "./social.ts";
import { amounts, fmtInt, nameOf } from "./names.ts";

const HOUR_MS = 3600000;
/** Nach der gewählten Uhrzeit wird höchstens so lange nachgeholt (z. B. nach einem Neustart). */
export const SUMMARY_CATCHUP_MINUTES = 180;
/** Zeitraum ohne vorherigen Bericht und höchster Rückblick. */
const DEFAULT_LOOKBACK_MS = 24 * HOUR_MS;
const MAX_LOOKBACK_MS = 36 * HOUR_MS;
const MAX_ITEMS = 25;

/** Zusätzlicher Abschnitt (z. B. Tagesbefehle), den andere Module anmelden können. */
export type SummarySection = (db: DbOrTx, playerId: number, sinceMs: number, nowMs: number) => Promise<{ title: string; lines: string[] } | null>;
const sections: SummarySection[] = [];
export function registerSummarySection(fn: SummarySection): void {
  if (!sections.includes(fn)) sections.push(fn);
}

/** Datum (JJJJ-MM-TT) und Minute des Tages in einer Zeitzone. */
export function localClock(ms: number, timeZone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Fällig, wenn die Uhrzeit erreicht (höchstens SUMMARY_CATCHUP_MINUTES später) und heute noch nichts versandt ist. */
export function summaryDue(s: { minuteOfDay: number; timeZone: string; lastSentDay: string | null }, nowMs: number): string | null {
  const c = localClock(nowMs, s.timeZone);
  if (c.minute < s.minuteOfDay || c.minute >= s.minuteOfDay + SUMMARY_CATCHUP_MINUTES) return null;
  return s.lastSentDay === c.day ? null : c.day;
}

export interface SummaryBattle {
  atMs: number;
  title: string;
  role: "attacker" | "defender";
  won: boolean;
  /** Beute: erbeutet (Angreifer) bzw. verloren (Verteidiger). */
  loot: ResourceMap;
  /** Eigene Verluste ohne Rückkehrer. */
  losses: Counts;
}

export interface SummaryData {
  sinceMs: number;
  nowMs: number;
  battles: SummaryBattle[];
  lootGained: ResourceMap;
  lootLost: ResourceMap;
  unitsLost: Counts;
  scouts: number;
  entries: { kind: string; title: string; body: string; atMs: number }[];
  messages: { received: number; unread: number };
  rank: { rank: number; of: number; total: number } | null;
  extra: { title: string; lines: string[] }[];
}

function addInto(target: Record<string, number>, add: Record<string, number> | undefined, sign = 1): void {
  for (const [k, v] of Object.entries(add ?? {})) if (v) target[k] = (target[k] ?? 0) + sign * v;
}

interface StoredBattle {
  winner: string;
  loot?: ResourceMap;
  attacker?: { losses?: Counts; returned?: Counts };
  defender?: { losses?: Counts; returned?: Counts };
}

/** Sammelt, was zwischen sinceMs und nowMs geschah. */
export async function buildSummary(engine: Engine, playerId: number, sinceMs: number, nowMs: number): Promise<SummaryData> {
  const db = engine.db;
  const window = (col: PgColumn) => and(gt(col, new Date(sinceMs)), lte(col, new Date(nowMs)));
  const reports = await db
    .select()
    .from(tables.battleReport)
    .where(and(
      window(tables.battleReport.createdAt),
      or(eq(tables.battleReport.attackerPlayerId, playerId), eq(tables.battleReport.defenderPlayerId, playerId)),
    ))
    .orderBy(asc(tables.battleReport.createdAt));
  const battles: SummaryBattle[] = [];
  const lootGained: ResourceMap = {};
  const lootLost: ResourceMap = {};
  const unitsLost: Counts = {};
  let scouts = 0;
  for (const r of reports) {
    const attacker = r.attackerPlayerId === playerId;
    if (r.kind === "aufklaerung" && attacker) scouts++;
    const b = (r.report as { battle?: StoredBattle }).battle;
    if (!b) continue;
    const side = attacker ? b.attacker : b.defender;
    const losses: Counts = {};
    addInto(losses, side?.losses);
    addInto(losses, side?.returned, -1);
    for (const k of Object.keys(losses)) if (losses[k] <= 0) delete losses[k];
    const won = (r.winner === "attacker") === attacker;
    const loot = (attacker ? (won ? b.loot : {}) : won ? {} : b.loot) ?? {};
    addInto(attacker ? lootGained : lootLost, loot);
    addInto(unitsLost, losses);
    battles.push({ atMs: r.createdAt.getTime(), title: r.title, role: attacker ? "attacker" : "defender", won, loot, losses });
  }
  const entries = await db
    .select()
    .from(tables.summaryEntry)
    .where(and(eq(tables.summaryEntry.playerId, playerId), window(tables.summaryEntry.createdAt)))
    .orderBy(asc(tables.summaryEntry.createdAt));
  const [msg] = await db
    .select({
      received: sql<number>`count(*) filter (where ${tables.message.createdAt} > ${new Date(sinceMs).toISOString()}::timestamptz)::int`,
      unread: sql<number>`count(*) filter (where ${tables.message.readAt} is null)::int`,
    })
    .from(tables.message)
    .where(eq(tables.message.toPlayerId, playerId));
  let rank: SummaryData["rank"] = null;
  try {
    const rv = await rankingView(engine, playerId);
    const own = rv.rows.find((x) => x.own);
    if (own) rank = { rank: own.rank, of: rv.rows.length, total: own.total };
  } catch (err) {
    engine.log("summary ranking", String(err));
  }
  const extra: SummaryData["extra"] = [];
  for (const fn of sections) {
    try {
      const s = await fn(db, playerId, sinceMs, nowMs);
      if (s && s.lines.length > 0) extra.push(s);
    } catch (err) {
      engine.log("summary section", String(err));
    }
  }
  return {
    sinceMs, nowMs, battles, lootGained, lootLost, unitsLost, scouts,
    entries: entries.map((e) => ({ kind: e.kind, title: e.title, body: e.body, atMs: e.createdAt.getTime() })),
    messages: { received: msg?.received ?? 0, unread: msg?.unread ?? 0 },
    rank, extra,
  };
}

function clockIn(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone });
}

const unitsText = (c: Counts) => {
  const parts = Object.entries(c).filter(([, n]) => n > 0).map(([id, n]) => `${fmtInt(n)} ${nameOf(id)}`);
  return parts.length ? parts.join(", ") : "keine";
};

/** Kurzfassung in einem Satz (Absatz der Mail und Push-Text). */
export function summaryLine(d: SummaryData): string {
  const won = d.battles.filter((b) => b.won).length;
  const parts: string[] = [];
  if (d.battles.length > 0) parts.push(`${d.battles.length} ${d.battles.length === 1 ? "Kampf" : "Kämpfe"} (${won} gewonnen)`);
  const done = d.entries.filter((e) => e.kind !== "delivery").length;
  if (done > 0) parts.push(`${done} ${done === 1 ? "fertiger Auftrag" : "fertige Aufträge"}`);
  const del = d.entries.filter((e) => e.kind === "delivery").length;
  if (del > 0) parts.push(`${del} ${del === 1 ? "Lieferung" : "Lieferungen"}`);
  if (d.messages.received > 0) parts.push(`${d.messages.received} neue ${d.messages.received === 1 ? "Nachricht" : "Nachrichten"}`);
  return parts.length ? `${parts.join(", ")}.` : "Eine ruhige Nacht: keine Kämpfe, keine Meldungen.";
}

/** Morgenbericht als Mail im Stil MAIL_THEME (über renderMail). */
export function summaryMail(d: SummaryData, name: string, timeZone: string, unsubscribeUrl?: string): MailContent {
  const day = new Date(d.nowMs).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone });
  const facts: [string, string][] = [];
  const won = d.battles.filter((b) => b.won).length;
  facts.push(["Kämpfe", d.battles.length ? `${d.battles.length} (${won} gewonnen, ${d.battles.length - won} verloren)` : "keine"]);
  if (d.battles.some((b) => b.role === "attacker")) facts.push(["Beute", amounts(d.lootGained)]);
  if (Object.values(d.lootLost).some((v) => v >= 1)) facts.push(["Geplündert", amounts(d.lootLost)]);
  if (d.battles.length) facts.push(["Eigene Verluste", unitsText(d.unitsLost)]);
  facts.push(["Fertige Aufträge", String(d.entries.filter((e) => e.kind !== "delivery").length)]);
  facts.push(["Lieferungen", String(d.entries.filter((e) => e.kind === "delivery").length)]);
  facts.push(["Neue Nachrichten", d.messages.unread > d.messages.received ? `${d.messages.received} (${d.messages.unread} ungelesen)` : String(d.messages.received)]);
  if (d.rank) facts.push(["Rang in der Saison", `${d.rank.rank} von ${d.rank.of} · ${fmtInt(d.rank.total)} Punkte`]);

  // Ausführlich: Kacheln, Lage, Kämpfe als Tabelle, Aufträge/Lieferungen und Zusatzabschnitte als Listen.
  const lootSum = Object.values(d.lootGained).reduce((n, v) => n + Math.max(0, v), 0);
  const done = d.entries.filter((e) => e.kind !== "delivery").length + d.entries.filter((e) => e.kind === "delivery").length;
  const blocks: MailBlock[] = [
    { type: "tiles", tiles: [
      { label: "Siege", value: d.battles.length ? `${won}/${d.battles.length}` : "–", tone: !d.battles.length ? undefined : won === d.battles.length ? "win" : won === 0 ? "loss" : undefined },
      { label: "Beute", value: lootSum > 0 ? `+${fmtInt(lootSum)}` : "0", tone: lootSum > 0 ? "win" : undefined },
      { label: "Erledigt", value: String(done) },
    ] },
    { type: "section", title: "Lage" },
    { type: "facts", facts },
  ];
  if (d.battles.length) {
    blocks.push({ type: "section", title: "Kämpfe" }, {
      type: "table", head: ["Zeit", "Ereignis", "Ergebnis"], align: ["left", "left", "left"], maxRows: MAX_ITEMS,
      rows: [...d.battles].sort((a, b) => a.atMs - b.atMs).map((b) => [
        { v: clockIn(b.atMs, timeZone), muted: true },
        b.role === "attacker" ? b.title : `Angriff auf dich: ${b.title}`,
        { v: b.role === "attacker" ? (b.won ? `Sieg${Object.values(b.loot).some((v) => v >= 1) ? `, Beute ${amounts(b.loot)}` : ""}` : "Niederlage") : b.won ? "abgewehrt" : `verloren, geplündert ${amounts(b.loot)}`, tone: b.won ? "win" : "loss" },
      ]),
    });
  }
  const items = d.entries.map((e) => `${clockIn(e.atMs, timeZone)} ${e.title}: ${e.body}`);
  if (d.scouts > 0) items.push(`${d.scouts} ${d.scouts === 1 ? "Aufklärungsbericht liegt" : "Aufklärungsberichte liegen"} vor.`);
  const shown = items.length > MAX_ITEMS ? [...items.slice(0, MAX_ITEMS), `… und ${items.length - MAX_ITEMS} weitere Meldungen`] : items;
  if (shown.length) blocks.push({ type: "section", title: "Aufträge und Meldungen" }, { type: "list", items: shown });
  for (const s of d.extra) blocks.push({ type: "section", title: s.title }, { type: "list", items: s.lines.slice(0, 10) });

  return {
    subject: `Morgenbericht ${new Date(d.nowMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone })}`,
    heading: `Guten Morgen, ${name}`,
    paragraphs: [
      `Lage seit ${new Date(d.sinceMs).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone })} Uhr: ${summaryLine(d)}`,
      `Dein Bericht für ${day}.`,
    ],
    blocks,
    button: { label: "Hafen öffnen", url: `${publicUrl()}/?tab=basis` },
    unsubscribeUrl,
    footerNote: "Du erhältst den Morgenbericht, weil du ihn in den Einstellungen eingeschaltet hast. Abschalten: Einstellungen → Morgenbericht.",
  };
}

type Outcome = "sent" | "nothing" | "failed";

async function deliverSummary(engine: Engine, playerId: number, name: string, timeZone: string, sinceMs: number, nowMs: number, push: boolean): Promise<Outcome> {
  const [pe] = await engine.db.select().from(tables.playerEmail).where(eq(tables.playerEmail.playerId, playerId));
  const canMail = !!pe?.verifiedAt && (await mailReady(engine.db));
  if (!canMail && !push) return "nothing";
  const data = await buildSummary(engine, playerId, sinceMs, nowMs);
  let mailed: boolean | null = null;
  if (canMail) {
    const r = await sendMail(engine, pe!.email, summaryMail(data, name, timeZone, `${publicUrl()}/api/mail/unsubscribe?t=${pe!.unsubscribeToken}`));
    mailed = r.ok;
  }
  let pushed = 0;
  if (push) {
    pushed = await pushToPlayer(engine, playerId, { kind: "report", title: "Morgenbericht", body: summaryLine(data), url: "/?tab=basis", tag: "summary" })
      .catch((err) => { engine.log("summary push", String(err)); return 0; });
  }
  if (mailed === false && pushed === 0) return "failed";
  return mailed || pushed > 0 ? "sent" : "nothing";
}

/** Jede Minute im Worker: fällige Morgenberichte versenden. Rückgabe: Anzahl versandter Berichte. */
export async function runMorningSummaries(engine: Engine, nowMs: number): Promise<number> {
  const db: Db = engine.db;
  await db.execute(sql`delete from summary_entry where created_at < now() - interval '3 days'`);
  const rows = await db
    .select({ s: tables.morningSummary, name: tables.player.name })
    .from(tables.morningSummary)
    .innerJoin(tables.player, eq(tables.player.id, tables.morningSummary.playerId))
    .where(eq(tables.morningSummary.enabled, true));
  let sent = 0;
  for (const { s, name } of rows) {
    let day: string | null;
    try {
      day = summaryDue(s, nowMs);
    } catch {
      continue;
    }
    if (!day) continue;
    const claimed = await db
      .update(tables.morningSummary)
      .set({ lastSentDay: day, lastSentAt: new Date(nowMs) })
      .where(and(
        eq(tables.morningSummary.playerId, s.playerId),
        eq(tables.morningSummary.enabled, true),
        or(isNull(tables.morningSummary.lastSentDay), ne(tables.morningSummary.lastSentDay, day)),
      ))
      .returning({ id: tables.morningSummary.playerId });
    if (claimed.length === 0) continue;
    const prevMs = s.lastSentAt?.getTime();
    const sinceMs = prevMs !== undefined ? Math.max(prevMs, nowMs - MAX_LOOKBACK_MS) : nowMs - DEFAULT_LOOKBACK_MS;
    let outcome: Outcome = "failed";
    try {
      outcome = await deliverSummary(engine, s.playerId, name, s.timeZone, sinceMs, nowMs, s.push);
    } catch (err) {
      engine.log("summary failed", { playerId: s.playerId, err: String(err) });
    }
    if (outcome === "sent") sent++;
    if (outcome === "failed") {
      // Freigeben, damit die nächste Minute es erneut versucht (innerhalb des Nachholfensters).
      await db
        .update(tables.morningSummary)
        .set({ lastSentDay: s.lastSentDay, lastSentAt: s.lastSentAt })
        .where(and(eq(tables.morningSummary.playerId, s.playerId), eq(tables.morningSummary.lastSentDay, day)));
    }
  }
  return sent;
}
