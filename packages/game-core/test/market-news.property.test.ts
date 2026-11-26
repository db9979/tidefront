// Eigenschaftstests der Börse mit Marktnachrichten: Die Garantie „keine Kredite aus dem Nichts“ gilt auch mit
// verschobenem (effektivem) Richtwert. Gegenstück zu market.property.test.ts, dort ohne Nachrichten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMarketState,
  createTraderState,
  effectiveRefPrices,
  executeTrade,
  quote,
  verifyLedger,
} from "../src/market/index.ts";
import type {
  Delivery,
  MarketBalance,
  MarketNewsBalance,
  MarketState,
  RefPrices,
  ResourceId,
  TradeResult,
  TradeSide,
  TraderState,
} from "../src/market/index.ts";

const realBalance: MarketBalance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"));
const MAX_TOTAL = (realBalance.market.news as MarketNewsBalance).maxTotal;
const RESOURCES: ResourceId[] = ["stahl", "treibstoff", "elektronik", "proviant"];
const NOW = Date.UTC(2026, 6, 1, 9, 30, 0);
const SEQUENCES = 300;
const MAX_STEPS = 40;

function withoutRateLimit(b: MarketBalance): MarketBalance {
  const copy = structuredClone(b);
  copy.market.tradesPerMinute = 1_000_000;
  return copy;
}

function stressBalance(b: MarketBalance): MarketBalance {
  const copy = withoutRateLimit(b);
  copy.market.hourBand = 1000;
  copy.market.dayBand = 1000;
  copy.market.maxImpactPerTrade = b.market.maxImpactPerTrade * 5;
  return copy;
}

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

/** Zufällige Versätze im ganzen erlaubten Bereich ±maxTotal, manchmal genau am Deckel. */
function randomRefs(rand: () => number, b: MarketBalance): Record<ResourceId, number> {
  const offsets: Record<string, number> = {};
  for (const r of RESOURCES) {
    const x = rand();
    offsets[r] = x < 0.1 ? MAX_TOTAL : x < 0.2 ? -MAX_TOTAL : (rand() * 2 - 1) * MAX_TOTAL;
  }
  return effectiveRefPrices(b.market.refPrice, offsets) as Record<ResourceId, number>;
}

interface Portfolio {
  market: MarketState;
  trader: TraderState;
  deliveries: Delivery[];
}

const context = (tradeId: string) => ({
  playerId: "prop", tradeId, harborLevel: 1_000_000,
  storageCapacity: { stahl: 1e12, treibstoff: 1e12, elektronik: 1e12, proviant: 1e12 },
  attackDetected: false, distanceToPortKm: 120,
});

function valueCents(p: Portfolio, refs: RefPrices): number {
  let value = Math.round(p.trader.credits * 100);
  for (const r of RESOURCES) {
    const transit = p.deliveries.filter((d) => d.resource === r).reduce((s, d) => s + d.qty, 0);
    value += (p.trader.stock[r] + transit) * (refs[r] as number) * 100;
  }
  return value;
}

function attempt(p: Portfolio, side: TradeSide, resource: ResourceId, qty: number, b: MarketBalance, refs: RefPrices, id: string): { result: TradeResult; next: Portfolio } {
  const q = quote(p.market, { side, resource, qty }, b, NOW, refs);
  const result = executeTrade(p.market, p.trader, { side, resource, qty, expectedPrice: q.ok ? q.executionPrice : 1 }, context(id), b, NOW, refs);
  if (!result.ok) return { result, next: { ...p, market: result.market } };
  return { result, next: { market: result.market, trader: result.trader, deliveries: result.delivery ? [...p.deliveries, result.delivery] : p.deliveries } };
}

function randomQty(rand: () => number, r: ResourceId, b: MarketBalance): number {
  const max = b.market.maxImpactPerTrade * b.market.depth[r];
  const x = rand();
  if (x < 0.15) return 1 + Math.floor(rand() * 20);
  if (x < 0.2) return Math.floor(max * (1 + rand()));
  return Math.max(1, Math.floor(max * rand()));
}

/** Kurse bleiben in den festen Grenzen des GRUNDrichtwerts (nicht des effektiven). */
function assertBounds(p: Portfolio, b: MarketBalance, label: string): void {
  assert.ok(p.trader.credits >= 0, `${label}: Kredite negativ`);
  for (const r of RESOURCES) {
    const ref = b.market.refPrice[r];
    const price = p.market[r].price;
    assert.ok(price >= b.market.floorFactor * ref && price <= b.market.ceilFactor * ref, `${label}: Kurs ${r} außerhalb (${price})`);
  }
}

function runValue(b: MarketBalance, seedBase: number): { executed: number; bounds: number } {
  let executed = 0;
  let bounds = 0;
  for (let s = 0; s < SEQUENCES; s++) {
    const rand = mulberry32(seedBase + s);
    const refs = randomRefs(rand, b);
    // Markt steht am effektiven Richtwert (der Kurs ist ihm bereits gefolgt).
    const market = createMarketState(b, NOW);
    for (const r of RESOURCES) market[r] = { price: refs[r], lastUpdateMs: NOW, haltedUntilMs: 0, history: [{ tMs: NOW, price: refs[r] }] };
    let p: Portfolio = {
      market,
      trader: createTraderState(b, Math.floor(rand() * 2_000_000_00) / 100, {
        stahl: Math.floor(rand() * 400_000), treibstoff: Math.floor(rand() * 240_000),
        elektronik: Math.floor(rand() * 120_000), proviant: Math.floor(rand() * 300_000),
      }, NOW),
      deliveries: [],
    };
    const start = valueCents(p, refs);
    const focus = rand() < 0.5 ? RESOURCES[Math.floor(rand() * 4)] : null;
    const buyBias = 0.15 + rand() * 0.7;
    const steps = 1 + Math.floor(rand() * MAX_STEPS);
    for (let n = 0; n < steps; n++) {
      const r = focus ?? RESOURCES[Math.floor(rand() * 4)];
      const side: TradeSide = rand() < buyBias ? "buy" : "sell";
      const { result, next } = attempt(p, side, r, randomQty(rand, r, b), b, refs, `n${s}-${n}`);
      const label = `seed ${seedBase + s}, Schritt ${n}`;
      if (result.ok) {
        executed++;
        assert.equal(verifyLedger(result.ledger).ok, true, `${label}: Journal`);
      } else if (result.code === "price_bounds") bounds++;
      p = next;
      assertBounds(p, b, label);
      assert.ok(valueCents(p, refs) <= start + 1e-3, `${label}: Gesamtwert zum effektiven Richtwert gestiegen`);
    }
  }
  return { executed, bounds };
}

