// Befehlsrahmen der Spieler (aus commands.ts ausgelagert): Idempotenz-Schlüssel, fällige Ereignisse der eigenen Häfen,
// eine Transaktion mit Savepoint für abgelehnte Befehle, Wiederholung bei Deadlock/Serialisierung (TE-08).
import { eq } from "drizzle-orm";
import { expansionOf } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import type { Tx } from "@tidefront/db";
import { balance, GameError, type ChangeKind, type Engine } from "./context.ts";
import { processDueForBase } from "./events.ts";
import { worldLockShared } from "./world-lock.ts";
import { basesOfPlayer } from "./store.ts";

export type Rejected = { ok: false; code: string };
export type Draft<T> = T | (Rejected & { keepWrites?: boolean });

export interface Ctx {
  tx: Tx;
  playerId: number;
  nowMs: number;
  notify: [number[] | null, ChangeKind][];
}

/**
 * Führt einen Befehl genau einmal aus. Ein zweiter Aufruf mit demselben Schlüssel liefert die
 * gespeicherte Antwort (auch für abgelehnte Befehle).
 */
export async function runCommand<T extends { ok: true }>(
  engine: Engine,
  playerId: number,
  key: string,
  command: string,
  fn: (ctx: Ctx) => Promise<Draft<T>>,
): Promise<T | Rejected> {
  const fullKey = `${playerId}:${key}`;
  const nowMs = Date.now();
  // Mehrere Häfen: fällige Ereignisse aller eigenen Häfen (höchstens balance-maxBases, also wenige).
  for (const own of (await basesOfPlayer(engine.db, playerId)).slice(0, maxDueBases())) await processDueForBase(engine, own.id, nowMs);
  const notes: Ctx["notify"] = [];
  // TE-08: Deadlock/Serialisierung/Sperr-Timeout rollt alles zurück (auch command_log) – derselbe Schlüssel gelingt
  // meist sofort beim zweiten Versuch. Bis zu RETRY_ATTEMPTS Wiederholungen mit kurzem Zufallsabstand.
  for (let attempt = 0; ; attempt++) {
    notes.length = 0;
    try {
      const result = await commandTransaction(engine, playerId, fullKey, command, nowMs, notes, fn);
      for (const [ids, kind] of notes) engine.notify(ids, kind);
      return result;
    } catch (err) {
      if (attempt >= RETRY_ATTEMPTS || !isRetryableDbError(err)) throw err;
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 60) * (attempt + 1)));
    }
  }
}

/** Wiederholungen von runCommand bei vorübergehenden Datenbankfehlern (TE-08). */
export const RETRY_ATTEMPTS = 2;

/** Postgres-Codes, bei denen eine Wiederholung derselben Transaktion sinnvoll ist: Deadlock, Serialisierung, lock_timeout. */
const RETRYABLE = new Set(["40P01", "40001", "55P03"]);

/** Vorübergehender DB-Fehler? Auch eingewickelt (Drizzle legt den Treiberfehler in `cause`). */
export function isRetryableDbError(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (typeof e.code === "string" && RETRYABLE.has(e.code)) return true;
  }
  return false;
}

async function commandTransaction<T extends { ok: true }>(
  engine: Engine, playerId: number, fullKey: string, command: string, nowMs: number, notes: Ctx["notify"],
  fn: (ctx: Ctx) => Promise<Draft<T>>,
): Promise<T | Rejected> {
  return engine.db.transaction(async (tx) => {
    await worldLockShared(tx); // Saisonwechsel wartet auf laufende Befehle (world-lock.ts)
    const inserted = await tx
      .insert(tables.commandLog)
      .values({ key: fullKey, playerId, command })
      .onConflictDoNothing()
      .returning({ key: tables.commandLog.key });
    if (inserted.length === 0) {
      const [prev] = await tx.select().from(tables.commandLog).where(eq(tables.commandLog.key, fullKey));
      return (prev?.response as T | Rejected) ?? { ok: false, code: "duplicate" };
    }
    let res: T | Rejected;
    try {
      // Savepoint: ein abgelehnter Befehl hinterlässt nur den Eintrag im Befehlsprotokoll.
      res = await tx.transaction(async (inner) => {
        const r = await fn({ tx: inner, playerId, nowMs, notify: notes });
        if (r.ok) return r;
        const rej = r as Rejected & { keepWrites?: boolean };
        if (!rej.keepWrites) throw new GameError(rej.code);
        return { ok: false as const, code: rej.code };
      });
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      notes.length = 0;
      res = { ok: false, code: err.code };
    }
    await tx.update(tables.commandLog).set({ response: res }).where(eq(tables.commandLog.key, fullKey));
    return res;
  });
}

/** Obergrenze der Häfen, deren fällige Ereignisse ein Befehl vorab verarbeitet (Balance: expansion.maxBases). */
const maxDueBases = (): number => Math.max(1, expansionOf(balance)?.maxBases ?? 3);
