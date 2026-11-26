// Handel zwischen Spielern: Angebot "gebe X, will Y" mit Treuhand. Beim Einstellen wird die Ware aus dem Hafen
// (bzw. die Kredite vom Konto) abgezogen und auf escrow:po-<id> gebucht. Bei Annahme zahlt der Annehmende sofort;
// Ressourcen reisen beiderseits als Lieferung (delivery_arrive) mit Reisezeit nach Entfernung der Häfen, Kredite
// werden sofort gutgeschrieben. Gebühr je empfangener Seite. Rückzug erstattet sofort.
// Sperrreihenfolge: Angebot, Stützpunkte aufsteigend, Spieler aufsteigend.
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { harborMarketUnlocked, settle, deliverCargo, market as marketCore } from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { baseOfPlayer, lockBase, lockBases, saveBase, scheduleEvent } from "./store.ts";
import { fail, membershipOf, systemMessage } from "./alliance-core.ts";
import { getSetting } from "./settings.ts";
import { attachTradeEscort, createConvoy } from "./naval.ts"; // See: Konvoi (Lieferungen reisen als Konvoi, Geleitschutz)

/** Gebühr je empfangener Seite ohne Einstellung (server_setting player_trade_fee, 0 bis 0,2). */
export const PLAYER_TRADE_FEE_DEFAULT = 0.02;
export const PLAYER_TRADE_FEE_SETTING = "player_trade_fee";
export const MAX_OPEN_OFFERS = 10;
export const OFFER_QTY_MAX = 10_000_000;
const MIN_TRAVEL_MS = 60000;

type Trader = Omit<marketCore.TraderState, "stock">;

export function tradeAssets(): string[] {
  return [...balance.resources, "credits"];
}

export async function playerTradeFee(db: Tx | Engine["db"]): Promise<number> {
  const raw = await getSetting(db, PLAYER_TRADE_FEE_SETTING);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 0.2 ? n : PLAYER_TRADE_FEE_DEFAULT;
}

/** Gebühr auf eine Menge: Ressourcen ganzzahlig abgerundet, Kredite auf Cent abgerundet. */
export function feeOf(asset: string, qty: number, fee: number): number {
  return asset === "credits" ? Math.floor(qty * fee * 100) / 100 : Math.floor(qty * fee);
}

export function travelMs(a: { col: number; row: number }, b: { col: number; row: number }): number {
  return Math.max(MIN_TRAVEL_MS, Math.round((hexDistanceKm(a, b) / balance.market.convoySpeedKmh) * 3600000));
}

const ASSET_TEXT: Record<string, string> = { stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant", credits: "Kredite" };
const resLabel = (id: string) => ASSET_TEXT[id] ?? id;
const cents = (n: number) => Math.round(n * 100) / 100;
const amt = (n: number) => n.toFixed(2);

async function lockPlayers(tx: Tx, ids: number[]): Promise<Map<number, Trader>> {
  const rows = await tx
    .select({ id: tables.player.id, trader: tables.player.trader })
    .from(tables.player)
    .where(inArray(tables.player.id, [...new Set(ids)]))
    .orderBy(asc(tables.player.id))
    .for("update");
  return new Map(rows.map((r) => [r.id, r.trader as Trader]));
}

async function setCredits(tx: Tx, playerId: number, trader: Trader, credits: number): Promise<void> {
  await tx.update(tables.player).set({ trader: { ...trader, credits: cents(credits) } }).where(eq(tables.player.id, playerId));
}

export interface OfferInput {
  give: string;
  giveQty: number;
  want: string;
  wantQty: number;
  visibility: "public" | "alliance";
}

/** Angebot einstellen. Codes: bad_offer, bad_qty, no_alliance, locked, too_many_offers, funds. */
export function createOffer(engine: Engine, playerId: number, key: string, input: OfferInput) {
  return runCommand<{ ok: true; offerId: number }>(engine, playerId, key, "offerCreate", async (ctx: Ctx) => {
    const assets = tradeAssets();
    if (!assets.includes(input.give) || !assets.includes(input.want) || input.give === input.want) fail("bad_offer");
    for (const q of [input.giveQty, input.wantQty]) if (!Number.isInteger(q) || q < 1 || q > OFFER_QTY_MAX) fail("bad_qty");
    if (input.visibility !== "public" && input.visibility !== "alliance") fail("bad_offer");
    const m = await membershipOf(ctx.tx, playerId);
    if (input.visibility === "alliance" && !m) fail("no_alliance");
    const own = await baseOfPlayer(ctx.tx, playerId);
    if (!own) fail("no_base");
    const b = (await lockBase(ctx.tx, own.id))!;
    const state = settle(b.state, ctx.nowMs, balance);
    if (!harborMarketUnlocked(state, balance)) fail("locked");
    const [n] = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tables.playerOffer)
      .where(and(eq(tables.playerOffer.sellerId, playerId), eq(tables.playerOffer.status, "open")));
    if ((n?.n ?? 0) >= MAX_OPEN_OFFERS) fail("too_many_offers");
    if (input.give === "credits") {
      const trader = (await lockPlayers(ctx.tx, [playerId])).get(playerId)!;
      if (trader.credits < input.giveQty) fail("funds");
      await setCredits(ctx.tx, playerId, trader, trader.credits - input.giveQty);
    } else {
      if (Math.floor(state.resources[input.give] ?? 0) < input.giveQty) fail("funds");
      state.resources[input.give] = (state.resources[input.give] ?? 0) - input.giveQty;
      await saveBase(ctx.tx, b.id, state);
    }
    const [o] = await ctx.tx
      .insert(tables.playerOffer)
      .values({
        sellerId: playerId, give: input.give, giveQty: input.giveQty, want: input.want, wantQty: input.wantQty,
        visibility: input.visibility, allianceId: m?.allianceId ?? null, createdAt: new Date(ctx.nowMs),
      })
      .returning({ id: tables.playerOffer.id });
    const tradeId = `po-${o.id}:escrow`;
    await ctx.tx.insert(tables.tradeLedger).values([
      { tradeId, tMs: ctx.nowMs, account: `player:${playerId}`, asset: input.give, amount: amt(-input.giveQty) },
      { tradeId, tMs: ctx.nowMs, account: `escrow:po-${o.id}`, asset: input.give, amount: amt(input.giveQty) },
    ]);
    ctx.notify.push([[playerId], "base"], [null, "market"]);
    return { ok: true as const, offerId: o.id };
  });
}

