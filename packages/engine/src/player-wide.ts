// Mehrere Häfen: spielerweite Werte, die aus mehreren Häfen abgeleitet werden.
// - Hafenkommandantur für Börse (Freischaltung, Kreditlimit) und Admiral-Plätze: höchste Stufe aller Häfen.
// - Börsen-Tageslimit: Lagerkapazität des Heimathafens.
// - Forschung: wird im Heimathafen geführt; Kolonien zeigen dessen Stand.
import { buildingLevel, settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { basesOfPlayer, homeBaseOf, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";

/** Höchste Stufe der Hafenkommandantur über alle Häfen; `known` ersetzt einen (z. B. gesperrten) Stand. */
export function maxHarborLevelOf(bases: BaseRow[], known?: { id: number; state: BaseState }): number {
  return Math.max(0, ...bases.map((b) => buildingLevel(b.id === known?.id ? known.state : b.state, "hafenkommandantur")));
}

/** Wie maxHarborLevelOf, liest die Häfen des Spielers. */
export async function maxHarborLevel(db: DbOrTx, playerId: number, known?: { id: number; state: BaseState }): Promise<number> {
  return maxHarborLevelOf(await basesOfPlayer(db, playerId), known);
}

/** Lagerkapazität des Heimathafens (Börsen-Tageslimit); `known` ersetzt den Heimathafen, wenn er schon geladen ist. */
export async function homeStorageCapacity(db: DbOrTx, playerId: number, nowMs: number, known?: BaseRow): Promise<number> {
  const home = known?.isHome ? known : await homeBaseOf(db, playerId);
  if (!home) return 0;
  const mods = await modsOf(db, home, nowMs);
  return storageCapacity(settle(home.state, nowMs, balance, mods), balance, mods);
}

/** Heimathafen mit abgerechnetem Stand und Modifikatoren (Forschungsanzeige in Kolonien), oder null. */
export async function settledHome(db: DbOrTx, playerId: number, nowMs: number) {
  const home = await homeBaseOf(db, playerId);
  if (!home) return null;
  const mods = await modsOf(db, home, nowMs);
  return { row: home, state: settle(home.state, nowMs, balance, mods), mods };
}
