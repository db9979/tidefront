import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMarketState,
  createTraderState,
  executeTrade,
  quote,
  verifyLedger,
} from "../src/market/index.ts";
import type {
  Delivery,
  MarketBalance,
  MarketState,
  ResourceId,
  TradeContext,
  TradeResult,
  TradeSide,
  TraderState,
} from "../src/market/index.ts";

const realBalance: MarketBalance = JSON.parse(
  readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"),
);

/**
 * All trades of a sequence happen at the same instant, so the per-minute limit
 * of balance.json would stop every sequence after tradesPerMinute trades. The
 * property tests lift only this limit; every price parameter stays original.
 */
function withoutRateLimit(balance: MarketBalance): MarketBalance {
  const copy = structuredClone(balance);
  copy.market.tradesPerMinute = 1_000_000;
  return copy;
}

/** Additionally: no price bands and five times the impact, so that prices travel far. */
function stressBalance(balance: MarketBalance): MarketBalance {
  const copy = withoutRateLimit(balance);
  copy.market.hourBand = 1000;
  copy.market.dayBand = 1000;
  copy.market.maxImpactPerTrade = balance.market.maxImpactPerTrade * 5;
  return copy;
}

const RESOURCES: ResourceId[] = ["stahl", "treibstoff", "elektronik", "proviant"];
const NOW = Date.UTC(2026, 2, 1, 9, 30, 0);
const SEQUENCES = 400;
const MAX_STEPS = 40;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generousContext(tradeId: string): TradeContext {
  return {
    playerId: "prop",
    tradeId,
    harborLevel: 1_000_000,
    storageCapacity: { stahl: 1e12, treibstoff: 1e12, elektronik: 1e12, proviant: 1e12 },
    attackDetected: false,
    distanceToPortKm: 120,
  };
}

interface Portfolio {
  market: MarketState;
  trader: TraderState;
  deliveries: Delivery[];
}

/** Credits plus stock plus goods in transit, everything valued at the reference price, in cents. */
function totalValueCents(p: Portfolio, balance: MarketBalance): number {
  let value = Math.round(p.trader.credits * 100);
  for (const resource of RESOURCES) {
    const inTransit = p.deliveries
      .filter((d) => d.resource === resource)
      .reduce((sum, d) => sum + d.qty, 0);
    value += (p.trader.stock[resource] + inTransit) * balance.market.refPrice[resource] * 100;
  }
  return value;
}

function attempt(
  p: Portfolio,
  side: TradeSide,
  resource: ResourceId,
  qty: number,
  balance: MarketBalance,
  tradeId: string,
): { result: TradeResult; next: Portfolio } {
  const q = quote(p.market, { side, resource, qty }, balance, NOW);
  const expectedPrice = q.ok ? q.executionPrice : 1;
  const result = executeTrade(
    p.market,
    p.trader,
    { side, resource, qty, expectedPrice },
    generousContext(tradeId),
    balance,
    NOW,
  );
  if (!result.ok) {
    return { result, next: { market: result.market, trader: p.trader, deliveries: p.deliveries } };
  }
  return {
    result,
    next: {
      market: result.market,
      trader: result.trader,
      deliveries: result.delivery ? [...p.deliveries, result.delivery] : p.deliveries,
    },
  };
}

function randomQty(rand: () => number, resource: ResourceId, balance: MarketBalance): number {
  const max = balance.market.maxImpactPerTrade * balance.market.depth[resource];
  const r = rand();
  // mostly large trades, some tiny ones (rounding), a few beyond the impact limit
  if (r < 0.15) return 1 + Math.floor(rand() * 20);
  if (r < 0.2) return Math.floor(max * (1 + rand()));
  return Math.max(1, Math.floor(max * rand()));
}

function assertInvariants(p: Portfolio, balance: MarketBalance, label: string): void {
  const m = balance.market;
  assert.ok(p.trader.credits >= 0, `${label}: credits negative (${p.trader.credits})`);
  for (const resource of RESOURCES) {
    assert.ok(p.trader.stock[resource] >= 0, `${label}: stock of ${resource} negative`);
    const price = p.market[resource].price;
    const ref = m.refPrice[resource];
    assert.ok(
      price >= m.floorFactor * ref && price <= m.ceilFactor * ref,
      `${label}: price of ${resource} out of bounds (${price})`,
    );
  }
}

interface RunStats {
  executed: number;
  rejected: Record<string, number>;
  minPriceFactor: number;
  maxPriceFactor: number;
}

