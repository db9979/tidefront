// Saisonfinale „Leviathan“: Ablauf. Planer (über ensureWorldEventPlanner), Ankündigung (finale_announce), Erscheinen mit
// einmal festgelegter Stärke (finale_appear), Abzug nach Ablauf (finale_end), Verwaltung: Finale vorziehen (Testsystem).
// Zeiten: finaleSchedule (Tag 36, 12:00 / Tag 38, 12:00 / +72 h bei 42 Tagen Saison, sonst proportional).
import { and, eq, inArray, sql } from "drizzle-orm";
import { composeFinale, finaleBalance, finaleSchedule, finaleStrength, forceHp, type Counts } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, type Engine, type NoticeJob } from "./context.ts";
import type { Handler, HandlerResult } from "./events.ts";
import { scheduleEvent } from "./store.ts";
import { cartelStrength } from "./cartel-strength.ts";
import { gameTimeZone } from "./challenge-pool.ts";
import { worldEventNews } from "./market-news-sources.ts";
import { closeFinale, emptyFinaleData, finaleCenter, finaleParticipants, finaleVanguards } from "./finale-core.ts";
import { lockWorldEvent, notice, playersWithBase, runningSeasonRow, systemMessage, type WorldEventRow } from "./world-events.ts";

const HOUR_MS = 3600000;
const none = (): HandlerResult => ({ notify: [] });

function when(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: gameTimeZone() });
}

async function finaleOf(tx: Tx, seasonId: number): Promise<WorldEventRow | null> {
  const [r] = await tx.select().from(tables.worldEvent)
    .where(and(eq(tables.worldEvent.kind, "finale"), eq(tables.worldEvent.seasonId, seasonId))).orderBy(sql`${tables.worldEvent.id} desc`).limit(1);
  return (r as WorldEventRow | undefined) ?? null;
}

/**
 * Planer (Worker alle 10 Minuten, aus ensureWorldEventPlanner): plant die Ankündigung der laufenden Saison, falls es weder
 * ein Finale noch eine geplante Ankündigung gibt und die Armada noch abziehen kann, bevor die Saison endet.
 */
export async function ensureFinalePlanner(tx: Tx, season: { id: number; startsAt: Date; endsAt: Date }, nowMs: number): Promise<number | null> {
  if (!finaleBalance(balance)) return null;
  if (await finaleOf(tx, season.id)) return null;
  const [pending] = await tx.select({ id: tables.gameEvent.id }).from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.type, "finale_announce"), eq(tables.gameEvent.status, "pending"))).limit(1);
  if (pending) return null;
  const s = finaleSchedule(season.startsAt.getTime(), season.endsAt.getTime(), balance);
  if (nowMs >= s.endMs) return null;
  const at = Math.max(nowMs, s.announceMs);
  await scheduleEvent(tx, "finale_announce", at, { seasonId: season.id }, null);
  return at;
}

/** Ankündigung: Sammelpunkt (und Vorhuten) festlegen, Ereignis „announced“, Erscheinen planen, Nachricht und Push an alle. */
export async function announceFinale(tx: Tx, seasonId: number, due: number, appearMs: number, endMs: number): Promise<{ id: number; jobs: NoticeJob[] } | null> {
  const parts = await finaleParticipants(tx, due);
  const all = await playersWithBase(tx);
  const ports = parts.length > 0 ? parts : (await tx.select().from(tables.base)).map((b) => ({ col: b.col, row: b.row, name: b.name }));
  const center = finaleCenter(ports);
  if (!center || all.length === 0) return null;
  const vanguards = finaleVanguards(center, ports);
  const [row] = await tx.insert(tables.worldEvent).values({
    kind: "finale", status: "announced", seasonId, col: center.col, row: center.row, targetBaseId: null, units: {}, initialUnits: {},
    data: { initialHp: 0, strength: 1, finale: emptyFinaleData(parts.length, vanguards) },
    startsAt: new Date(due), activeAt: new Date(appearMs), endsAt: new Date(endMs),
  }).returning({ id: tables.worldEvent.id });
  await scheduleEvent(tx, "finale_appear", appearMs, { eventId: row.id }, null);
  const hours = Math.round((endMs - appearMs) / HOUR_MS);
  const body = `Das Kartell sammelt seine Armada mit dem Flaggschiff „Leviathan“ zum Saisonfinale. Sie erscheint ${when(appearMs)} ` +
    `am Sammelpunkt (Feld ${center.col}/${center.row})${vanguards.length > 0 ? ` und mit ${vanguards.length === 1 ? "einer Vorhut" : `${vanguards.length} Vorhuten`} vor entfernten Häfen` : ""} ` +
    `und bleibt ${hours} Stunden. Ihre Stärke richtet sich nach den Kriegsschiffen und Flugzeugen aller aktiven Häfen. ` +
    "Jeder Überfall trifft einen Abschnitt der Geschwader passend zur Größe deines Verbands; sind sie versenkt, ist das Flaggschiff dran – " +
    "am besten im Sammelangriff. Beute gibt es für jeden vernichteten Lebenspunkt, Titel in der Ruhmeshalle für die Besten.";
  await systemMessage(tx, all.map((p) => p.playerId), "Saisonfinale: Die Kartell-Armada kommt", body, due);
  const jobs = [...new Set(all.map((p) => p.playerId))].map((id) => notice(id, "fleet", "Saisonfinale angekündigt", `Die Kartell-Armada erscheint ${when(appearMs)}.`));
  return { id: row.id, jobs };
}

