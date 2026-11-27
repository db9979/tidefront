// Quote and execution of instant trades. Pure: time comes in as nowMs.
import type {
  Delivery,
  MarketBalance,
  MarketState,
  PricePoint,
  Quote,
  QuoteResult,
  RejectionCode,
  ResourceId,
  ResourceMarketState,
  TradeContext,
  TradeRejection,
  TradeRequest,
  TradeResult,
  TradeSide,
  TraderState,
} from "./types.ts";
import {
  centsToCredits,
  creditsToCents,
  executionPrice,
  priceAfterTrade,
  priceImpact,
  revertToReference,
  tradeAmounts,
} from "./pricing.ts";
import { buildTradeLedger } from "./ledger.ts";
import { addToWindow, tradeWindow } from "./window.ts";
import { deliveryTravelMs } from "./delivery.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
function resourceIds(balance: MarketBalance): ResourceId[] {
  return Object.keys(balance.market.refPrice) as ResourceId[];
}

function isKnownResource(resource: unknown, balance: MarketBalance): resource is ResourceId {
  return typeof resource === "string" && Object.hasOwn(balance.market.refPrice, resource);
}

/** Fresh market: every resource at its reference price. */
export function createMarketState(balance: MarketBalance, nowMs: number): MarketState {
  const market = {} as MarketState;
  for (const resource of resourceIds(balance)) {
    const price = balance.market.refPrice[resource];
    market[resource] = {
      price,
      lastUpdateMs: nowMs,
      haltedUntilMs: 0,
      history: [{ tMs: nowMs, price }],
    };
  }
  return market;
}

/** Fresh trader with the given credits and stock and no trades so far (empty 24-hour window; `_nowMs` kept for callers). */
export function createTraderState(
  balance: MarketBalance,
  credits: number,
  stock: Partial<Record<ResourceId, number>>,
  _nowMs: number,
): TraderState {
  const fullStock = {} as Record<ResourceId, number>;
  for (const resource of resourceIds(balance)) fullStock[resource] = stock[resource] ?? 0;
  return {
    credits,
    stock: fullStock,
    tradeHours: [],
    recentTradeTimesMs: [],
  };
}

/**
 * Effective reference prices (Marktnachrichten, news.ts): optional per resource. Missing, non-finite or
 * non-positive values fall back to the base reference price of balance.json, so without them every
 * result is bit-identical to the plain market.
 */
export type RefPrices = Readonly<Partial<Record<ResourceId, number>>>;

/** Reference price the price reverts to: the effective one if given, else the base reference price. */
export function referencePrice(resource: ResourceId, balance: MarketBalance, refPrices?: RefPrices): number {
  const r = refPrices?.[resource];
  return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : balance.market.refPrice[resource];
}

/** Price of a resource at nowMs, after reversion to the (effective) reference price. */
export function currentPrice(
  state: ResourceMarketState,
  resource: ResourceId,
  balance: MarketBalance,
  nowMs: number,
  refPrices?: RefPrices,
): number {
  return revertToReference(
    state.price,
    referencePrice(resource, balance, refPrices),
    nowMs - state.lastUpdateMs,
    balance.market.reversionHalfLifeHours,
  );
}

/**
 * Price at a past moment, reconstructed from the history (last point at or
 * before atMs, reverted forward). Before the first point: the first point's
 * price. Empty history: null.
 */
export function priceAt(
  history: readonly PricePoint[],
  atMs: number,
  refPrice: number,
  halfLifeHours: number,
): number | null {
  if (history.length === 0) return null;
  let found: PricePoint | null = null;
  for (const point of history) {
    if (point.tMs <= atMs) found = point;
    else break;
  }
  if (found === null) return history[0].price;
  return revertToReference(found.price, refPrice, atMs - found.tMs, halfLifeHours);
}

/** Drops points that are no longer needed for the 24-hour band. */
function pruneHistory(history: readonly PricePoint[], nowMs: number): PricePoint[] {
  const cutoff = nowMs - MS_PER_DAY;
  let firstNeeded = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].tMs <= cutoff) firstNeeded = i;
    else break;
  }
  return history.slice(firstNeeded).map((point) => ({ tMs: point.tMs, price: point.price }));
}

