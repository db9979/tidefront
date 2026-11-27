// Integrationstests Marktnachrichten gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { isCoast, nestSites, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { market as marketCore, type BaseState } from "@tidefront/game-core";
import {
  auditLedger, balance, chooseBase, marketNewsView, marketQuote, marketRefs, marketView, register, runMarketNewsTx, runningSeason,
  seed, spawnWorldEvent, trade, upsertNews, REF_OFFSETS_KEY, SCARCITY_KEY, type Engine,
} from "../src/index.ts";
import { endWorldEvent, lockWorldEvent } from "../src/world-events.ts";
import { collectNewsPush } from "../src/market-news.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const news = balance.market.news!;
const base = balance.market.refPrice;
let keyN = 0;
const key = () => `mn${++keyN}-${Date.now()}`;
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

/** Spieler mit Hafen ohne Anfängerschutz; aktiv (lastSeenAt jetzt), wenn active. */
async function newPlayer(name: string, active = true) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(3 * fieldN++);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  await db.update(tables.player).set({ lastSeenAt: active ? new Date() : null }).where(eq(tables.player.id, p.playerId));
  return { playerId: p.playerId, baseId };
}

async function rowsOf(keyName: string) {
  return db.select().from(tables.marketNews).where(eq(tables.marketNews.key, keyName));
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.marketNews);
  await db.delete(tables.serverSetting).where(inArray(tables.serverSetting.key, [REF_OFFSETS_KEY, SCARCITY_KEY]));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
  await db.update(tables.worldEvent).set({ status: "ended", outcome: "test", endedAt: new Date(Date.now() - 30 * DAY) });
  await db.update(tables.player).set({ lastSeenAt: null });
});

after(async () => {
  await client.end();
});

test("ohne Nachrichten: effektiver Richtwert exakt der Grundrichtwert", async () => {
  const m = await marketRefs(db, Date.now());
  assert.deepEqual(m.refs, base);
  const v = await marketNewsView(db);
  assert.equal(v.news.length, 0);
  assert.deepEqual(v.refs.map((r) => r.effective), Object.values(base));
});

