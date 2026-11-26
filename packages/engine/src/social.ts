// Andere Spieler: Rangliste mit Spielerübersicht und Nachrichten.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { tables } from "@tidefront/db";
import { GameError, type Engine } from "./context.ts";
import { computeStandings, type Standing } from "./scoring.ts";
import { runningSeason } from "./season.ts";

// ---------------------------------------------------------------- Rangliste

const RANKING_TTL_MS = 30000;
let cache: { at: number; seasonId: number | null; rows: Standing[] } | null = null;

/** Für Tests und nach einem Saisonwechsel. */
export function clearRankingCache(): void {
  cache = null;
}

/** Rangliste der laufenden Saison mit Spielerübersicht; bis zu 30 s zwischengespeichert. */
export async function rankingView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const s = await runningSeason(engine.db);
  const seasonId = s?.id ?? null;
  if (!cache || cache.seasonId !== seasonId || nowMs - cache.at > RANKING_TTL_MS) {
    const rows = await computeStandings(engine.db, s ? s.startsAt.getTime() : 0, nowMs);
    cache = { at: nowMs, seasonId, rows };
  }
  return {
    serverNow: nowMs,
    computedAtMs: cache.at,
    season: s ? { number: s.number, startsAtMs: s.startsAt.getTime(), endsAtMs: s.endsAt.getTime() } : null,
    rows: cache.rows.map((r) => ({ ...r, own: r.playerId === playerId })),
  };
}

// ---------------------------------------------------------------- Nachrichten

export const MESSAGE_MAX = 2000;
export const SUBJECT_MAX = 80;

/** Codes: no_recipient, self, empty. fromPlayerId null = Systemnachricht. */
export async function sendMessage(
  engine: Engine,
  fromPlayerId: number | null,
  input: { toPlayerId: number; subject?: string | null; body: string },
): Promise<{ ok: true; id: number }> {
  const body = input.body.trim().slice(0, MESSAGE_MAX);
  const subject = input.subject?.trim().slice(0, SUBJECT_MAX) || null;
  if (!body) throw new GameError("empty");
  if (fromPlayerId !== null && fromPlayerId === input.toPlayerId) throw new GameError("self");
  const [to] = await engine.db.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.id, input.toPlayerId));
  if (!to) throw new GameError("no_recipient");
  const [m] = await engine.db
    .insert(tables.message)
    .values({ fromPlayerId, toPlayerId: input.toPlayerId, subject, body })
    .returning({ id: tables.message.id });
  engine.notify([input.toPlayerId], "messages");
  if (fromPlayerId !== null) engine.notify([fromPlayerId], "messages");
  return { ok: true, id: m.id };
}

const other = alias(tables.player, "other");

function shape(r: { id: number; subject: string | null; body: string; createdAt: Date; readAt: Date | null; otherId: number | null; otherName: string | null }) {
  return {
    id: r.id,
    subject: r.subject,
    body: r.body,
    atMs: r.createdAt.getTime(),
    read: r.readAt !== null,
    other: r.otherId === null ? null : { id: r.otherId, name: r.otherName ?? "?" },
  };
}

const cols = {
  id: tables.message.id,
  subject: tables.message.subject,
  body: tables.message.body,
  createdAt: tables.message.createdAt,
  readAt: tables.message.readAt,
  otherId: other.id,
  otherName: other.name,
};

/** Posteingang (neueste zuerst, höchstens 100). other = Absender, null = System. */
export async function inbox(engine: Engine, playerId: number) {
  const rows = await engine.db
    .select(cols)
    .from(tables.message)
    .leftJoin(other, eq(other.id, tables.message.fromPlayerId))
    .where(eq(tables.message.toPlayerId, playerId))
    .orderBy(desc(tables.message.createdAt), desc(tables.message.id))
    .limit(100);
  return rows.map(shape);
}

/** Gesendet (neueste zuerst, höchstens 100). other = Empfänger; read = vom Empfänger gelesen. */
export async function sentMessages(engine: Engine, playerId: number) {
  const rows = await engine.db
    .select(cols)
    .from(tables.message)
    .leftJoin(other, eq(other.id, tables.message.toPlayerId))
    .where(eq(tables.message.fromPlayerId, playerId))
    .orderBy(desc(tables.message.createdAt), desc(tables.message.id))
    .limit(100);
  return rows.map(shape);
}

export async function unreadCount(engine: Engine, playerId: number): Promise<number> {
  const [r] = await engine.db
    .select({ n: sql<number>`count(*)::int` })
    .from(tables.message)
    .where(and(eq(tables.message.toPlayerId, playerId), isNull(tables.message.readAt)));
  return r?.n ?? 0;
}

/** Markiert eine eigene empfangene Nachricht als gelesen. */
export async function markRead(engine: Engine, playerId: number, id: number): Promise<{ ok: true; changed: boolean }> {
  const r = await engine.db
    .update(tables.message)
    .set({ readAt: new Date() })
    .where(and(eq(tables.message.id, id), eq(tables.message.toPlayerId, playerId), isNull(tables.message.readAt)))
    .returning({ id: tables.message.id });
  if (r.length > 0) engine.notify([playerId], "messages");
  return { ok: true, changed: r.length > 0 };
}