test("Eigenschaft (Nachrichten): Gesamtwert zum effektiven Richtwert steigt nie (balance.json)", () => {
  const stats = runValue(withoutRateLimit(realBalance), 3000);
  assert.ok(stats.executed > SEQUENCES * 5, `nur ${stats.executed} Geschäfte`);
});

test("Eigenschaft (Nachrichten): dasselbe ohne Kursband, fünffache Kurswirkung; Grenzen am Grundrichtwert greifen", () => {
  const stats = runValue(stressBalance(realBalance), 70_000);
  assert.ok(stats.executed > SEQUENCES * 10, `nur ${stats.executed} Geschäfte`);
  assert.ok(stats.bounds > 0, "price_bounds nie ausgelöst");
});

test("Eigenschaft (Nachrichten): von jedem Kurs und Richtwert aus bringt keine Folge mit wiederhergestelltem Bestand Kredite", () => {
  const b = stressBalance(realBalance);
  const m = b.market;
  let checked = 0;
  for (let s = 0; s < SEQUENCES; s++) {
    const rand = mulberry32(950_000 + s);
    const refs = randomRefs(rand, b);
    const market = { ...createMarketState(b, NOW) };
    for (const r of RESOURCES) {
      const lo = m.floorFactor * m.refPrice[r] * 1.3;
      const hi = (m.ceilFactor * m.refPrice[r]) / 1.3;
      market[r] = { price: lo + rand() * (hi - lo), lastUpdateMs: NOW, haltedUntilMs: 0, history: [] };
    }
    const startStock = { stahl: 400_000, treibstoff: 240_000, elektronik: 120_000, proviant: 300_000 };
    let p: Portfolio = { market, trader: createTraderState(b, 5_000_000, startStock, NOW), deliveries: [] };
    const startCredits = p.trader.credits;
    const steps = 1 + Math.floor(rand() * MAX_STEPS);
    for (let n = 0; n < steps; n++) {
      const r = RESOURCES[Math.floor(rand() * 4)];
      p = attempt(p, rand() < 0.5 ? "buy" : "sell", r, randomQty(rand, r, b), b, refs, `c${s}-${n}`).next;
      assertBounds(p, b, `seed ${s}, Schritt ${n}`);
    }
    let restored = true;
    for (const r of RESOURCES) {
      const holdings = () => p.trader.stock[r] + p.deliveries.filter((d) => d.resource === r).reduce((x, d) => x + d.qty, 0);
      const maxChunk = Math.floor(m.maxImpactPerTrade * m.depth[r]);
      let guard = 0;
      while (holdings() < startStock[r] && restored) {
        const chunk = Math.min(startStock[r] - holdings(), Math.max(1, Math.floor(maxChunk * rand())));
        const step = attempt(p, "buy", r, chunk, b, refs, `c${s}-close-${r}-${guard}`);
        if (!step.result.ok || ++guard > 10_000) restored = false;
        p = step.next;
      }
    }
    if (!restored) continue;
    checked++;
    assert.ok(p.trader.credits <= startCredits, `seed ${s}: Kredite von ${startCredits} auf ${p.trader.credits}`);
  }
  assert.ok(checked > SEQUENCES * 0.8, `nur ${checked} Folgen abgeschlossen`);
});

test("Eigenschaft (Nachrichten): Kauf und sofortiger Rückverkauf verliert immer, bei jedem effektiven Richtwert", () => {
  const b = stressBalance(realBalance);
  const m = b.market;
  const rand = mulberry32(4242);
  let checked = 0;
  for (let n = 0; n < 2000; n++) {
    const refs = randomRefs(rand, b);
    const r = RESOURCES[Math.floor(rand() * 4)];
    const lo = m.floorFactor * m.refPrice[r] * (1 + m.maxImpactPerTrade) * 1.001;
    const hi = (m.ceilFactor * m.refPrice[r]) / (1 + m.maxImpactPerTrade) / 1.001;
    const market: MarketState = { ...createMarketState(b, NOW), [r]: { price: lo + rand() * (hi - lo), lastUpdateMs: NOW, haltedUntilMs: 0, history: [] } };
    const qty = randomQty(rand, r, b);
    const start: Portfolio = { market, trader: createTraderState(b, 10_000_000, { [r]: qty * 2 }, NOW), deliveries: [] };
    const buy = attempt(start, "buy", r, qty, b, refs, `rt${n}-b`);
    if (!buy.result.ok) {
      assert.equal(buy.result.code, "impact");
      continue;
    }
    const sell = attempt(buy.next, "sell", r, qty, b, refs, `rt${n}-s`);
    assert.equal(sell.result.ok, true);
    assert.ok(sell.next.trader.credits < start.trader.credits, `Fall ${n}: kein Verlust`);
    checked++;
  }
  assert.ok(checked > 1500, `nur ${checked} geprüft`);
});