/** game_event finale_announce. */
const finaleAnnounce: Handler = async (tx, ev, due) => {
  const season = await runningSeasonRow(tx);
  if (!season || Number(ev.payload.seasonId) !== season.id || (await finaleOf(tx, season.id))) return none();
  const s = finaleSchedule(season.startsAt.getTime(), season.endsAt.getTime(), balance);
  if (due >= s.endMs) return none();
  const made = await announceFinale(tx, season.id, due, Math.max(due, s.appearMs), s.endMs);
  if (!made) return none();
  return { notify: [[null, "map"], [null, "messages"]], push: made.jobs };
};

/** game_event finale_appear: Stärke H einmal festlegen (Teilnehmer jetzt, Kartellstärke-Regler), Armada aufstellen. */
const finaleAppear: Handler = async (tx, ev, due) => {
  const e = await lockWorldEvent(tx, Number(ev.payload.eventId));
  if (!e || e.kind !== "finale" || e.status !== "announced") return none();
  const parts = await finaleParticipants(tx, due);
  const totalHp = finaleStrength(parts.reduce((s, p) => s + p.k, 0), await cartelStrength(tx), balance);
  const units: Counts = composeFinale(totalHp, balance);
  const vanguards = parts.length > 0 ? finaleVanguards({ col: e.col, row: e.row }, parts) : (e.data.finale?.vanguards ?? []);
  const data = { ...e.data, initialHp: forceHp(units, balance), finale: { ...(e.data.finale ?? emptyFinaleData(0, [])), totalHp, participants: parts.length, vanguards } };
  await tx.update(tables.worldEvent).set({ status: "active", units, initialUnits: units, data }).where(eq(tables.worldEvent.id, e.id));
  await scheduleEvent(tx, "finale_end", e.endsAt.getTime(), { eventId: e.id }, null);
  await worldEventNews(tx, e.id, due); // Börse: Treibstoff zieht an (wie Kriegslage)
  const all = await playersWithBase(tx);
  const body = `Die Kartell-Armada liegt am Sammelpunkt (Feld ${e.col}/${e.row}): ${units.schnellboot} Schnellboote mit ${units.piratenmiliz} Milizionären ` +
    `und das Flaggschiff „Leviathan“ aus ${units.flaggschiff} Sektionen, zusammen ${Math.round(data.initialHp).toLocaleString("de-DE")} Lebenspunkte. ` +
    `Sie zieht ${when(e.endsAt.getTime())} ab. Plane auf der Karte einen Überfall – die Vorschau zeigt deinen Abschnitt, die Siegchance und die Beute.`;
  await systemMessage(tx, all.map((p) => p.playerId), "Saisonfinale: Die Armada ist da", body, due);
  const push = [...new Set(all.map((p) => p.playerId))].map((id) => notice(id, "fleet", "Die Kartell-Armada ist erschienen", "Greif sie an – jeder Abschnitt bringt Beute."));
  return { notify: [[null, "map"], [null, "messages"]], push };
};

/** game_event finale_end: nicht versenkt – die Armada zieht ab, Restbeute verfällt, Ruhmeshalle „entkommen“. */
const finaleEnd: Handler = async (tx, ev, due) => {
  const e = await lockWorldEvent(tx, Number(ev.payload.eventId));
  if (!e || e.kind !== "finale" || (e.status !== "active" && e.status !== "announced")) return none();
  const push = await closeFinale(tx, e, "escaped", due);
  return { notify: [[null, "map"], [null, "messages"]], push };
};

export const FINALE_HANDLERS: Record<string, Handler> = {
  finale_announce: finaleAnnounce,
  finale_appear: finaleAppear,
  finale_end: finaleEnd,
};

/**
 * Verwaltung (Testsystem): Finale jetzt ankündigen, Erscheinen in appearInMinutes, Dauer wie geplant (proportional zur
 * Saisonlänge, höchstens bis kurz vor Saisonende). Ein früheres Finale dieser Saison wird ersetzt (Ergebnis gelöscht).
 * Codes: no_season, finale_running, season_too_short.
 */
export async function startFinaleNow(engine: Engine, appearInMinutes: number, nowMs = Date.now()): Promise<{ ok: true; eventId: number; appearAtMs: number; endsAtMs: number } | { ok: false; code: string }> {
  const r = await engine.db.transaction(async (tx) => {
    const season = await runningSeasonRow(tx);
    if (!season) return { ok: false as const, code: "no_season" };
    const prev = await finaleOf(tx, season.id);
    if (prev && (prev.status === "announced" || prev.status === "active")) return { ok: false as const, code: "finale_running" };
    const s = finaleSchedule(season.startsAt.getTime(), season.endsAt.getTime(), balance);
    const appearMs = nowMs + Math.max(0, Math.round(appearInMinutes)) * 60000;
    const endMs = Math.min(season.endsAt.getTime() - 60000, appearMs + (s.endMs - s.appearMs));
    if (endMs <= appearMs) return { ok: false as const, code: "season_too_short" };
    await tx.delete(tables.gameEvent).where(and(eq(tables.gameEvent.status, "pending"), inArray(tables.gameEvent.type, ["finale_announce", "finale_appear", "finale_end"])));
    await tx.delete(tables.seasonFinaleResult).where(eq(tables.seasonFinaleResult.seasonId, season.id));
    const made = await announceFinale(tx, season.id, nowMs, appearMs, endMs);
    if (!made) return { ok: false as const, code: "no_season" };
    return { ok: true as const, eventId: made.id, appearAtMs: appearMs, endsAtMs: endMs, jobs: made.jobs };
  });
  if (!r.ok) return r;
  engine.notify(null, "map");
  engine.notify(null, "messages");
  engine.push?.(r.jobs);
  return { ok: true, eventId: r.eventId, appearAtMs: r.appearAtMs, endsAtMs: r.endsAtMs };
}
