// Integrationstests Lieferverträge (v1.31) gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert):
// KI-Vertrag (Kauf, Abo, Nachfrist mit Strafe, Verkauf an die Festung, Kündigung, Rotbart-Konvoi), Vertrag zwischen
// Spielern mit Konvoi, Preisband, Paarbremse, Absprache-Schutz, Vormerkung im Tageslimit und Saisonende.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { isCoast, nestSites, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import {
  acceptPlayerContract, addBot, balance, GameError, cancelContract, chooseBase, colluded, contractBandView, contractsView, kiContractQuote,
  loadBot, marketView, processDue, proposePlayerContract, recordTies, register, seed, signKiContract, voidContracts, type Engine,
} from "../src/index.ts";
import { contractsTurn } from "../src/bots-contracts.ts";
import type { TurnCtx } from "../src/bots-war.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `lv${++keyN}-${Date.now()}`;
let fieldN = 0;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 12; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
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

async function stock(baseId: number, r: string): Promise<number> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return Math.floor((b.state as BaseState).resources[r] ?? 0);
}

async function setCredits(playerId: number, credits: number) {
  await db.execute(sql`update player set trader = jsonb_set(trader, '{credits}', ${String(credits)}::jsonb) where id = ${playerId}`);
}

async function creditsOf(playerId: number): Promise<number> {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  return (p.trader as { credits: number }).credits;
}

/** Hafen mit Börse, großem Lager (keine Produktion: Uhr steht durch resUpdatedAt in der Zukunft nicht still, daher Bestände fest setzen). */
async function human(name: string, res: Record<string, number> = {}) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(5 * fieldN++);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.buildings.hafenkommandantur = 5; s.buildings.kommandozentrale = 5; s.buildings.lagerkomplex = 10;
    for (const [k, v] of Object.entries(res)) s.resources[k] = v;
  });
  await setCredits(p.playerId, 20_000);
  return { playerId: p.playerId, baseId };
}

/** KI-Spieler mit Heimathafen; Lager auf fill (Anteil der Kapazität) je Ressource. */
async function ki(profile: string, fill: Record<string, number>) {
  const r = await addBot(engine, profile);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { playerId: number }).playerId;
  const [b] = await db.select().from(tables.base).where(eq(tables.base.playerId, id));
  await patchBase(b.id, (s) => {
    s.buildings.lagerkomplex = 10; s.buildings.hafenkommandantur = 3;
    const cap = storageCapacity(settle(s, Date.now(), balance), balance);
    for (const [k, v] of Object.entries(fill)) s.resources[k] = Math.floor(cap * v);
  });
  await setCredits(id, 500_000);
  return { playerId: id, baseId: b.id };
}

