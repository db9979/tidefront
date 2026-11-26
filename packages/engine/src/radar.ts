// Radar-Erkennung anfliegender Angriffe: einmal erkannt bleibt erkannt. Der Erkennungszeitpunkt steht im Plan der
// Mission (plan.detectedAtMs); fällt das Radar danach aus (Strommangel, Sabotage, Nebel), bleibt der Angriff sichtbar.
// Gesetzt wird er vom Ereignis attack_warning (Push) und von den Lesemodellen, sobald die aktuelle Vorwarnzeit ihn erfasst.
import { and, eq, inArray, sql } from "drizzle-orm";
import { isAttackDetected, type Mission } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";

/** Tarnfaktor eines Verbands (Mission.warningFactor), 1 ohne Tarnung. */
export function warnFactor(plan: unknown): number {
  return (plan as Mission | null)?.warningFactor ?? 1;
}

/** Gespeicherter Erkennungszeitpunkt oder null. */
export function detectedAtOf(plan: unknown): number | null {
  const t = (plan as Mission | null)?.detectedAtMs;
  return typeof t === "number" ? t : null;
}

/** Erkannt: schon früher erkannt oder jetzt innerhalb der aktuellen Vorwarnzeit (`warnMinutes` ohne Tarnung). */
export function isDetected(m: { arriveAt: Date; plan: unknown }, nowMs: number, warnMinutes: number): boolean {
  const at = detectedAtOf(m.plan);
  if (at !== null && nowMs >= at) return true;
  return isAttackDetected(m.arriveAt.getTime(), nowMs, warnMinutes * warnFactor(m.plan));
}

/** Merkt die Erkennung (nur wo noch keine steht, nur auf der Hinfahrt); idempotent. */
export async function markDetected(db: DbOrTx, missionIds: number[], atMs: number): Promise<void> {
  if (!missionIds.length) return;
  await db
    .update(tables.mission)
    .set({ plan: sql`jsonb_set(${tables.mission.plan}, '{detectedAtMs}', to_jsonb(${atMs}::bigint))` })
    .where(and(
      inArray(tables.mission.id, missionIds),
      eq(tables.mission.status, "outbound"),
      sql`${tables.mission.plan}->'detectedAtMs' is null`,
    ));
}

/** Filtert erkannte Angriffe (`rows`: anfliegend auf einen Hafen) und merkt neu erkannte. */
export async function detectIncoming<T extends { id: number; arriveAt: Date; plan: unknown }>(
  db: DbOrTx,
  rows: T[],
  nowMs: number,
  warnMinutes: number,
): Promise<T[]> {
  const seen = rows.filter((m) => isDetected(m, nowMs, warnMinutes));
  await markDetected(db, seen.filter((m) => detectedAtOf(m.plan) === null).map((m) => m.id), nowMs);
  return seen;
}
