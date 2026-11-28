// Befehle der Spieler. Jeder Befehl: Idempotenz-Schlüssel, zuerst fällige Ereignisse der eigenen
// Stützpunkte, dann eine Transaktion mit gesperrtem Stützpunkt. Mehrere Häfen: hafenbezogene Befehle
// nehmen ein optionales baseId (Besitz wird geprüft); ohne baseId gilt der Heimathafen.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cancelTraining,
  cancelUpgrade,
  combineModifiers,
  createBase,
  createProtection,
  harborCreditLimit,
  isNestRespawned,
  planMission,
  recallMission,
  scheduleNightShieldChange,
  settle,
  validTimeZone,
  startTraining,
  startUpgrade,
  market as marketCore,
  type BaseState,
  type Counts,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { hexCenter, isCoast, isTradePortHex, nearestTradePortBySea } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { nestKnown } from "./intel-query.ts"; // Lagebild
import { balance, marketBalance, GameError, type Engine } from "./context.ts";
import { lockPlayerWide } from "./world-lock.ts";
import { activeMissionCount, basesOfPlayer, homeBaseOf, lockBases, lockOwnBase, ownBase, saveBase, scheduleEvent, withSite } from "./store.ts";
import { scheduleNextDelivery } from "./training-events.ts"; // Teillieferung der Ausbildung
import { homeStorageCapacity, maxHarborLevel } from "./player-wide.ts"; // Mehrere Häfen: Börse spielerweit
import { missionWeather } from "./weather.ts"; // Wetter (v1.6): Sturm auf der Route
import { incomingDetected } from "./views.ts";
import { scheduleAttackWarning } from "./event-notices.ts";
import { trackProgress } from "./challenges.ts";
import { recordTradeFee } from "./achievements.ts";
import { diplomacyBlock } from "./alliance-core.ts"; // Allianzen/Diplomatie
// Weltereignisse: Missionen gegen Ereignisse, Belagerung sperrt Börsenkäufe.
import { launchAgainstEvent } from "./world-events-missions.ts";
import { siegeEffects } from "./world-events.ts";
import { ensureStartNest, revealStartNest } from "./start-nest.ts"; // Einstieg: Nest Stufe 1 in ≤ 300 km
import { effectiveMarketRefs } from "./market-news.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { applyPendingBoost } from "./guide.ts";
import { admiralForLaunch, assignAdmiral } from "./admirals-core.ts"; // Admirale
import { STATION_TYPE, stationLaunch } from "./alliance-ops-station.ts"; // Allianz-Ops: Stationierung
import { createConvoy, isNavalInput, launchNaval, tradeBlocked, transportConvoyRecall } from "./naval.ts"; // See: Minen/Blockade/Konvoi
import { createMarketConvoy } from "./market-convoy.ts"; // See: Börsenkäufe als Konvoi
import { launchField } from "./fields-missions.ts"; // Felder
import { FOUNDING_TYPE, TRANSFER_TYPE, launchExpansion } from "./expansion.ts"; // Mehrere Häfen
import { endBeginnerElsewhere } from "./pvp.ts"; // PvP: Anfängerschutz endet beim ersten Spielerüberfall
import { latePackState } from "./catch-up.ts"; // Aufholhilfe: Startpaket für Spät-Einsteiger
import { reservedNext24h } from "./contracts-core.ts"; // Lieferverträge: Vormerkung im Tageslimit
import { marketBalanceNow } from "./politik-core.ts"; // Weltpolitik: Gebühr und Tageslimit der Gezeit

export { runCommand, isRetryableDbError, RETRY_ATTEMPTS, type Ctx, type Draft, type Rejected } from "./command-run.ts";
import { runCommand, type Ctx } from "./command-run.ts";

/** Gesperrter eigener Hafen: baseId mit Besitzprüfung (sonst "no_base"), ohne baseId der Heimathafen. */
export function ownBaseLocked(ctx: Ctx, baseId?: number) {
  return lockOwnBase(ctx.tx, ctx.playerId, baseId);
}

function fail(code: string): never {
  throw new GameError(code);
}

// ---------------------------------------------------------------- Stützpunkt