/** Nur die Ereignisse der Verträge und Lieferungen bis ms abarbeiten (Kartellwürfel aus: Ladung bleibt heil). */
async function runUntil(ms: number) {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.status} = 'pending' and ${tables.gameEvent.type} not in ('contract_due', 'delivery_arrive', 'mission_arrive', 'mission_return')`);
  while ((await processDue(engine, ms, 500)) > 0);
}

/** Vorschau wie über den Router (GameError → { ok: false, code }). */
async function tryQuote(playerId: number, input: Parameters<typeof kiContractQuote>[2]) {
  try {
    return await kiContractQuote(engine, playerId, input);
  } catch (err) {
    if (err instanceof GameError) return { ok: false, code: err.code };
    throw err;
  }
}

/** Ware an den Spieler laut Journal der Abwicklung (Produktion im Hafen läuft nebenher). */
async function deliveredTo(playerId: number, id: number, r: string): Promise<number> {
  const x = await db.execute<{ s: string }>(sql`select coalesce(sum(amount), 0)::text as s from trade_ledger
    where trade_id in (${`mc-${id}:settle`}, ${`mc-${id}:arrival`}) and account = ${`player:${playerId}`} and asset = ${r}`);
  return Number(x[0].s);
}

async function contract(id: number) {
  const [c] = await db.select().from(tables.marketContract).where(eq(tables.marketContract.id, id));
  return c;
}

async function sign(playerId: number, kiId: number, input: { side: "buy" | "sell"; resource: string; qty: number; days: number; abo?: boolean }, baseId?: number) {
  const q = await kiContractQuote(engine, playerId, { kiId, ...input, baseId });
  assert.equal(q.ok, true);
  return signKiContract(engine, playerId, key(), { kiId, ...input, expectedPrice: q.avgPrice, baseId });
}

/** Alle Journalzeilen der Verträge gehen je Wert auf 0 auf; Treuhandkonten abgeschlossener Verträge sind leer. */
async function ledgerBalanced() {
  const sums = await db.execute<{ asset: string; s: string }>(sql`select asset, sum(amount)::text as s from trade_ledger where trade_id like 'mc-%' and trade_id not like '%:arrival' group by asset`);
  for (const r of sums) assert.equal(Number(r.s), 0, `Journal ${r.asset}`);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.execute(sql`delete from server_setting where key = 'pvp_ties'`);
});

after(async () => {
  await client.end();
});

test("KI-Vertrag: Kauf bei Albers – Anzahlung, Treuhandware, Lieferung zur Fälligkeit, Tageslimit, Journal", async () => {
  const a = await human("VertragA", { stahl: 1000 });
  const albers = await ki("haendler", { stahl: 0.6, treibstoff: 0.6, elektronik: 0.1, proviant: 0.5 });
  const view = await contractsView(engine, a.playerId);
  assert.equal(view.enabled, true);
  const card = view.enabled ? view.kis.find((k) => k.id === albers.playerId) : null;
  assert.ok(card, "Albers bietet an");
  const offer = card.offers.find((o) => o.side === "buy" && o.resource === "stahl")!;
  assert.ok(offer.quota >= 2000 && offer.quota % 500 === 0, `Kontingent ${offer.quota}`);
  assert.equal(card.offers.find((o) => o.side === "buy" && o.resource === "elektronik")!.quota, 0, "unter 40 % kein Verkauf");

  const kiBefore = await stock(albers.baseId, "stahl");
  const q = await kiContractQuote(engine, a.playerId, { kiId: albers.playerId, side: "buy", resource: "stahl", qty: 2000, days: 1 });
  assert.ok(q.ok && q.avgPrice >= q.course * 1.045, "Preis ≥ Kurs × (1 + 4 % + 0,5 %)");
  assert.ok(q.ok && q.instantPrice !== null && q.avgPrice > q.instantPrice, "Termin nie billiger als die Börse");
  // Abweichung > 1 % → neu anbieten.
  assert.deepEqual(await signKiContract(engine, a.playerId, key(), { kiId: albers.playerId, side: "buy", resource: "stahl", qty: 2000, days: 1, expectedPrice: q.avgPrice * 0.9 }), { ok: false, code: "slippage" });
  const r = await sign(a.playerId, albers.playerId, { side: "buy", resource: "stahl", qty: 2000, days: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = await contract((r as { contractIds: number[] }).contractIds[0]);
  assert.equal(c.status, "offen");
  assert.equal(c.escrowQty, 2000);
  assert.equal(await stock(albers.baseId, "stahl"), kiBefore - 2000, "Ware der KI in Treuhand");
  assert.equal(await creditsOf(a.playerId), 20_000 - c.buyerDepositCents / 100);
  assert.equal(c.buyerDepositCents, Math.ceil(2000 * c.buyerUnit * 0.25 * 100 - 1e-6));
  // Vormerkung im Tageslimit der Börse (Lieferung in den nächsten 24 h).
  const mv = await marketView(engine, a.playerId);
  assert.equal(mv.resources.find((x) => x.id === "stahl")!.dailyReserved, 2000);
  // Zu viel: Kontingent je Mensch ⅓.
  assert.deepEqual(await signKiContract(engine, a.playerId, key(), { kiId: albers.playerId, side: "buy", resource: "stahl", qty: 50_000, days: 2, expectedPrice: 1 }), { ok: false, code: "quota" });

  const kiCredits = await creditsOf(albers.playerId);
  await runUntil(c.settleAt.getTime() + 1000);
  const done = await contract(c.id);
  assert.equal(done.status, "erfuellt");
  assert.equal(done.deliveredQty, 2000);
  // Konvoi von Albers' Hafen (Art „vertrag“), Ankunft zur Fälligkeit; Kartell hier ausgeschaltet (Zufall).
  const [acv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, done.deliveryId!));
  assert.ok(acv && acv.kind === "vertrag" && acv.senderId === albers.playerId && acv.recipientId === a.playerId, "Albers liefert per Konvoi");
  assert.equal(c.delivery, "konvoi");
  await db.update(tables.convoy).set({ cartelAt: null }).where(eq(tables.convoy.id, acv.id));
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.type, "convoy_raid"), sql`${tables.gameEvent.payload}->>'convoyId' = ${String(acv.id)}`));
  assert.equal(await deliveredTo(a.playerId, c.id, "stahl"), 0, "noch unterwegs");
  await runUntil(acv.arriveAt.getTime() + 1000);
  assert.equal(await deliveredTo(a.playerId, c.id, "stahl"), 2000);
  assert.ok(await stock(a.baseId, "stahl") >= 3000);
  const paid = Math.ceil(2000 * c.buyerUnit * 100 - 1e-6) / 100;
  assert.ok(Math.abs(await creditsOf(a.playerId) - (20_000 - paid)) < 0.011);
  assert.ok(Math.abs(await creditsOf(albers.playerId) - (kiCredits + Math.floor(2000 * c.sellerUnit * 100 + 1e-6) / 100)) < 0.011, "KI bekommt den Preis ohne Grundaufschlag");
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, a.playerId));
  const hours = (p.trader as { tradeHours?: { q: Record<string, number> }[] }).tradeHours ?? [];
  assert.equal(hours.reduce((s, h) => s + (h.q.stahl ?? 0), 0), 2000, "Lieferung zählt ins gleitende Tageslimit");
  const fee = await db.execute<{ s: string }>(sql`select sum(amount)::text as s from trade_ledger where trade_id = ${`mc-${c.id}:settle`} and account = 'fees'`);
  assert.ok(Number(fee[0].s) > 0, "Grundaufschlag in den Gebührentopf");
  await ledgerBalanced();
});

test("KI-Vertrag: Nachfrist 12 h, dann anteilig mit 25 % Strafe an die KI; Abo zählt als ein Vertrag; Kündigung", async () => {
  const b = await human("VertragB");
  const albers = (await db.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.botProfile, "haendler")))[0].id;
  const r = await sign(b.playerId, albers, { side: "buy", resource: "treibstoff", qty: 2000, days: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = await contract((r as { contractIds: number[] }).contractIds[0]);
  const deposit = c.buyerDepositCents / 100;
  await setCredits(b.playerId, 0);
  await runUntil(c.settleAt.getTime() + 1000);
  const grace = await contract(c.id);
  assert.equal(grace.status, "nachfrist");
  assert.equal(grace.graceUntil!.getTime(), c.settleAt.getTime() + 12 * HOUR);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, b.playerId));
  assert.ok(msgs.some((m) => m.subject === "Liefervertrag: Nachfrist"));
  const kiCredits = await creditsOf(albers);
  await runUntil(grace.graceUntil!.getTime() + 1000);
  const end = await contract(c.id);
  // Ohne Kredite deckt die Anzahlung 25 % je erfüllter Einheit: erfüllt wird nichts, 25 % des Werts verfallen.
  assert.equal(end.status, "geplatzt");
  assert.equal(end.deliveredQty, 0);
  assert.equal(end.buyerPenaltyCents, c.buyerDepositCents - (c.buyerDepositCents - Math.floor(2000 * c.buyerUnit * 0.25 * 100 + 1e-6)));
  assert.ok(Math.abs(await creditsOf(albers) - kiCredits - end.buyerPenaltyCents / 100) < 0.011, "Strafe an die KI");
  assert.ok(Math.abs(await creditsOf(b.playerId) - (deposit - end.buyerPenaltyCents / 100)) < 0.011, "Rest der Anzahlung zurück");

  // Abo: 3 Tranchen, ein offener Vertrag; Kündigung beendet alle, Ware zurück in das Lager der KI.
  await setCredits(b.playerId, 20_000);
  const kiBase = (await db.select().from(tables.base).where(eq(tables.base.playerId, albers)))[0].id;
  const before = await stock(kiBase, "proviant");
  const abo = await sign(b.playerId, albers, { side: "buy", resource: "proviant", qty: 500, days: 3, abo: true });
  assert.equal(abo.ok, true, JSON.stringify(abo));
  const ids = (abo as { contractIds: number[] }).contractIds;
  assert.equal(ids.length, 3);
  const v = await contractsView(engine, b.playerId);
  assert.equal(v.enabled && v.openCount, 1);
  assert.equal(await stock(kiBase, "proviant"), before - 1500);
  const credits = await creditsOf(b.playerId);
  const rows = await db.select().from(tables.marketContract).where(inArray(tables.marketContract.id, ids));
  const cancel = await cancelContract(engine, b.playerId, key(), ids[1]);
  assert.equal(cancel.ok, true, JSON.stringify(cancel));
  assert.equal((cancel as { cancelled: number }).cancelled, 3);
  const deposits = rows.reduce((s, x) => s + x.buyerDepositCents, 0);
  assert.ok(Math.abs(await creditsOf(b.playerId) - credits - (deposits - (cancel as { penaltyCredits: number }).penaltyCredits * 100) / 100) < 0.011);
  assert.equal(await stock(kiBase, "proviant"), before, "Treuhandware zurück");
  assert.ok((await db.select().from(tables.marketContract).where(inArray(tables.marketContract.id, ids))).every((x) => x.status === "gekuendigt"));
  // Rotbart verkauft kein Abo, Laufzeit nur 1–2 Tage.
  await ledgerBalanced();
});

test("KI-Vertrag: Verkauf an Falkenberg (Pfand, Spieler liefert) und Rotbart-Konvoi über die Seewege", async () => {
  const c0 = await human("VertragC", { stahl: 5000 });
  const falk = await ki("festung", { stahl: 0.2, elektronik: 0.2 });
  const quote = await tryQuote(c0.playerId, { kiId: falk.playerId, side: "sell", resource: "stahl", qty: 1000, days: 1 });
  assert.deepEqual(quote, { ok: false, code: "bad_term" }, "Festung erst ab 2 Tagen");
  assert.deepEqual(await tryQuote(c0.playerId, { kiId: falk.playerId, side: "buy", resource: "stahl", qty: 1000, days: 2 }), { ok: false, code: "not_offered" });
  const r = await sign(c0.playerId, falk.playerId, { side: "sell", resource: "stahl", qty: 1000, days: 2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = await contract((r as { contractIds: number[] }).contractIds[0]);
  assert.ok(c.sellerPledgeCents > 0 && c.buyerDepositCents >= Math.ceil(1000 * c.buyerUnit * 100 - 1e-6), "Pfand und voller Preis der KI in Treuhand");
  await runUntil(c.settleAt.getTime() + 1000);
  assert.equal((await contract(c.id)).status, "erfuellt");
  assert.equal(await deliveredTo(c0.playerId, c.id, "stahl"), -1000);

  // Rotbart: Treibstoff aus Prisen, Konvoi von seinem Hafen, Ankunft zur Fälligkeit.
  const rot = await ki("freibeuter", { treibstoff: 0.8, elektronik: 0.8 });
  assert.deepEqual(await tryQuote(c0.playerId, { kiId: rot.playerId, side: "buy", resource: "treibstoff", qty: 2500, days: 1 }), { ok: false, code: "quota" });
  assert.deepEqual(await tryQuote(c0.playerId, { kiId: rot.playerId, side: "buy", resource: "treibstoff", qty: 1000, days: 2, abo: true }), { ok: false, code: "no_abo" });
  const rr = await sign(c0.playerId, rot.playerId, { side: "buy", resource: "treibstoff", qty: 2000, days: 1 });
  assert.equal(rr.ok, true, JSON.stringify(rr));
  const rc = await contract((rr as { contractIds: number[] }).contractIds[0]);
  assert.equal(rc.delivery, "konvoi");
  assert.ok(rc.settleAt.getTime() < rc.dueAt.getTime(), "Abfahrt vor der Fälligkeit");
  await runUntil(rc.settleAt.getTime() + 1000);
  const sent = await contract(rc.id);
  assert.equal(sent.status, "erfuellt");
  assert.equal(sent.deliveryId, `mc-${rc.id}`);
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, sent.deliveryId!));
  assert.ok(cv && cv.kind === "vertrag" && cv.recipientId === c0.playerId && cv.senderId === rot.playerId, "Konvoi auf der Karte");
  // Ankunft zur Fälligkeit; ist der Seeweg länger als die Laufzeit, fährt er sofort und kommt später.
  assert.ok(cv.arriveAt.getTime() >= rc.dueAt.getTime());
  if (rc.settleAt.getTime() > rc.createdAt.getTime() + 120_000) assert.equal(cv.arriveAt.getTime(), rc.dueAt.getTime());
  assert.equal(await deliveredTo(c0.playerId, rc.id, "treibstoff"), 0, "noch unterwegs");
  await runUntil(cv.arriveAt.getTime() + 1000);
  assert.equal(await deliveredTo(c0.playerId, rc.id, "treibstoff"), 2000);
  await ledgerBalanced();
});

test("Vertrag zwischen Spielern: Preisband, Konvoi, Gebühr in den Topf, Verbindung für die PvP-Absprache, Paarbremse", async () => {
  const s = await human("VerkaeuferS", { stahl: 5000 });
  const k = await human("KaeuferK");
  const band = await contractBandView(engine, "stahl", 2);
  const price = band.course;
  assert.deepEqual(await proposePlayerContract(engine, s.playerId, key(), { side: "sell", resource: "stahl", qty: 1000, days: 2, price: band.max * 1.05 }), { ok: false, code: "price_band" });
  const p = await proposePlayerContract(engine, s.playerId, key(), { side: "sell", resource: "stahl", qty: 1000, days: 2, price, target: "KaeuferK" });
  assert.equal(p.ok, true, JSON.stringify(p));
  const id = (p as { contractId: number }).contractId;
  assert.ok((await creditsOf(s.playerId)) < 20_000, "Pfand in Treuhand");
  const view = await contractsView(engine, k.playerId);
  assert.ok(view.enabled && view.proposals.some((x) => x.id === id && x.personal && x.side === "buy"));
  assert.equal(await colluded(db, s.playerId, k.playerId, Date.now()), false);
  const acc = await acceptPlayerContract(engine, k.playerId, key(), id);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  const c = await contract(id);
  assert.equal(c.status, "offen");
  assert.equal(c.counts, true);
  assert.ok(c.settleAt.getTime() < c.dueAt.getTime());
  await runUntil(c.settleAt.getTime() + 1000);
  const sent = await contract(id);
  assert.equal(sent.status, "erfuellt");
  assert.equal(await deliveredTo(s.playerId, id, "stahl"), -1000);
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, `mc-${id}`));
  assert.ok(cv && cv.senderId === s.playerId && cv.recipientId === k.playerId);
  await runUntil(cv.arriveAt.getTime() + 1000);
  assert.equal(await deliveredTo(k.playerId, id, "stahl"), 1000);
  const fees = await db.execute<{ s: string }>(sql`select sum(amount)::text as s from trade_ledger where trade_id = ${`mc-${id}:settle`} and account = 'fees'`);
  assert.ok(Math.abs(Number(fees[0].s) - 1000 * price * 0.04) < 0.02, "4 % Grundaufschlag in den Gebührentopf");
  assert.equal(await colluded(db, s.playerId, k.playerId, Date.now()), true, "Lieferung verbindet das Paar");

  // Paarbremse: höchstens 20.000 Börsenwert je Paar und 7 Tage.
  await db.insert(tables.marketContract).values({
    kind: "spieler", status: "erfuellt", proposerId: s.playerId, sellerId: s.playerId, buyerId: k.playerId, resource: "stahl", qty: 19_000,
    buyerUnit: 1, sellerUnit: 0.96, course: 1, delivery: "konvoi", dueAt: new Date(), settleAt: new Date(), signedAt: new Date(),
  });
  const p2 = await proposePlayerContract(engine, s.playerId, key(), { side: "sell", resource: "stahl", qty: 1000, days: 2, price });
  assert.equal(p2.ok, true, JSON.stringify(p2));
  assert.deepEqual(await acceptPlayerContract(engine, k.playerId, key(), (p2 as { contractId: number }).contractId), { ok: false, code: "pair_limit" });
  await ledgerBalanced();
});

test("KI-Händler nutzt Verträge: nimmt ein deutlich günstiges öffentliches Angebot im Zug an, ein knappes nicht", async () => {
  const h = await human("HaendlerKunde");
  const albersId = (await db.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.botProfile, "haendler")))[0].id;
  const bot = (await loadBot(db, albersId))!;
  const [kb] = await db.select().from(tables.base).where(eq(tables.base.playerId, albersId));
  const band = await contractBandView(engine, "stahl", 2);
  const thin = await proposePlayerContract(engine, h.playerId, key(), { side: "buy", resource: "stahl", qty: 600, days: 2, price: band.course * 1.01 });
  const fat = await proposePlayerContract(engine, h.playerId, key(), { side: "buy", resource: "stahl", qty: 600, days: 2, price: Math.min(band.max, band.course * 1.15) });
  assert.equal(thin.ok && fat.ok, true, JSON.stringify([thin, fat]));
  const log: string[] = [];
  const ctx = { engine, bot, cfg: { trade: true } as never, nowMs: Date.now(), rand: () => 0.5, log, key: (w: string) => `${w}-${key()}`, state: bot.state } as unknown as TurnCtx;
  const base = { ...kb, state: settle(kb.state as BaseState, Date.now(), balance) } as never;
  await contractsTurn(ctx, base, {});
  assert.equal((await contract((thin as { contractId: number }).contractId)).status, "angeboten");
  const won = await contract((fat as { contractId: number }).contractId);
  assert.equal(won.status, "offen");
  assert.equal(won.sellerId, albersId);
  assert.ok(log.some((l) => l.startsWith("Vertrag: liefert 600 Stahl")));
});

test("Absprache-Schutz: verbundene Spieler dürfen, der Vertrag zählt aber nicht für Erfolge und Tagesbefehle", async () => {
  const a = await human("VerbundA", { elektronik: 3000 });
  const b = await human("VerbundB");
  await recordTies(db, [a.playerId], [b.playerId], Date.now());
  const band = await contractBandView(engine, "elektronik", 1);
  const p = await proposePlayerContract(engine, b.playerId, key(), { side: "buy", resource: "elektronik", qty: 500, days: 1, price: band.course });
  assert.equal(p.ok, true, JSON.stringify(p));
  const id = (p as { contractId: number }).contractId;
  assert.deepEqual(await acceptPlayerContract(engine, b.playerId, key(), id), { ok: false, code: "own_offer" });
  const acc = await acceptPlayerContract(engine, a.playerId, key(), id);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  assert.equal((await contract(id)).counts, false);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, b.playerId));
  assert.ok(msgs.some((m) => m.body.includes("zählt nicht für Erfolge")));
});

test("Saisonende: Laufzeiten nur bis 24 h vor Ende; offene Verträge rückabgewickelt, Treuhand ausgebucht", async () => {
  const d = await human("SaisonD");
  const albers = (await db.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.botProfile, "haendler")))[0].id;
  const [season] = await db.select().from(tables.season).where(eq(tables.season.status, "running"));
  await db.update(tables.season).set({ endsAt: new Date(Date.now() + 2.5 * DAY) }).where(eq(tables.season.id, season.id));
  try {
    assert.deepEqual(await tryQuote(d.playerId, { kiId: albers, side: "buy", resource: "stahl", qty: 500, days: 2 }), { ok: false, code: "bad_term" });
    const v = await contractsView(engine, d.playerId);
    assert.deepEqual(v.enabled && v.cfg.days, [1]);
    const r = await sign(d.playerId, albers, { side: "buy", resource: "stahl", qty: 500, days: 1 });
    assert.equal(r.ok, true, JSON.stringify(r));
    await db.transaction((tx) => voidContracts(tx, season.number, Date.now()));
    const open = await db.select().from(tables.marketContract).where(inArray(tables.marketContract.status, ["angeboten", "offen", "nachfrist"]));
    assert.equal(open.length, 0);
    const esc = await db.execute<{ s: string }>(sql`select coalesce(sum(amount), 0)::text as s from trade_ledger where account like 'escrow:mc-%'`);
    assert.equal(Number(esc[0].s), 0);
    const rows = await db.select().from(tables.marketContract).where(like(tables.marketContract.status, "rueck%"));
    assert.ok(rows.length >= 1);
  } finally {
    await db.update(tables.season).set({ endsAt: season.endsAt }).where(eq(tables.season.id, season.id));
  }
});
