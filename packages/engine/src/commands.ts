// Befehle der Spieler. Jeder Befehl: Idempotenz-Schlüssel, zuerst fällige Ereignisse des eigenen
// Stützpunkts, dann eine Transaktion mit gesperrtem Stützpunkt.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cancelTraining,
  cancelUpgrade,
  createBase,
  createProtection,
  harborCreditLimit,
  isNestRespawned,
  planMission,
  recallMission,
  settle,
  startTraining,
  startUpgrade,
  storageCapacity,
  market as marketCore,
  type BaseState,
  type Counts,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexCenter, isCoast, nearestTradePort } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, marketBalance, GameError, type ChangeKind, type Engine } from "./context.ts";
import { processDueForBase } from "./events.ts";
import { activeMissionCount, baseOfPlayer, lockBase, saveBase, scheduleEvent } from "./store.ts";
import { incomingDetected } from "./views.ts";

export type Rejected = { ok: false; code: string };
type Draft<T> = T | (Rejected & { keepWrites?: boolean });

interface Ctx {
  tx: Tx;
  playerId: number;
  nowMs: number;
  notify: [number[] | null, ChangeKind][];
}

/**
 * Führt einen Befehl genau einmal aus. Ein zweiter Aufruf mit demselben Schlüssel liefert die
 * gespeicherte Antwort (auch für abgelehnte Befehle).
 */
