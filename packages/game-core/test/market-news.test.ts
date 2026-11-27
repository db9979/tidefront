// Marktnachrichten (news.ts): Einflüsse, Deckel, Abklingen, sanfte Änderung, Anlässe; Börse mit effektivem Richtwert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMarketState,
  createTraderState,
  currentPrice,
  effectiveRefPrices,
  executeTrade,
  grossflottePcts,
  influenceAt,
  quote,
  roundPct,
  scarcityIndex,
  seasonEndFactor,
  smoothScarcity,
  stepOffsets,
  targetOffsets,
  tradeBalancePct,
  cappedNetBuys,
  warPct,
} from "../src/market/index.ts";
import type { MarketBalance, MarketInfluence, MarketNewsBalance, TradeContext } from "../src/market/index.ts";

const balance: MarketBalance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"));
const news = balance.market.news as MarketNewsBalance;
const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 5, 1, 12);
const RES = ["stahl", "treibstoff", "elektronik", "proviant"];

test("balance: market.news vorhanden, Deckel 25 %, 5 % je Stunde", () => {
  assert.equal(news.maxTotal, 0.25);
  assert.equal(news.maxChangePerHour, 0.05);
  const fade = [news.worldEvents.grossflotte.fadeHours, news.worldEvents.belagerung.fadeHours,
    news.worldEvents.schatzschiffErbeutet.fadeHours, news.worldEvents.schatzschiffEntkommen.fadeHours];
  for (const h of fade) assert.ok(h >= 24 && h <= 48, `Abklingen ${h} h`);
});

test("influenceAt: vor Beginn 0, voll bis Ende, dann linear abklingend", () => {
  const inf: MarketInfluence = { resource: "treibstoff", pct: 0.12, startMs: T0, endMs: T0 + 10 * H, fadeMs: 24 * H };
  assert.equal(influenceAt(inf, T0 - 1), 0);
  assert.equal(influenceAt(inf, T0), 0.12);
  assert.equal(influenceAt(inf, T0 + 10 * H), 0.12);
  assert.ok(Math.abs(influenceAt(inf, T0 + 22 * H) - 0.06) < 1e-12);
  assert.equal(influenceAt(inf, T0 + 34 * H), 0);
  assert.equal(influenceAt({ ...inf, fadeMs: 0 }, T0 + 10 * H + 1), 0);
});

test("targetOffsets: Summe je Ressource, gedeckelt auf ±25 %, ohne Einflüsse exakt 0", () => {
  const infs: MarketInfluence[] = [
    { resource: "treibstoff", pct: 0.15, startMs: T0, endMs: T0 + H, fadeMs: 0 },
    { resource: "treibstoff", pct: 0.08, startMs: T0, endMs: T0 + H, fadeMs: 0 },
    { resource: "treibstoff", pct: 0.1, startMs: T0, endMs: T0 + H, fadeMs: 0 },
    { resource: "stahl", pct: -0.2, startMs: T0, endMs: T0 + H, fadeMs: 0 },
    { resource: "stahl", pct: -0.2, startMs: T0, endMs: T0 + H, fadeMs: 0 },
    { resource: "gold", pct: 0.5, startMs: T0, endMs: T0 + H, fadeMs: 0 },
  ];
  const t = targetOffsets(infs, RES, T0, news.maxTotal);
  assert.equal(t.treibstoff, 0.25);
  assert.equal(t.stahl, -0.25);
  assert.equal(t.elektronik, 0);
  assert.equal(t.proviant, 0);
  assert.equal("gold" in t, false);
  assert.deepEqual(targetOffsets([], RES, T0, 0.25), { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 });
});

