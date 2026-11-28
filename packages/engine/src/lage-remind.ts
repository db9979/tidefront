// „Erinnern“ am nächsten lohnenden Besuch (UX-0.43 B8): ein Push zur gewählten Zeit. Je Spieler höchstens eine
// Erinnerung; eine neue ersetzt die alte. Ablage als Ereignis "visit_reminder" (game_event, keine Schemaänderung),
// Versand nach dem Commit über deliverNotice → pushToPlayer (Art "reminder": ohne Schalter, Nutzerentscheid: übergeht
// Ruhezeit und Bündel und kommt pünktlich). Ohne Push setzt die Oberfläche eine Kalenderdatei (ICS) ein.
import { and, eq, sql } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";
import type { Engine } from "./context.ts";
import type { Handler } from "./events.ts";
import { scheduleEvent } from "./store.ts";

export const REMIND_TYPE = "visit_reminder";
/** Erinnerung frühestens/spätestens so weit voraus. */
export const REMIND_MIN_MS = 60_000;
export const REMIND_MAX_MS = 48 * 3_600_000;
export const REMIND_TEXT_MAX = 160;

const ev = tables.gameEvent;
const mine = (playerId: number) => and(eq(ev.type, REMIND_TYPE), eq(ev.status, "pending"), sql`(${ev.payload}->>'playerId')::int = ${playerId}`);

/** Offene Erinnerung des Spielers (oder null). */
export async function lageReminder(db: DbOrTx, playerId: number): Promise<{ atMs: number; text: string } | null> {
  const [r] = await db.select({ dueAt: ev.dueAt, payload: ev.payload }).from(ev).where(mine(playerId)).limit(1);
  return r ? { atMs: r.dueAt.getTime(), text: String((r.payload as { text?: string }).text ?? "") } : null;
}

/** Erinnerung stellen (ersetzt eine offene). Codes: bad_time, bad_text. */
export async function lageRemind(engine: Engine, playerId: number, input: { atMs: number; text: string }, nowMs = Date.now()) {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, REMIND_TEXT_MAX);
  if (!Number.isFinite(input.atMs) || input.atMs < nowMs + REMIND_MIN_MS || input.atMs > nowMs + REMIND_MAX_MS) return { ok: false as const, code: "bad_time" as const };
  if (text.length === 0) return { ok: false as const, code: "bad_text" as const };
  await engine.db.transaction(async (tx) => {
    await tx.delete(ev).where(mine(playerId));
    await scheduleEvent(tx, REMIND_TYPE, input.atMs, { playerId, text }, null);
  });
  return { ok: true as const, atMs: input.atMs };
}

/** Offene Erinnerung zurücknehmen. */
export async function lageRemindCancel(db: DbOrTx, playerId: number): Promise<{ ok: true }> {
  await db.delete(ev).where(mine(playerId));
  return { ok: true };
}

const visitReminder: Handler = async (_tx, e) => {
  const playerId = Number(e.payload.playerId);
  const text = String(e.payload.text ?? "");
  if (!Number.isInteger(playerId) || !text) return { notify: [] };
  return { notify: [], push: [{ playerId, notice: { kind: "reminder", title: "Zeit für einen Besuch", body: text, url: "/?tab=lage", tag: "reminder" } }] };
};

export const REMIND_HANDLERS: Record<string, Handler> = { [REMIND_TYPE]: visitReminder };
