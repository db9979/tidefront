import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMarketState,
  createTraderState,
  currentPrice,
  executeTrade,
  executionPrice,
  priceAfterTrade,
  quote,
  revertToReference,
  tradeAmounts,
  ceilToCents,
  floorToCents,
  verifyLedger,
  buildTradeLedger,
  freeAtMs,
  gameDayIndex,
  tradedInWindow,
  windowReleases,
} from "../src/market/index.ts";
import type {
  MarketBalance,
  MarketState,
  ResourceId,
  TradeContext,
  TradeResult,
  TradeSide,
  TraderState,
} from "../src/market/index.ts";

const balance: MarketBalance = JSON.parse(
  readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"),
);
const M = balance.market;
const HARBOR = balance.buildings.hafenkommandantur;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);
const RESOURCES: ResourceId[] = ["stahl", "treibstoff", "elektronik", "proviant"];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function makeContext(overrides: Partial<TradeContext> = {}): TradeContext {
  return {
    playerId: "p1",
    tradeId: "t1",
    harborLevel: HARBOR.marketFromLevel,
    storageCapacity: { stahl: 1e9, treibstoff: 1e9, elektronik: 1e9, proviant: 1e9 },
    attackDetected: false,
    distanceToPortKm: 90,
    ...overrides,
  };
}

function makeTrader(credits = 10_000, stockEach = 10_000, nowMs = T0): TraderState {
  return createTraderState(
    balance,
    credits,
    { stahl: stockEach, treibstoff: stockEach, elektronik: stockEach, proviant: stockEach },
    nowMs,
  );
}

/** Executes a trade with the expected price taken from a fresh quote. */
function trade(
  market: MarketState,
  trader: TraderState,
  side: TradeSide,
  resource: ResourceId,
  qty: number,
  nowMs: number,
  context: TradeContext = makeContext(),
): TradeResult {
  const q = quote(market, { side, resource, qty }, balance, nowMs);
  const expectedPrice = q.ok ? q.executionPrice : 1;
  return executeTrade(market, trader, { side, resource, qty, expectedPrice }, context, balance, nowMs);
}

