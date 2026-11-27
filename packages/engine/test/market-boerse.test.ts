// Integrationstests Börse v1.30 gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert):
// Handelsbilanz (Marktnachricht), Saisonchart (Stundenschlusskurse), gleitendes Tageslimit in der Börsenansicht,
// Knappheit je Spieltag.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { isCoast, nestSites, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { market as marketCore, type BaseState } from "@tidefront/game-core";
import {
  balance, chooseBase, clearMarketNews, marketChartView, marketQuote, marketView, netBuysByPlayer, register, runMarketNewsTx,
  seed, trade, REF_OFFSETS_KEY, SCARCITY_KEY, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const tb = balance.market.news!.tradeBalance!;
let keyN = 0;
const key = () => `mb${++keyN}-${Date.now()}`;
let fieldN = 0;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Aktiver Spieler (gerade gesehen) mit Hafen, Börse freigeschaltet und Stahl im Lager. */
async function trader(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(3 * fieldN++);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.buildings.hafenkommandantur = 5; s.buildings.kommandozentrale = 5; s.buildings.lagerkomplex = 8;
    s.resources.stahl = 50_000;
  });
  await db.update(tables.player).set({ lastSeenAt: new Date() }).where(eq(tables.player.id, p.playerId));
  return { playerId: p.playerId, baseId };
}

/** Börsenkauf im Journal (wie executeTrade ihn bucht: der Markt gibt Ware ab, der Spieler zahlt Kredite). */
async function journalBuy(playerId: number, resource: string, qty: number, tMs: number) {
  const tradeId = `t-test-${key()}`;
  await db.insert(tables.tradeLedger).values([
    { tradeId, tMs, account: `player:${playerId}`, asset: "credits", amount: (-qty).toFixed(2) },
    { tradeId, tMs, account: "market", asset: "credits", amount: qty.toFixed(2) },
    { tradeId, tMs, account: "market", asset: resource, amount: (-qty).toFixed(2) },
    { tradeId, tMs, account: `delivery:${tradeId}`, asset: resource, amount: qty.toFixed(2) },
  ]);
}

async function newsRows(resource?: string) {
  const rows = await db.select().from(tables.marketNews).where(eq(tables.marketNews.key, "handelsbilanz"));
  return rows.filter((r) => !resource || r.resource === resource).sort((a, b) => a.id - b.id);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Saison läuft seit 10 Tagen (die Handelsbilanz zählt nur Handel der laufenden Saison).
  await db.update(tables.season).set({ startsAt: new Date(Date.now() - 10 * DAY) }).where(eq(tables.season.status, "running"));
});

beforeEach(async () => {
  await db.delete(tables.marketNews);
  await db.delete(tables.marketPriceHour);
  await db.delete(tables.tradeLedger).where(sql`${tables.tradeLedger.tradeId} like 't-test-%'`);
  await db.delete(tables.serverSetting).where(inArray(tables.serverSetting.key, [REF_OFFSETS_KEY, SCARCITY_KEY]));
  await db.update(tables.player).set({ lastSeenAt: null });
});

after(async () => {
  await client.end();
});

