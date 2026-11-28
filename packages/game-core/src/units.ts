import type { Balance, BaseState, ResourceMap, Result, TrainingOrder } from "./types.ts";
import { buildingLevel, hasResources, settle, subtractResources } from "./economy.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry } from "./modifiers.ts";
import { diluteBase } from "./veterans.ts";
import { poweredFinishMs } from "./power.ts";

/** Pseudo-Bauplatz für Verteidigungsanlagen (haben in balance.json kein builtIn). */
export const DEFENSE_SLOT = "anlagen";

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

// ---------------------------------------------------------------- Teillieferung (0.44)

/** Bereits gelieferte Einheiten eines Auftrags (ältere Aufträge ohne Feld: 0). */
export function trainingDone(o: TrainingOrder): number {
  return Math.min(o.count, Math.max(0, o.done ?? 0));
}

/** Noch nicht gelieferte Einheiten (count − done): nur sie zählen als „in Ausbildung“. */
export function trainingLeft(o: TrainingOrder): number {
  return o.count - trainingDone(o);
}

/** Fertigstellung der Einheit i (1..count): anteilig über die (stromgedehnte) Gesamtdauer, die letzte genau zu finishesAt. */
export function trainingUnitAt(o: TrainingOrder, i: number): number {
  if (i >= o.count) return o.finishesAt;
  return o.startedAt + Math.floor(((o.finishesAt - o.startedAt) * i) / o.count);
}

/** Zum Zeitpunkt t fertige Einheiten (geliefert oder fällig), 0..count. */
export function trainingReadyBy(o: TrainingOrder, t: number): number {
  if (t >= o.finishesAt) return o.count;
  const span = o.finishesAt - o.startedAt;
  if (t < o.startedAt || span <= 0) return 0;
  let n = Math.min(o.count, Math.max(0, Math.floor(((t - o.startedAt) * o.count) / span)));
  while (n < o.count && trainingUnitAt(o, n + 1) <= t) n++;
  while (n > 0 && trainingUnitAt(o, n) > t) n--;
  return n;
}

/** Zeitpunkt der nächsten noch nicht gelieferten Einheit (null: alles geliefert). */
export function nextTrainingDeliveryAt(o: TrainingOrder): number | null {
  const d = trainingDone(o);
  return d >= o.count ? null : trainingUnitAt(o, d + 1);
}

/** Frühester nächster Lieferzeitpunkt aller Aufträge eines Hafens (null: keine Aufträge). */
export function nextTrainingDelivery(base: BaseState): number | null {
  let best: number | null = null;
  for (const o of base.trainingQueue) {
    const at = nextTrainingDeliveryAt(o);
    if (at !== null && (best === null || at < best)) best = at;
  }
  return best;
}

/** Höchstens so viele Fortschreibungen je Aufruf (Nachholen nach langer Pause); darüber werden Lieferungen gebündelt. */
const MAX_DELIVERY_STEPS = 200;

/**
 * Liefert alle bis nowMs fertigen Einheiten und Anlagen aus (Teillieferung). In zeitlicher Reihenfolge: der Hafen wird
 * jeweils bis zum Lieferzeitpunkt fortgeschrieben (Unterhalt ab Lieferung), Veteranen werden je Lieferung verwässert,
 * vollständige Aufträge verlassen die Schlange. Der Rückgabe-Hafen ist bis zum letzten Lieferzeitpunkt fortgeschrieben
 * (nicht bis nowMs). Ohne fällige Lieferung bleibt `base` unverändert (dasselbe Objekt).
 */