function expectReject(result: TradeResult, code: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

function expectOk(result: TradeResult): asserts result is Extract<TradeResult, { ok: true }> {
  if (!result.ok) assert.fail(`trade rejected with ${result.code}`);
}

/** Largest quantity whose impact does not exceed maxImpactPerTrade. */
function maxQty(resource: ResourceId): number {
  return Math.floor(M.maxImpactPerTrade * M.depth[resource]);
}

// --- Rejection codes -------------------------------------------------------

test("locked: market below marketFromLevel", () => {
  const market = createMarketState(balance, T0);
  const ctx = makeContext({ harborLevel: HARBOR.marketFromLevel - 1 });
  expectReject(trade(market, makeTrader(), "buy", "stahl", 10, T0, ctx), "locked");
  expectOk(trade(market, makeTrader(), "buy", "stahl", 10, T0, makeContext()));
});

test("halted: no trade while haltedUntilMs lies in the future", () => {
  const base = createMarketState(balance, T0);
  const market: MarketState = { ...base, stahl: { ...base.stahl, haltedUntilMs: T0 + 1 } };
  expectReject(trade(market, makeTrader(), "buy", "stahl", 10, T0), "halted");
  // other resources are not affected
  expectOk(trade(market, makeTrader(), "buy", "proviant", 10, T0));
});

test("bad_qty: zero, negative, fractional, NaN, non-number", () => {
  const market = createMarketState(balance, T0);
  for (const qty of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10" as unknown as number]) {
    const result = executeTrade(
      market,
      makeTrader(),
      { side: "buy", resource: "stahl", qty, expectedPrice: 1 },
      makeContext(),
      balance,
      T0,
    );
    expectReject(result, "bad_qty");
  }
  assert.deepEqual(quote(market, { side: "sell", resource: "stahl", qty: 0 }, balance, T0), {
    ok: false,
    code: "bad_qty",
  });
});

test("impact: quantity above maxImpactPerTrade * depth", () => {
  const market = createMarketState(balance, T0);
  const trader = makeTrader(1e9, 1e9);
  expectReject(trade(market, trader, "buy", "stahl", maxQty("stahl") + 1, T0), "impact");
  expectReject(trade(market, trader, "sell", "stahl", maxQty("stahl") + 1, T0), "impact");
  expectOk(trade(market, trader, "buy", "stahl", maxQty("stahl"), T0));
});

test("rate: more than tradesPerMinute trades within a minute", () => {
  let market = createMarketState(balance, T0);
  let trader = makeTrader();
  for (let n = 0; n < M.tradesPerMinute; n++) {
    const result = trade(market, trader, "buy", "stahl", 1, T0 + n * 1000);
    expectOk(result);
    market = result.market;
    trader = result.trader;
  }
  const lastMs = T0 + (M.tradesPerMinute - 1) * 1000;
  expectReject(trade(market, trader, "buy", "stahl", 1, lastMs), "rate");
  // sells count as well
  expectReject(trade(market, trader, "sell", "proviant", 1, lastMs + 1), "rate");
  // one minute after the first trade a slot is free again
  expectReject(trade(market, trader, "buy", "stahl", 1, T0 + MINUTE - 1), "rate");
  const later = trade(market, trader, "buy", "stahl", 1, T0 + MINUTE);
  expectOk(later);
  assert.ok(later.trader.recentTradeTimesMs.length <= M.tradesPerMinute);
});

test("daily_limit: buys plus sells per resource within a sliding 24-hour window (hourly slots), across midnight", () => {
  const prevTz = process.env.TZ;
  process.env.TZ = "Europe/Berlin"; // Januar: Mitternacht Berlin = 23:00 UTC – das Fenster kennt keine Mitternacht mehr
  const capacity = 5000;
  const limit = M.dailyLimitShareOfStorage * capacity;
  const first = Math.floor(limit * 0.6);
  const ctx = makeContext({
    storageCapacity: { stahl: capacity, treibstoff: capacity, elektronik: capacity, proviant: capacity },
  });
  const beforeMidnight = Date.UTC(2026, 0, 15, 22, 40, 0); // 23:40 Spielzeit
  const market0 = createMarketState(balance, beforeMidnight);
  const r1 = trade(market0, makeTrader(10_000, 10_000, beforeMidnight), "buy", "stahl", first, beforeMidnight, ctx);
  expectOk(r1);
  assert.deepEqual(r1.trader.tradeHours, [{ h: Math.floor(beforeMidnight / HOUR), q: { stahl: first } }]);
  assert.equal(r1.trader.dailyVolume, undefined, "kein Kalendertag-Zähler mehr");
  // buys and sells share the limit
  expectReject(trade(r1.market, r1.trader, "sell", "stahl", first, beforeMidnight + 1000, ctx), "daily_limit");
  expectReject(trade(r1.market, r1.trader, "buy", "stahl", first, beforeMidnight + 1000, ctx), "daily_limit");
  // exactly up to the limit is fine
  expectOk(trade(r1.market, r1.trader, "buy", "stahl", limit - first, beforeMidnight + 1000, ctx));
  // the limit is per resource
  expectOk(trade(r1.market, r1.trader, "buy", "proviant", first, beforeMidnight + 1000, ctx));
  // midnight (game time) no longer resets the limit
  const afterMidnight = Date.UTC(2026, 0, 15, 23, 0, 1);
  expectReject(trade(r1.market, r1.trader, "buy", "stahl", first, afterMidnight, ctx), "daily_limit");
  const r2 = trade(r1.market, r1.trader, "sell", "stahl", limit - first, afterMidnight, ctx);
  expectOk(r2);
  assert.equal(tradedInWindow(r2.trader, "stahl", afterMidnight), limit);
  // the slot of 22:xx UTC is free from 22:00 UTC the next day (start of its hour + 24 h); the later one stays
  const releases = windowReleases(r2.trader, "stahl", afterMidnight);
  assert.deepEqual(releases, [
    { atMs: Date.UTC(2026, 0, 16, 22, 0, 0), qty: first },
    { atMs: Date.UTC(2026, 0, 16, 23, 0, 0), qty: limit - first },
  ]);
  assert.equal(freeAtMs(releases, limit, limit, first, afterMidnight), Date.UTC(2026, 0, 16, 22, 0, 0));
  assert.equal(freeAtMs(releases, limit, limit, limit, afterMidnight), Date.UTC(2026, 0, 16, 23, 0, 0));
  assert.equal(freeAtMs(releases, limit, limit, limit + 1, afterMidnight), null);
  expectReject(trade(r2.market, r2.trader, "buy", "stahl", 1, Date.UTC(2026, 0, 16, 21, 59, 59), ctx), "daily_limit");
  const r3 = trade(r2.market, r2.trader, "buy", "stahl", first, Date.UTC(2026, 0, 16, 22, 0, 0), ctx);
  expectOk(r3);
  assert.equal(r3.trader.tradeHours!.length, 2, "abgelaufenes Fach fällt weg");
  if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
});

test("daily_limit: old trader states (calendar day) are carried over and free at the next game-time midnight", () => {
  const prevTz = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  const capacity = 5000;
  const limit = M.dailyLimitShareOfStorage * capacity;
  const ctx = makeContext({ storageCapacity: { stahl: capacity, treibstoff: capacity, elektronik: capacity, proviant: capacity } });
  const now = Date.UTC(2026, 0, 15, 15, 30, 0); // 16:30 Spielzeit am 15.1.
  const { tradeHours: _h, ...fresh } = makeTrader(10_000, 10_000, now);
  const old: TraderState = { ...fresh, dailyDayIndex: gameDayIndex(now), dailyVolume: { stahl: limit, treibstoff: 0, elektronik: 0, proviant: 0 } };
  assert.equal(tradedInWindow(old, "stahl", now), limit);
  expectReject(trade(createMarketState(balance, now), old, "buy", "stahl", 1, now, ctx), "daily_limit");
  // free at midnight Berlin (23:00 UTC), as before
  assert.deepEqual(windowReleases(old, "stahl", now), [{ atMs: Date.UTC(2026, 0, 15, 23, 0, 0), qty: limit }]);
  expectOk(trade(createMarketState(balance, now), old, "buy", "stahl", 1, Date.UTC(2026, 0, 15, 23, 0, 0), ctx));
  // an older day does not count at all
  const stale: TraderState = { ...old, dailyDayIndex: gameDayIndex(now) - 1 };
  assert.equal(tradedInWindow(stale, "stahl", now), 0);
  if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
});

test("under_attack: sells are blocked while an attack is detected, buys stay possible", () => {
  const market = createMarketState(balance, T0);
  const ctx = makeContext({ attackDetected: true });
  expectReject(trade(market, makeTrader(), "sell", "stahl", 100, T0, ctx), "under_attack");
  expectOk(trade(market, makeTrader(), "buy", "stahl", 100, T0, ctx));
  expectOk(trade(market, makeTrader(), "sell", "stahl", 100, T0, makeContext()));
});

test("credit_limit: a sell may not lift credits above creditLimitPerLevel * level", () => {
  const market = createMarketState(balance, T0);
  const level = HARBOR.marketFromLevel;
  const limit = HARBOR.creditLimitPerLevel * level;
  const q = quote(market, { side: "sell", resource: "stahl", qty: 100 }, balance, T0);
  assert.ok(q.ok);
  // one cent too much
  const tooRich = makeTrader(limit - q.totalCredits + 0.01);
  expectReject(trade(market, tooRich, "sell", "stahl", 100, T0), "credit_limit");
  // exactly reaching the limit is allowed
  const exact = trade(market, makeTrader(limit - q.totalCredits), "sell", "stahl", 100, T0);
  expectOk(exact);
  assert.equal(exact.trader.credits, limit);
  // a higher harbor level raises the limit
  expectOk(trade(market, tooRich, "sell", "stahl", 100, T0, makeContext({ harborLevel: level + 1 })));
  // buys are not restricted by the credit limit
  expectOk(trade(market, makeTrader(limit * 2), "buy", "stahl", 100, T0));
});

test("funds: not enough credits for a buy, not enough stock for a sell", () => {
  const market = createMarketState(balance, T0);
  const q = quote(market, { side: "buy", resource: "elektronik", qty: 100 }, balance, T0);
  assert.ok(q.ok);
  expectReject(trade(market, makeTrader(q.totalCredits - 0.01), "buy", "elektronik", 100, T0), "funds");
  const exact = trade(market, makeTrader(q.totalCredits), "buy", "elektronik", 100, T0);
  expectOk(exact);
  assert.equal(exact.trader.credits, 0);
  expectReject(trade(market, makeTrader(100, 99), "sell", "elektronik", 100, T0), "funds");
  const all = trade(market, makeTrader(100, 100), "sell", "elektronik", 100, T0);
  expectOk(all);
  assert.equal(all.trader.stock.elektronik, 0);
});

test("slippage: expected price deviates by more than slippageTolerance", () => {
  const market = createMarketState(balance, T0);
  const q = quote(market, { side: "buy", resource: "treibstoff", qty: 500 }, balance, T0);
  assert.ok(q.ok);
  const run = (expectedPrice: number) =>
    executeTrade(
      market,
      makeTrader(),
      { side: "buy", resource: "treibstoff", qty: 500, expectedPrice },
      makeContext(),
      balance,
      T0,
    );
  const tol = M.slippageTolerance;
  expectReject(run(q.executionPrice / (1 + tol * 1.1)), "slippage");
  expectReject(run(q.executionPrice / (1 - tol * 1.1)), "slippage");
  expectReject(run(Number.NaN), "slippage");
  expectReject(run(0), "slippage");
  expectOk(run(q.executionPrice / (1 + tol * 0.9)));
  expectOk(run(q.executionPrice / (1 - tol * 0.9)));
  expectOk(run(q.executionPrice));
});

test("price_bounds: new price outside [floorFactor, ceilFactor] * ref", () => {
  const ref = M.refPrice.stahl;
  const qty = maxQty("stahl");
  const impact = qty / M.depth.stahl;
  // empty history: the bands refer to the current price, so only the bounds matter
  const at = (price: number): MarketState => ({
    ...createMarketState(balance, T0),
    stahl: { price, lastUpdateMs: T0, haltedUntilMs: 0, history: [] },
  });
  const trader = makeTrader(1e9, 1e9);
  const ctx = makeContext({ harborLevel: 1_000_000 });

  const nearCeil = at((M.ceilFactor * ref) / (1 + impact / 2));
  expectReject(trade(nearCeil, trader, "buy", "stahl", qty, T0, ctx), "price_bounds");
  expectOk(trade(nearCeil, trader, "sell", "stahl", qty, T0, ctx));

  const nearFloor = at(M.floorFactor * ref * (1 + impact / 2));
  expectReject(trade(nearFloor, trader, "sell", "stahl", qty, T0, ctx), "price_bounds");
  expectOk(trade(nearFloor, trader, "buy", "stahl", qty, T0, ctx));
});

test("band (hour): rejection halts the market, 'halted' during the pause, trading afterwards", () => {
  let market = createMarketState(balance, T0);
  let trader = makeTrader(1e7, 1e6);
  const ctx = makeContext({ harborLevel: 1_000_000 });
  const qty = maxQty("stahl");
  const impact = qty / M.depth.stahl;
  let price = M.refPrice.stahl;
  let now = T0;
  let rejected: TradeResult | null = null;
  // buy the price up until the next buy would leave the hour band
  for (let n = 0; n < 100 && rejected === null; n++) {
    now = T0 + n * (MINUTE / M.tradesPerMinute + 1); // stay below the per-minute limit
    const result = trade(market, trader, "buy", "stahl", qty, now, ctx);
    if (result.ok) {
      market = result.market;
      trader = result.trader;
      price = result.quote.priceAfter;
    } else {
      rejected = result;
    }
  }
  assert.ok(rejected !== null && !rejected.ok);
  assert.equal(rejected.code, "band");
  assert.ok(now - T0 < HOUR, "all trades happened within one hour");
  // the price stayed inside the band, the rejected trade would have left it
  assert.ok(price <= M.refPrice.stahl * (1 + M.hourBand));
  assert.ok(price * (1 + impact) > M.refPrice.stahl * (1 + M.hourBand) * 0.999);
  // the returned market is halted, price and trader are untouched
  const haltedUntil = now + M.haltMinutes * MINUTE;
  assert.equal(rejected.market.stahl.haltedUntilMs, haltedUntil);
  assert.equal(rejected.market.stahl.price, market.stahl.price);
  assert.equal(rejected.market.proviant.haltedUntilMs, 0);
  assert.equal(market.stahl.haltedUntilMs, 0, "input market not mutated");
  assert.deepEqual(rejected.trader, trader);

  const halted = rejected.market;
  // during the pause every trade in this resource is 'halted', even harmless sells
  expectReject(trade(halted, trader, "sell", "stahl", 10, now + 1, ctx), "halted");
  expectReject(trade(halted, trader, "buy", "stahl", 1, haltedUntil - 1, ctx), "halted");
  // other resources keep trading
  expectOk(trade(halted, trader, "buy", "proviant", 10, now + 1, ctx));
  // after the pause trading resumes
  const after = trade(halted, trader, "sell", "stahl", 10, haltedUntil, ctx);
  expectOk(after);
  const afterBuy = trade(halted, trader, "buy", "stahl", 1, haltedUntil, ctx);
  expectOk(afterBuy);
});

test("band (day): deviation from the price 24 hours ago halts the market", () => {
  const ref = M.refPrice.stahl;
  // 25 h ago at ref; 2 h ago someone left the price well above the day band
  const high = ref * (1 + M.dayBand + 0.05);
  const market: MarketState = {
    ...createMarketState(balance, T0),
    stahl: {
      price: high,
      lastUpdateMs: T0 - 2 * HOUR,
      haltedUntilMs: 0,
      history: [
        { tMs: T0 - 25 * HOUR, price: ref },
        { tMs: T0 - 2 * HOUR, price: high },
      ],
    },
  };
  const now = currentPrice(market.stahl, "stahl", balance, T0);
  const hourAgo = currentPrice(market.stahl, "stahl", balance, T0 - HOUR);
  const qty = maxQty("stahl") / 2;
  const next = now * (1 + qty / M.depth.stahl);
  // preconditions: only the day band is violated
  assert.ok(Math.abs(next - hourAgo) / hourAgo <= M.hourBand);
  assert.ok(Math.abs(next - ref) / ref > M.dayBand);
  assert.ok(next < M.ceilFactor * ref);

  const trader = makeTrader(1e7, 1e6);
  const ctx = makeContext({ harborLevel: 1_000_000 });
  const result = trade(market, trader, "buy", "stahl", qty, T0, ctx);
  expectReject(result, "band");
  assert.equal(result.market.stahl.haltedUntilMs, T0 + M.haltMinutes * MINUTE);
  expectReject(trade(result.market, trader, "buy", "stahl", 1, T0 + MINUTE, ctx), "halted");
  // a day later the price has reverted far enough and the old history has aged out
  expectOk(trade(result.market, trader, "buy", "stahl", qty, T0 + 30 * HOUR, ctx));
});

// --- Order of checks -------------------------------------------------------

test("order of checks: the earliest matching reason wins", () => {
  const base = createMarketState(balance, T0);
  const haltedMarket: MarketState = { ...base, stahl: { ...base.stahl, haltedUntilMs: T0 + HOUR } };
  const poor = makeTrader(0, 0);
  const run = (
    market: MarketState,
    trader: TraderState,
    side: TradeSide,
    qty: number,
    ctx: TradeContext,
    expectedPrice = 1e-9,
  ) => executeTrade(market, trader, { side, resource: "stahl", qty, expectedPrice }, ctx, balance, T0);

  // Example 1: locked + halted + bad_qty apply at once
  const lockedCtx = makeContext({ harborLevel: 0, attackDetected: true });
  expectReject(run(haltedMarket, poor, "sell", -1, lockedCtx), "locked");
  // Example 2: halted + bad_qty + under_attack + funds + slippage
  const attackedCtx = makeContext({ attackDetected: true });
  expectReject(run(haltedMarket, poor, "sell", -1, attackedCtx), "halted");
  // bad_qty before everything that follows
  expectReject(run(base, poor, "sell", 0.5, attackedCtx), "bad_qty");

  // Example 3: impact + rate + daily_limit + under_attack + funds + slippage
  const busy: TraderState = {
    ...poor,
    recentTradeTimesMs: Array.from({ length: M.tradesPerMinute }, () => T0),
  };
  const tinyStorage = makeContext({
    attackDetected: true,
    storageCapacity: { stahl: 1, treibstoff: 1, elektronik: 1, proviant: 1 },
  });
  const huge = maxQty("stahl") + 1;
  expectReject(run(base, busy, "sell", huge, tinyStorage), "impact");
  // without the impact problem: rate, then daily_limit, then under_attack
  expectReject(run(base, busy, "sell", 10, tinyStorage), "rate");
  expectReject(run(base, poor, "sell", 10, tinyStorage), "daily_limit");
  expectReject(run(base, poor, "sell", 10, attackedCtx), "under_attack");

  // Example 4: credit_limit + funds + slippage -> credit_limit
  const limit = HARBOR.creditLimitPerLevel * HARBOR.marketFromLevel;
  const richNoStock = makeTrader(limit, 0);
  expectReject(run(base, richNoStock, "sell", 10, makeContext()), "credit_limit");
  // funds + slippage -> funds
  expectReject(run(base, poor, "sell", 10, makeContext()), "funds");
  expectReject(run(base, poor, "buy", 10, makeContext()), "funds");

  // slippage + price_bounds + band -> slippage; price_bounds + band -> price_bounds
  const ref = M.refPrice.stahl;
  const top: MarketState = {
    ...base,
    stahl: {
      price: M.ceilFactor * ref,
      lastUpdateMs: T0,
      haltedUntilMs: 0,
      history: [{ tMs: T0 - 2 * HOUR, price: ref }],
    },
  };
  const whale = makeTrader(1e9, 1e9);
  expectReject(run(top, whale, "buy", 100, makeContext()), "slippage");
  const q = quote(top, { side: "buy", resource: "stahl", qty: 100 }, balance, T0);
  assert.ok(q.ok);
  const bounds = run(top, whale, "buy", 100, makeContext(), q.executionPrice);
  expectReject(bounds, "price_bounds");
  assert.equal(bounds.market.stahl.haltedUntilMs, 0, "only 'band' halts the market");
});

// --- Pricing ---------------------------------------------------------------

test("buy raises the price, sell lowers it; execution price lies between old and new", () => {
  const market = createMarketState(balance, T0);
  for (const resource of RESOURCES) {
    const qty = maxQty(resource);
    const i = qty / M.depth[resource];
    const p = M.refPrice[resource];

    const buy = trade(market, makeTrader(1e7), "buy", resource, qty, T0);
    expectOk(buy);
    assert.equal(buy.quote.priceBefore, p);
    assert.ok(Math.abs(buy.quote.priceAfter - p * (1 + i)) < 1e-12);
    assert.equal(buy.market[resource].price, buy.quote.priceAfter);
    assert.ok(buy.market[resource].price > p);
    assert.ok(buy.quote.executionPrice > p && buy.quote.executionPrice < buy.quote.priceAfter);
    assert.ok(Math.abs(buy.quote.executionPrice - (p + p * (1 + i)) / 2) < 1e-12);

    const sell = trade(market, makeTrader(0, 1e6), "sell", resource, qty, T0);
    expectOk(sell);
    assert.ok(Math.abs(sell.quote.priceAfter - p / (1 + i)) < 1e-12);
    assert.ok(sell.market[resource].price < p);
    assert.ok(sell.quote.executionPrice < p && sell.quote.executionPrice > sell.quote.priceAfter);
    assert.ok(Math.abs(sell.quote.executionPrice - (p + p / (1 + i)) / 2) < 1e-12);

    // untouched resources keep their state
    for (const other of RESOURCES) {
      if (other !== resource) assert.deepEqual(buy.market[other], market[other]);
    }
  }
  assert.equal(priceAfterTrade("buy", 2, 0.5), 3);
  assert.equal(priceAfterTrade("sell", 3, 0.5), 2);
  assert.equal(executionPrice(2, 3), 2.5);
});

test("fee: buy costs q*exec*(1+fee), sell yields q*exec*(1-fee)", () => {
  const market = createMarketState(balance, T0);
  // 1000 Stahl at ref 1.0, depth 200000: exec = 1.0025 -> exact amounts
  const buy = trade(market, makeTrader(10_000, 0), "buy", "stahl", 1000, T0);
  expectOk(buy);
  const exec = M.refPrice.stahl * (1 + 1000 / M.depth.stahl / 2);
  const cost = 1000 * exec * (1 + M.fee);
  assert.ok(Math.abs(buy.quote.totalCredits - cost) < 0.01 + 1e-9);
  assert.ok(Math.abs(buy.quote.baseCredits - 1000 * exec) <= 0.005 + 1e-9);
  assert.ok(Math.abs(buy.quote.feeCredits - 1000 * exec * M.fee) < 0.015);
  assert.equal(Math.round((buy.quote.baseCredits + buy.quote.feeCredits) * 100), Math.round(buy.quote.totalCredits * 100));
  assert.equal(Math.round(buy.trader.credits * 100), Math.round((10_000 - buy.quote.totalCredits) * 100));

  const sell = trade(market, makeTrader(0, 1000), "sell", "stahl", 1000, T0);
  expectOk(sell);
  const sellExec = (M.refPrice.stahl * (1 + 1 / (1 + 1000 / M.depth.stahl))) / 2;
  const proceeds = 1000 * sellExec * (1 - M.fee);
  assert.ok(Math.abs(sell.quote.totalCredits - proceeds) < 0.01 + 1e-9);
  assert.ok(Math.abs(sell.quote.feeCredits - 1000 * sellExec * M.fee) < 0.015);
  assert.equal(Math.round((sell.quote.baseCredits - sell.quote.feeCredits) * 100), Math.round(sell.quote.totalCredits * 100));
  assert.equal(sell.trader.credits, sell.quote.totalCredits);
  assert.equal(sell.trader.stock.stahl, 0);

  // quote() and executeTrade() agree
  const q = quote(market, { side: "buy", resource: "stahl", qty: 1000 }, balance, T0);
  assert.ok(q.ok);
  const { ok: _ok, ...plain } = q;
  assert.deepEqual(plain, buy.quote);
});

test("rounding is never in the player's favour and always on whole cents", () => {
  const market = createMarketState(balance, T0);
  for (const resource of RESOURCES) {
    for (const qty of [1, 2, 3, 7, 13, 99, 101, 333, 777, 1001, maxQty(resource)]) {
      const p = M.refPrice[resource];
      const i = qty / M.depth[resource];
      const buy = quote(market, { side: "buy", resource, qty }, balance, T0);
      const sell = quote(market, { side: "sell", resource, qty }, balance, T0);
      assert.ok(buy.ok && sell.ok);
      const exactCost = qty * ((p + p * (1 + i)) / 2) * (1 + M.fee);
      const exactProceeds = qty * ((p + p / (1 + i)) / 2) * (1 - M.fee);
      assert.ok(buy.totalCredits >= exactCost - 1e-8, `${resource} buy ${qty}`);
      assert.ok(buy.totalCredits < exactCost + 0.01 + 1e-8);
      assert.ok(sell.totalCredits <= exactProceeds + 1e-8, `${resource} sell ${qty}`);
      assert.ok(sell.totalCredits > exactProceeds - 0.01 - 1e-8);
      for (const amount of [buy.totalCredits, buy.feeCredits, buy.baseCredits, sell.totalCredits, sell.feeCredits, sell.baseCredits]) {
        assert.ok(Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6);
        assert.ok(amount >= 0);
      }
    }
  }
  // helpers: up for payments, down for proceeds, no extra cent from float noise
  assert.equal(ceilToCents(1.001), 101);
  assert.equal(floorToCents(1.009), 100);
  assert.equal(ceilToCents(100 * 1.04), 10400);
  assert.equal(floorToCents(0.1 + 0.2), 30);
  assert.deepEqual(tradeAmounts("buy", 1, 0.6, 0.04), { baseCents: 60, feeCents: 3, totalCents: 63 });
  assert.deepEqual(tradeAmounts("sell", 1, 0.6, 0.04), { baseCents: 60, feeCents: 3, totalCents: 57 });
});

test("reversion: after one half-life half of the distance to the reference is left", () => {
  const halfLifeMs = M.reversionHalfLifeHours * HOUR;
  assert.ok(Math.abs(revertToReference(2, 1, halfLifeMs, M.reversionHalfLifeHours) - 1.5) < 1e-12);
  assert.ok(Math.abs(revertToReference(0.5, 1, halfLifeMs, M.reversionHalfLifeHours) - 0.75) < 1e-12);
  assert.ok(Math.abs(revertToReference(2, 1, 2 * halfLifeMs, M.reversionHalfLifeHours) - 1.25) < 1e-12);
  assert.equal(revertToReference(2, 1, 0, M.reversionHalfLifeHours), 2);
  assert.equal(revertToReference(2, 1, -5000, M.reversionHalfLifeHours), 2);

  // applied before every trade
  const bought = trade(createMarketState(balance, T0), makeTrader(1e6), "buy", "treibstoff", maxQty("treibstoff"), T0);
  expectOk(bought);
  const ref = M.refPrice.treibstoff;
  const distance = bought.market.treibstoff.price - ref;
  assert.ok(distance > 0);
  const q = quote(bought.market, { side: "buy", resource: "treibstoff", qty: 1 }, balance, T0 + halfLifeMs);
  assert.ok(q.ok);
  assert.ok(Math.abs(q.priceBefore - (ref + distance / 2)) < 1e-12);
  const next = trade(bought.market, makeTrader(), "sell", "treibstoff", 1, T0 + halfLifeMs);
  expectOk(next);
  assert.ok(Math.abs(next.quote.priceBefore - (ref + distance / 2)) < 1e-12);
  assert.equal(next.market.treibstoff.lastUpdateMs, T0 + halfLifeMs);
});

// --- Delivery, ledger, purity ----------------------------------------------

test("bought goods arrive as a delivery, not in stock; sold goods leave at once", () => {
  const market = createMarketState(balance, T0);
  const trader = makeTrader(5000, 300);
  const ctx = makeContext({ distanceToPortKm: 90, tradeId: "trade-42", playerId: "anna" });
  const buy = trade(market, trader, "buy", "elektronik", 200, T0, ctx);
  expectOk(buy);
  assert.equal(buy.trader.stock.elektronik, 300, "stock unchanged by a buy");
  assert.ok(buy.trader.credits < 5000);
  assert.deepEqual(buy.delivery, {
    id: "trade-42",
    playerId: "anna",
    resource: "elektronik",
    qty: 200,
    departMs: T0,
    arriveMs: T0 + (M.deliveryHours ? M.deliveryHours * HOUR : Math.ceil((90 / M.convoySpeedKmh) * HOUR)),
  });
  assert.ok(buy.delivery !== null && buy.delivery.arriveMs > T0);

  const sell = trade(market, trader, "sell", "elektronik", 200, T0, ctx);
  expectOk(sell);
  assert.equal(sell.delivery, null);
  assert.equal(sell.trader.stock.elektronik, 100);
  assert.ok(sell.trader.credits > 5000);

  const atPort = trade(market, trader, "buy", "elektronik", 1, T0, makeContext({ distanceToPortKm: 0 }));
  expectOk(atPort);
  assert.equal(atPort.delivery?.arriveMs, T0 + (M.deliveryHours ? M.deliveryHours * HOUR : 0)); // feste Lieferzeit: auch am Hafen
});

test("ledger: every successful trade sums to zero per currency and resource", () => {
  let market = createMarketState(balance, T0);
  let trader = makeTrader(50_000, 5000);
  const steps: Array<[TradeSide, ResourceId, number]> = [
    ["buy", "stahl", 1],
    ["buy", "stahl", 777],
    ["sell", "stahl", 333],
    ["buy", "treibstoff", 1234],
    ["sell", "elektronik", 7],
    ["sell", "proviant", 2999],
    ["buy", "proviant", 13],
  ];
  steps.forEach(([side, resource, qty], n) => {
    const ctx = makeContext({ tradeId: `t${n}`, playerId: "p7", harborLevel: 20 });
    const result = trade(market, trader, side, resource, qty, T0 + n * 7000, ctx);
    expectOk(result);
    const check = verifyLedger(result.ledger);
    assert.equal(check.ok, true, JSON.stringify(check.sums));
    assert.equal(check.sums.credits, 0);
    assert.equal(check.sums[resource], 0);
    // the ledger says the same as the state change
    const playerLines = result.ledger.filter((line) => line.account === "player:p7");
    const creditDelta = playerLines.filter((l) => l.asset === "credits").reduce((s, l) => s + l.amount, 0);
    assert.equal(Math.round(creditDelta * 100), Math.round((result.trader.credits - trader.credits) * 100));
    const fees = result.ledger.filter((l) => l.account === "fees");
    assert.equal(fees.length, 1);
    assert.equal(fees[0].amount, result.quote.feeCredits);
    if (side === "buy") {
      assert.deepEqual(
        result.ledger.filter((l) => l.account === `delivery:t${n}`).map((l) => [l.asset, l.amount]),
        [[resource, qty]],
      );
      assert.equal(playerLines.filter((l) => l.asset === resource).length, 0);
    } else {
      assert.deepEqual(playerLines.filter((l) => l.asset === resource).map((l) => l.amount), [-qty]);
    }
    for (const line of result.ledger) {
      assert.equal(line.tradeId, `t${n}`);
      assert.equal(line.tMs, T0 + n * 7000);
    }
    market = result.market;
    trader = result.trader;
  });
});

test("verifyLedger detects unbalanced entries", () => {
  const lines = buildTradeLedger({
    tradeId: "x",
    tMs: T0,
    side: "buy",
    playerId: "p",
    deliveryId: "x",
    resource: "stahl",
    qty: 10,
    baseCents: 1000,
    feeCents: 40,
    totalCents: 1040,
  });
  assert.equal(verifyLedger(lines).ok, true);
  assert.equal(verifyLedger([]).ok, true);
  const missingFee = lines.filter((line) => line.account !== "fees");
  const bad = verifyLedger(missingFee);
  assert.equal(bad.ok, false);
  assert.equal(bad.sums.credits, -0.4);
  assert.equal(bad.sums.stahl, 0);
  const wrongQty = lines.map((line) => (line.account === "delivery:x" ? { ...line, amount: 9 } : line));
  assert.equal(verifyLedger(wrongQty).ok, false);
});

test("inputs stay unchanged (deep-frozen inputs, successful and rejected trades)", () => {
  const frozenBalance = deepFreeze(structuredClone(balance));
  const market = deepFreeze(createMarketState(balance, T0));
  const trader = deepFreeze(makeTrader(5000, 5000));
  const ctx = deepFreeze(makeContext());
  const marketCopy = structuredClone(market);
  const traderCopy = structuredClone(trader);

  const requests = [
    deepFreeze({ side: "buy" as const, resource: "stahl" as const, qty: 500, expectedPrice: 1.00125 }),
    deepFreeze({ side: "sell" as const, resource: "proviant" as const, qty: 500, expectedPrice: 0.599 }),
    deepFreeze({ side: "sell" as const, resource: "stahl" as const, qty: -1, expectedPrice: 1 }),
    deepFreeze({ side: "buy" as const, resource: "stahl" as const, qty: 500, expectedPrice: 5 }),
  ];
  const results = requests.map((request) => executeTrade(market, trader, request, ctx, frozenBalance, T0 + 5000));
  assert.deepEqual(results.map((r) => (r.ok ? "ok" : r.code)), ["ok", "ok", "bad_qty", "slippage"]);
  quote(market, { side: "buy", resource: "stahl", qty: 5 }, frozenBalance, T0 + 5000);
  assert.deepEqual(market, marketCopy);
  assert.deepEqual(trader, traderCopy);

  // successful trades return new objects
  const ok = results[0];
  expectOk(ok);
  assert.notEqual(ok.market, market);
  assert.notEqual(ok.market.stahl, market.stahl);
  assert.notEqual(ok.market.stahl.history, market.stahl.history);
  assert.notEqual(ok.trader, trader);
  assert.notEqual(ok.trader.stock, trader.stock);

  // a band rejection must not mutate either
  const tight = deepFreeze({
    ...structuredClone(marketCopy),
    stahl: {
      price: M.refPrice.stahl * (1 + M.hourBand),
      lastUpdateMs: T0,
      haltedUntilMs: 0,
      history: [{ tMs: T0 - 2 * HOUR, price: M.refPrice.stahl }],
    },
  });
  const band = trade(tight, trader, "buy", "stahl", 500, T0, ctx);
  expectReject(band, "band");
  assert.equal(tight.stahl.haltedUntilMs, 0);
  assert.notEqual(band.market.stahl.history, tight.stahl.history);
});

test("determinism: same input, same result", () => {
  const market = createMarketState(balance, T0);
  const trader = makeTrader();
  const a = trade(market, trader, "buy", "stahl", 321, T0 + 99);
  const b = trade(market, trader, "buy", "stahl", 321, T0 + 99);
  assert.deepEqual(a, b);
});

test("history keeps what the 24-hour band needs and drops older points", () => {
  let market = createMarketState(balance, T0);
  let trader = makeTrader(1e6, 1e6);
  const ctx = makeContext({ harborLevel: 1_000_000 });
  for (let n = 1; n <= 60; n++) {
    const result = trade(market, trader, n % 2 ? "buy" : "sell", "stahl", 100, T0 + n * HOUR, ctx);
    expectOk(result);
    market = result.market;
    trader = result.trader;
  }
  const now = T0 + 60 * HOUR;
  const history = market.stahl.history;
  assert.ok(history.length <= 26, `history length ${history.length}`);
  assert.ok(history[0].tMs <= now - DAY, "one point at or before now - 24h is kept");
  assert.ok(history[1].tMs > now - DAY);
  for (let n = 1; n < history.length; n++) assert.ok(history[n].tMs >= history[n - 1].tMs);
});

test("reversion: half-life 24 h (v1.30) – after 24 h half the gap to the reference is left, after 12 h about 71 %", () => {
  assert.equal(M.reversionHalfLifeHours, 24);
  const market = createMarketState(balance, T0);
  const moved = { ...market, stahl: { ...market.stahl, price: 1.4, lastUpdateMs: T0 } };
  assert.ok(Math.abs(currentPrice(moved.stahl, "stahl", balance, T0 + DAY) - 1.2) < 1e-12);
  assert.ok(Math.abs(currentPrice(moved.stahl, "stahl", balance, T0 + 12 * HOUR) - (1 + 0.4 * Math.SQRT1_2)) < 1e-12);
});
