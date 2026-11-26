// Ereignis-Queue: eine Transaktion je Ereignis, fällige Ereignisse mit FOR UPDATE SKIP LOCKED.
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { tables, type Tx } from "@tidefront/db";
import { MAX_EVENT_ATTEMPTS, type ChangeKind, type Engine } from "./context.ts";
import { HANDLERS } from "./handlers.ts";

export interface EventRow {
  id: number;
  type: string;
  dueAt: Date;
  payload: Record<string, unknown>;
  baseId: number | null;
}

export interface HandlerResult {
  notify: [number[] | null, ChangeKind][];
}

export type Handler = (tx: Tx, ev: EventRow, dueMs: number) => Promise<HandlerResult>;

type Pick = { kind: "next"; nowMs: number } | { kind: "base"; baseId: number; nowMs: number };

/**
 * Holt genau ein fälliges Ereignis (gesperrt, andere Worker überspringen es), verarbeitet es und
 * schreibt den Status in derselben Transaktion. Rückgabe: true, wenn eines verarbeitet wurde.
 */
async function processOne(engine: Engine, pick: Pick): Promise<boolean> {
  let failed: { id: number; attempts: number; error: string } | null = null;
  let processed = false;
  const notes: HandlerResult["notify"] = [];
  try {
    await engine.db.transaction(async (tx) => {
      const where =
        pick.kind === "base"
          ? and(
              eq(tables.gameEvent.status, "pending"),
              eq(tables.gameEvent.baseId, pick.baseId),
              lte(tables.gameEvent.dueAt, new Date(pick.nowMs)),
            )
          : and(eq(tables.gameEvent.status, "pending"), lte(tables.gameEvent.dueAt, new Date(pick.nowMs)));
      const [ev] = await tx
        .select()
        .from(tables.gameEvent)
        .where(where)
        .orderBy(asc(tables.gameEvent.dueAt), asc(tables.gameEvent.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!ev) return;
      processed = true;
      const handler = HANDLERS[ev.type];
      try {
        if (!handler) throw new Error(`unknown event type ${ev.type}`);
        await tx.transaction(async (inner) => {
          const res = await handler(inner, ev as EventRow, ev.dueAt.getTime());
          notes.push(...res.notify);
        });
        await tx
          .update(tables.gameEvent)
          .set({ status: "done", processedAt: new Date() })
          .where(eq(tables.gameEvent.id, ev.id));
      } catch (err) {
        // Savepoint zurückgerollt; Fehler am Ereignis vermerken, später erneut versuchen.
        failed = { id: ev.id, attempts: ev.attempts + 1, error: String((err as Error)?.stack ?? err) };
        const giveUp = failed.attempts >= MAX_EVENT_ATTEMPTS;
        await tx
          .update(tables.gameEvent)
          .set({
            attempts: failed.attempts,
            lastError: failed.error.slice(0, 2000),
            status: giveUp ? "failed" : "pending",
            dueAt: giveUp ? ev.dueAt : sql`now() + make_interval(secs => ${2 ** failed.attempts})`,
          })
          .where(eq(tables.gameEvent.id, ev.id));
      }
    });
  } catch (err) {
    engine.log("event transaction failed", String(err));
    return false;
  }
  if (failed) engine.log("event failed", failed);
  for (const [ids, kind] of notes) engine.notify(ids, kind);
  return processed;
}

/** Worker: verarbeitet bis zu `limit` fällige Ereignisse. */
export async function processDue(engine: Engine, nowMs: number, limit = 100): Promise<number> {
  let n = 0;
  while (n < limit && (await processOne(engine, { kind: "next", nowMs }))) n++;
  return n;
}

/** Befehle: zuerst die fälligen Ereignisse des eigenen Stützpunkts. */
export async function processDueForBase(engine: Engine, baseId: number, nowMs: number): Promise<number> {
  let n = 0;
  while (n < 50 && (await processOne(engine, { kind: "base", baseId, nowMs }))) n++;
  return n;
}