export function chooseBase(engine: Engine, playerId: number, key: string, input: { col: number; row: number; name: string; nightShieldStartHour: number | null; tzOffsetMinutes: number; timeZone?: string | null }) {
  return runCommand(engine, playerId, key, "chooseBase", async (ctx) => {
    if (await homeBaseOf(ctx.tx, playerId)) fail("has_base");
    if (!isCoast(input.col, input.row)) fail("not_coast");
    // Wie bei der Gründung (foundingBlocker): nicht auf einem Handelshafen oder Rohstofffeld.
    if (isTradePortHex(input.col, input.row)) fail("trade_port");
    const [onField] = await ctx.tx
      .select({ id: tables.resourceField.id })
      .from(tables.resourceField)
      .where(and(eq(tables.resourceField.col, input.col), eq(tables.resourceField.row, input.row)));
    if (onField) fail("resource_field");
    const [occupiedNest] = await ctx.tx
      .select({ id: tables.nest.id })
      .from(tables.nest)
      .where(and(eq(tables.nest.col, input.col), eq(tables.nest.row, input.row)));
    if (occupiedNest) fail("field_taken");
    const state: BaseState = createBase(balance, ctx.nowMs, hexCenter(input.col, input.row));
    // IANA-Zeitzone (Sommerzeit); ungültig oder fehlend: fester Versatz wie bisher.
    state.protection = createProtection(ctx.nowMs, input.nightShieldStartHour, input.tzOffsetMinutes, input.timeZone ?? null);
    // Aufholhilfe: erster Hafen ab Saisontag 8 (Menschen und KI) bekommt das Startpaket als Baugutschrift.
    const pack = await latePackState(ctx.tx, ctx.nowMs);
    if (pack) state.catchUp = pack;
    const inserted = await ctx.tx
      .insert(tables.base)
      .values({ playerId, name: input.name, col: input.col, row: input.row, state, isHome: true }) // erster Hafen = Heimathafen
      .onConflictDoNothing()
      .returning({ id: tables.base.id });
    if (inserted.length === 0) fail("field_taken");
    const id = inserted[0].id;
    await scheduleEvent(ctx.tx, "raid_launch", ctx.nowMs + balance.pirates.raidIntervalHours * 3600000, {}, id);
    // Einstieg: Menschen bekommen ein erreichbares Nest der Stufe 1 (KI-Spieler suchen sich ihre Ziele selbst).
    const [who] = await ctx.tx.select({ bot: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, playerId));
    if (who && who.bot === null) {
      const start = await ensureStartNest(ctx.tx, { col: input.col, row: input.row }, ctx.nowMs);
      if (start) await revealStartNest(ctx.tx, playerId, start.id, ctx.nowMs);
    }
    ctx.notify.push([null, "map"]);
    return { ok: true as const, baseId: id };
  });
}

