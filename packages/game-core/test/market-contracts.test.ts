// Lieferverträge (v1.31): Preisformel, keine Geldmaschine, Abwicklung mit Nachfrist und Strafe, Kontingente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aboDueTimes, allowedDays, cancelPenaltyCents, contractPrice, contractSurcharge, createMarketState, createTraderState,
  depositCents, executeTrade, expectedPriceAt, kiQuota, maxWindowLoad, playerContractUnits, playerPriceBand,
  reservedNext24h, settleContract,
} from "../src/market/index.ts";
import type { ContractsBalance, MarketBalance, ResourceId, TradeSide } from "../src/market/index.ts";
import { mulberry32 } from "../src/rng.ts";

const balance: MarketBalance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"));
const cfg = balance.market.contracts as ContractsBalance;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("Preisformel: Aufschlag 4 % + 0,5 %/Tag + Menge/(2 × Tiefe), Kauf max(K, E), Verkauf min(K, E)", () => {
  // Vorlage Rechnung B: Stahl 20.000, Kurs = Richtwert, 1 Tag → 1,095 je Einheit.
  const b = contractPrice({ side: "buy", resource: "stahl", qty: 20_000, k: 1, r: 1, rT: 1, termMs: DAY }, balance);
  near(b.surcharge, 0.04 + 0.005 + 20_000 / (2 * 200_000));
  near(b.price, 1.095);
  near(b.feePerUnit, 0.04);
  near(b.buyerUnit - b.sellerUnit, 0.04);
  // Stahl dauerhaft hoch (1,52), Richtwert 1: E nach 3 Tagen = 1 + 0,52 × 0,5^3 = 1,065 → Bezug ist der Kurs.
  const hi = contractPrice({ side: "buy", resource: "stahl", qty: 1000, k: 1.52, r: 1, rT: 1, termMs: 3 * DAY }, balance);
  near(hi.expected, 1.065);
  near(hi.basis, 1.52);
  const sell = contractPrice({ side: "sell", resource: "stahl", qty: 1000, k: 1.52, r: 1, rT: 1, termMs: 3 * DAY }, balance);
  near(sell.basis, 1.065);
  near(sell.price, 1.065 * (1 - (0.04 + 0.015 + 1000 / 400_000)));
  near(sell.buyerUnit - sell.sellerUnit, 0.04 * 1.065);
  // Angekündigte Nachricht (Saisonende +8 %) steckt in R_T: Kauf unter dem Kurs wird teurer.
  const lowK = contractPrice({ side: "buy", resource: "stahl", qty: 1000, k: 0.9, r: 1, rT: 1.08, termMs: 2 * DAY }, balance);
  near(lowK.basis, 1.08 - 0.1 * 0.25);
  // Charakterbonus: 2 Prozentpunkte kleiner.
  near(contractSurcharge(cfg, 2 * DAY, 1000, 120_000, 0.02), 0.04 + 0.01 + 1000 / 240_000 - 0.02);
  // Grenzen: Preis immer innerhalb floorFactor … ceilFactor × Grundrichtwert.
  const capped = contractPrice({ side: "buy", resource: "stahl", qty: 1000, k: 2.5, r: 1, rT: 1, termMs: 7 * DAY }, balance);
  near(capped.price, balance.market.ceilFactor * 1);
  near(expectedPriceAt(2, 1, 1, 24 * HOUR, 24), 1.5);
});

/** Kurs K zur Zeit 0, Richtwert bei Lieferung rT ohne Überraschung: der Markt kehrt zurück, gehandelt wird zur Lieferung. */
function marketAt(resource: ResourceId, k: number) {
  const m = createMarketState(balance, 0);
  m[resource] = { price: k, lastUpdateMs: 0, haltedUntilMs: 0, history: [{ tMs: 0, price: k }] };
  return m;
}

