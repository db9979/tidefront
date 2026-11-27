// Seekabel / Stromverbund (v1.21, docs/REGELN-STROM.md): Befehle (anbieten, annehmen, Preis, trennen) und die
// Abrechnung cable_tick. Der Kern (power-green.ts) schreibt in der Fortschreibung jedes Hafens fort, was der
// Abgebende ins Kabel schickt (state.cable.sent) und was der Empfänger aus seinem Kabelpuffer zieht. Hier wird alle
// tickMinutes das Gesendete mit Leitungsverlust in den Puffer des Empfängers gebucht und bezahlt (Journal
// trade_ledger: player:<Empfänger> → player:<Abgebender>, Prüflauf audit.ts bleibt ausgeglichen).
// Sperren: Kabelzeile, dann Stützpunkte (aufsteigende ID), dann Spieler.
import { and, eq, inArray, or } from "drizzle-orm";
import { cableBalance, cableBuilding, settle, transferCable, type BaseState } from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { lockBases, readBase, saveBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { membershipOf, systemMessage } from "./alliance-core.ts";
import type { Notes } from "./naval-common.ts";

export const CABLE_TICK = "cable_tick";
export type CableRow = typeof tables.powerCable.$inferSelect;
const pc = tables.powerCable;
const MIN = 60000;

function fail(code: string): never {
  throw new GameError(code);
}

const cents = (x: number) => Math.round(x * 100) / 100;

/** Kabel, an denen der Hafen beteiligt ist (angefragt oder aktiv). */
export async function cablesOfBase(db: DbOrTx, baseId: number): Promise<CableRow[]> {
  return db.select().from(pc).where(or(eq(pc.fromBaseId, baseId), eq(pc.toBaseId, baseId)));
}

/** Gleiche Allianz (beide Mitglied derselben)? */
async function allied(db: DbOrTx, a: number, b: number): Promise<boolean> {
  const [x, y] = [await membershipOf(db, a), await membershipOf(db, b)];
  return !!x && !!y && x.allianceId === y.allianceId;
}

/** Stufe der Kabelstation eines Hafens. */
function stationLevel(state: BaseState): number {
  const id = cableBuilding(balance);
  return id ? state.buildings[id] ?? 0 : 0;
}

/** Beide Häfen bis nowMs fortschreiben (gesperrt), Rückgabe in Reihenfolge [from, to]. */
async function settledPair(tx: Tx, fromId: number, toId: number, nowMs: number): Promise<[BaseRow | null, BaseRow | null]> {
  const rows = await lockBases(tx, [fromId, toId]);
  const out: (BaseRow | null)[] = [];
  for (const id of [fromId, toId]) {
    const b = rows.get(id) ?? null;
    if (b) b.state = settle(b.state, nowMs, balance, await modsOf(tx, b, nowMs));
    out.push(b);
  }
  return [out[0], out[1]];
}

/**
 * Abrechnung bis nowMs: Gesendetes mit Verlust in den Puffer, Preis vom Empfänger an den Abgebenden. Beide Häfen
 * sind fortgeschrieben (settledPair); speichert beide und schreibt die Summen am Kabel fort.
 */
async function bill(tx: Tx, c: CableRow, from: BaseRow, to: BaseRow, nowMs: number): Promise<void> {
  const paying = c.price > 0 && c.fromPlayerId !== c.toPlayerId;
  let credits = 0;
  let traders = new Map<number, { credits: number }>();
  if (paying) {
    const rows = await tx.select({ id: tables.player.id, trader: tables.player.trader }).from(tables.player)
      .where(inArray(tables.player.id, [c.fromPlayerId, c.toPlayerId])).orderBy(tables.player.id).for("update");
    traders = new Map(rows.map((r) => [r.id, r.trader as { credits: number }]));
    credits = traders.get(c.toPlayerId)?.credits ?? 0;
  }
  const t = transferCable(from.state, to.state, c.distanceKm, paying ? c.price : 0, credits, nowMs, balance);
  await saveBase(tx, from.id, t.out);
  await saveBase(tx, to.id, t.in);
  const cost = paying ? Math.min(t.cost, credits) : 0;
  if (cost >= 0.01) {
    const payer = traders.get(c.toPlayerId)!;
    const payee = traders.get(c.fromPlayerId)!;
    await tx.update(tables.player).set({ trader: { ...payer, credits: cents(payer.credits - cost) } }).where(eq(tables.player.id, c.toPlayerId));
    await tx.update(tables.player).set({ trader: { ...payee, credits: cents(payee.credits + cost) } }).where(eq(tables.player.id, c.fromPlayerId));
    const tradeId = `kabel-${c.id}:${nowMs}`;
    await tx.insert(tables.tradeLedger).values([
      { tradeId, tMs: nowMs, account: `player:${c.toPlayerId}`, asset: "credits", amount: (-cost).toFixed(2) },
      { tradeId, tMs: nowMs, account: `player:${c.fromPlayerId}`, asset: "credits", amount: cost.toFixed(2) },
    ]);
  }
  await tx.update(pc).set({
    lastTickAt: new Date(nowMs), delivered: c.delivered + t.delivered, lost: c.lost + t.lost, paid: cents(c.paid + (cost >= 0.01 ? cost : 0)),
  }).where(eq(pc.id, c.id));
}

/** Kabel trennen: aktive zuletzt abrechnen, Zustand beider Häfen räumen, Zeile löschen, Gegenseite benachrichtigen. */
export async function severCable(tx: Tx, c: CableRow, nowMs: number, notes: Notes, reason: string, by: number | null): Promise<void> {
  if (c.status === "aktiv" && c.fromBaseId !== null && c.toBaseId !== null) {
    const [from, to] = await settledPair(tx, c.fromBaseId, c.toBaseId, nowMs);
    if (from && to && from.state.cable?.id === c.id && to.state.cable?.id === c.id) await bill(tx, c, from, to, nowMs);
  }
  for (const id of [c.fromBaseId, c.toBaseId]) {
    if (id === null) continue;
    const b = (await lockBases(tx, [id])).get(id);
    if (b && b.state.cable?.id === c.id) {
      const state = settle(b.state, nowMs, balance, await modsOf(tx, b, nowMs));
      state.cable = null;
      await saveBase(tx, b.id, state);
    }
  }
  await tx.delete(pc).where(eq(pc.id, c.id));
  const others = [c.fromPlayerId, c.toPlayerId].filter((p) => p !== by);
  if (c.fromPlayerId !== c.toPlayerId) await systemMessage(tx, notes, others, "Seekabel getrennt", reason);
  notes.push([[c.fromPlayerId, c.toPlayerId], "base"]);
}

/** Kabel in Betrieb nehmen: beide Häfen fortschreiben, Zustand setzen, erste Abrechnung planen. */
async function activate(tx: Tx, c: CableRow, nowMs: number): Promise<void> {
  const cb = cableBalance(balance)!;
  const [from, to] = await settledPair(tx, c.fromBaseId!, c.toBaseId!, nowMs);
  if (!from || !to) fail("cable_gone");
  // Ein Kabel im Zustand ohne Zeile (Gegenseite samt Spieler gelöscht) ist verwaist und wird überschrieben.
  for (const b of [from, to]) {
    const other = b.state.cable;
    if (!other || other.id === c.id) continue;
    const [row] = await tx.select({ id: pc.id }).from(pc).where(eq(pc.id, other.id));
    if (row) fail("cable_busy");
  }
  if (stationLevel(from.state) < 1 || stationLevel(to.state) < 1) fail("cable_station_required");
  from.state.cable = { id: c.id, role: "out", sent: 0 };
  to.state.cable = { id: c.id, role: "in", buffer: 0 };
  await saveBase(tx, from.id, from.state);
  await saveBase(tx, to.id, to.state);
  await tx.update(pc).set({ status: "aktiv", activeSince: new Date(nowMs), lastTickAt: new Date(nowMs) }).where(eq(pc.id, c.id));
  await scheduleEvent(tx, CABLE_TICK, nowMs + cb.tickMinutes * MIN, { cableId: c.id }, to.id);
}

function checkPrice(price: number): number {
  const max = cableBalance(balance)?.maxPrice ?? 0;
  if (!Number.isFinite(price) || price < 0 || price > max) fail("cable_price");
  return cents(price);
}

/**
 * Kabel anbieten: vom eigenen Hafen `fromBaseId` (gibt Überschuss ab) zum Hafen `toBaseId`. Eigener Hafen: sofort
 * in Betrieb (Preis 0). Hafen eines Allianzmitglieds: Anfrage, der Empfänger muss annehmen. Codes: no_cable,
 * no_base, cable_self, cable_station_required, cable_busy, cable_too_far, cable_not_ally, cable_price.
 */
export function cableOffer(engine: Engine, playerId: number, key: string, input: { fromBaseId: number; toBaseId: number; price: number }) {
  return runCommand<{ ok: true; cableId: number; status: string }>(engine, playerId, key, "cableOffer", async (ctx: Ctx) => {
    const cb = cableBalance(balance);
    if (!cb || !cableBuilding(balance)) fail("no_cable");
    if (input.fromBaseId === input.toBaseId) fail("cable_self");
    const from = await readBase(ctx.tx, input.fromBaseId);
    const to = await readBase(ctx.tx, input.toBaseId);
    if (!from || from.playerId !== playerId || !to) fail("no_base");
    if (stationLevel(from.state) < 1 || stationLevel(to.state) < 1) fail("cable_station_required");
    const km = hexDistanceKm(from, to);
    if (km > cb.maxKm) fail("cable_too_far");
    const own = to.playerId === playerId;
    if (!own && !(await allied(ctx.tx, playerId, to.playerId))) fail("cable_not_ally");
    const price = own ? 0 : checkPrice(input.price);
    const [busy] = await ctx.tx.select({ id: pc.id }).from(pc).where(or(
      inArray(pc.fromBaseId, [from.id, to.id]), inArray(pc.toBaseId, [from.id, to.id]),
    )).limit(1);
    if (busy) fail("cable_busy");
    const [row] = await ctx.tx.insert(pc).values({
      fromBaseId: from.id, toBaseId: to.id, fromPlayerId: playerId, toPlayerId: to.playerId,
      status: "angefragt", price, distanceKm: Math.round(km * 10) / 10, createdAt: new Date(ctx.nowMs),
    }).returning();
    if (own) await activate(ctx.tx, row, ctx.nowMs);
    else {
      await systemMessage(ctx.tx, ctx.notify, [to.playerId], "Seekabel angeboten",
        `${from.name} bietet ${to.name} ein Seekabel an (${Math.round(km)} km, ${price > 0 ? `${price.toLocaleString("de-DE")} Kredite je Strom-Stunde` : "kostenlos als Allianzhilfe"}). ` +
        "Annehmen oder ablehnen unter Basis → Versorgung → Seekabel.");
    }
    ctx.notify.push([[playerId, to.playerId], "base"]);
    return { ok: true as const, cableId: row.id, status: own ? "aktiv" : "angefragt" };
  });
}

/** Lädt ein Kabel gesperrt; Codes: cable_gone, cable_not_party. */
async function lockCable(tx: Tx, playerId: number, cableId: number): Promise<CableRow> {
  const [c] = await tx.select().from(pc).where(eq(pc.id, cableId)).for("update");
  if (!c) fail("cable_gone");
  if (c.fromPlayerId !== playerId && c.toPlayerId !== playerId) fail("cable_not_party");
  return c;
}

/** Angefragtes Kabel annehmen (nur der Empfänger). Codes wie cableOffer, dazu cable_gone, cable_not_party. */
export function cableAccept(engine: Engine, playerId: number, key: string, cableId: number) {
  return runCommand(engine, playerId, key, "cableAccept", async (ctx: Ctx) => {
    const c = await lockCable(ctx.tx, playerId, cableId);
    if (c.toPlayerId !== playerId || c.status !== "angefragt") fail("cable_not_party");
    if (c.fromPlayerId !== playerId && !(await allied(ctx.tx, c.fromPlayerId, playerId))) fail("cable_not_ally");
    await activate(ctx.tx, c, ctx.nowMs);
    await systemMessage(ctx.tx, ctx.notify, [c.fromPlayerId], "Seekabel angenommen", "Das angebotene Seekabel ist in Betrieb.");
    ctx.notify.push([[c.fromPlayerId, c.toPlayerId], "base"]);
    return { ok: true as const };
  });
}

/** Preis ändern (nur der Abgebende, nicht zwischen eigenen Häfen); gilt ab der nächsten Abrechnung. */
export function cableSetPrice(engine: Engine, playerId: number, key: string, cableId: number, price: number) {
  return runCommand(engine, playerId, key, "cableSetPrice", async (ctx: Ctx) => {
    const c = await lockCable(ctx.tx, playerId, cableId);
    if (c.fromPlayerId !== playerId || c.toPlayerId === playerId) fail("cable_not_party");
    await ctx.tx.update(pc).set({ price: checkPrice(price) }).where(eq(pc.id, c.id));
    if (c.status === "aktiv") {
      await systemMessage(ctx.tx, ctx.notify, [c.toPlayerId], "Seekabel: neuer Preis",
        `Der Strom aus dem Seekabel kostet ab jetzt ${checkPrice(price).toLocaleString("de-DE")} Kredite je Strom-Stunde.`);
    }
    ctx.notify.push([[c.fromPlayerId, c.toPlayerId], "base"]);
    return { ok: true as const };
  });
}

/** Kabel trennen bzw. Anfrage ablehnen oder zurückziehen (beide Seiten). */
export function cableCut(engine: Engine, playerId: number, key: string, cableId: number) {
  return runCommand(engine, playerId, key, "cableCut", async (ctx: Ctx) => {
    const c = await lockCable(ctx.tx, playerId, cableId);
    const text = c.status === "angefragt" ? "Das Angebot für ein Seekabel wurde abgelehnt bzw. zurückgezogen." : "Die Gegenseite hat das Seekabel getrennt.";
    await severCable(ctx.tx, c, ctx.nowMs, ctx.notify, text, playerId);
    return { ok: true as const };
  });
}

/** game_event cable_tick: abrechnen und die nächste Abrechnung planen; ungültige Kabel trennen. */
export async function cableTick(tx: Tx, ev: { payload: Record<string, unknown> }, due: number): Promise<HandlerResult> {
  const notes: Notes = [];
  const [c] = await tx.select().from(pc).where(eq(pc.id, Number(ev.payload.cableId))).for("update");
  if (!c || c.status !== "aktiv") return { notify: [] };
  let invalid: string | null = null;
  if (c.fromBaseId === null || c.toBaseId === null) invalid = "Ein Hafen am Seekabel besteht nicht mehr.";
  const [from, to] = invalid ? [null, null] : await settledPair(tx, c.fromBaseId!, c.toBaseId!, due);
  if (!invalid && (!from || !to || from.playerId !== c.fromPlayerId || to.playerId !== c.toPlayerId)) invalid = "Ein Hafen am Seekabel hat den Besitzer gewechselt.";
  if (!invalid && from!.state.cable?.id !== c.id) invalid = "Das Seekabel ist nicht mehr angeschlossen.";
  if (!invalid && to!.state.cable?.id !== c.id) invalid = "Das Seekabel ist nicht mehr angeschlossen.";
  if (!invalid && c.fromPlayerId !== c.toPlayerId && !(await allied(tx, c.fromPlayerId, c.toPlayerId))) {
    invalid = "Das Seekabel wurde getrennt: Ihr seid nicht mehr in derselben Allianz.";
  }
  if (invalid) {
    await severCable(tx, c, due, notes, invalid, null);
    return { notify: notes };
  }
  await bill(tx, c, from!, to!, due);
  await scheduleEvent(tx, CABLE_TICK, due + (cableBalance(balance)?.tickMinutes ?? 10) * MIN, { cableId: c.id }, to!.id);
  return { notify: [[[c.fromPlayerId, c.toPlayerId], "base"]] };
}

/** Saisonende: alle Kabel löschen (die Häfen verschwinden ohnehin). */
export async function clearCables(tx: Tx): Promise<void> {
  await tx.delete(pc);
}

/** Bots und Prüfungen: aktive Kabel eines Spielers. */
export async function activeCablesOf(db: DbOrTx, playerId: number): Promise<CableRow[]> {
  return db.select().from(pc).where(and(eq(pc.status, "aktiv"), or(eq(pc.fromPlayerId, playerId), eq(pc.toPlayerId, playerId))));
}
