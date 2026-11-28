// Teillieferung der Ausbildung (0.44): Ereigniskette „training_complete“ je Hafen.
// Jedes Ereignis liefert alle bis zu seiner Fälligkeit fertigen Einheiten (game-core completeTraining) und plant das
// nächste zur frühesten noch offenen Lieferung. So stehen gelieferte Einheiten zur richtigen Zeit im Bestand – auch
// ohne Abruf des Spielers –, und ein Angriff am Hafen (späteres Ereignis) kämpft mit ihnen, weil Ereignisse nach
// Fälligkeit abgearbeitet werden. Befehle und Hafenansicht holen fällige Ereignisse vorher nach (processDueForBase).
import { and, eq, lte, ne } from "drizzle-orm";
import { nextTrainingDelivery, type BaseState } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { scheduleEvent } from "./store.ts";

export const TRAINING_EVENT = "training_complete";

/**
 * Plant das Ereignis zur nächsten Lieferung des Hafens, sofern nicht schon eines bis dahin ansteht (Kette ohne
 * Dubletten: mehrere Aufträge, Sabotage-Verschiebung und Abbruch hinterlassen höchstens wirkungslose Ereignisse, die
 * sich selbst wieder einreihen). `exceptId`: das gerade laufende Ereignis (noch „pending“). Rückgabe: nächste Lieferung.
 */
export async function scheduleNextDelivery(tx: DbOrTx, baseId: number, state: BaseState, exceptId?: number): Promise<number | null> {
  const at = nextTrainingDelivery(state);
  if (at === null) return null;
  const t = tables.gameEvent;
  const conds = [eq(t.baseId, baseId), eq(t.type, TRAINING_EVENT), eq(t.status, "pending"), lte(t.dueAt, new Date(at))];
  if (exceptId !== undefined) conds.push(ne(t.id, exceptId));
  const [pending] = await tx.select({ id: t.id }).from(t).where(and(...conds)).limit(1);
  if (!pending) await scheduleEvent(tx, TRAINING_EVENT, at, {}, baseId);
  return at;
}