/**
 * Angebot annehmen. Das Angebot wird zuerst gesperrt: von zwei gleichzeitigen Annahmen gelingt genau eine.
 * Codes: offer_gone, own_offer, not_ally, no_base, seller_gone, locked, funds.
 */
export function acceptOffer(engine: Engine, playerId: number, key: string, offerId: number, escort?: Record<string, number>) {
  return runCommand<{ ok: true; arriveAtMs: number }>(engine, playerId, key, "offerAccept", async (ctx: Ctx) => {
    const [o] = await ctx.tx.select().from(tables.playerOffer).where(eq(tables.playerOffer.id, offerId)).for("update");
    if (!o || o.status !== "open") fail("offer_gone");
    if (o.sellerId === playerId) fail("own_offer");
    if (o.visibility === "alliance") {
      const mine = await membershipOf(ctx.tx, playerId);
      const theirs = await membershipOf(ctx.tx, o.sellerId);
      if (!mine || mine.allianceId !== o.allianceId || theirs?.allianceId !== o.allianceId) fail("not_ally");
    }
    const buyerRow = await baseOfPlayer(ctx.tx, playerId);
    if (!buyerRow) fail("no_base");
    const sellerRow = await baseOfPlayer(ctx.tx, o.sellerId);
    if (!sellerRow) fail("seller_gone");
    const bases = await lockBases(ctx.tx, [buyerRow.id, sellerRow.id]);
    const buyerBase = bases.get(buyerRow.id)!;
    const sellerBase = bases.get(sellerRow.id)!;
    const buyerState = settle(buyerBase.state, ctx.nowMs, balance);
    if (!harborMarketUnlocked(buyerState, balance)) fail("locked");
    const traders = o.want === "credits" || o.give === "credits" ? await lockPlayers(ctx.tx, [playerId, o.sellerId]) : new Map<number, Trader>();
    const credit = new Map<number, number>();
    const creditOf = (id: number) => credit.get(id) ?? traders.get(id)!.credits;

    // 1. Der Annehmende zahlt sofort.
    if (o.want === "credits") {
      if (creditOf(playerId) < o.wantQty) fail("funds");
      credit.set(playerId, creditOf(playerId) - o.wantQty);
    } else {
      if (Math.floor(buyerState.resources[o.want] ?? 0) < o.wantQty) fail("funds");
      buyerState.resources[o.want] = (buyerState.resources[o.want] ?? 0) - o.wantQty;
      await saveBase(ctx.tx, buyerBase.id, buyerState);
    }

    // 2. Lieferungen (Ressourcen per Konvoi, Kredite sofort), Gebühr je empfangener Seite.
    const fee = await playerTradeFee(ctx.tx);
    const arriveAtMs = ctx.nowMs + travelMs(sellerBase, buyerBase);
    const tradeId = `po-${o.id}:accept`;
    const ledger: (typeof tables.tradeLedger.$inferInsert)[] = [];
    const line = (account: string, asset: string, amount: number) => ledger.push({ tradeId, tMs: ctx.nowMs, account, asset, amount: amt(amount) });
    const send = async (to: number, toBaseId: number, asset: string, qty: number, suffix: string) => {
      const f = feeOf(asset, qty, fee);
      const net = asset === "credits" ? cents(qty - f) : qty - f;
      if (f > 0) line("fees", asset, f);
      if (asset === "credits") {
        credit.set(to, creditOf(to) + net);
        line(`player:${to}`, asset, net);
      } else if (net > 0) {
        const id = `po-${o.id}-${suffix}`;
        await ctx.tx.insert(tables.delivery).values({
          id, playerId: to, baseId: toBaseId, resource: asset, qty: net, departAt: new Date(ctx.nowMs), arriveAt: new Date(arriveAtMs),
        });
        await scheduleEvent(ctx.tx, "delivery_arrive", arriveAtMs, { deliveryId: id }, toBaseId);
        line(`delivery:${id}`, asset, net);
        // See: Konvoi – die Lieferung reist auf der Route; Geleitschutz des Annehmenden begleitet die eingehende Ware.
        const fromBase = toBaseId === buyerBase.id ? sellerBase : buyerBase;
        const convoyId = await createConvoy(ctx.tx, {
          kind: "handel", deliveryId: id, senderId: fromBase.playerId, recipientId: to, recipientBaseId: toBaseId, from: fromBase,
          to: toBaseId === buyerBase.id ? buyerBase : sellerBase, cargo: { [asset]: net }, departMs: ctx.nowMs, arriveMs: arriveAtMs,
        });
        if (suffix === "k" && escort) await attachTradeEscort(ctx.tx, playerId, { ...buyerBase, state: buyerState }, escort, convoyId, sellerBase, arriveAtMs, ctx.nowMs);
      }
    };
    line(`escrow:po-${o.id}`, o.give, -o.giveQty);
    await send(playerId, buyerBase.id, o.give, o.giveQty, "k");
    line(`player:${playerId}`, o.want, -o.wantQty);
    await send(o.sellerId, sellerBase.id, o.want, o.wantQty, "v");
    await ctx.tx.insert(tables.tradeLedger).values(ledger);
    for (const [id, c] of credit) await setCredits(ctx.tx, id, traders.get(id)!, c);

    await ctx.tx
      .update(tables.playerOffer)
      .set({ status: "accepted", buyerId: playerId, closedAt: new Date(ctx.nowMs) })
      .where(eq(tables.playerOffer.id, o.id));
    const [buyer] = await ctx.tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
    await systemMessage(ctx.tx, ctx.notify, [o.sellerId], "Handel: Angebot angenommen",
      `${buyer?.name ?? "?"} hat dein Angebot angenommen: ${o.giveQty} ${resLabel(o.give)} gegen ${o.wantQty} ${resLabel(o.want)}. ` +
      (o.want === "credits" ? "Die Kredite sind gutgeschrieben." : "Die Ware ist per Konvoi unterwegs."));
    ctx.notify.push([[playerId, o.sellerId], "base"], [null, "market"]);
    return { ok: true as const, arriveAtMs };
  });
}