test("stepOffsets: höchstens 5 % je Stunde, nie über den Deckel, ohne Vorstand keine Bewegung", () => {
  const target = { stahl: 0.25, treibstoff: -0.1 };
  const first = stepOffsets(null, target, T0, 0.05, 0.25);
  assert.deepEqual(first.offset, { stahl: 0, treibstoff: 0 });
  const tenMin = stepOffsets(first, target, T0 + 10 * 60000, 0.05, 0.25);
  assert.ok(Math.abs(tenMin.offset.stahl - 0.05 / 6) < 1e-12);
  const twoH = stepOffsets(first, target, T0 + 2 * H, 0.05, 0.25);
  assert.ok(Math.abs(twoH.offset.stahl - 0.1) < 1e-12);
  assert.ok(Math.abs(twoH.offset.treibstoff + 0.1) < 1e-12, "Ziel erreicht, nicht darüber hinaus");
  const day = stepOffsets(twoH, { stahl: 0.9 }, T0 + 30 * H, 0.05, 0.25);
  assert.equal(day.offset.stahl, 0.25);
  assert.equal(day.offset.treibstoff, 0, "ohne Ziel zurück auf 0");
  const back = stepOffsets(twoH, target, T0, 0.05, 0.25);
  assert.deepEqual(back.offset, twoH.offset, "Zeit rückwärts: Stand bleibt");
});

test("Eigenschaft: der effektive Richtwert ändert sich je Stunde um höchstens 5 % des Grundrichtwerts", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let state = stepOffsets(null, {}, T0, news.maxChangePerHour, news.maxTotal);
  let t = T0;
  for (let i = 0; i < 2000; i++) {
    const dt = Math.floor(rnd() * 3 * H);
    t += dt;
    const target = targetOffsets(
      [{ resource: "stahl", pct: (rnd() - 0.5) * 2, startMs: t - H, endMs: t + H, fadeMs: 0 }],
      RES, t, news.maxTotal,
    );
    const next = stepOffsets(state, target, t, news.maxChangePerHour, news.maxTotal);
    const change = Math.abs(next.offset.stahl - (state.offset.stahl ?? 0));
    assert.ok(change <= news.maxChangePerHour * (dt / H) + 1e-12, `Schritt ${i}: ${change}`);
    assert.ok(Math.abs(next.offset.stahl) <= news.maxTotal + 1e-12);
    state = next;
  }
});

test("effectiveRefPrices: Versatz 0 ist bit-gleich zum Grundrichtwert", () => {
  const eff = effectiveRefPrices(balance.market.refPrice, { stahl: 0, treibstoff: 0.1 });
  assert.equal(eff.stahl, balance.market.refPrice.stahl);
  assert.ok(Math.abs(eff.treibstoff - 1.8 * 1.1) < 1e-12);
  assert.deepEqual(effectiveRefPrices(balance.market.refPrice, null), balance.market.refPrice);
});

test("Anlässe: Großflotte bis 15 %, Kriegslage −4 % bis +8 %, Saisonende tageweise bis 8 %", () => {
  assert.deepEqual(grossflottePcts(1, news.worldEvents.grossflotte), { treibstoff: 0.12, proviant: 0.12 });
  assert.deepEqual(grossflottePcts(2, news.worldEvents.grossflotte), { treibstoff: 0.15, proviant: 0.15 });
  assert.equal(warPct(0, 0, news.war), -0.04);
  assert.equal(roundPct(warPct(2, 0, news.war)), 0);
  assert.equal(warPct(10, 50, news.war), 0.08);
  const end = T0 + 30 * D;
  assert.equal(seasonEndFactor(end - 8 * D, end, 7), 0);
  assert.equal(seasonEndFactor(end - 7 * D, end, 7), 1 / 7);
  assert.equal(seasonEndFactor(end - 3.5 * D, end, 7), 4 / 7);
  assert.equal(seasonEndFactor(end - 1, end, 7), 1);
  assert.equal(seasonEndFactor(end, end, 7), 0);
});