export function deliverTraining(
  base: BaseState,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): { base: BaseState; delivered: { order: TrainingOrder; count: number }[]; completed: TrainingOrder[] } {
  // Alle fälligen Lieferungen (Zeit, Auftrag, Einheit i) sammeln; je Zeitpunkt und Auftrag eine Stufe.
  const steps: { at: number; key: string; upTo: number }[] = [];
  for (const o of base.trainingQueue) {
    const ready = trainingReadyBy(o, nowMs);
    for (let i = trainingDone(o) + 1; i <= ready; i++) {
      const at = trainingUnitAt(o, i);
      const last = steps[steps.length - 1];
      if (last && last.key === orderKey(o) && last.at === at) last.upTo = i;
      else steps.push({ at, key: orderKey(o), upTo: i });
    }
  }
  if (steps.length === 0) return { base, delivered: [], completed: [] };
  steps.sort((a, b) => a.at - b.at);
  // Nachholen sehr vieler Lieferungen: gebündelt (je Bündel bis zum Zeitpunkt seiner letzten Lieferung fortgeschrieben).
  const chunk = Math.ceil(steps.length / MAX_DELIVERY_STEPS);
  const deliveredBy = new Map<string, number>();
  const completed: TrainingOrder[] = [];
  let next = base;
  for (let k = 0; k < steps.length; k += chunk) {
    const group = steps.slice(k, k + chunk);
    next = settle(next, group[group.length - 1].at, balance, mods);
    const upTo = new Map<string, number>();
    for (const st of group) upTo.set(st.key, Math.max(upTo.get(st.key) ?? 0, st.upTo));
    const queue: TrainingOrder[] = [];
    for (const o of next.trainingQueue) {
      const target = upTo.get(orderKey(o));
      if (target === undefined) { queue.push(o); continue; }
      const n = target - trainingDone(o);
      if (n > 0) {
        if (o.kind === "unit") {
          const v = diluteBase(next, o.id, n); // Veteranen: neue Rekruten verwässern die Erfahrung des Typs
          if (v) next.veterancy = v;
        }
        const pool = o.kind === "unit" ? next.units : next.defenses;
        pool[o.id] = (pool[o.id] ?? 0) + n;
        deliveredBy.set(orderKey(o), (deliveredBy.get(orderKey(o)) ?? 0) + n);
      }
      if (target >= o.count) completed.push({ ...o, done: o.count });
      else queue.push({ ...o, done: target });
    }
    next.trainingQueue = queue;
  }
  const delivered = base.trainingQueue
    .filter((o) => deliveredBy.has(orderKey(o)))
    .map((o) => ({ order: { ...o }, count: deliveredBy.get(orderKey(o))! }));
  return { base: next, delivered, completed };
}

/** Auftrag eindeutig je Hafen: höchstens einer je ausführendem Gebäude. */
function orderKey(o: TrainingOrder): string {
  return `${o.builtIn}|${o.id}|${o.startedAt}`;
}

/** Baukosten für `count` Einheiten oder Anlagen eines Typs. */
export function trainingCost(id: string, count: number, balance: Balance): ResourceMap {
  const def = balance.units[id] ?? balance.defenses[id];
  const cost: ResourceMap = {};
  for (const r of balance.resources) cost[r] = (def.cost?.[r] ?? 0) * count;
  return cost;
}

/** Bauzeit je Einheit in Sekunden bei Stufe `level` (>= 1) des Baugebäudes; `mods.trainingTime[builtIn]`. */
export function trainingSecondsPerUnit(unitId: string, level: number, balance: Balance, mods?: Modifiers): number {
  const def = balance.units[unitId];
  const speed = balance.buildings[def.builtIn ?? ""]?.buildSpeedPerLevel ?? 0;
  return ((def.seconds ?? 0) / (1 + speed * (level - 1))) * modEntry(mods, "trainingTime", def.builtIn ?? "");
}

/** Bauzeit je Verteidigungsanlage in Sekunden; `mods.trainingTime.anlagen`. */
export function defenseSecondsEach(defenseId: string, balance: Balance, mods?: Modifiers): number {
  return balance.defenses[defenseId].seconds * modEntry(mods, "trainingTime", DEFENSE_SLOT);
}

/** Stellplätze für Flugzeuge (Flugfeld). */
export function aircraftSlots(base: BaseState, balance: Balance): number {
  return (balance.buildings.flugfeld.slotsPerLevel ?? 0) * buildingLevel(base, "flugfeld");
}