/** Eigenes offenes Angebot zurückziehen; die Ware kommt sofort zurück. Codes: offer_gone, no_rights, no_base. */
export function withdrawOffer(engine: Engine, playerId: number, key: string, offerId: number) {
  return runCommand(engine, playerId, key, "offerWithdraw", async (ctx: Ctx) => {
    const [o] = await ctx.tx.select().from(tables.playerOffer).where(eq(tables.playerOffer.id, offerId)).for("update");
    if (!o || o.status !== "open") fail("offer_gone");
    if (o.sellerId !== playerId) fail("no_rights");
    if (o.give === "credits") {
      const trader = (await lockPlayers(ctx.tx, [playerId])).get(playerId)!;
      await setCredits(ctx.tx, playerId, trader, trader.credits + o.giveQty);
    } else {
      const own = await baseOfPlayer(ctx.tx, playerId);
      if (!own) fail("no_base");
      const b = (await lockBase(ctx.tx, own.id))!;
      await saveBase(ctx.tx, b.id, deliverCargo(b.state, { [o.give]: o.giveQty }, ctx.nowMs, balance));
    }
    const tradeId = `po-${o.id}:cancel`;
    await ctx.tx.insert(tables.tradeLedger).values([
      { tradeId, tMs: ctx.nowMs, account: `escrow:po-${o.id}`, asset: o.give, amount: amt(-o.giveQty) },
      { tradeId, tMs: ctx.nowMs, account: `player:${playerId}`, asset: o.give, amount: amt(o.giveQty) },
    ]);
    await ctx.tx.update(tables.playerOffer).set({ status: "cancelled", closedAt: new Date(ctx.nowMs) }).where(eq(tables.playerOffer.id, o.id));
    ctx.notify.push([[playerId], "base"], [null, "market"]);
    return { ok: true as const };
  });
}

