// Lieferverträge zwischen Spielern (v1.31, abweichend von der Vorlage schon in Stufe 1): ein Spieler bietet an (an alle
// oder an einen Spieler), ein anderer nimmt an. Schutz gegen Rohstoff-Schieben: Preisband ±band um min/max(Kurs,
// erwarteter Kurs), Grundaufschlag und Strafen in den Gebührentopf (nie an den Partner), Lieferung per Konvoi über
// die Seewege (abfangbar, Geleit des Käufers), Paarbremse (Börsenwert je Paar und 7 Tage). Verbundene Spieler
// (PvP-Absprache: Allianz, Pakt, Handel, Transport in 7 Tagen) dürfen Verträge schließen, diese zählen aber nicht für
// Erfolge und Tagesbefehle; jede Lieferung verbindet das Paar selbst für 7 Tage (kein Kopfgeld).
import { and, eq, gt, notInArray, or, sql } from "drizzle-orm";
import { gameTimeZone, settle, market as marketCore } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, marketBalance, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { marketUnlockedFor } from "./player-wide.ts";
import { incomingDetected } from "./views.ts";
import { modsOf } from "./modifiers.ts";
import { homeBaseOf, lockBases, lockOwnBase, readBase, scheduleEvent } from "./store.ts";
import { travelMs } from "./player-trade.ts";
import { systemMessage } from "./alliance-core.ts";
import { colluded } from "./pvp.ts";
import { balanceNow } from "./politik-core.ts"; // Weltpolitik: wirksame Börsengebühr
import { fmtInt, nameOf } from "./names.ts";
import type { HandlerResult } from "./events.ts";
import {
  CONTRACT_EVENT, cfgOrFail, checkCounts, checkCreditLimit, checkTerm, checkWindow, dayMs, escrowAccount, fail, isResource, journal,
  lockTraders, playerAcc, priceInputs, saveTrader, withCredits, type ContractRow,
} from "./contracts-core.ts";
import { cleanEscort, scheduleContract } from "./contracts-sign.ts";

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;

export interface ProposeInput {
  /** Seite des Anbietenden: "buy" = er kauft, "sell" = er liefert. */
  side: "buy" | "sell";
  resource: string;
  qty: number;
  days: number;
  /** Preis je Einheit (Käufer zahlt ihn; der Verkäufer bekommt ihn abzüglich Grundaufschlag). */
  price: number;
  /** Nur an diesen Spieler (Name); fehlt: an alle. */
  target?: string | null;
  baseId?: number;
  /** Geleit des Käufers für den Konvoi (nur wer kauft). */
  escort?: Record<string, number>;
}

/** Preisband zur Fälligkeit dueMs: [(1 − band) · min(K, E), (1 + band) · max(K, E)]. */
async function bandAt(db: DbOrTx, resource: marketCore.ResourceId, nowMs: number, dueMs: number) {
  const cfg = cfgOrFail();
  const pi = await priceInputs(db, resource, nowMs);
  const e = marketCore.expectedPriceAt(pi.k, pi.r, pi.rAt(dueMs), dueMs - nowMs, balance.market.reversionHalfLifeHours);
  return { ...marketCore.playerPriceBand(pi.k, e, cfg.player.band), k: pi.k, halted: pi.halted };
}

const inBand = (price: number, b: { min: number; max: number }) => price >= b.min - 1e-9 && price <= b.max + 1e-9;

/**
 * Vertrag einem Spieler (oder allen) anbieten; die eigene Sicherheit (Anzahlung bzw. Pfand) geht sofort in Treuhand.
 * Codes: no_contracts, bad_qty, bad_term, bad_target, locked, halted, under_attack, price_band, too_many_contracts,
 * rate, contract_limit, credit_limit, funds, escort_ships_only.
 */