function isValidQty(qty: unknown): qty is number {
  return typeof qty === "number" && Number.isSafeInteger(qty) && qty > 0;
}

function buildQuote(
  state: ResourceMarketState,
  side: TradeSide,
  resource: ResourceId,
  qty: number,
  balance: MarketBalance,
  nowMs: number,
  refPrices?: RefPrices,
): { quote: Quote; totalCents: number; baseCents: number; feeCents: number } {
  const priceBefore = currentPrice(state, resource, balance, nowMs, refPrices);
  const impact = priceImpact(qty, balance.market.depth[resource]);
  const priceAfter = priceAfterTrade(side, priceBefore, impact);
  const execPrice = executionPrice(priceBefore, priceAfter);
  const amounts = tradeAmounts(side, qty, execPrice, balance.market.fee);
  return {
    quote: {
      side,
      resource,
      qty,
      priceBefore,
      priceAfter,
      executionPrice: execPrice,
      impact,
      baseCredits: centsToCredits(amounts.baseCents),
      feeCredits: centsToCredits(amounts.feeCents),
      totalCredits: centsToCredits(amounts.totalCents),
    },
    ...amounts,
  };
}

/**
 * Offer for a trade without any state change and without the player-specific
 * checks. Rejects only malformed requests (`bad_qty`).
 */
export function quote(
  market: MarketState,
  request: { side: TradeSide; resource: ResourceId; qty: number },
  balance: MarketBalance,
  nowMs: number,
  refPrices?: RefPrices,
): QuoteResult {
  if (
    (request.side !== "buy" && request.side !== "sell") ||
    !isKnownResource(request.resource, balance) ||
    !isValidQty(request.qty)
  ) {
    return { ok: false, code: "bad_qty" };
  }
  const built = buildQuote(
    market[request.resource],
    request.side,
    request.resource,
    request.qty,
    balance,
    nowMs,
    refPrices,
  );
  return { ok: true, ...built.quote };
}

function relativeDeviation(value: number, base: number): number {
  return Math.abs(value - base) / base;
}

/**
 * Executes an instant buy or sell. Checks run in the order of REGELN.md:
 * locked, halted, bad_qty, impact, rate, daily_limit, under_attack,
 * credit_limit, funds, slippage, price_bounds, band.
 * Inputs are not mutated. With `refPrices` (Marktnachrichten) the price reverts to the effective reference
 * price; the hard price bounds stay relative to the base reference price (ENTSCHEIDUNGEN.md, section E).
 */
