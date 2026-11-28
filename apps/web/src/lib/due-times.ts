// Fällige Zeitpunkte der Hafenansicht (rein, ohne React/Netz – für useDueRefresh in due.ts und Unit-Tests).
import type { BaseData } from "./trpc.ts";
import { nextTrainingDeliveryAt } from "@tidefront/game-core"; // Teillieferung: auch zur nächsten Einheit nachholen

/** Nachholversuche nach dem fälligen Zeitpunkt (ms): der Worker braucht einen Moment. */
export const DUE_RETRIES_MS = [1500, 8000] as const;

type DueBase = Pick<BaseData, "buildQueue" | "trainingQueue" | "research" | "missions" | "incoming" | "deliveries" | "protection">;

/** Zeitpunkte (Serverzeit), zu denen sich der Hafen von selbst ändert: Bau, Ausbildung, Forschung, Missionen, Angriffe, Lieferungen, Nachtschild. */
export function dueTimes(base: DueBase): number[] {
  const out: number[] = [];
  const add = (t: unknown) => { if (typeof t === "number" && Number.isFinite(t)) out.push(t); };
  for (const o of base.buildQueue) add(o.finishesAt);
  for (const o of base.trainingQueue) { add(o.finishesAt); add(nextTrainingDeliveryAt(o)); }
  add(base.research?.order?.finishesAt);
  for (const m of base.missions) add(m.status === "outbound" ? m.arriveAtMs : m.status === "returning" ? m.returnAtMs : null);
  for (const i of base.incoming) add(i.arriveAtMs);
  for (const d of base.deliveries) add(d.arriveAtMs);
  add(base.protection.nightWindow?.startMs);
  add(base.protection.nightWindow?.endMs);
  return out;
}

/** Nächster Nachholzeitpunkt nach `now` (null: nichts fällig). Vergangene Zeitpunkte lösen nie erneut aus. */
export function nextRefresh(times: number[], now: number): number | null {
  let best: number | null = null;
  for (const t of times) for (const d of DUE_RETRIES_MS) {
    const at = t + d;
    if (at > now && (best === null || at < best)) best = at;
  }
  return best;
}
