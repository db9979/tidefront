// See: Minen, Blockade und Konvois – Einstieg für die gemeinsamen Dateien. Eingehängt über kleine, markierte Eingriffe
// in commands.ts (launchMission, recallOwnMission, trade), views.ts (missionPreview), handlers.ts (missionArrive,
// deliveryArrive), player-trade.ts (acceptOffer) und season.ts (Saisonende). Regeln: docs/REGELN-SEE.md.
import { eq } from "drizzle-orm";
import { hexDistanceKm } from "@tidefront/world";
import type { Counts, Mission, ResourceMap } from "@tidefront/game-core";
import { blockadeOf, minesOf } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine, type NoticeJob } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { ownBase, readBase, scheduleEvent, type BaseRow } from "./store.ts";
import { NAVAL_TYPES, sendHome, type MissionRowLike, type NavalInput, type Notes } from "./naval-common.ts";
import { launchMines, mineTransitFor, minesArrive, previewMines, routeMines, visibleFields } from "./naval-mines.ts";
import {
  activeBlockade, blockadeArrive, blockadeAttackArrive, blockadeEndHandler, blockadesView, launchBlockade, launchBlockadeAttack,
  previewBlockade, previewBlockadeAttack,
} from "./naval-blockade.ts";
import {
  convoyRaidHandler, deliveryConvoyArrived, escortArrive, interceptArrive, launchIntercept, previewIntercept,
  transportConvoyArrive,
} from "./naval-convoy.ts";
import { convoysView } from "./naval-convoy-view.ts"; // Karte, Börse, Lagebild (fremde Konvois in Sicht)

export { NAVAL_TYPES, type NavalInput };
export { liftBlockade, activeBlockade } from "./naval-blockade.ts";
export { createConvoy, attachSellerEscort, attachTradeEscort, transportConvoyRecall, convoysForDeliveries } from "./naval-convoy.ts";
export { routeMines } from "./naval-mines.ts";

/** Gehört die Missionseingabe zu den Seemissionen dieses Moduls? */
export function isNavalInput(input: { type: string; blockadeId?: number; convoyId?: number }): boolean {
  return NAVAL_TYPES.has(input.type) || input.blockadeId !== undefined || input.convoyId !== undefined;
}

/** launchMission für Seemissionen. */
export async function launchNaval(tx: Tx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number, notify: Notes) {
  if (input.blockadeId !== undefined) {
    if (input.type !== "ueberfall") throw new GameError("bad_type");
    return launchBlockadeAttack(tx, playerId, own, input, nowMs, notify);
  }
  if (input.convoyId !== undefined || input.type === "abfangen") {
    if (input.convoyId === undefined) throw new GameError("no_convoy");
    return launchIntercept(tx, playerId, own, { ...input, type: "abfangen" }, nowMs, notify);
  }
  if (input.type === "blockade") {
    if (!blockadeOf(balance)) throw new GameError("bad_type");
    return launchBlockade(tx, playerId, own, input, nowMs, notify);
  }
  if (!minesOf(balance)) throw new GameError("bad_type");
  return launchMines(tx, playerId, own, input, nowMs, notify);
}

/** missionPreview für Seemissionen (gleiche Ablehnungen wie der Start, ohne Änderung). */
export async function previewNaval(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const distanceKm = hexDistanceKm(own, input);
  try {
    const r = input.blockadeId !== undefined ? await previewBlockadeAttack(db, playerId, own, input, nowMs)
      : input.convoyId !== undefined || input.type === "abfangen" ? await previewIntercept(db, playerId, own, { ...input, type: "abfangen" }, nowMs)
      : input.type === "blockade" ? await previewBlockade(db, playerId, own, input, nowMs)
      : await previewMines(db, playerId, own, input, nowMs);
    if (!r.ok) return { ok: false as const, code: r.code, distanceKm };
    const m = r.mission;
    return {
      ok: true as const,
      distanceKm: m.distanceKm,
      travelSeconds: m.travelSeconds,
      route: m.route ?? null, // Seewege
      fuelCost: m.fuelCost,
      arriveAtMs: m.arriveAtMs,
      returnAtMs: m.returnAtMs,
      target: { kind: "naval", own: false },
      weatherFactor: m.weather?.shipFactor ?? 1,
      naval: r.extra as Record<string, unknown>,
      intercept: (r.extra as { intercept?: { col: number; row: number } }).intercept,
    };
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code, distanceKm };
    throw err;
  }
}

/**
 * Hook am Anfang von missionArrive. Eigene Missionsarten werden hier vollständig abgewickelt (done). Für alle übrigen:
 * Transport-Konvoi (Verband und Ladung nach Abfangversuchen) und Minenfelder auf der Hinfahrt; danach läuft die normale
 * Ankunft mit dem angepassten Plan weiter. Ist nichts mehr übrig, kehrt die Mission leer heim.
 */