function runValueProperty(balance: MarketBalance, seedBase: number): RunStats {
  const stats: RunStats = { executed: 0, rejected: {}, minPriceFactor: 1, maxPriceFactor: 1 };
  for (let s = 0; s < SEQUENCES; s++) {
    const seed = seedBase + s;
    const rand = mulberry32(seed);
    // A market at its reference price and a player who could move it a long way.
    let p: Portfolio = {
      market: createMarketState(balance, NOW),
      trader: createTraderState(
        balance,
        Math.floor(rand() * 2_000_000_00) / 100,
        {
          stahl: Math.floor(rand() * 400_000),
          treibstoff: Math.floor(rand() * 240_000),
          elektronik: Math.floor(rand() * 120_000),
          proviant: Math.floor(rand() * 300_000),
        },
        NOW,
      ),
      deliveries: [],
    };
    const startValue = totalValueCents(p, balance);
    // Some sequences stay in one resource and lean to one side, so prices run far.
    const focus = rand() < 0.5 ? RESOURCES[Math.floor(rand() * RESOURCES.length)] : null;
    const buyBias = 0.15 + rand() * 0.7;
    const steps = 1 + Math.floor(rand() * MAX_STEPS);
    const log: string[] = [];
    for (let n = 0; n < steps; n++) {
      const resource = focus ?? RESOURCES[Math.floor(rand() * RESOURCES.length)];
      const side: TradeSide = rand() < buyBias ? "buy" : "sell";
      const qty = randomQty(rand, resource, balance);
      const { result, next } = attempt(p, side, resource, qty, balance, `s${seed}-${n}`);
      const label = `seed ${seed}, step ${n} (${side} ${qty} ${resource})`;
      if (result.ok) {
        stats.executed++;
        log.push(`${side} ${qty} ${resource} @ ${result.quote.executionPrice}`);
        assert.equal(verifyLedger(result.ledger).ok, true, `${label}: ledger unbalanced`);
        const factor = result.quote.priceAfter / balance.market.refPrice[resource];
        stats.minPriceFactor = Math.min(stats.minPriceFactor, factor);
        stats.maxPriceFactor = Math.max(stats.maxPriceFactor, factor);
      } else {
        stats.rejected[result.code] = (stats.rejected[result.code] ?? 0) + 1;
        assert.deepEqual(next.trader, p.trader, `${label}: rejection changed the trader`);
      }
      p = next;
      assertInvariants(p, balance, label);
      // The guarantee must hold after every step, not only at the end.
      const value = totalValueCents(p, balance);
      assert.ok(
        value <= startValue + 1e-3,
        `${label}: total value rose from ${startValue / 100} to ${value / 100}\n${log.join("\n")}`,
      );
    }
    assert.ok(totalValueCents(p, balance) <= startValue + 1e-3, `seed ${seed}: final value higher`);
  }
  return stats;
}

test("property: no sequence of trades without elapsed time raises the total value (balance.json)", () => {
  const balance = withoutRateLimit(realBalance);
  const stats = runValueProperty(balance, 1000);
  // the test is only meaningful if many trades actually went through
  assert.ok(stats.executed > SEQUENCES * 5, `only ${stats.executed} trades executed`);
  assert.ok(stats.maxPriceFactor > 1.05 && stats.minPriceFactor < 0.95);
});

test("property: same guarantee without price bands and with five times the impact", () => {
  const balance = stressBalance(realBalance);
  const stats = runValueProperty(balance, 50_000);
  assert.ok(stats.executed > SEQUENCES * 10, `only ${stats.executed} trades executed`);
  // prices really travelled: the bounds were reached and enforced
  assert.ok((stats.rejected.price_bounds ?? 0) > 0, "price_bounds never triggered");
  assert.ok(stats.maxPriceFactor > 2 && stats.minPriceFactor < 0.5);
});