test("Weltereignis verschiebt den Richtwert sanft und klingt nach dem Ende ab", async () => {
  const p = await newPlayer("Belagert");
  const season = await runningSeason(db);
  const T = Date.now();
  const ev = await db.transaction((tx) => spawnWorldEvent(tx, T, "belagerung", season!.id, 0, p.baseId));
  assert.ok(ev && ev.kind === "belagerung");
  // Hook beim Entstehen: Proviant +10 %.
  const rows = await rowsOf(`we:${ev.id}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resource, "proviant");
  assert.equal(rows[0].pct, 0.1);
  assert.match(rows[0].reason, /Belagerung von Hafen Belagert/);
  // Noch kein Stand gespeichert: keine Bewegung. Danach höchstens 5 % je Stunde.
  assert.equal((await marketRefs(db, T)).refs.proviant, base.proviant);
  await runMarketNewsTx(db, T);
  const oneH = await marketRefs(db, T + HOUR);
  assert.ok(Math.abs(oneH.offsets.proviant - 0.05) < 1e-9, `nach 1 h: ${oneH.offsets.proviant}`);
  assert.equal(oneH.target.proviant, 0.1);
  await runMarketNewsTx(db, T + 3 * HOUR);
  const full = await marketRefs(db, T + 3 * HOUR);
  assert.ok(Math.abs(full.refs.proviant - base.proviant * 1.1) < 1e-12);
  // Börse: Richtwert und Kurs folgen dem effektiven Richtwert; Liste zeigt die Nachricht.
  const view = await marketNewsView(db, T + 3 * HOUR);
  const item = view.news.find((n) => n.resource === "proviant" && n.source === "weltereignis");
  assert.ok(item && item.active && item.direction === "up" && item.title.includes("Proviant +10 %"));
  // Ende nach 4 h: Hook setzt das Ende, danach klingt die Wirkung über fadeHours ab.
  const E = T + 4 * HOUR;
  await db.transaction(async (tx) => {
    const row = await lockWorldEvent(tx, ev.id);
    await endWorldEvent(tx, row!, "expired", E);
  });
  const [ended] = await rowsOf(`we:${ev.id}`);
  assert.equal(ended.endsAt.getTime(), E);
  assert.equal(ended.fadeMinutes, news.worldEvents.belagerung.fadeHours * 60);
  const half = await marketRefs(db, E + (news.worldEvents.belagerung.fadeHours / 2) * HOUR);
  assert.ok(Math.abs(half.target.proviant - 0.05) < 1e-9, `halb abgeklungen: ${half.target.proviant}`);
  assert.ok(Math.abs(half.offsets.proviant - 0.05) < 1e-9);
  await runMarketNewsTx(db, E + news.worldEvents.belagerung.fadeHours * HOUR + 1);
  const gone = await marketRefs(db, E + news.worldEvents.belagerung.fadeHours * HOUR + 2);
  assert.equal(gone.refs.proviant, base.proviant, "nach dem Abklingen exakt der Grundrichtwert");
});

test("Schatzschiff erbeutet: Stahl und Elektronik −10 % ab dem Ausgang", async () => {
  const p = await newPlayer("Kaperer");
  const season = await runningSeason(db);
  const T = Date.now();
  const ev = await db.transaction((tx) => spawnWorldEvent(tx, T, "schatzschiff", season!.id, 0, p.baseId));
  assert.ok(ev);
  assert.equal((await rowsOf(`we:${ev.id}`)).length, 0, "unterwegs keine Wirkung");
  await db.transaction(async (tx) => endWorldEvent(tx, (await lockWorldEvent(tx, ev.id))!, "defeated", T + HOUR, p.playerId));
  const rows = await rowsOf(`we:${ev.id}`);
  assert.deepEqual(rows.map((r) => [r.resource, r.pct]).sort(), [["elektronik", -0.1], ["stahl", -0.1]]);
  assert.equal(rows[0].endsAt.getTime(), T + HOUR + news.worldEvents.schatzschiffErbeutet.holdHours * HOUR);
});

test("Deckel: Summe der Einflüsse je Ressource höchstens ±25 %", async () => {
  const T = Date.now();
  await db.transaction(async (tx) => {
    for (const [i, pct] of [0.15, 0.12, 0.1, 0.08].entries()) {
      await upsertNews(tx, { key: `test:${i}`, source: "weltereignis", resource: "treibstoff", pct, reason: "Test", startMs: T, endMs: T + DAY, fadeMs: 0 }, T);
    }
    await upsertNews(tx, { key: "test:neg", source: "weltereignis", resource: "stahl", pct: -0.6, reason: "Test", startMs: T, endMs: T + DAY, fadeMs: 0 }, T);
  });
  await runMarketNewsTx(db, T);
  const m = await marketRefs(db, T + 10 * HOUR);
  assert.equal(m.target.treibstoff, 0.25);
  assert.equal(m.offsets.treibstoff, 0.25);
  assert.ok(Math.abs(m.refs.treibstoff - base.treibstoff * 1.25) < 1e-12);
  assert.equal(m.offsets.stahl, -0.25);
});

test("Knappheit: erst ab 3 aktiven Häfen, Median-basiert und robust gegen einen Ausreißer", async () => {
  const T = Date.now();
  const a = await newPlayer("Knapp1");
  const b = await newPlayer("Knapp2");
  await newPlayer("Inaktiv", false);
  const low = (s: BaseState) => { for (const r of balance.resources) s.resources[r] = 500; };
  await patchBase(a.baseId, low);
  await patchBase(b.baseId, low);
  await runMarketNewsTx(db, T);
  assert.equal((await rowsOf("knappheit")).length, 0, "zwei aktive Häfen: keine Wirkung");
  const c = await newPlayer("Knapp3");
  const d = await newPlayer("Knapp4");
  await patchBase(c.baseId, low);
  await patchBase(d.baseId, low);
  await db.delete(tables.serverSetting).where(eq(tables.serverSetting.key, SCARCITY_KEY));
  await runMarketNewsTx(db, T + 1000);
  const rows = await rowsOf("knappheit");
  const stahl = rows.find((r) => r.resource === "stahl");
  assert.ok(stahl && stahl.pct > 0 && stahl.pct <= news.scarcity.max, `knapp: ${stahl?.pct}`);
  assert.match(stahl.reason, /knapp/);
  // Am selben Tag kein zweiter Tageswert.
  const count = (await rowsOf("knappheit")).length;
  await patchBase(a.baseId, (s) => { for (const r of balance.resources) s.resources[r] = 0; });
  await runMarketNewsTx(db, T + 2000);
  assert.equal((await rowsOf("knappheit")).length, count);
  // Ein einzelner Spieler mit riesigem Lager verschiebt den Median kaum.
  const whale = await newPlayer("Wal");
  await patchBase(whale.baseId, (s) => { s.buildings.lagerkomplex = 20; for (const r of balance.resources) s.resources[r] = 10_000_000; });
  await db.delete(tables.serverSetting).where(eq(tables.serverSetting.key, SCARCITY_KEY));
  await runMarketNewsTx(db, T + 3000);
  const after = (await rowsOf("knappheit")).filter((r) => r.resource === "stahl").sort((x, y) => y.id - x.id)[0];
  assert.ok(Math.abs(after.pct - stahl.pct) <= 0.01, `Ausreißer verschiebt ${stahl.pct} → ${after.pct}`);
});

test("Saisonende: Stahl und Elektronik steigen in den letzten 7 Tagen tageweise bis +8 %", async () => {
  const season = await runningSeason(db);
  const end = season!.endsAt.getTime();
  await runMarketNewsTx(db, end - 8 * DAY);
  assert.equal((await rowsOf("saison")).length, 0, "vor der letzten Woche keine Wirkung");
  await runMarketNewsTx(db, end - 5.5 * DAY);
  let rows = (await rowsOf("saison")).filter((r) => r.endsAt.getTime() > end - 5.5 * DAY);
  assert.deepEqual(rows.map((r) => [r.resource, r.pct]).sort(), [["elektronik", 0.023], ["stahl", 0.023]]);
  await runMarketNewsTx(db, end - HOUR);
  rows = (await rowsOf("saison")).filter((r) => r.endsAt.getTime() > end - HOUR);
  assert.deepEqual(rows.map((r) => [r.resource, r.pct]).sort(), [["elektronik", 0.08], ["stahl", 0.08]]);
  assert.match(rows[0].reason, /Saisonende in 1 Tag/);
  const sooner = await marketRefs(db, end - HOUR);
  assert.ok(sooner.target.stahl === 0.08 && sooner.offsets.stahl > 0);
});

/** Spieler mit Börse und Treibstoff (Taler nur aus Verkäufen, damit das Journal stimmt); Richtwert Treibstoff +20 %, Kurs seit einer Halbwertszeit am Grundrichtwert. */
async function shiftedMarket(name: string) {
  const p = await newPlayer(name);
  await patchBase(p.baseId, (s) => {
    s.buildings.hafenkommandantur = 5; s.buildings.kommandozentrale = 5; s.buildings.lagerkomplex = 8;
    s.resources.treibstoff = 50_000; s.resources.stahl = 50_000;
  });
  const now = Date.now();
  await db.transaction((tx) => upsertNews(tx, { key: "test:handel", source: "kriegslage", resource: "treibstoff", pct: 0.2, reason: "Test", startMs: now - DAY, endMs: now + DAY, fadeMs: 0 }, now));
  await db.insert(tables.serverSetting).values({ key: REF_OFFSETS_KEY, value: JSON.stringify({ atMs: now - 10 * HOUR, offset: { treibstoff: 0.2 } }) })
    .onConflictDoUpdate({ target: tables.serverSetting.key, set: { value: JSON.stringify({ atMs: now - 10 * HOUR, offset: { treibstoff: 0.2 } }) } });
  const hl = balance.market.reversionHalfLifeHours * HOUR;
  const state = { price: base.treibstoff, lastUpdateMs: now - hl, haltedUntilMs: 0, history: [{ tMs: now - hl, price: base.treibstoff }] };
  await db.update(tables.market).set({ state }).where(eq(tables.market.resource, "treibstoff"));
  return { ...p, state };
}

test("Handel, Angebot und Börsenansicht nutzen den effektiven Richtwert", async () => {
  const p = await shiftedMarket("Haendler");
  const eff = base.treibstoff * 1.2;
  const view = await marketView(engine, p.playerId);
  const t = view.resources.find((r) => r.id === "treibstoff")!;
  assert.ok(Math.abs(t.ref - eff) < 1e-12 && t.baseRef === base.treibstoff);
  // Nach einer Halbwertszeit liegt der Kurs auf halbem Weg zum effektiven Richtwert.
  assert.ok(Math.abs(t.price - (eff + (base.treibstoff - eff) * 0.5)) < 1e-3, `Kurs ${t.price}`);
  const q = await marketQuote(engine, { side: "sell", resource: "treibstoff", qty: 1000 });
  assert.ok(q.ok);
  const r = await trade(engine, p.playerId, key(), { side: "sell", resource: "treibstoff", qty: 1000, expectedPrice: q.executionPrice });
  assert.equal(r.ok, true, JSON.stringify(r));
  const expectedBefore = marketCore.currentPrice(p.state, "treibstoff", balance as never, Date.now(), { treibstoff: eff });
  const before = (r as unknown as { quote: { priceBefore: number } }).quote.priceBefore;
  assert.ok(Math.abs(before - expectedBefore) < 1e-4, `${before} gegen ${expectedBefore}`);
  assert.ok(before > base.treibstoff * 1.05, "ohne Nachricht läge der Kurs am Grundrichtwert");
});

test("keine Taler aus dem Nichts: Verkauf und Rückkauf bei verschobenem Richtwert verliert, Journal stimmt", async () => {
  const p = await shiftedMarket("Zocker");
  // Taler für den Rückkauf aus einem Stahlverkauf (über das Journal).
  const qStahl = await marketQuote(engine, { side: "sell", resource: "stahl", qty: 3000 });
  assert.ok(qStahl.ok);
  assert.equal((await trade(engine, p.playerId, key(), { side: "sell", resource: "stahl", qty: 3000, expectedPrice: qStahl.executionPrice })).ok, true);
  const [before] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, p.playerId));
  const credits0 = (before.trader as { credits: number }).credits;
  const qs = await marketQuote(engine, { side: "sell", resource: "treibstoff", qty: 2000 });
  assert.ok(qs.ok);
  const sold = await trade(engine, p.playerId, key(), { side: "sell", resource: "treibstoff", qty: 2000, expectedPrice: qs.executionPrice });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const qb = await marketQuote(engine, { side: "buy", resource: "treibstoff", qty: 2000 });
  assert.ok(qb.ok);
  const bought = await trade(engine, p.playerId, key(), { side: "buy", resource: "treibstoff", qty: 2000, expectedPrice: qb.executionPrice });
  assert.equal(bought.ok, true, JSON.stringify(bought));
  const [afterRow] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, p.playerId));
  const credits1 = (afterRow.trader as { credits: number }).credits;
  assert.ok(credits1 < credits0, `Taler ${credits0} → ${credits1}`);
  const audit = await auditLedger(engine);
  assert.equal(audit.ok, true, JSON.stringify(audit));
});

test("Push „Marktnachricht“ nur an Geräte mit eingeschalteter Art, ab pushMinPct, einmal", async () => {
  const a = await newPlayer("PushJa");
  const b = await newPlayer("PushNein");
  await db.insert(tables.pushSubscription).values([
    { playerId: a.playerId, endpoint: `https://push.test/${key()}`, p256dh: "x", auth: "y", prefs: { market: true } },
    { playerId: b.playerId, endpoint: `https://push.test/${key()}`, p256dh: "x", auth: "y", prefs: {} },
  ]);
  const T = Date.now();
  const jobs = await db.transaction(async (tx) => {
    await upsertNews(tx, { key: "test:push", source: "weltereignis", resource: "proviant", pct: 0.12, reason: "Großflotte vor Testhafen", startMs: T, endMs: T + DAY, fadeMs: 0 }, T);
    await upsertNews(tx, { key: "test:klein", source: "kriegslage", resource: "treibstoff", pct: 0.02, reason: "Kleinkram", startMs: T, endMs: T + DAY, fadeMs: 0 }, T);
    return collectNewsPush(tx, T);
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].playerId, a.playerId);
  assert.equal(jobs[0].notice.kind, "market");
  assert.match(jobs[0].notice.body, /Großflotte vor Testhafen – Proviant \+12 %/);
  const again = await db.transaction((tx) => collectNewsPush(tx, T + 1));
  assert.equal(again.length, 0, "nur einmal");
});

test("Kriegslage: ruhige See senkt Treibstoff um 4 %", async () => {
  const T = Date.now();
  await runMarketNewsTx(db, T);
  const [row] = await rowsOf("kriegslage");
  assert.equal(row.resource, "treibstoff");
  assert.equal(row.pct, news.war.calm);
  assert.match(row.reason, /Ruhige See/);
});