function instant(side: TradeSide, resource: ResourceId, qty: number, k: number, rT: number, atMs: number, credits = 1e9) {
  const cap = 1e9;
  const trader = createTraderState(balance, credits, { [resource]: qty }, atMs);
  const storage = { stahl: cap, treibstoff: cap, elektronik: cap, proviant: cap };
  const q = executeTrade(marketAt(resource, k), trader, { side, resource, qty, expectedPrice: 1 }, {
    playerId: "1", tradeId: "t", harborLevel: 10, storageCapacity: storage, attackDetected: false, distanceToPortKm: 0,
  }, { ...balance, market: { ...balance.market, slippageTolerance: 1e9, hourBand: 1e9, dayBand: 1e9, maxImpactPerTrade: 1, creditLimitPerLevel: 1e12 } as never, buildings: { hafenkommandantur: { marketFromLevel: 1, creditLimitPerLevel: 1e12 } } }, atMs, { [resource]: rT });
  assert.ok(q.ok, `Börse ${side}: ${!q.ok ? q.code : ""}`);
  return q.quote.totalCredits;
}

test("Keine Geldmaschine: Termin kaufen und bei Lieferung an der Börse verkaufen verliert (und umgekehrt)", () => {
  const rand = mulberry32(31);
  const res: ResourceId[] = ["stahl", "treibstoff", "elektronik", "proviant"];
  for (let i = 0; i < 400; i++) {
    const resource = res[i % 4];
    const ref = balance.market.refPrice[resource];
    const r = ref * (0.85 + 0.3 * rand());
    const rT = r * (1 + 0.1 * rand()); // angekündigte Steigerung
    const k = ref * (0.5 + 1.5 * rand());
    const days = cfg.durationsDays[Math.floor(rand() * cfg.durationsDays.length)];
    const qty = 500 + Math.floor(rand() * 15_000);
    const bonus = rand() < 0.5 ? 0.02 : 0;
    const T = days * DAY;
    const buy = contractPrice({ side: "buy", resource, qty, k, r, rT, termMs: T, bonus }, balance);
    const cost = Math.ceil(qty * buy.buyerUnit * 100) / 100;
    const proceeds = instant("sell", resource, qty, k, rT, T);
    assert.ok(proceeds < cost, `Kauf auf Termin ${resource} ${qty} K=${k} → ${proceeds} ≥ ${cost}`);
    // Leerverkauf: auf Termin liefern, die Ware erst bei Lieferung an der Börse kaufen.
    const sell = contractPrice({ side: "sell", resource, qty, k, r, rT, termMs: T, bonus }, balance);
    const got = Math.floor(qty * sell.sellerUnit * 100) / 100;
    const pay = instant("buy", resource, qty, k, rT, T);
    assert.ok(got < pay, `Verkauf auf Termin ${resource} ${qty} K=${k} → ${got} ≥ ${pay}`);
    // Kreislauf: jetzt an der Börse kaufen, auf Termin an die KI liefern.
    assert.ok(got < instant("buy", resource, qty, k, r, 0), "sofort kaufen + Termin verkaufen");
    // Kreislauf: bei der KI auf Termin kaufen und bei einer KI auf Termin verkaufen.
    assert.ok(qty * sell.sellerUnit < qty * buy.buyerUnit, "Termin kaufen + Termin verkaufen");
  }
});