test("property: buying and immediately selling back the same quantity always loses credits", () => {
  const balance = stressBalance(realBalance);
  const m = balance.market;
  const rand = mulberry32(777);
  let checked = 0;
  for (let n = 0; n < 3000; n++) {
    const resource = RESOURCES[Math.floor(rand() * RESOURCES.length)];
    const ref = m.refPrice[resource];
    // any admissible starting price, not only the reference price
    const lo = m.floorFactor * ref * (1 + m.maxImpactPerTrade) * 1.001;
    const hi = (m.ceilFactor * ref) / (1 + m.maxImpactPerTrade) / 1.001;
    const startPrice = lo + rand() * (hi - lo);
    const market: MarketState = {
      ...createMarketState(balance, NOW),
      [resource]: { price: startPrice, lastUpdateMs: NOW, haltedUntilMs: 0, history: [] },
    };
    const qty = randomQty(rand, resource, balance);
    const stock = Math.floor(rand() * 3) * qty + qty;
    const start: Portfolio = {
      market,
      trader: createTraderState(balance, 10_000_000, { [resource]: stock }, NOW),
      deliveries: [],
    };
    const label = `case ${n}: ${qty} ${resource} at ${startPrice}`;

    const buy = attempt(start, "buy", resource, qty, balance, `rt${n}-buy`);
    if (!buy.result.ok) {
      assert.equal(buy.result.code, "impact", label);
      continue;
    }
    const sell = attempt(buy.next, "sell", resource, qty, balance, `rt${n}-sell`);
    assert.equal(sell.result.ok, true, `${label}: sell back rejected`);
    assert.ok(sell.next.trader.credits < start.trader.credits, `${label}: no credit loss`);
    // holdings are the same as before (stock down by qty, qty in transit)
    assert.equal(sell.next.trader.stock[resource] + qty, start.trader.stock[resource]);
    // the loss is at least the two fees
    const loss = start.trader.credits - sell.next.trader.credits;
    assert.ok(buy.result.ok && sell.result.ok);
    assert.ok(loss >= buy.result.quote.feeCredits + sell.result.quote.feeCredits - 0.011, label);

    // the other way round: sell first, buy back
    const sellFirst = attempt(start, "sell", resource, qty, balance, `rt${n}-sell2`);
    assert.equal(sellFirst.result.ok, true, `${label}: sell rejected`);
    const buyBack = attempt(sellFirst.next, "buy", resource, qty, balance, `rt${n}-buy2`);
    assert.equal(buyBack.result.ok, true, `${label}: buy back rejected`);
    assert.ok(buyBack.next.trader.credits < start.trader.credits, `${label}: no credit loss (sell first)`);
    checked++;
  }
  assert.ok(checked > 2500, `only ${checked} round trips checked`);
});

test("property: from any starting price, no sequence that restores the holdings gains credits", () => {
  const balance = stressBalance(realBalance);
  const m = balance.market;
  let checked = 0;
  for (let s = 0; s < SEQUENCES; s++) {
    const seed = 900_000 + s;
    const rand = mulberry32(seed);
    const base = createMarketState(balance, NOW);
    const market = { ...base };
    for (const resource of RESOURCES) {
      const ref = m.refPrice[resource];
      const lo = m.floorFactor * ref * 1.3;
      const hi = (m.ceilFactor * ref) / 1.3;
      market[resource] = { price: lo + rand() * (hi - lo), lastUpdateMs: NOW, haltedUntilMs: 0, history: [] };
    }
    const startStock = { stahl: 400_000, treibstoff: 240_000, elektronik: 120_000, proviant: 300_000 };
    let p: Portfolio = {
      market,
      trader: createTraderState(balance, 5_000_000, startStock, NOW),
      deliveries: [],
    };
    const startCredits = p.trader.credits;
    const steps = 1 + Math.floor(rand() * MAX_STEPS);
    for (let n = 0; n < steps; n++) {
      const resource = RESOURCES[Math.floor(rand() * RESOURCES.length)];
      const side: TradeSide = rand() < 0.5 ? "buy" : "sell";
      p = attempt(p, side, resource, randomQty(rand, resource, balance), balance, `c${seed}-${n}`).next;
      assertInvariants(p, balance, `seed ${seed}, step ${n}`);
    }
    // Close out: buy back whatever is missing (stock plus goods in transit), in random chunks.
    let restored = true;
    for (const resource of RESOURCES) {
      const holdings = () =>
        p.trader.stock[resource] +
        p.deliveries.filter((d) => d.resource === resource).reduce((sum, d) => sum + d.qty, 0);
      const maxChunk = Math.floor(m.maxImpactPerTrade * m.depth[resource]);
      let guard = 0;
      while (holdings() < startStock[resource] && restored) {
        const missing = startStock[resource] - holdings();
        const chunk = Math.min(missing, Math.max(1, Math.floor(maxChunk * rand())));
        const step = attempt(p, "buy", resource, chunk, balance, `c${seed}-close-${resource}-${guard}`);
        if (!step.result.ok || ++guard > 10_000) restored = false;
        p = step.next;
      }
    }
    if (!restored) continue; // e.g. the buy-back would leave the price bounds
    checked++;
    assert.ok(
      p.trader.credits <= startCredits,
      `seed ${seed}: credits rose from ${startCredits} to ${p.trader.credits} with holdings restored`,
    );
  }
  assert.ok(checked > SEQUENCES * 0.8, `only ${checked} of ${SEQUENCES} sequences could be closed out`);
});
