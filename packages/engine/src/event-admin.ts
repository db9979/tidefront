// Verwaltung → Ereignisse: endgültig fehlgeschlagene Ereignisse (status failed) ansehen und neu einreihen.
// Neu einreihen: status pending, Versuche 0, sofort fällig; die ursprüngliche Fälligkeit bleibt in orig_due_at
// (events.ts gibt sie dem Handler als Spielzeit). Der letzte Fehler bleibt zur Ansicht stehen.
import { and, desc, eq, sql } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";

export interface FailedEvent {
  id: number;
  type: string;
  baseId: number | null;
  payload: Record<string, unknown>;
  attempts: number;
  dueAtMs: number;
  origDueAtMs: number | null;
  createdAtMs: number;
  lastError: string | null;
}

/** Fehlgeschlagene Ereignisse, neueste zuerst (höchstens limit), dazu die Gesamtzahl. */
export async function listFailedEvents(db: DbOrTx, limit = 50): Promise<{ total: number; events: FailedEvent[] }> {
  const g = tables.gameEvent;
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(g).where(eq(g.status, "failed"));
  const rows = await db.select().from(g).where(eq(g.status, "failed")).orderBy(desc(g.id)).limit(limit);
  return {
    total: c?.n ?? 0,
    events: rows.map((r) => ({
      id: r.id, type: r.type, baseId: r.baseId, payload: r.payload as Record<string, unknown>, attempts: r.attempts,
      dueAtMs: r.dueAt.getTime(), origDueAtMs: r.origDueAt?.getTime() ?? null, createdAtMs: r.createdAt.getTime(),
      lastError: r.lastError ? r.lastError.slice(0, 600) : null,
    })),
  };
}

/** Schlüssel, über die sich Ketten erkennen (wie im Wächter event-watchdog.ts). */
const CHAIN_KEYS = ["missionId", "postId", "cableId", "satId", "raidId"];

/**
 * Ein fehlgeschlagenes Ereignis neu einreihen. Codes: not_failed (nicht/nicht mehr fehlgeschlagen),
 * already_pending (gleicher Typ für dasselbe Objekt ist bereits offen, z. B. vom Wächter neu angelegt – sonst
 * liefe eine Kette doppelt).
 */
export async function requeueEvent(db: DbOrTx, id: number, nowMs = Date.now()): Promise<{ ok: true } | { ok: false; code: string }> {
  const g = tables.gameEvent;
  const [ev] = await db.select().from(g).where(eq(g.id, id));
  if (!ev || ev.status !== "failed") return { ok: false, code: "not_failed" };
  const payload = ev.payload as Record<string, unknown>;
  const field = CHAIN_KEYS.find((k) => payload[k] !== undefined);
  const same = field
    ? sql`${g.payload}->>${field} = ${String(payload[field])}`
    : ev.type === "raid_launch" && ev.baseId !== null ? eq(g.baseId, ev.baseId) : sql`${g.payload} = ${JSON.stringify(payload)}::jsonb`;
  const [dup] = await db.select({ n: sql<number>`count(*)::int` }).from(g).where(and(eq(g.status, "pending"), eq(g.type, ev.type), same));
  if ((dup?.n ?? 0) > 0) return { ok: false, code: "already_pending" };
  const rows = await db.update(g)
    .set({ status: "pending", attempts: 0, origDueAt: sql`coalesce(${g.origDueAt}, ${g.dueAt})`, dueAt: new Date(nowMs) })
    .where(and(eq(g.id, id), eq(g.status, "failed")))
    .returning({ id: g.id });
  return rows.length > 0 ? { ok: true } : { ok: false, code: "not_failed" };
}
