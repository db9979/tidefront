// Lieferverträge (v1.31): Abschluss mit einer KI und gemeinsame Bausteine des Abschlusses (Sicherheiten in Treuhand,
// Fälligkeiten als Ereignisse). Sperrreihenfolge wie überall: Stützpunkte aufsteigend, dann Spieler.
import { eq } from "drizzle-orm";
import { settle, market as marketCore, type Counts } from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { marketUnlockedFor } from "./player-wide.ts";
import { incomingDetected, marketQuote } from "./views.ts";
import { modsOf } from "./modifiers.ts";
import { homeBaseOf, lockBases, ownBase, saveBase, scheduleEvent } from "./store.ts";
import {
  CONTRACT_EVENT, cfgOrFail, checkCounts, checkCreditLimit, checkWindow, escrowAccount, fail, journal, lockTraders, playerAcc,
  saveTrader, withCredits, type ContractRow,
} from "./contracts-core.ts";
import { contractKi, kiDeal, kiFor, kiStocks, quotaOf, type KiDealInput } from "./contracts-ki.ts";
import { balanceNow } from "./politik-core.ts"; // Weltpolitik: wirksame Gebühr

const HOUR_MS = 3_600_000;

/** Fälligkeit als Ereignisse: Erinnerung remindHours vorher (wenn noch in der Zukunft) und die Abwicklung. */
export async function scheduleContract(tx: Tx, c: Pick<ContractRow, "id" | "settleAt">, baseId: number | null, nowMs: number): Promise<void> {
  const cfg = cfgOrFail();
  const remindAt = c.settleAt.getTime() - cfg.remindHours * HOUR_MS;
  if (remindAt > nowMs) await scheduleEvent(tx, CONTRACT_EVENT, remindAt, { contractId: c.id, step: "remind" }, baseId);
  await scheduleEvent(tx, CONTRACT_EVENT, c.settleAt.getTime(), { contractId: c.id, step: "settle" }, baseId);
}

/** Geleit für einen Konvoi-Vertrag: nur Schiffe, ganze Zahlen (geprüft wird beim Auslaufen). */
export function cleanEscort(escort: Record<string, number> | undefined): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(escort ?? {})) {
    if (!Number.isInteger(n) || n < 0) fail("bad_offer");
    if (n === 0) continue;
    if (balance.units[id]?.branch !== "see") fail("escort_ships_only");
    out[id] = n;
  }
  return out;
}

export interface KiSignInput extends KiDealInput {
  /** Durchschnittspreis je Einheit, den der Spieler gesehen hat (Abweichung > slippageTolerance → neu anbieten). */
  expectedPrice: number;
  baseId?: number;
  escort?: Record<string, number>;
}

/** Vorschau eines KI-Vertrags (Preis, Anzahlung, Fälligkeit, Börse zum Vergleich). Codes wie beim Abschluss. */
export async function kiContractQuote(engine: Engine, playerId: number, input: KiDealInput & { baseId?: number }) {
  const nowMs = Date.now();
  const ki = await kiFor(engine.db, await contractKi(engine.db, input.kiId), playerId, nowMs); // Weltpolitik: Ansehen
  const own = await ownBase(engine.db, playerId, input.baseId);
  const kiHome = await homeBaseOf(engine.db, ki.id);
  if (!kiHome) fail("no_ki");
  const deal = await kiDeal(engine.db, ki, input, own, kiHome, nowMs);
  const stocks = await kiStocks(engine.db, ki.id, playerId, nowMs, kiHome);
  const quota = stocks ? quotaOf(stocks, input.side, input.resource, ki) : 0;
  // Zum Vergleich: dieselbe Menge (je Tranche) jetzt an der Börse, mit Gebühr.
  const q = await marketQuote(engine, { side: input.side, resource: input.resource, qty: input.qty });
  const fee = (await balanceNow(engine.db, nowMs)).market.fee; // Weltpolitik: Gebühr der Gezeit
  const instant = q.ok ? q.executionPrice * (input.side === "buy" ? 1 + fee : 1 - fee) : null;
  return {
    ok: true as const,
    avgPrice: deal.avgPrice, totalQty: deal.totalQty, totalCredits: deal.totalCents / 100, securityCredits: deal.securityCents / 100,
    course: deal.inputs.k, expected: deal.tranches.map((t) => t.price.expected), instantPrice: instant, halted: deal.inputs.halted,
    tranches: deal.tranches.map((t) => ({ dueMs: t.dueMs, settleMs: t.settleMs, qty: t.qty, price: input.side === "buy" ? t.price.buyerUnit : t.price.sellerUnit })),
    delivery: deal.delivery, travelMs: deal.travelMs, quota, fits: deal.totalQty <= quota,
  };
}