test("Handelsbilanz: Netto-Käufe aus dem Journal, Ziel 0,5 × Summe ÷ (3 × Tiefe), ⅓-Deckel, erst ab 3 aktiven Häfen", async () => {
  const a = await trader("BilanzA");
  const b = await trader("BilanzB");
  const c = await trader("BilanzC");
  const T = Date.now();
  // Ein echter Börsenverkauf zählt negativ.
  const q = await marketQuote(engine, { side: "sell", resource: "stahl", qty: 1000 });
  assert.ok(q.ok);
  assert.equal((await trade(engine, a.playerId, key(), { side: "sell", resource: "stahl", qty: 1000, expectedPrice: q.executionPrice })).ok, true);
  const real = await db.transaction((tx) => netBuysByPlayer(tx, T - HOUR));
  assert.deepEqual(real.stahl, [-1000]);
  await db.delete(tables.tradeLedger).where(sql`${tables.tradeLedger.tradeId} like 't-%' and ${tables.tradeLedger.tradeId} not like 't-test-%'`);

  // Nur zwei aktive Häfen: keine Wirkung, auch nicht bei großen Käufen.
  await db.update(tables.player).set({ lastSeenAt: null }).where(eq(tables.player.id, c.playerId));
  await journalBuy(a.playerId, "stahl", 60_000, T - HOUR);
  await journalBuy(b.playerId, "stahl", 60_000, T - HOUR);
  await runMarketNewsTx(db, T);
  assert.equal((await newsRows()).length, 0, "unter 3 aktiven Häfen keine Handelsbilanz");

  // Drei aktive Häfen, drei gleich starke Käufer (je 40.000 netto): voll gezählt → 0,5 × 120.000 ÷ 600.000 = 10 %.
  await db.delete(tables.tradeLedger).where(sql`${tables.tradeLedger.tradeId} like 't-test-%'`);
  await db.update(tables.player).set({ lastSeenAt: new Date(T) }).where(inArray(tables.player.id, [a.playerId, b.playerId, c.playerId]));
  for (const p of [a, b, c]) await journalBuy(p.playerId, "stahl", 40_000, T - 2 * HOUR);
  // Älter als 72 h: zählt nicht.
  await journalBuy(c.playerId, "stahl", 500_000, T - tb.windowHours * HOUR - 1);
  await runMarketNewsTx(db, T);
  const rows = await newsRows("stahl");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "handelsbilanz");
  assert.equal(rows[0].pct, 0.1);
  assert.match(rows[0].reason, /Handelsbilanz: Häfen kaufen mehr Stahl/);
  assert.equal((await newsRows("proviant")).length, 0, "ohne Handel keine Nachricht");

  // Ein einzelner Großkäufer zählt nur zu einem Drittel: 108.000 Elektronik netto (Tiefe 60.000) → 36.000 →
  // 0,5 × 36.000 ÷ 180.000 = 10 % statt 30 % (das wäre über dem Deckel von 15 %).
  await db.delete(tables.marketNews);
  await db.delete(tables.tradeLedger).where(sql`${tables.tradeLedger.tradeId} like 't-test-%'`);
  const depthEl = balance.market.depth.elektronik;
  await journalBuy(a.playerId, "elektronik", 1.8 * depthEl, T - HOUR);
  await runMarketNewsTx(db, T);
  const [el] = await newsRows("elektronik");
  assert.equal(el.pct, Math.round(((tb.factor * 1.8 * depthEl) / tb.playerShareDivisor / (tb.depthMultiple * depthEl)) * 100) / 100);
  assert.equal(el.pct, 0.1);

  // Fällt ein Hafen weg, endet die Nachricht sofort.
  await db.update(tables.player).set({ lastSeenAt: null }).where(eq(tables.player.id, c.playerId));
  await runMarketNewsTx(db, T + 10 * 60_000);
  const [ended] = await newsRows("elektronik");
  assert.ok(ended.endsAt.getTime() <= T + 10 * 60_000 && ended.fadeMinutes === 0);
});