export function proposePlayerContract(engine: Engine, playerId: number, key: string, input: ProposeInput) {
  return runCommand<{ ok: true; contractId: number }>(engine, playerId, key, "contractPropose", async (ctx: Ctx) => {
    const cfg = cfgOrFail();
    const { tx, nowMs } = ctx;
    if (!isResource(input.resource) || (input.side !== "buy" && input.side !== "sell")) fail("bad_qty");
    if (!Number.isInteger(input.qty) || input.qty < cfg.minQty || input.qty > 10_000_000) fail("bad_qty");
    if (!(typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0)) fail("price_band");
    await checkTerm(tx, input.days, cfg.durationsDays, nowMs);
    let targetId: number | null = null;
    if (input.target && input.target.trim() !== "") {
      const [t] = await tx.select({ id: tables.player.id, bot: tables.player.botProfile }).from(tables.player)
        .where(sql`lower(${tables.player.name}) = lower(${input.target.trim()})`);
      if (!t || t.id === playerId || t.bot !== null) fail("bad_target");
      targetId = t.id;
    }
    const b = await lockOwnBase(tx, playerId, input.baseId);
    const state = settle(b.state, nowMs, balance, await modsOf(tx, b, nowMs));
    if (!(await marketUnlockedFor(tx, playerId, { id: b.id, state }))) fail("locked");
    const dueMs = nowMs + dayMs(input.days);
    const band = await bandAt(tx, input.resource, nowMs, dueMs);
    if (band.halted) fail("halted");
    if (input.side === "sell" && (await incomingDetected(tx, b.id, state, nowMs))) fail("under_attack");
    if (!inBand(input.price, band)) fail("price_band");
    const units = marketCore.playerContractUnits(input.price, cfg);
    const escort = input.side === "buy" ? cleanEscort(input.escort) : {};
    // TE-06: Spielersperre vor den Grenzprüfungen – zwei Angebote aus zwei Häfen sperren verschiedene Basen, aber
    // denselben Spieler; so sieht das zweite die Zeile des ersten (Höchstzahl, Abschlüsse je Stunde, 24-h-Fenster).
    const me = (await lockTraders(tx, [playerId])).get(playerId)!;
    await checkCounts(tx, playerId, nowMs, true);
    await checkWindow(tx, playerId, input.resource, [{ atMs: dueMs, qty: input.qty }], nowMs);
    const unit = input.side === "buy" ? units.buyerUnit : units.sellerUnit;
    const security = marketCore.depositCents(input.qty, unit, cfg.depositShare);
    await checkCreditLimit(tx, playerId, input.side === "buy" ? "buyer" : "seller",
      input.side === "buy" ? marketCore.ceilToCents(input.qty * unit) - security : marketCore.floorToCents(input.qty * unit), me.credits);
    if (Math.round(me.credits * 100) < security) fail("funds");
    const offerUntil = Math.min(nowMs + cfg.player.offerHours * HOUR_MS, dueMs - HOUR_MS);
    const [row]: { id: number }[] = await tx.insert(tables.marketContract).values({
      kind: "spieler", status: "angeboten", proposerId: playerId, targetId,
      sellerId: input.side === "sell" ? playerId : null, buyerId: input.side === "buy" ? playerId : null,
      sellerBaseId: input.side === "sell" ? b.id : null, buyerBaseId: input.side === "buy" ? b.id : null,
      resource: input.resource, qty: input.qty, buyerUnit: units.buyerUnit, sellerUnit: units.sellerUnit, course: band.k,
      buyerDepositCents: input.side === "buy" ? security : 0, sellerPledgeCents: input.side === "sell" ? security : 0,
      delivery: "konvoi", dueAt: new Date(dueMs), settleAt: new Date(dueMs), offerUntil: new Date(offerUntil),
      escort: Object.keys(escort).length > 0 ? escort : null, createdAt: new Date(nowMs),
    }).returning({ id: tables.marketContract.id });
    await journal(tx, `mc-${row.id}:offer`, nowMs, [[playerAcc(playerId), "credits", -security], [escrowAccount(row.id), "credits", security]]);
    await saveTrader(tx, playerId, withCredits(me, -security));
    await scheduleEvent(tx, CONTRACT_EVENT, offerUntil, { contractId: row.id, step: "expire" }, null);
    if (targetId !== null) {
      const [me2] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
      await systemMessage(tx, ctx.notify, [targetId], "Liefervertrag angeboten",
        `${me2?.name ?? "?"} bietet dir einen Liefervertrag an: ${input.side === "sell" ? "liefert dir" : "kauft von dir"} ${fmtInt(input.qty)} ${nameOf(input.resource)} ` +
        `in ${input.days} ${input.days === 1 ? "Tag" : "Tagen"} zu ${input.price.toLocaleString("de-DE", { maximumFractionDigits: 3 })} Taler je Einheit. Annehmen in der Börse, Reiter „Verträge“.`);
    }
    ctx.notify.push([[playerId], "base"], [null, "market"]);
    return { ok: true as const, contractId: row.id };
  });
}