test("Knappheit: Median-basiert, robust gegen einzelne Ausreißer, unter 3 Häfen keine Wirkung", () => {
  const cfg = news.scarcity;
  const normal = [
    { stock: 2000, capacity: 10000, netPerHour: 50 },
    { stock: 2500, capacity: 10000, netPerHour: 60 },
    { stock: 1500, capacity: 12000, netPerHour: 40 },
    { stock: 3000, capacity: 9000, netPerHour: 70 },
  ];
  const base = scarcityIndex(normal, cfg);
  assert.ok(base !== null && base > 0, "knapp gefüllt: Richtwert steigt");
  // Ein einzelner Spieler mit riesigem Lager ändert den Median kaum.
  const whale = scarcityIndex([...normal, { stock: 5_000_000, capacity: 5_000_000, netPerHour: 99999 }], cfg);
  assert.ok(whale !== null && Math.abs(whale - (base as number)) < 0.02, `Ausreißer: ${whale} gegen ${base}`);
  assert.equal(scarcityIndex(normal.slice(0, 2), cfg), null);
  const full = scarcityIndex(normal.map((b) => ({ ...b, stock: b.capacity })), cfg);
  assert.equal(full, -0.1);
  const deficit = scarcityIndex(normal.map((b) => ({ ...b, stock: 0, netPerHour: -5 })), cfg);
  assert.equal(deficit, 0.1, "gedeckelt");
  assert.ok(Math.abs(smoothScarcity([0.5, 0.1, -0.05, 0.02], 3, 0.1) - 0.07 / 3) < 1e-12, "Mittel der letzten drei");
  assert.equal(smoothScarcity([0.5, 0.5], 3, 0.1), 0.1, "gedeckelt");
  assert.equal(smoothScarcity([], 3, 0.1), 0);
});

// ---------------------------------------------------------------- Börse mit effektivem Richtwert

const ctx: TradeContext = {
  playerId: "p", tradeId: "t1", harborLevel: 10,
  storageCapacity: { stahl: 1e9, treibstoff: 1e9, elektronik: 1e9, proviant: 1e9 },
  attackDetected: false, distanceToPortKm: 0,
};

test("ohne Nachrichten bit-gleich: Kurs, Angebot und Handel wie ohne Parameter", () => {
  const market = createMarketState(balance, T0);
  market.treibstoff = { ...market.treibstoff, price: 1.5, history: [{ tMs: T0, price: 1.5 }] };
  const now = T0 + 5 * H;
  const neutral = effectiveRefPrices(balance.market.refPrice, { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 });
  assert.equal(currentPrice(market.treibstoff, "treibstoff", balance, now, neutral), currentPrice(market.treibstoff, "treibstoff", balance, now));
  assert.deepEqual(quote(market, { side: "buy", resource: "treibstoff", qty: 500 }, balance, now, neutral),
    quote(market, { side: "buy", resource: "treibstoff", qty: 500 }, balance, now));
  const trader = createTraderState(balance, 100000, { treibstoff: 1000 }, now);
  const q = quote(market, { side: "sell", resource: "treibstoff", qty: 500 }, balance, now);
  assert.ok(q.ok);
  const req = { side: "sell" as const, resource: "treibstoff" as const, qty: 500, expectedPrice: q.executionPrice };
  assert.deepEqual(executeTrade(market, trader, req, ctx, balance, now, neutral), executeTrade(market, trader, req, ctx, balance, now));
  assert.deepEqual(executeTrade(market, trader, req, ctx, balance, now, {}), executeTrade(market, trader, req, ctx, balance, now));
});

test("Kurs folgt dem effektiven Richtwert über die Rückkehrformel", () => {
  const market = createMarketState(balance, T0);
  const eff = effectiveRefPrices(balance.market.refPrice, { treibstoff: 0.12 });
  const halfLife = balance.market.reversionHalfLifeHours * H;
  const p = currentPrice(market.treibstoff, "treibstoff", balance, T0 + halfLife, eff);
  assert.ok(Math.abs(p - (1.8 + (2.016 - 1.8) * 0.5)) < 1e-12, `nach einer Halbwertszeit halbe Strecke: ${p}`);
  const q = quote(market, { side: "buy", resource: "treibstoff", qty: 100 }, balance, T0 + halfLife, eff);
  assert.ok(q.ok && Math.abs(q.priceBefore - p) < 1e-12);
});

