// Belohnungen und Lagergrenze (seit 0.24.0): Tagesbefehle, Wochenziele und Erfolge liefern Ressourcen nur bis zur
// Lagergrenze des Heimathafens (deliverToStorage). Die Ansichten geben dafür Bestand und Kapazität des
// Heimathafens mit, damit der Browser vor dem Abholen warnen kann; die Befehle melden den verfallenen Rest (`lost`).
import { storageCapacity, type ResourceMap } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { settledHome } from "./player-wide.ts";

/** Lager des Heimathafens: Name, Kapazität je Ressource und abgerechneter Bestand (abgerundet). */
export type RewardStorage = { baseName: string; capacity: number; resources: ResourceMap };

export async function rewardStorage(db: DbOrTx, playerId: number, nowMs: number): Promise<RewardStorage | null> {
  const home = await settledHome(db, playerId, nowMs);
  if (!home) return null;
  const resources: ResourceMap = {};
  for (const r of balance.resources) resources[r] = Math.floor(home.state.resources[r] ?? 0);
  return { baseName: home.row.name, capacity: Math.floor(storageCapacity(home.state, balance, home.mods)), resources };
}

/** Verfallene Mengen zusammenzählen (Belohnung und Bonus in einem Befehl). */
export function addLost(into: ResourceMap, more: ResourceMap): ResourceMap {
  for (const [r, n] of Object.entries(more)) if (n > 0) into[r] = (into[r] ?? 0) + n;
  return into;
}