/** Börsenwert der Spielerverträge eines Paars in den letzten 7 Tagen (Paarbremse). */
export async function pairWeekValue(db: DbOrTx, a: number, b: number, nowMs: number): Promise<number> {
  const t = tables.marketContract;
  const [r] = await db.select({ v: sql<number>`coalesce(sum(${t.qty} * ${t.course}), 0)::float8` }).from(t).where(and(
    eq(t.kind, "spieler"), gt(t.signedAt, new Date(nowMs - WEEK_MS)), notInArray(t.status, ["angeboten", "zurueckgezogen", "abgelaufen"]),
    or(and(eq(t.sellerId, a), eq(t.buyerId, b)), and(eq(t.sellerId, b), eq(t.buyerId, a))),
  ));
  return Number(r?.v ?? 0);
}

/**
 * Vertragsangebot eines Spielers annehmen. Codes: offer_gone, own_offer, not_for_you, no_base, locked, halted,
 * under_attack, price_band (Kurs hat sich bewegt – neu anbieten), pair_limit, too_many_contracts, rate, contract_limit,
 * credit_limit, funds, escort_ships_only.
 */
export function acceptPlayerContract(engine: Engine, playerId: number, key: string, contractId: number, opts: { baseId?: number; escort?: Record<string, number> } = {}) {
  return runCommand<{ ok: true; dueAtMs: number }>(engine, playerId, key, "contractAccept", async (ctx: Ctx) => {
    const cfg = cfgOrFail();
    const { tx, nowMs } = ctx;
    const [c] = await tx.select().from(tables.marketContract).where(eq(tables.marketContract.id, contractId)).for("update");
    if (!c || c.kind !== "spieler" || c.status !== "angeboten" || (c.offerUntil && c.offerUntil.getTime() <= nowMs)) fail("offer_gone");
    if (c.proposerId === playerId) fail("own_offer");
    if (c.targetId !== null && c.targetId !== playerId) fail("not_for_you");
    const [me] = await tx.select({ bot: tables.player.botProfile }).from(tables.player).where(eq(tables.player.id, playerId));
    if (!me) fail("not_for_you"); // KI-Händler nehmen öffentliche Angebote im Zug an (bots-contracts.ts)
    const iBuy = c.buyerId === null;
    const ownRow = await (opts.baseId !== undefined ? readBase(tx, opts.baseId) : homeBaseOf(tx, playerId));
    if (!ownRow || ownRow.playerId !== playerId) fail("no_base");
    const propBaseId = iBuy ? c.sellerBaseId : c.buyerBaseId;
    const propRow = (propBaseId !== null ? await readBase(tx, propBaseId) : null) ?? (await homeBaseOf(tx, c.proposerId));
    if (!propRow || propRow.playerId !== c.proposerId) fail("offer_gone");
    const bases = await lockBases(tx, [ownRow.id, propRow.id]);
    const own = bases.get(ownRow.id)!;
    const prop = bases.get(propRow.id)!;
    const state = settle(own.state, nowMs, balance, await modsOf(tx, own, nowMs));
    if (!(await marketUnlockedFor(tx, playerId, { id: own.id, state }))) fail("locked");
    const band = await bandAt(tx, c.resource as marketCore.ResourceId, nowMs, c.dueAt.getTime());
    if (band.halted) fail("halted");
    if (!iBuy && (await incomingDetected(tx, own.id, state, nowMs))) fail("under_attack");
    if (!inBand(c.buyerUnit, band)) fail("price_band");
    if ((await pairWeekValue(tx, playerId, c.proposerId, nowMs)) + c.qty * band.k > cfg.player.pairWeekValue) fail("pair_limit");
    const escort = iBuy ? cleanEscort(opts.escort) : ((c.escort as Record<string, number> | null) ?? {});
    const seller = iBuy ? prop : own;
    const buyer = iBuy ? own : prop;
    const settleMs = Math.max(nowMs + 60_000, c.dueAt.getTime() - travelMs(seller, buyer));
    // Grenzen des Annehmenden; ein KI-Händler ist Gegenpartei vieler KI-Verträge und hat keine eigenen Vertragsgrenzen.
    const human = me.bot === null;
    const traders = await lockTraders(tx, [playerId, c.proposerId]); // TE-06: Sperre vor den Grenzprüfungen
    const mine = traders.get(playerId)!;
    if (human) {
      await checkCounts(tx, playerId, nowMs, true);
      await checkWindow(tx, playerId, c.resource, [{ atMs: settleMs, qty: c.qty }], nowMs);
    }
    const unit = iBuy ? c.buyerUnit : c.sellerUnit;
    const security = marketCore.depositCents(c.qty, unit, cfg.depositShare);
    if (human) {
      await checkCreditLimit(tx, playerId, iBuy ? "buyer" : "seller",
        iBuy ? marketCore.ceilToCents(c.qty * unit) - security : marketCore.floorToCents(c.qty * unit), mine.credits);
    }
    if (Math.round(mine.credits * 100) < security) fail("funds");
    const counts = !(await colluded(tx, playerId, c.proposerId, nowMs));
    await tx.update(tables.marketContract).set({
      status: "offen", signedAt: new Date(nowMs), settleAt: new Date(settleMs), counts,
      sellerId: seller.playerId, buyerId: buyer.playerId, sellerBaseId: seller.id, buyerBaseId: buyer.id,
      buyerDepositCents: iBuy ? security : c.buyerDepositCents, sellerPledgeCents: iBuy ? c.sellerPledgeCents : security,
      escort: Object.keys(escort).length > 0 ? escort : null,
    }).where(eq(tables.marketContract.id, c.id));
    await journal(tx, `mc-${c.id}:accept`, nowMs, [[playerAcc(playerId), "credits", -security], [escrowAccount(c.id), "credits", security]]);
    await saveTrader(tx, playerId, withCredits(mine, -security));
    await scheduleContract(tx, { id: c.id, settleAt: new Date(settleMs) }, seller.id, nowMs);
    const [n] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
    await systemMessage(tx, ctx.notify, [c.proposerId], "Liefervertrag angenommen",
      `${n?.name ?? "?"} hat deinen Liefervertrag über ${fmtInt(c.qty)} ${nameOf(c.resource)} angenommen. Fällig ${c.dueAt.toLocaleString("de-DE", { timeZone: gameTimeZone(), day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}; ` +
      `die Ware fährt per Konvoi.${counts ? "" : " Ihr seid verbunden (Allianz, Pakt oder Handel in den letzten Tagen): der Vertrag zählt nicht für Erfolge und Tagesbefehle."}`);
    ctx.notify.push([[playerId, c.proposerId], "base"], [null, "market"]);
    return { ok: true as const, dueAtMs: c.dueAt.getTime() };
  });
}

