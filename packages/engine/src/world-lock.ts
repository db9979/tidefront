// Transaktionssperren über Postgres-Advisory-Locks (gelten bis Commit/Rollback der Transaktion).
// - Welt: Befehle (runCommand, damit auch KI-Spieler) und Ereignisse halten sie geteilt, das Saisonende exklusiv.
//   So läuft kein Befehl in eine halb zurückgesetzte Welt, und das Saisonende wartet auf laufende Befehle.
// - Spieler: spielerweite Grenzen über mehrere Häfen (Satelliten-Höchstzahl, Gründungen) prüfen und schreiben,
//   ohne dass zwei Befehle für verschiedene Häfen desselben Spielers gleichzeitig die alte Zahl sehen.
import { sql } from "drizzle-orm";
import type { Tx } from "@tidefront/db";

/** Schlüsselraum der Weltsperre (bigint-Form, kollidiert nicht mit den Zwei-int-Sperren). */
export const WORLD_LOCK = 7340050;
/** Erster Teil der Zwei-int-Form für Spielersperren. */
export const PLAYER_LOCK_SPACE = 7340051;

/** Geteilt: Befehl oder Ereignis läuft (blockiert nur gegen das Saisonende). */
export async function worldLockShared(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${WORLD_LOCK}::bigint)`);
}

/** Exklusiv: Saisonende setzt die Welt zurück. */
export async function worldLockExclusive(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${WORLD_LOCK}::bigint)`);
}

/** Spielerweite Sperre bis zum Ende der Transaktion. */
export async function lockPlayerWide(tx: Tx, playerId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PLAYER_LOCK_SPACE}::int, ${playerId}::int)`);
}