/**
 * Weltpolitik: Abschluss als Gesuch (politik-gesuche.ts). before läuft vor, after nach dem Abschluss im selben Befehl;
 * das Kontingent wird nicht geprüft (die Menge hat die KI selbst erbeten).
 */
export interface KiSignGesuch {
  before: (ctx: Ctx) => Promise<void>;
  after: (ctx: Ctx, contractIds: number[]) => Promise<void>;
}

/**
 * Vertrag mit einer KI abschließen. Codes: no_contracts, no_ki, ki_refuses, bad_qty, not_offered, no_abo, bad_term,
 * locked, halted, under_attack, quota, too_many_contracts, rate, daily_limit, credit_limit, funds, slippage.
 */
export function signKiContract(engine: Engine, playerId: number, key: string, input: KiSignInput, gesuch?: KiSignGesuch) {
  return runCommand<{ ok: true; contractIds: number[]; firstDueMs: number }>(engine, playerId, key, "contractSignKi", async (ctx: Ctx) => {
    const cfg = cfgOrFail();
    const { tx, nowMs } = ctx;
    if (gesuch) await gesuch.before(ctx);
    const ki = await kiFor(tx, await contractKi(tx, input.kiId), playerId, nowMs); // Weltpolitik: Ansehen (statt kiRefuses)
    if (ki.id === playerId) fail("no_ki");
    if (ki.refused) fail("ki_refuses");
    const ownRow = await ownBase(tx, playerId, input.baseId);
    const kiRow = await homeBaseOf(tx, ki.id);
    if (!kiRow) fail("no_ki");
    const bases = await lockBases(tx, [ownRow.id, kiRow.id]);
    const own = bases.get(ownRow.id)!;
    const kiBase = bases.get(kiRow.id)!;
    if (own.playerId !== playerId) fail("no_base");
    const ownState = settle(own.state, nowMs, balance, await modsOf(tx, own, nowMs));
    if (!(await marketUnlockedFor(tx, playerId, { id: own.id, state: ownState }))) fail("locked");
    const deal = await kiDeal(tx, ki, input, own, kiBase, nowMs);
    if (deal.inputs.halted) fail("halted");
    if (input.side === "sell" && (await incomingDetected(tx, own.id, ownState, nowMs))) fail("under_attack");
    const escort = deal.delivery === "konvoi" && input.side === "buy" ? cleanEscort(input.escort) : {};
    const stocks = await kiStocks(tx, ki.id, playerId, nowMs, kiBase);
    if (!stocks || (!gesuch && deal.totalQty > quotaOf(stocks, input.side, input.resource, ki))) fail("quota");
    await checkCounts(tx, playerId, nowMs, true);
    await checkWindow(tx, playerId, input.resource, deal.tranches.map((t) => ({ atMs: t.settleMs, qty: t.qty })), nowMs);
    const traders = await lockTraders(tx, [playerId, ki.id]);
    const me = traders.get(playerId)!;
    const kiTrader = traders.get(ki.id)!;
    await checkCreditLimit(tx, playerId, input.side === "buy" ? "buyer" : "seller", input.side === "buy" ? deal.totalCents - deal.securityCents : deal.totalCents, me.credits);
    const exp = input.expectedPrice;
    if (!(typeof exp === "number" && exp > 0 && Math.abs(deal.avgPrice - exp) / exp <= balance.market.slippageTolerance)) fail("slippage");
    if (Math.round(me.credits * 100) < deal.securityCents) fail("funds");

    // Sicherheiten: Anzahlung bzw. Pfand des Spielers; Ware bzw. voller Kaufpreis der KI in Treuhand.
    let kiCredits = Math.round(kiTrader.credits * 100);
    const kiState = settle(kiBase.state, nowMs, balance, await modsOf(tx, kiBase, nowMs));
    const ids: number[] = [];
    let aboId: number | null = null;
    for (const [i, t] of deal.tranches.entries()) {
      const unit = input.side === "buy" ? t.price.buyerUnit : t.price.sellerUnit;
      const security = marketCore.depositCents(t.qty, unit, cfg.depositShare);
      const kiFull = input.side === "sell" ? marketCore.ceilToCents(t.qty * t.price.buyerUnit) : 0;
      if (input.side === "buy") {
        if (Math.floor(kiState.resources[input.resource] ?? 0) < t.qty) fail("quota");
        kiState.resources[input.resource] = (kiState.resources[input.resource] ?? 0) - t.qty;
      } else {
        if (kiCredits < kiFull) fail("quota");
        kiCredits -= kiFull;
      }
      const [row]: { id: number; settleAt: Date }[] = await tx.insert(tables.marketContract).values({
        kind: "ki", status: "offen", aboId, tranche: i + 1, tranches: deal.tranches.length,
        sellerId: input.side === "buy" ? ki.id : playerId, buyerId: input.side === "buy" ? playerId : ki.id,
        sellerBaseId: input.side === "buy" ? kiBase.id : own.id, buyerBaseId: input.side === "buy" ? own.id : kiBase.id,
        proposerId: playerId, resource: input.resource, qty: t.qty, buyerUnit: t.price.buyerUnit, sellerUnit: t.price.sellerUnit,
        course: deal.inputs.k, buyerDepositCents: input.side === "buy" ? security : kiFull, sellerPledgeCents: input.side === "buy" ? 0 : security,
        escrowQty: input.side === "buy" ? t.qty : 0, delivery: deal.delivery, dueAt: new Date(t.dueMs), settleAt: new Date(t.settleMs),
        escort: Object.keys(escort).length > 0 ? escort : null, counts: true, createdAt: new Date(nowMs), signedAt: new Date(nowMs),
      }).returning({ id: tables.marketContract.id, settleAt: tables.marketContract.settleAt });
      if (deal.tranches.length > 1) {
        if (aboId === null) aboId = row.id;
        await tx.update(tables.marketContract).set({ aboId }).where(eq(tables.marketContract.id, row.id));
      }
      ids.push(row.id);
      const esc = escrowAccount(row.id);
      await journal(tx, `mc-${row.id}:sign`, nowMs, input.side === "buy"
        ? [[playerAcc(playerId), "credits", -security], [esc, "credits", security], [playerAcc(ki.id), input.resource, -t.qty], [esc, input.resource, t.qty]]
        : [[playerAcc(playerId), "credits", -security], [esc, "credits", security + kiFull], [playerAcc(ki.id), "credits", -kiFull]]);
      await scheduleContract(tx, row, own.id, nowMs);
    }
    await saveTrader(tx, playerId, withCredits(me, -deal.securityCents));
    if (input.side === "sell") await saveTrader(tx, ki.id, { ...kiTrader, credits: kiCredits / 100 });
    else await saveBase(tx, kiBase.id, kiState);
    if (gesuch) await gesuch.after(ctx, ids);
    ctx.notify.push([[playerId], "base"], [[playerId], "market"]);
    return { ok: true as const, contractIds: ids, firstDueMs: deal.tranches[0].dueMs };
  });
}