export function upgrade(engine: Engine, playerId: number, key: string, buildingId: string, baseId?: number) {
  return runCommand(engine, playerId, key, "upgrade", async (ctx) => {
    const b = await ownBaseLocked(ctx, baseId);
    const r = startUpgrade(b.state, buildingId, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if (!r.ok) return r;
    const state = await applyPendingBoost(ctx.tx, playerId, r.base, ctx.nowMs); // Auftragsbuch: −1 Stunde Bauzeit
    await saveBase(ctx.tx, b.id, state);
    await scheduleEvent(ctx.tx, "build_complete", state.buildQueue[state.buildQueue.length - 1].finishesAt, {}, b.id);
    await trackProgress(ctx.tx, playerId, "bauschlange", r.base.buildQueue.length, { atMs: ctx.nowMs, mode: "max" });
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

/**
 * Bricht einen Auftrag der Bauschlange ab. Der Auftrag wird über Gebäude und Zielstufe benannt
 * (eindeutig in der Schlange); ohne Angabe der laufende. Für nachgerückte Aufträge werden neue
 * build_complete-Ereignisse geplant; die alten laufen ins Leere oder schließen nur Fälliges ab.
 */
export function cancelBuild(engine: Engine, playerId: number, key: string, order?: { buildingId: string; targetLevel: number }, baseId?: number) {
  return runCommand<{ ok: true; refund: ResourceMap; removed: number }>(engine, playerId, key, "cancelBuild", async (ctx) => {
    const b = await ownBaseLocked(ctx, baseId);
    const index = order
      ? b.state.buildQueue.findIndex((o) => o.buildingId === order.buildingId && o.targetLevel === order.targetLevel)
      : 0;
    const r = cancelUpgrade(b.state, ctx.nowMs, balance, index, await modsOf(ctx.tx, b, ctx.nowMs));
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

export function train(engine: Engine, playerId: number, key: string, id: string, count: number, baseId?: number) {
  return runCommand(engine, playerId, key, "train", async (ctx) => {
    const b = await ownBaseLocked(ctx, baseId);
    const r = startTraining(b.state, id, count, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    await scheduleNextDelivery(ctx.tx, b.id, r.base); // Teillieferung: Ereignis zur ersten fertigen Einheit
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const };
  });
}

export function cancelTrain(engine: Engine, playerId: number, key: string, builtIn: string, baseId?: number) {
  return runCommand(engine, playerId, key, "cancelTrain", async (ctx) => {
    const b = await ownBaseLocked(ctx, baseId);
    const r = cancelTraining(b.state, builtIn, ctx.nowMs, balance, await modsOf(ctx.tx, b, ctx.nowMs));
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, refund: r.refund };
  });
}

export function setNightShield(engine: Engine, playerId: number, key: string, startHour: number | null, tzOffsetMinutes: number, baseId?: number, timeZone: string | null = null) {
  return runCommand<{ ok: true; fromMs: number }>(engine, playerId, key, "nightShield", async (ctx) => {
    // Mehrere Häfen: Einstellung spielerweit – der aktive Hafen entscheidet über Erfolg und fromMs, die übrigen
    // Häfen übernehmen sie, soweit ihr Schutzzustand es erlaubt. Sperren aufsteigend nach ID.
    const active = (await ownBase(ctx.tx, playerId, baseId)).id;
    const locked = await lockBases(ctx.tx, (await basesOfPlayer(ctx.tx, playerId)).map((x) => x.id));
    const b = locked.get(active);
    if (!b || b.playerId !== playerId) fail("no_base");
    let fromMs = 0;
    for (const x of [b, ...[...locked.values()].filter((y) => y.id !== active)]) {
      const next = settle(x.state, ctx.nowMs, balance, await modsOf(ctx.tx, x, ctx.nowMs));
      // Unbekannte Zone (alter Browser): fester Versatz wie bisher statt Ablehnung.
      const r = scheduleNightShieldChange(next.protection, startHour, tzOffsetMinutes, ctx.nowMs, balance, validTimeZone(timeZone) ? timeZone : null);
      if (!r.ok) {
        if (x.id === active) return { ok: false as const, code: r.code };
        continue;
      }
      if (x.id === active) fromMs = r.fromMs;
      next.protection = r.protection;
      await saveBase(ctx.tx, x.id, next);
    }
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, fromMs };
  });
}

// ---------------------------------------------------------------- Missionen

/** Eingabe von mission.launch (baseId: Ausgangshafen, fehlt → Heimathafen). */
export interface LaunchInput {
  type: string; units: Counts; col: number; row: number; cargo?: ResourceMap; eventId?: number; admiralId?: number;
  blockadeId?: number; convoyId?: number; holdHours?: number; fieldId?: number; stayAll?: boolean; baseId?: number;
}

export interface MissionTarget {
  kind: "base" | "nest";
  id: number;
  col: number;
  row: number;
  playerId: number | null;
  state?: BaseState;
  /** Mehrere Häfen: Ziel ist ein Heimathafen (für Modifikatoren des Verteidigers). */
  isHome?: boolean;
  defeatedAt?: Date | null;
  /** Nest: Stufe (eigene Wiederkehr je Stufe, v1.15). */
  level?: number;
}

export async function targetAt(tx: Tx, col: number, row: number): Promise<MissionTarget | null> {
  const [b] = await tx.select().from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  if (b) return { kind: "base", id: b.id, col, row, playerId: b.playerId, isHome: b.isHome, state: withSite(b.state as BaseState, col, row) };
  const [n] = await tx.select().from(tables.nest).where(and(eq(tables.nest.col, col), eq(tables.nest.row, row)));
  if (n) return { kind: "nest", id: n.id, col, row, playerId: null, defeatedAt: n.defeatedAt, level: n.level };
  return null;
}

export function launchMission(
  engine: Engine,
  playerId: number,
  key: string,
  input: LaunchInput,
) {
  return runCommand<{ ok: true; missionId: number; arriveAtMs: number }>(engine, playerId, key, "mission", async (ctx) => {
    const expansion = input.type === FOUNDING_TYPE || input.type === TRANSFER_TYPE;
    // Spielerweite Grenze (Häfen + laufende Gründungen) über mehrere Häfen: vor der Hafensperre serialisieren.
    if (expansion) await lockPlayerWide(ctx.tx, playerId);
    const b = await ownBaseLocked(ctx, input.baseId);
    if (expansion) return launchExpansion(ctx.tx, playerId, b, input, ctx.nowMs, ctx.notify); // Mehrere Häfen
    if (input.fieldId !== undefined) return launchField(ctx.tx, playerId, b, { ...input, fieldId: input.fieldId }, ctx.nowMs, ctx.notify); // Felder
    // Weltereignis als Ziel (world-events-missions.ts).
    if (input.eventId !== undefined) return launchAgainstEvent(ctx.tx, playerId, b, { ...input, eventId: input.eventId }, ctx.nowMs, ctx.notify);
    if (input.type === STATION_TYPE) return stationLaunch(ctx.tx, playerId, b, input, ctx.nowMs, ctx.notify); // Allianz-Ops
    // See: Minen legen/räumen, Blockade, Konvoi abfangen, Angriff auf Blockade (naval.ts).
    if (isNavalInput(input)) return launchNaval(ctx.tx, playerId, b, input, ctx.nowMs, ctx.notify);
    const target = await targetAt(ctx.tx, input.col, input.row);
    if (!target) fail("no_target");
    if (target.kind === "base" && target.playerId === playerId && (input.type !== "transport" || target.id === b.id)) fail("own_base"); // Transport in eigenen Hafen erlaubt
    // Allianzen/Diplomatie: kein Überfall auf Verbündete (ally) oder Paktpartner (pact).
    if (input.type === "ueberfall" && target.kind === "base" && target.playerId !== null) { const d = await diplomacyBlock(ctx.tx, playerId, target.playerId, ctx.nowMs); if (d) fail(d); }
    if (input.type === "transport" && target.kind !== "base") fail("transport_needs_base");
    // Lagebild: ein unerkanntes Nest darf angegriffen werden (ist es leer, gibt es einen Bericht „verlassen“).
    if (input.type === "ueberfall" && target.kind === "nest" && target.defeatedAt && !isNestRespawned(target.defeatedAt.getTime(), ctx.nowMs, balance, target.level) && (await nestKnown(ctx.tx, playerId, target.id, ctx.nowMs))) {
      fail("nest_empty");
    }
    // Admirale: Führer des Verbands (Tempo, Treibstoff, Tarnung …); prüft Besitz und Verfügbarkeit.
    const adm = input.admiralId !== undefined ? await admiralForLaunch(ctx.tx, playerId, input.admiralId, ctx.nowMs, b.id) : null;
    const mods = combineModifiers(await modsOf(ctx.tx, b, ctx.nowMs), adm?.mods);
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
        weather: missionWeather(b.col, b.row, target.col, target.row, ctx.nowMs),
        playerHarbor: target.kind === "base" && target.playerId !== null, // PvP: beendet den eigenen Anfängerschutz
        sightRecon: true, // Aufklärung auf Sicht: Wendepunkt in Lagebild-Reichweite
      },
      ctx.nowMs,
      balance,
      mods,
    );
    if (!r.ok) return r;
    await saveBase(ctx.tx, b.id, r.base);
    if (r.base.protection.beginnerEndedAtMs === ctx.nowMs) { await endBeginnerElsewhere(ctx.tx, playerId, b.id, ctx.nowMs); ctx.notify.push([null, "map"]); } // PvP
    const [m] = await ctx.tx
      .insert(tables.mission)
      .values({
        playerId, baseId: b.id, type: r.mission.type, targetKind: target.kind, targetId: target.id,
        targetCol: target.col, targetRow: target.row, plan: adm ? { ...r.mission, admiralId: adm.id } : r.mission, status: "outbound",
        arriveAt: new Date(r.mission.arriveAtMs),
      })
      .returning({ id: tables.mission.id });
    if (adm) await assignAdmiral(ctx.tx, adm.id, m.id); // Admirale
    await scheduleEvent(ctx.tx, "mission_arrive", r.mission.arriveAtMs, { missionId: m.id }, target.kind === "base" ? target.id : null);
    // See: Konvoi – ein Transport reist als Konvoi (Kartell und Kriegsgegner können abfangen).
    if (r.mission.type === "transport" && target.kind === "base") {
      await createConvoy(ctx.tx, { kind: "transport", missionId: m.id, senderId: playerId, recipientId: target.playerId!, recipientBaseId: target.id, from: b, to: target, cargo: r.mission.cargo, escort: r.mission.units, departMs: ctx.nowMs, arriveMs: r.mission.arriveAtMs });
    }
    if (r.mission.type === "ueberfall" && target.kind === "base" && target.state) {
      const targetMods = await modifiersFor(ctx.tx, target.playerId, { state: target.state, nowMs: ctx.nowMs, baseId: target.id, isHome: target.isHome });
      await scheduleAttackWarning(ctx.tx, { missionId: m.id, targetBaseId: target.id, targetState: target.state, arriveAtMs: r.mission.arriveAtMs, nowMs: ctx.nowMs, targetMods, warningFactor: r.mission.warningFactor });
    }
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
        cargoHome: { ...((await transportConvoyRecall(ctx.tx, m.id)) ?? plan.cargo ?? {}) }, // See: Konvoi (Ladung nach Abfang)
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
  input: { side: "buy" | "sell"; resource: string; qty: number; expectedPrice: number; baseId?: number; escort?: Record<string, number> },
) {
  const request = { side: input.side, resource: input.resource, qty: input.qty, expectedPrice: input.expectedPrice };
  return runCommand(engine, playerId, key, "trade", async (ctx) => {
    const b = await ownBaseLocked(ctx, input.baseId);
    const [p] = await ctx.tx.select().from(tables.player).where(eq(tables.player.id, playerId)).for("no key update");
    if (!balance.resources.includes(request.resource)) fail("bad_qty");
    // Weltereignis Belagerung: keine Börsenkäufe (Lieferungen) während des Belagerungsrings.
    if (request.side === "buy" && (await siegeEffects(ctx.tx, b.id, ctx.nowMs))?.marketBlocked) fail("siege");
    if (await tradeBlocked(ctx.tx, b.id, request.side, ctx.nowMs)) fail("blockade"); // See: Blockade sperrt Börsenverkäufe
    const marketState = await loadMarket(ctx.tx, request.resource);
    const mods = await modsOf(ctx.tx, b, ctx.nowMs);
    const state = settle(b.state, ctx.nowMs, balance, mods);
    const stock = {} as Record<ResourceId, number>;
    for (const r of balance.resources) stock[r as ResourceId] = Math.floor(state.resources[r] ?? 0);
    const trader = { ...(p.trader as Omit<marketCore.TraderState, "stock">), stock } as marketCore.TraderState;
    const capacity = await homeStorageCapacity(ctx.tx, playerId, ctx.nowMs, { ...b, state }); // Tageslimit: Heimathafen
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
        harborLevel: await maxHarborLevel(ctx.tx, playerId, { id: b.id, state }), // höchste Hafenkommandantur
        storageCapacity: storage,
        attackDetected: await incomingDetected(ctx.tx, b.id, state, ctx.nowMs, mods),
        distanceToPortKm: nearestTradePortBySea(b).distanceKm, // Seewege: Lieferung fährt über Wasser
        reservedQty: (await reservedNext24h(ctx.tx, playerId, ctx.nowMs))[request.resource] ?? 0, // Lieferverträge: Vormerkung
      },
      await marketBalanceNow(ctx.tx, ctx.nowMs), // Weltpolitik: wirksame Gebühr und Tageslimit
      ctx.nowMs,
      // Marktnachrichten: effektiver Richtwert (undefined ohne Verschiebung, dann bit-gleich wie vorher).
      await effectiveMarketRefs(ctx.tx, ctx.nowMs),
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
      await createMarketConvoy(ctx.tx, playerId, { ...b, state }, d, input.escort); // See: Börsenkonvoi (Geleit optional)
    }
    await trackProgress(ctx.tx, playerId, "handel", result.quote.totalCredits, { atMs: ctx.nowMs });
    await recordTradeFee(ctx.tx, playerId, result.quote.totalCredits, result.quote.feeCredits, ctx.nowMs); // M-07: Kaufmann nach Gebühren
    ctx.notify.push([[playerId], "base"], [null, "market"]);
    return { ok: true as const, quote: result.quote, delivery: result.delivery };
  });
}

export { harborCreditLimit, sql };