/** Saisonende: offene Angebote verfallen, die Treuhand wird gegen season:<n> ausgebucht (wie Kredite und Lieferungen). */
export async function expireOffers(tx: Tx, seasonNumber: number, atMs: number): Promise<void> {
  const open = await tx.select().from(tables.playerOffer).where(eq(tables.playerOffer.status, "open")).for("update");
  if (open.length === 0) return;
  await tx.insert(tables.tradeLedger).values(open.flatMap((o) => [
    { tradeId: `po-${o.id}:expire`, tMs: atMs, account: `escrow:po-${o.id}`, asset: o.give, amount: amt(-o.giveQty) },
    { tradeId: `po-${o.id}:expire`, tMs: atMs, account: `season:${seasonNumber}`, asset: o.give, amount: amt(o.giveQty) },
  ]));
  await tx.update(tables.playerOffer).set({ status: "expired", closedAt: new Date(atMs) }).where(eq(tables.playerOffer.status, "open"));
}

/** Sichtbare offene Angebote (öffentlich oder aus der eigenen Allianz) und die eigenen der letzten Zeit. */
export async function offersView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const m = await membershipOf(engine.db, playerId);
  const visible = m
    ? or(eq(tables.playerOffer.visibility, "public"), eq(tables.playerOffer.allianceId, m.allianceId), eq(tables.playerOffer.sellerId, playerId))
    : or(eq(tables.playerOffer.visibility, "public"), eq(tables.playerOffer.sellerId, playerId));
  const rows = await engine.db
    .select({ o: tables.playerOffer, name: tables.player.name, col: tables.base.col, row: tables.base.row })
    .from(tables.playerOffer)
    .innerJoin(tables.player, eq(tables.player.id, tables.playerOffer.sellerId))
    .leftJoin(tables.base, eq(tables.base.playerId, tables.playerOffer.sellerId))
    .where(and(eq(tables.playerOffer.status, "open"), visible))
    .orderBy(desc(tables.playerOffer.createdAt))
    .limit(100);
  const mine = await engine.db
    .select()
    .from(tables.playerOffer)
    .where(and(eq(tables.playerOffer.sellerId, playerId), sql`${tables.playerOffer.status} <> 'open'`))
    .orderBy(desc(tables.playerOffer.closedAt))
    .limit(10);
  const own = await baseOfPlayer(engine.db, playerId);
  const tags = new Map(
    (await engine.db
      .select({ playerId: tables.allianceMember.playerId, tag: tables.alliance.tag })
      .from(tables.allianceMember)
      .innerJoin(tables.alliance, eq(tables.alliance.id, tables.allianceMember.allianceId))).map((r) => [r.playerId, r.tag]),
  );
  const shape = (o: typeof tables.playerOffer.$inferSelect) => ({
    id: o.id, give: o.give, giveQty: o.giveQty, want: o.want, wantQty: o.wantQty, visibility: o.visibility as "public" | "alliance",
    status: o.status, atMs: o.createdAt.getTime(), closedAtMs: o.closedAt?.getTime() ?? null,
  });
  return {
    serverNow: nowMs,
    fee: await playerTradeFee(engine.db),
    maxOpen: MAX_OPEN_OFFERS,
    assets: tradeAssets(),
    open: rows.map((r) => ({
      ...shape(r.o),
      seller: { id: r.o.sellerId, name: r.name, tag: tags.get(r.o.sellerId) ?? null },
      own: r.o.sellerId === playerId,
      travelMs: own && r.col !== null && r.row !== null && r.o.sellerId !== playerId ? travelMs({ col: r.col, row: r.row! }, own) : null,
    })),
    closed: mine.map(shape),
  };
}