export function executeTrade(
  market: MarketState,
  trader: TraderState,
  request: TradeRequest,
  context: TradeContext,
  balance: MarketBalance,
  nowMs: number,
  refPrices?: RefPrices,
): TradeResult {
  const cfg = balance.market;
  const harbor = balance.buildings.hafenkommandantur;
  const reject = (code: RejectionCode, newMarket: MarketState = market): TradeRejection => ({
    ok: false,
    code,
    market: newMarket,
    trader,
  });

  // 1. locked
  if (!(context.harborLevel >= harbor.marketFromLevel)) return reject("locked");

  const { side, resource, qty } = request;
  const validRequest =
    (side === "buy" || side === "sell") && isKnownResource(resource, balance);

  // 2. halted (only decidable when the resource is known)
  if (validRequest && market[resource].haltedUntilMs > nowMs) return reject("halted");

  // 3. bad_qty (also: unknown side or resource, see ENTSCHEIDUNGEN.md)
  if (!validRequest || !isValidQty(qty)) return reject("bad_qty");

  const state = market[resource];
  const baseRef = cfg.refPrice[resource];
  const refPrice = referencePrice(resource, balance, refPrices);
  const built = buildQuote(state, side, resource, qty, balance, nowMs, refPrices);
  const q = built.quote;

  // 4. impact
  if (q.impact > cfg.maxImpactPerTrade) return reject("impact");

  // 5. rate
  const recent = trader.recentTradeTimesMs.filter(
    (tMs) => tMs > nowMs - MS_PER_MINUTE && tMs <= nowMs,
  );
  if (recent.length >= cfg.tradesPerMinute) return reject("rate");

  // 6. daily_limit: gleitendes 24-h-Fenster (window.ts), Kauf und Verkauf zusammen je Ressource; freier Rahmen
  //    abzüglich der für Lieferverträge der nächsten 24 h vorgemerkten Menge (v1.31).
  const window = tradeWindow(trader, nowMs);
  const tradedInWindow = window.reduce((sum, x) => sum + (x.q[resource] ?? 0), 0);
  const dailyLimit = cfg.dailyLimitShareOfStorage * context.storageCapacity[resource];
  const reserved = context.reservedQty !== undefined && context.reservedQty > 0 ? context.reservedQty : 0;
  if (!(tradedInWindow + reserved + qty <= dailyLimit)) return reject("daily_limit");

  // 7. under_attack
  if (side === "sell" && context.attackDetected) return reject("under_attack");

  // 8. credit_limit
  const creditsCents = creditsToCents(trader.credits);
  if (side === "sell") {
    const limitCents = creditsToCents(harbor.creditLimitPerLevel * context.harborLevel);
    if (creditsCents + built.totalCents > limitCents) return reject("credit_limit");
  }

  // 9. funds
  if (side === "buy") {
    if (built.totalCents > creditsCents) return reject("funds");
  } else if (qty > (trader.stock[resource] ?? 0)) {
    return reject("funds");
  }

  // 10. slippage
  const expected = request.expectedPrice;
  if (
    !(typeof expected === "number" && Number.isFinite(expected) && expected > 0) ||
    relativeDeviation(q.executionPrice, expected) > cfg.slippageTolerance
  ) {
    return reject("slippage");
  }

  // 11. price_bounds: relative to the base reference price, not the effective one (news cannot move them)
  if (q.priceAfter < cfg.floorFactor * baseRef || q.priceAfter > cfg.ceilFactor * baseRef) {
    return reject("price_bounds");
  }

  // 12. band: rejects and halts the market of this resource
  const halfLife = cfg.reversionHalfLifeHours;
  const hourAgo = priceAt(state.history, nowMs - MS_PER_HOUR, refPrice, halfLife) ?? q.priceBefore;
  const dayAgo = priceAt(state.history, nowMs - MS_PER_DAY, refPrice, halfLife) ?? q.priceBefore;
  if (
    relativeDeviation(q.priceAfter, hourAgo) > cfg.hourBand ||
    relativeDeviation(q.priceAfter, dayAgo) > cfg.dayBand
  ) {
    const halted: MarketState = {
      ...market,
      [resource]: {
        ...state,
        history: state.history.map((point) => ({ ...point })),
        haltedUntilMs: nowMs + cfg.haltMinutes * MS_PER_MINUTE,
      },
    };
    return reject("band", halted);
  }

  // --- Execution -----------------------------------------------------------
  const newMarket: MarketState = {
    ...market,
    [resource]: {
      price: q.priceAfter,
      lastUpdateMs: nowMs,
      haltedUntilMs: state.haltedUntilMs,
      history: [...pruneHistory(state.history, nowMs), { tMs: nowMs, price: q.priceAfter }],
    },
  };

  const newStock = { ...trader.stock };

  let newCreditsCents: number;
  let delivery: Delivery | null = null;
  if (side === "buy") {
    newCreditsCents = creditsCents - built.totalCents;
    delivery = {
      id: context.tradeId,
      playerId: context.playerId,
      resource,
      qty,
      departMs: nowMs,
      arriveMs: nowMs + deliveryTravelMs(cfg, context.distanceToPortKm), // feste Lieferzeit (delivery.ts)
    };
  } else {
    newCreditsCents = creditsCents + built.totalCents;
    newStock[resource] = trader.stock[resource] - qty;
  }

  const newTrader: TraderState = {
    credits: centsToCredits(newCreditsCents),
    stock: newStock,
    tradeHours: addToWindow(window, resource, qty, nowMs),
    recentTradeTimesMs: [...recent, nowMs],
  };

  const ledger = buildTradeLedger({
    tradeId: context.tradeId,
    tMs: nowMs,
    side,
    playerId: context.playerId,
    deliveryId: context.tradeId,
    resource,
    qty,
    baseCents: built.baseCents,
    feeCents: built.feeCents,
    totalCents: built.totalCents,
  });

  return { ok: true, market: newMarket, trader: newTrader, quote: q, delivery, ledger };
}