/** Belegte Stellplätze: Flugzeuge daheim, auf Mission und in Ausbildung (nur der noch nicht gelieferte Rest). */
export function aircraftSlotsUsed(base: BaseState, balance: Balance): number {
  let used = 0;
  for (const [id, def] of Object.entries(balance.units)) {
    if (def.branch !== "luft") continue;
    used += (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
  }
  for (const order of base.trainingQueue) {
    if (order.kind === "unit" && balance.units[order.id]?.branch === "luft") used += trainingLeft(order);
  }
  return used;
}

/**
 * Startet die Ausbildung von Einheiten oder den Bau von Verteidigungsanlagen.
 * Codes: unknown_unit, bad_count, building_required, building_level (Stufe unter requiresLevel), supply_shortage, queue_busy,
 * no_aircraft_slots, harbor_level (Kolonieschiff: Hafenkommandantur unter expansion.harborLevelForShip), insufficient_resources.
 */
export function startTraining(
  base: BaseState,
  id: string,
  count: number,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; order: TrainingOrder }> {
  const isUnit = Object.hasOwn(balance.units, id);
  const isDefense = Object.hasOwn(balance.defenses, id);
  if (!isUnit && !isDefense) return { ok: false, code: "unknown_unit" };
  if (!isPositiveInt(count)) return { ok: false, code: "bad_count" };

  const next = settle(base, nowMs, balance, mods);
  let builtIn = DEFENSE_SLOT;
  let secondsEach = 0;
  if (isUnit) {
    const def = balance.units[id];
    builtIn = def.builtIn ?? "";
    const level = buildingLevel(base, builtIn);
    if (level < 1) return { ok: false, code: "building_required" };
    if (level < (def.requiresLevel ?? 1)) return { ok: false, code: "building_level" };
    const exp = balance.expansion; // Mehrere Häfen: Kolonieschiff erst ab einer Stufe der Hafenkommandantur
    if (exp && id === exp.colonyShip && buildingLevel(base, "hafenkommandantur") < exp.harborLevelForShip) return { ok: false, code: "harbor_level" };
    if (next.versorgungsmangel) return { ok: false, code: "supply_shortage" };
    secondsEach = trainingSecondsPerUnit(id, level, balance, mods);
  } else {
    secondsEach = defenseSecondsEach(id, balance, mods);
  }
  if (base.trainingQueue.some((o) => o.builtIn === builtIn)) return { ok: false, code: "queue_busy" };
  if (isUnit && balance.units[id].branch === "luft") {
    if (aircraftSlotsUsed(base, balance) + count > aircraftSlots(base, balance)) {
      return { ok: false, code: "no_aircraft_slots" };
    }
  }
  // Höchstzahl je Stufe (Spione): Bestand daheim, unterwegs und in Ausbildung (Rest) zählt.
  if (isUnit && balance.units[id].maxPerLevel !== undefined) {
    let have = (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
    for (const o of base.trainingQueue) if (o.kind === "unit" && o.id === id) have += trainingLeft(o);
    if (have + count > balance.units[id].maxPerLevel! * buildingLevel(base, builtIn)) return { ok: false, code: "unit_cap" };
  }
  const cost = trainingCost(id, count, balance);
  if (!hasResources(next.resources, cost)) return { ok: false, code: "insufficient_resources" };

  next.resources = subtractResources(next.resources, cost);
  const workMs = Math.ceil(secondsEach * count * 1000);
  const order: TrainingOrder = {
    kind: isUnit ? "unit" : "defense",
    id,
    count,
    builtIn,
    startedAt: nowMs,
    finishesAt: nowMs + workMs,
  };
  // Strom (v1.6): Werft, Kaserne und Flugfeld sind Verbraucher im Rang 3. Die Fertigstellung wird beim Start
  // mit der Stromprognose (Wetter deterministisch) bestimmt und bleibt danach fest.
  if (isUnit && (balance.buildings[builtIn]?.powerPerLevel ?? 0) > 0) {
    const probe = { ...next, trainingQueue: [...next.trainingQueue, { ...order, finishesAt: Infinity }] };
    order.finishesAt = poweredFinishMs(probe, nowMs, workMs, "training", balance, mods);
  }
  next.trainingQueue = [...next.trainingQueue, order];
  return { ok: true, base: next, order: { ...order } };
}

/**
 * Verbucht alle fälligen Lieferungen (Teillieferungen und vollständige Aufträge, siehe deliverTraining) und schreibt den
 * Hafen bis nowMs fort. `completed`: vollständig abgeschlossene Aufträge; `delivered`: je Auftrag die jetzt gelieferte
 * Anzahl. Codes: no_order, not_finished (nichts fällig).
 */
export function completeTraining(
  base: BaseState,
  nowMs: number,
  balance: Balance,
  mods?: Modifiers,
): Result<{ base: BaseState; completed: TrainingOrder[]; delivered: { order: TrainingOrder; count: number }[] }> {
  if (base.trainingQueue.length === 0) return { ok: false, code: "no_order" };
  const r = deliverTraining(base, nowMs, balance, mods);
  if (r.delivered.length === 0) return { ok: false, code: "not_finished" };
  return { ok: true, base: settle(r.base, nowMs, balance, mods), completed: r.completed, delivered: r.delivered };
}