test("Kursgrenzen bleiben am Grundrichtwert, auch bei verschobenem Richtwert", () => {
  const b = structuredClone(balance);
  b.market.hourBand = 1000;
  b.market.dayBand = 1000;
  b.market.maxImpactPerTrade = 1;
  const market = createMarketState(b, T0);
  // Kurs knapp unter der Obergrenze des Grundrichtwerts
  market.stahl = { price: 2.49, lastUpdateMs: T0, haltedUntilMs: 0, history: [] };
  const eff = effectiveRefPrices(b.market.refPrice, { stahl: 0.25 });
  const trader = createTraderState(b, 1_000_000, {}, T0);
  const q = quote(market, { side: "buy", resource: "stahl", qty: 2000 }, b, T0, eff);
  assert.ok(q.ok && q.priceAfter > 2.5 && q.priceAfter < 2.5 * 1.25);
  const r = executeTrade(market, trader, { side: "buy", resource: "stahl", qty: 2000, expectedPrice: q.executionPrice }, ctx, b, T0, eff);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "price_bounds");
});

test("Handelsbilanz: Ziel 0,5 × Netto-Käufe ÷ (3 × Tiefe), ±15 %, erst ab 3 aktiven Häfen", () => {
  const cfg = news.tradeBalance!;
  assert.deepEqual({ f: cfg.factor, w: cfg.windowHours, d: cfg.depthMultiple, m: cfg.max, p: cfg.minPorts, s: cfg.playerShareDivisor }, { f: 0.5, w: 72, d: 3, m: 0.15, p: 3, s: 3 });
  const depth = balance.market.depth.stahl; // 200.000
  // drei gleich starke Käufer zählen voll: 3 × 40.000 = 120.000 → 0,5 × 120.000 / 600.000 = 10 %
  assert.ok(Math.abs(tradeBalancePct([40_000, 40_000, 40_000], depth, 3, cfg) - 0.1) < 1e-9);
  // unter 3 aktiven Häfen keine Wirkung
  assert.equal(tradeBalancePct([40_000, 40_000, 40_000], depth, 2, cfg), 0);
  // Verkäufe senken, Deckel ±15 %
  assert.ok(Math.abs(tradeBalancePct([-90_000, -90_000, -90_000], depth, 5, cfg) + 0.15) < 1e-12);
  assert.ok(Math.abs(tradeBalancePct([900_000, 900_000, 900_000], depth, 5, cfg) - 0.15) < 1e-12);
  assert.equal(tradeBalancePct([], depth, 5, cfg), 0);
});

test("Handelsbilanz: je Spieler höchstens ⅓ der gesamten Bewegung", () => {
  const cfg = news.tradeBalance!;
  // ein einzelner Großkäufer zählt nur zu einem Drittel
  assert.ok(Math.abs(cappedNetBuys([90_000], cfg.playerShareDivisor) - 90_000 / cfg.playerShareDivisor) < 1e-6);
  // ein Großer und zwei Kleine: der Große zählt höchstens ⅓ der Summe der Beträge (100.000 → 33.333)
  const capped = cappedNetBuys([90_000, 5_000, 5_000], cfg.playerShareDivisor);
  assert.ok(Math.abs(capped - (100_000 / cfg.playerShareDivisor + 10_000)) < 1e-6, String(capped));
  // gegenläufige Spieler heben sich auf; das Vorzeichen bleibt
  assert.equal(cappedNetBuys([30_000, -30_000, 30_000, -30_000], cfg.playerShareDivisor), 0);
  assert.ok(cappedNetBuys([-60_000, 10_000], cfg.playerShareDivisor) < 0);
  // wirkt im Ziel: ein Spieler mit 120.000 → 0,5 × 40.000 / 600.000 ≈ 3,3 % statt 10 %
  const one = tradeBalancePct([120_000], balance.market.depth.stahl, 3, cfg);
  assert.ok(Math.abs(one - (0.5 * 120_000 / cfg.playerShareDivisor) / 600_000) < 1e-9, String(one));
});