/** Angebot schließen (zurückgezogen oder abgelaufen): die Sicherheit des Anbietenden kommt zurück. */
export async function closeProposal(tx: Tx, c: ContractRow, status: "zurueckgezogen" | "abgelaufen", atMs: number, notify: HandlerResult["notify"]): Promise<void> {
  const security = c.buyerDepositCents + c.sellerPledgeCents;
  const t = (await lockTraders(tx, [c.proposerId])).get(c.proposerId);
  if (t) await saveTrader(tx, c.proposerId, withCredits(t, security));
  await journal(tx, `mc-${c.id}:${status}`, atMs, [[escrowAccount(c.id), "credits", -security], [playerAcc(c.proposerId), "credits", security]]);
  await tx.update(tables.marketContract).set({ status, closedAt: new Date(atMs) }).where(eq(tables.marketContract.id, c.id));
  if (status === "abgelaufen") {
    await systemMessage(tx, notify, [c.proposerId], "Liefervertrag: Angebot abgelaufen",
      `Niemand hat deinen Liefervertrag über ${fmtInt(c.qty)} ${nameOf(c.resource)} angenommen. Deine Sicherheit ist zurück auf dem Konto.`);
  }
  notify.push([[c.proposerId], "base"], [null, "market"]);
}

/** Eigenes Vertragsangebot zurückziehen. Codes: offer_gone, no_rights. */
export function withdrawPlayerContract(engine: Engine, playerId: number, key: string, contractId: number) {
  return runCommand(engine, playerId, key, "contractWithdraw", async (ctx: Ctx) => {
    const [c] = await ctx.tx.select().from(tables.marketContract).where(eq(tables.marketContract.id, contractId)).for("update");
    if (!c || c.status !== "angeboten") fail("offer_gone");
    if (c.proposerId !== playerId) fail("no_rights");
    await closeProposal(ctx.tx, c, "zurueckgezogen", ctx.nowMs, ctx.notify);
    return { ok: true as const };
  });
}

/** Preisband für die Eingabe eines Angebots (Anzeige). */
export async function playerBand(db: DbOrTx, resource: string, days: number, nowMs: number) {
  if (!isResource(resource)) fail("bad_qty");
  const b = await bandAt(db, resource, nowMs, nowMs + dayMs(days));
  return { min: b.min, max: b.max, course: b.k, fee: cfgOrFail().baseFee, marketFee: (await balanceNow(db, nowMs)).market.fee }; // Weltpolitik: Börsengebühr
}