test("Abwicklung: voll, Nachfrist-Ende mit anteiliger Erfüllung und 25 % Strafe auf den unerfüllten Teil", () => {
  const unit = { buyerUnit: 1.1, sellerUnit: 1.06 };
  const D = depositCents(1000, 1.1, 0.25);
  assert.equal(D, 27_500);
  const full = settleContract({ qty: 1000, ...unit, buyerDepositCents: D, sellerPledgeCents: 0, goodsAvailable: 1000, buyerCreditsCents: 1e9, penaltyShare: 0.25 });
  assert.equal(full.full, true);
  assert.equal(full.buyerPaysCents, 110_000);
  assert.equal(full.fromAccountCents, 82_500);
  assert.equal(full.feeCents, 4000);
  assert.equal(full.buyerRefundCents, 0);
  // Käufer hat nur 412,50 Taler: deckt mit der Anzahlung (25 % je erfüllter Einheit) genau 500 Einheiten.
  const part = settleContract({ qty: 1000, ...unit, buyerDepositCents: D, sellerPledgeCents: 0, goodsAvailable: 1000, buyerCreditsCents: 41_250, penaltyShare: 0.25 });
  assert.equal(part.qty, 500);
  assert.equal(part.buyerShort, 500);
  assert.equal(part.buyerPenaltyCents, 13_750); // 25 % von 500 × 1,10
  assert.equal(part.fromAccountCents, 41_250);
  assert.equal(part.buyerRefundCents, 0);
  // Verkäufer liefert nur 300: Pfand verfällt anteilig, Anzahlung des Käufers zum Teil zurück.
  const P = depositCents(1000, 1.06, 0.25);
  const short = settleContract({ qty: 1000, ...unit, buyerDepositCents: D, sellerPledgeCents: P, goodsAvailable: 300, buyerCreditsCents: 1e9, penaltyShare: 0.25 });
  assert.equal(short.qty, 300);
  assert.equal(short.sellerShort, 700);
  assert.equal(short.sellerPenaltyCents, Math.floor(700 * 1.06 * 0.25 * 100));
  assert.equal(short.buyerPenaltyCents, 0);
  assert.equal(short.buyerRefundCents, 0);
  assert.equal(short.fromAccountCents, 33_000 - D);
  // KI als Käuferin: voller Preis in Treuhand, Spieler liefert nichts → Strafe auf sein Pfand, KI-Treuhand zurück.
  const kiFull = Math.ceil(1000 * 1.1 * 100);
  const none = settleContract({ qty: 1000, ...unit, buyerDepositCents: kiFull, sellerPledgeCents: P, goodsAvailable: 0, buyerCreditsCents: 0, penaltyShare: 0.25 });
  assert.equal(none.qty, 0);
  assert.equal(none.buyerRefundCents, kiFull);
  assert.equal(none.sellerPledgeRefundCents, P - none.sellerPenaltyCents);
  // Bilanz geht in jedem Fall auf.
  const rand = mulberry32(7);
  for (let i = 0; i < 300; i++) {
    const qty = 500 + Math.floor(rand() * 9000);
    const bu = 0.3 + rand() * 4;
    const su = bu * (0.9 + 0.1 * rand());
    const d = depositCents(qty, bu, 0.25);
    const p = rand() < 0.5 ? 0 : depositCents(qty, su, 0.25);
    const s = settleContract({ qty, buyerUnit: bu, sellerUnit: su, buyerDepositCents: d, sellerPledgeCents: p, goodsAvailable: Math.floor(rand() * qty * 1.2), buyerCreditsCents: Math.floor(rand() * qty * bu * 100), penaltyShare: 0.25 });
    assert.equal(d + p + s.fromAccountCents, s.buyerRefundCents + s.buyerPenaltyCents + s.sellerGetsCents + s.sellerPledgeRefundCents + s.sellerPenaltyCents + s.feeCents);
    assert.ok(s.feeCents >= 0 && s.buyerRefundCents >= 0 && s.sellerPledgeRefundCents >= 0 && s.fromAccountCents >= 0);
    assert.ok(s.qty <= qty && s.qty >= 0);
  }
  assert.equal(cancelPenaltyCents(1000, 1.1, 0.25, D), 27_500);
});