test("Saisonchart: Stundenschlusskurse je Ressource, fehlende Stunden bis 24 h rückwirkend, Saisonende leert", async () => {
  const T = Math.floor(Date.now() / HOUR) * HOUR + 30 * 60_000; // halb nach einer vollen Stunde
  const ref = balance.market.refPrice.stahl;
  const hl = balance.market.reversionHalfLifeHours;
  // Stahl seit 30 h auf 1,4 × Richtwert (ein Handel), die anderen Ressourcen seit 30 h am Richtwert.
  for (const r of balance.resources) {
    const price = r === "stahl" ? ref * 1.4 : balance.market.refPrice[r];
    const state = { price, lastUpdateMs: T - 30 * HOUR, haltedUntilMs: 0, history: [{ tMs: T - 30 * HOUR, price }] };
    await db.update(tables.market).set({ state }).where(eq(tables.market.resource, r));
  }
  await runMarketNewsTx(db, T);
  const chart = await marketChartView(db, "stahl", T);
  assert.equal(chart.baseRef, ref);
  assert.equal(chart.points.length, 24, "24 volle Stunden rückwirkend");
  const lastEnd = Math.floor(T / HOUR) * HOUR;
  assert.equal(chart.points.at(-1)!.t, lastEnd);
  assert.equal(chart.points[0].t, lastEnd - 23 * HOUR);
  for (const p of chart.points) {
    const want = ref + (ref * 1.4 - ref) * 0.5 ** ((p.t - (T - 30 * HOUR)) / HOUR / hl);
    assert.ok(Math.abs(p.p - want) < 1e-9, `${p.t}: ${p.p} gegen ${want}`);
  }
  assert.ok(chart.points.every((p, i) => i === 0 || p.t > chart.points[i - 1].t), "aufsteigend");
  // Gleiche Stunde: nichts Neues; zwei Stunden später: zwei neue Zeilen je Ressource.
  await runMarketNewsTx(db, T + 10 * 60_000);
  assert.equal((await marketChartView(db, "stahl", T)).points.length, 24);
  await runMarketNewsTx(db, T + 2 * HOUR);
  const later = await marketChartView(db, "proviant", T + 2 * HOUR);
  assert.equal(later.points.length, 26);
  assert.ok(later.points.every((p) => Math.abs(p.p - balance.market.refPrice.proviant) < 1e-9));
  // Unbekannte Ressource: leer.
  assert.equal((await marketChartView(db, "gold", T)).points.length, 0);
  // Saisonende: Verlauf beginnt neu.
  await db.transaction((tx) => clearMarketNews(tx));
  assert.equal((await marketChartView(db, "stahl", T)).points.length, 0);
});

test("Börsenansicht: Tageslimit gleitend über 24 h mit Freigabezeit, alte Zustände überführt", async () => {
  const p = await trader("Fenster");
  const q = await marketQuote(engine, { side: "sell", resource: "stahl", qty: 1500 });
  assert.ok(q.ok);
  const t0 = Date.now();
  assert.equal((await trade(engine, p.playerId, key(), { side: "sell", resource: "stahl", qty: 1500, expectedPrice: q.executionPrice })).ok, true);
  const view = await marketView(engine, p.playerId);
  const st = view.resources.find((r) => r.id === "stahl")!;
  assert.equal(st.dailyUsed, 1500);
  assert.equal(st.dailyReleases.length, 1);
  assert.equal(st.dailyReleases[0].qty, 1500);
  const h = Math.floor(t0 / HOUR);
  assert.ok([h + 24, h + 25].includes(st.dailyReleases[0].atMs / HOUR), "frei 24 h nach Beginn der Stunde des Handels");
  const [row] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, p.playerId));
  const stored = row.trader as marketCore.TraderState;
  assert.ok(Array.isArray(stored.tradeHours) && stored.dailyVolume === undefined);

  // Zustand von vor v1.30 (Zähler je Spieltag): zählt bis Mitternacht Spielzeit.
  const old = { credits: stored.credits, recentTradeTimesMs: [], dailyDayIndex: marketCore.gameDayIndex(Date.now()), dailyVolume: { stahl: 700, treibstoff: 0, elektronik: 0, proviant: 0 } };
  await db.update(tables.player).set({ trader: old }).where(eq(tables.player.id, p.playerId));
  const v2 = (await marketView(engine, p.playerId)).resources.find((r) => r.id === "stahl")!;
  assert.equal(v2.dailyUsed, 700);
  assert.equal(v2.dailyReleases.length, 1);
  assert.equal(marketCore.gameDayIndex(v2.dailyReleases[0].atMs), marketCore.gameDayIndex(Date.now()) + 1, "frei zur nächsten Mitternacht");
  assert.equal(marketCore.gameDayIndex(v2.dailyReleases[0].atMs - 1), marketCore.gameDayIndex(Date.now()));
});

test("Knappheit: einmal je Spieltag (Spielzeitzone)", async () => {
  const T = Date.now();
  await runMarketNewsTx(db, T);
  const [s] = await db.select().from(tables.serverSetting).where(eq(tables.serverSetting.key, SCARCITY_KEY));
  assert.equal((JSON.parse(s.value) as { day: number }).day, marketCore.gameDayIndex(T));
});