export async function navalArrive(
  tx: Tx,
  m: MissionRowLike,
  plan: Mission,
  due: number,
  notify: Notes,
  push: NoticeJob[],
): Promise<{ done: true } | { done: false; plan: Mission }> {
  if (m.playerId === null || m.baseId === null) return { done: false, plan };
  if (m.type === "geleit") {
    await escortArrive(tx, m, plan, due);
    return { done: true };
  }
  let next: Mission = { ...plan, units: { ...plan.units }, cargo: { ...plan.cargo } };
  if (m.type === "transport") {
    const c = await transportConvoyArrive(tx, m.id);
    if (c) next = { ...next, units: c.units, cargo: c.cargo };
  }
  next = { ...next, units: await mineTransitFor(tx, m, next, due, notify) };
  const left = Object.values(next.units).some((n) => n > 0);
  const origin = await readBase(tx, m.baseId);
  if (m.type === "minen" || m.type === "raeumen") {
    if (!left) await sendHome(tx, m, next, {}, {}, null, due);
    else await minesArrive(tx, m, next, due, notify);
    return { done: true };
  }
  if (m.type === "blockade") {
    await blockadeArrive(tx, m, next, next.units, due, notify, push);
    return { done: true };
  }
  if (m.targetKind === "blockade") {
    await blockadeAttackArrive(tx, m, next, next.units, origin, due, notify, push);
    return { done: true };
  }
  if (m.targetKind === "convoy") {
    await interceptArrive(tx, m, next, next.units, origin, due, notify, push);
    return { done: true };
  }
  if (!left) {
    // Alles versenkt: die Ladung (Transport) ist mit untergegangen.
    await sendHome(tx, m, next, {}, {}, null, due);
    return { done: true };
  }
  return { done: false, plan: next };
}

/**
 * Hook in deliveryArrive: Während einer Blockade wird die Lieferung zurückgehalten (neu geplant, höchstens bis zum
 * Ende der Blockade). true = zurückgehalten. Sonst wird der Konvoi abgeschlossen.
 */
export async function holdDelivery(tx: Tx, d: { id: string; baseId: number }, due: number): Promise<boolean> {
  const bb = blockadeOf(balance);
  const b = bb ? await activeBlockade(tx, { baseId: d.baseId }, due) : null;
  if (b && bb) {
    const next = Math.min(b.endsAt.getTime(), due + bb.deliveryHoldMinutes * 60000);
    await tx.update(tables.delivery).set({ arriveAt: new Date(next) }).where(eq(tables.delivery.id, d.id));
    await scheduleEvent(tx, "delivery_arrive", Math.max(next, due + 1000), { deliveryId: d.id }, d.baseId);
    return true;
  }
  await deliveryConvoyArrived(tx, d.id, due); // Minen: Handelskonvoi durch feindliche Felder
  return false;
}

/** Hook in trade: Börsenverkäufe sind während einer Blockade gesperrt (Code blockade). */
export async function tradeBlocked(db: DbOrTx, baseId: number, side: "buy" | "sell", nowMs: number): Promise<boolean> {
  return side === "sell" && !!blockadeOf(balance) && (await activeBlockade(db, { baseId }, nowMs)) !== null;
}

export const NAVAL_HANDLERS: Record<string, (tx: Tx, ev: { payload: Record<string, unknown> }, due: number) => Promise<HandlerResult>> = {
  blockade_end: (tx, ev, due) => blockadeEndHandler(tx, ev.payload, due),
  convoy_raid: (tx, ev, due) => convoyRaidHandler(tx, ev.payload, due),
};

/** Saisonende: alles Seegeschehen verfällt. */
export async function clearNaval(tx: Tx): Promise<void> {
  await tx.delete(tables.minefieldKnown);
  await tx.delete(tables.minefield);
  await tx.delete(tables.blockade);
  await tx.delete(tables.convoy);
}

/** Lesemodell für Karte, Hafen und Börse. */
export async function navalView(engine: Engine, playerId: number, baseId?: number) { // ownBlockade: aktiver Hafen
  const nowMs = Date.now();
  const own = await ownBase(engine.db, playerId, baseId).catch((err: unknown) => {
    if (baseId !== undefined) throw err; // fremder Hafen: no_base
    return null;
  });
  const blockade = own ? await activeBlockade(engine.db, { baseId: own.id }, nowMs) : null;
  return {
    serverNow: nowMs,
    minefields: await visibleFields(engine.db, playerId, nowMs),
    blockades: await blockadesView(engine.db, playerId, nowMs),
    convoys: await convoysView(engine.db, playerId, nowMs),
    ownBlockade: blockade ? { id: blockade.id, endsAtMs: blockade.endsAt.getTime(), factor: blockadeOf(balance)?.productionFactor ?? 1 } : null,
    rules: { mines: minesOf(balance), blockade: blockadeOf(balance) },
  };
}

/** Bekannte Minen auf der Route zum Feld (Warnung in der Missionsplanung). */
export async function navalRouteMines(engine: Engine, playerId: number, col: number, row: number, baseId?: number) { // Route ab aktivem Hafen
  return routeMines(engine.db, playerId, col, row, Date.now(), baseId);
}

export type { Counts, ResourceMap };
