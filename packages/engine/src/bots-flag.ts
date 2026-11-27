// KI-Spieler: schnelle Prüfung „ist dieser Spieler ein Bot?“ (für Push/E-Mail-Unterdrückung), kurz zwischengespeichert.
import { isNotNull } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";

const TTL_MS = 60_000;
let cache: { at: number; ids: Set<number> } | null = null;

/** IDs aller KI-Spieler (höchstens eine Minute alt). */
export async function botIds(db: DbOrTx, nowMs = Date.now()): Promise<Set<number>> {
  if (cache && nowMs - cache.at < TTL_MS && nowMs >= cache.at) return cache.ids;
  const rows = await db.select({ id: tables.player.id }).from(tables.player).where(isNotNull(tables.player.botProfile));
  cache = { at: nowMs, ids: new Set(rows.map((r) => r.id)) };
  return cache.ids;
}

export async function isBot(db: DbOrTx, playerId: number): Promise<boolean> {
  return (await botIds(db)).has(playerId);
}

/** Nach Anlegen/Entfernen eines Bots. */
export function resetBotCache(): void {
  cache = null;
}