async function runCommand<T extends { ok: true }>(
  engine: Engine,
  playerId: number,
  key: string,
  command: string,
  fn: (ctx: Ctx) => Promise<Draft<T>>,
): Promise<T | Rejected> {
  const fullKey = `${playerId}:${key}`;
  const nowMs = Date.now();
  const own = await baseOfPlayer(engine.db, playerId);
  if (own) await processDueForBase(engine, own.id, nowMs);
  const notes: Ctx["notify"] = [];
  const result = await engine.db.transaction(async (tx) => {
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
  for (const [ids, kind] of notes) engine.notify(ids, kind);
  return result;
}

async function ownBaseLocked(ctx: Ctx) {
  const own = await baseOfPlayer(ctx.tx, ctx.playerId);
  if (!own) throw new GameError("no_base");
  const b = await lockBase(ctx.tx, own.id);
  if (!b) throw new GameError("no_base");
  return b;
}

function fail(code: string): never {
  throw new GameError(code);
}

// ---------------------------------------------------------------- Stützpunkt

export function chooseBase(engine: Engine, playerId: number, key: string, input: { col: number; row: number; name: string; nightShieldStartHour: number | null; tzOffsetMinutes: number }) {
  return runCommand(engine, playerId, key, "chooseBase", async (ctx) => {
    if (await baseOfPlayer(ctx.tx, playerId)) fail("has_base");
    if (!isCoast(input.col, input.row)) fail("not_coast");
    const [occupiedNest] = await ctx.tx
      .select({ id: tables.nest.id })
      .from(tables.nest)
      .where(and(eq(tables.nest.col, input.col), eq(tables.nest.row, input.row)));
    if (occupiedNest) fail("field_taken");
    const state: BaseState = createBase(balance, ctx.nowMs);
    state.protection = createProtection(ctx.nowMs, input.nightShieldStartHour, input.tzOffsetMinutes);
    const inserted = await ctx.tx
      .insert(tables.base)
      .values({ playerId, name: input.name, col: input.col, row: input.row, state })
      .onConflictDoNothing()
      .returning({ id: tables.base.id });
    if (inserted.length === 0) fail("field_taken");
    const id = inserted[0].id;
    await scheduleEvent(ctx.tx, "raid_launch", ctx.nowMs + balance.pirates.raidIntervalHours * 3600000, {}, id);
    ctx.notify.push([null, "map"]);
    return { ok: true as const, baseId: id };
  });
}

export function upgrade(engine: Engine, playerId: number, key: string, buildingId: string) {
  return runCommand(engine, playerId, key, "upgrade", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const r = startUpgrade(b.state, buildingId, ctx.nowMs, balance);
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    await scheduleEvent(ctx.tx, "build_complete", r.order.finishesAt, {}, b.id);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

/**
 * Bricht einen Auftrag der Bauschlange ab. Der Auftrag wird über Gebäude und Zielstufe benannt
 * (eindeutig in der Schlange); ohne Angabe der laufende. Für nachgerückte Aufträge werden neue
 * build_complete-Ereignisse geplant; die alten laufen ins Leere oder schließen nur Fälliges ab.
 */
export function cancelBuild(engine: Engine, playerId: number, key: string, order?: { buildingId: string; targetLevel: number }) {
  return runCommand<{ ok: true; refund: ResourceMap; removed: number }>(engine, playerId, key, "cancelBuild", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const index = order
      ? b.state.buildQueue.findIndex((o) => o.buildingId === order.buildingId && o.targetLevel === order.targetLevel)
      : 0;
    const r = cancelUpgrade(b.state, ctx.nowMs, balance, index);
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    const before = new Map(b.state.buildQueue.map((o) => [`${o.buildingId}:${o.targetLevel}`, o.finishesAt]));
    for (const o of r.base.buildQueue) {
      if (before.get(`${o.buildingId}:${o.targetLevel}`) !== o.finishesAt) {
        await scheduleEvent(ctx.tx, "build_complete", o.finishesAt, {}, b.id);
      }
    }
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, refund: r.refund, removed: r.removed.length };
  });
}

export function train(engine: Engine, playerId: number, key: string, id: string, count: number) {
  return runCommand(engine, playerId, key, "train", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const r = startTraining(b.state, id, count, ctx.nowMs, balance);
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    await scheduleEvent(ctx.tx, "training_complete", r.order.finishesAt, {}, b.id);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

export function cancelTrain(engine: Engine, playerId: number, key: string, builtIn: string) {
  return runCommand(engine, playerId, key, "cancelTrain", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const r = cancelTraining(b.state, builtIn, ctx.nowMs, balance);
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, refund: r.refund };
  });
}

export function setNightShield(engine: Engine, playerId: number, key: string, startHour: number | null, tzOffsetMinutes: number) {
  return runCommand(engine, playerId, key, "nightShield", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const next = settle(b.state, ctx.nowMs, balance);
    next.protection = { ...next.protection, nightShieldStartHour: startHour, tzOffsetMinutes };
    await saveBase(ctx.tx, b.id, next);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- Missionen

export interface MissionTarget {
  kind: "base" | "nest";
  id: number;
  col: number;
  row: number;
  playerId: number | null;
  state?: BaseState;
  defeatedAt?: Date | null;
}

export async function targetAt(tx: Tx, col: number, row: number): Promise<MissionTarget | null> {
  const [b] = await tx.select().from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  if (b) return { kind: "base", id: b.id, col, row, playerId: b.playerId, state: b.state as BaseState };
  const [n] = await tx.select().from(tables.nest).where(and(eq(tables.nest.col, col), eq(tables.nest.row, row)));
  if (n) return { kind: "nest", id: n.id, col, row, playerId: null, defeatedAt: n.defeatedAt };
  return null;
}

export function launchMission(
  engine: Engine,
  playerId: number,
  key: string,
  input: { type: string; units: Counts; col: number; row: number; cargo?: ResourceMap },
) {
  return runCommand<{ ok: true; missionId: number; arriveAtMs: number }>(engine, playerId, key, "mission", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const target = await targetAt(ctx.tx, input.col, input.row);
    if (!target) fail("no_target");
    if (target.kind === "base" && target.playerId === playerId) fail("own_base");
    if (input.type === "transport" && target.kind !== "base") fail("transport_needs_base");
    if (input.type === "ueberfall" && target.kind === "nest" && target.defeatedAt && !isNestRespawned(target.defeatedAt.getTime(), ctx.nowMs, balance)) {
      fail("nest_empty");
    }
    const r = planMission(
      b.state,
      {
        type: input.type,
        units: input.units,
        origin: hexCenter(b.col, b.row),
        target: hexCenter(target.col, target.row),
        activeMissions: await activeMissionCount(ctx.tx, b.id),
        cargo: input.cargo,
        targetProtection: target.kind === "base" ? target.state!.protection : undefined,
      },
      ctx.nowMs,
      balance,
    );
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    const [m] = await ctx.tx
      .insert(tables.mission)
      .values({
        playerId, baseId: b.id, type: r.mission.type, targetKind: target.kind, targetId: target.id,
        targetCol: target.col, targetRow: target.row, plan: r.mission, status: "outbound",
        arriveAt: new Date(r.mission.arriveAtMs),
      })
      .returning({ id: tables.mission.id });
    await scheduleEvent(ctx.tx, "mission_arrive", r.mission.arriveAtMs, { missionId: m.id }, target.kind === "base" ? target.id : null);
    ctx.notify.push([[playerId], "base"], [[playerId], "missions"]);
    if (target.kind === "base" && target.playerId !== null) ctx.notify.push([[target.playerId], "missions"]);
    return { ok: true as const, missionId: m.id, arriveAtMs: r.mission.arriveAtMs };
  });
}

/**
 * Ruft einen eigenen Verband auf der Hinfahrt zurück. Sperrt nur die Mission (Reihenfolge Ereignis →
 * Mission → Stützpunkte bleibt gewahrt); der Stützpunkt ändert sich erst bei der Rückkehr. Das geplante
 * mission_arrive läuft ins Leere (Handler prüft den Status), mission_return wird neu geplant.
 * Codes: no_mission, not_outbound, already_recalled, already_arrived.
 */
export function recallOwnMission(engine: Engine, playerId: number, key: string, missionId: number) {
  return runCommand<{ ok: true; returnAtMs: number }>(engine, playerId, key, "recall", async (ctx) => {
    const [m] = await ctx.tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
    if (!m || m.playerId !== playerId || m.type === "kartell" || m.baseId === null) fail("no_mission");
    if (m.status !== "outbound") fail("not_outbound");
    const plan = m.plan as Mission;
    const r = recallMission(plan, ctx.nowMs);
    if (!r.ok) return r;
    await ctx.tx
      .update(tables.mission)
      .set({
        status: "returning",
        plan: r.mission,
        returning: { ...plan.units },
        cargoHome: { ...(plan.cargo ?? {}) },
        returnAt: new Date(r.returnAtMs),
      })
      .where(eq(tables.mission.id, m.id));
    await scheduleEvent(ctx.tx, "mission_return", r.returnAtMs, { missionId: m.id }, m.baseId);
    ctx.notify.push([[playerId], "base"], [[playerId], "missions"]);
    if (m.targetKind === "base" && m.targetId !== null) {
      const [t] = await ctx.tx.select({ playerId: tables.base.playerId }).from(tables.base).where(eq(tables.base.id, m.targetId));
      if (t) ctx.notify.push([[t.playerId], "missions"], [[t.playerId], "base"]);
    }
    return { ok: true as const, returnAtMs: r.returnAtMs };
  });
}

// ---------------------------------------------------------------- Börse

type ResourceId = marketCore.ResourceId;

export async function loadMarket(tx: Tx, lockResource?: string): Promise<marketCore.MarketState> {
  if (lockResource) {
    await tx.select().from(tables.market).where(eq(tables.market.resource, lockResource)).for("update");
  }
  const rows = await tx.select().from(tables.market).where(inArray(tables.market.resource, balance.resources));
  const state = {} as marketCore.MarketState;
  for (const r of rows) state[r.resource as ResourceId] = r.state as marketCore.ResourceMarketState;
  return state;
}

export function trade(
  engine: Engine,
  playerId: number,
  key: string,
  request: { side: "buy" | "sell"; resource: string; qty: number; expectedPrice: number },
) {
  return runCommand(engine, playerId, key, "trade", async (ctx) => {
    const b = await ownBaseLocked(ctx);
    const [p] = await ctx.tx.select().from(tables.player).where(eq(tables.player.id, playerId)).for("update");
    if (!balance.resources.includes(request.resource)) fail("bad_qty");
    const marketState = await loadMarket(ctx.tx, request.resource);
    const state = settle(b.state, ctx.nowMs, balance);
    const stock = {} as Record<ResourceId, number>;
    for (const r of balance.resources) stock[r as ResourceId] = Math.floor(state.resources[r] ?? 0);
    const trader = { ...(p.trader as Omit<marketCore.TraderState, "stock">), stock } as marketCore.TraderState;
    const capacity = storageCapacity(state, balance);
    const storage = {} as Record<ResourceId, number>;
    for (const r of balance.resources) storage[r as ResourceId] = capacity;
    const tradeId = `t-${randomUUID()}`;
    const result = marketCore.executeTrade(
      marketState,
      trader,
      request as marketCore.TradeRequest,
      {
        playerId: String(playerId),
        tradeId,
        harborLevel: state.buildings.hafenkommandantur ?? 0,
        storageCapacity: storage,
        attackDetected: await incomingDetected(ctx.tx, b.id, state, ctx.nowMs),
        distanceToPortKm: nearestTradePort(b).distanceKm,
      },
      marketBalance,
      ctx.nowMs,
    );
    const resource = request.resource as ResourceId;
    if (!result.ok) {
      // Kursband: die Handelspause muss bestehen bleiben, auch wenn der Handel abgelehnt ist.
      if (result.code === "band") {
        await ctx.tx
          .update(tables.market)
          .set({ state: result.market[resource] })
          .where(eq(tables.market.resource, resource));
        ctx.notify.push([null, "market"]);
        return { ok: false as const, code: result.code, keepWrites: true };
      }
      return { ok: false as const, code: result.code };
    }
    // Der Stützpunkt behält gebrochene Bestände; nur die gehandelte Ressource ändert sich um die Menge.
    if (request.side === "sell") state.resources[resource] = (state.resources[resource] ?? 0) - request.qty;
    await saveBase(ctx.tx, b.id, state);
    const { stock: _s, ...traderRest } = result.trader;
    await ctx.tx.update(tables.player).set({ trader: traderRest }).where(eq(tables.player.id, playerId));
    await ctx.tx.update(tables.market).set({ state: result.market[resource] }).where(eq(tables.market.resource, resource));
    await ctx.tx.insert(tables.tradeLedger).values(
      result.ledger.map((l) => ({ tradeId: l.tradeId, tMs: l.tMs, account: l.account, asset: l.asset, amount: l.amount.toFixed(2) })),
    );
    if (result.delivery) {
      const d = result.delivery;
      await ctx.tx.insert(tables.delivery).values({
        id: d.id, playerId, baseId: b.id, resource: d.resource, qty: d.qty,
        departAt: new Date(d.departMs), arriveAt: new Date(d.arriveMs),
      });
      await scheduleEvent(ctx.tx, "delivery_arrive", d.arriveMs, { deliveryId: d.id }, b.id);
    }
    ctx.notify.push([[playerId], "base"], [null, "market"]);
    return { ok: true as const, quote: result.quote, delivery: result.delivery };
  });
}

export { harborCreditLimit, sql };