test("Tageslimit: Vertragslieferungen je 24-h-Fenster, Vormerkung der nächsten 24 h", () => {
  const t = 1_000 * DAY;
  const pts = [{ atMs: t + HOUR, qty: 2000 }, { atMs: t + 30 * HOUR, qty: 1000 }];
  // Fenster ab t+1h: 2000 + 500 (t+30h liegt außerhalb); Fenster ab t+20h: 500 + 1000.
  assert.equal(maxWindowLoad(pts, [{ atMs: t + 20 * HOUR, qty: 500 }]), 2500);
  // Abo-Tranchen genau 24 h auseinander liegen nie im selben Fenster.
  assert.equal(maxWindowLoad([], aboDueTimes(t, 7).map((atMs) => ({ atMs, qty: 1000 }))), 1000);
  assert.equal(reservedNext24h(pts, t), 2000);
  assert.equal(reservedNext24h(pts, t + 2 * HOUR), 0);
  assert.equal(reservedNext24h(pts, t + 7 * HOUR), 1000);
});

test("KI-Kontingente aus echten Lagern: ab 40 % verkaufen, bis 60 % kaufen, 25 %, je Mensch ⅓, Stufen 500", () => {
  const base = { capacity: 100_000, escrowed: 0, incoming: 0, humanCommitted: 0 };
  assert.equal(kiQuota("buy", { ...base, stock: 39_000 }, cfg), 0);
  // 60.000 Bestand → 15.000 Kontingent, je Mensch 5.000.
  assert.equal(kiQuota("buy", { ...base, stock: 60_000 }, cfg), 5000);
  assert.equal(kiQuota("buy", { ...base, stock: 60_000, humanCommitted: 4200 }, cfg), 500);
  // Schon zugesagt (Treuhand 14.000 bei 46.000 im Lager): nur noch 1.000 frei.
  assert.equal(kiQuota("buy", { ...base, stock: 46_000, escrowed: 14_000 }, cfg), 1000);
  // Kaufen: Lager höchstens 60 % voll (mit zugesagten Käufen), 25 % des freien Platzes.
  assert.equal(kiQuota("sell", { ...base, stock: 61_000 }, cfg), 0);
  assert.equal(kiQuota("sell", { ...base, stock: 40_000 }, cfg), 5000);
  // Rotbart: höchstens 2.000 je Vertrag.
  assert.equal(kiQuota("buy", { ...base, stock: 90_000 }, cfg, cfg.ki.profiles.freibeuter), 2000);
});

test("Laufzeiten bis 24 h vor Saisonende, Preisband für Spielerverträge", () => {
  const now = 50 * DAY;
  assert.deepEqual(allowedDays(cfg.durationsDays, now, now + 4 * DAY, 24), [1, 2, 3]);
  assert.deepEqual(allowedDays(cfg.durationsDays, now, null, 24), cfg.durationsDays);
  const band = playerPriceBand(1.2, 1.1, 0.2);
  near(band.min, 0.88);
  near(band.max, 1.44);
  const u = playerContractUnits(2, cfg);
  near(u.sellerUnit, 1.92);
});

test("Börse: freier Rahmen = Tageslimit − Umsatz der letzten 24 h − Vertragslieferungen der nächsten 24 h", () => {
  const cap = 10_000; // Tageslimit 20 % = 2.000
  const storage = { stahl: cap, treibstoff: cap, elektronik: cap, proviant: cap };
  const ctx = { playerId: "1", tradeId: "t", harborLevel: 10, storageCapacity: storage, attackDetected: false, distanceToPortKm: 0 };
  const trader = createTraderState(balance, 1e6, {}, 0);
  const m = createMarketState(balance, 0);
  const req = { side: "buy" as const, resource: "stahl" as ResourceId, qty: 1500, expectedPrice: 1.0038 };
  const ok = executeTrade(m, trader, req, { ...ctx, reservedQty: 500 }, balance, 0);
  assert.equal(ok.ok ? "ok" : ok.code, "ok");
  const r = executeTrade(m, trader, req, { ...ctx, reservedQty: 501 }, balance, 0);
  assert.equal(r.ok ? "ok" : r.code, "daily_limit");
});
