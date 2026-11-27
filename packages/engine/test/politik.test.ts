// Integrationstests Weltpolitik (docs/REGELN-WELTPOLITIK.md) gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die
// Datenbank wird geleert): Saisonplan und Seerat-Sitzung (Öffnen, geheime Stimme, Auszählung, Fenster, Nachricht),
// Gesuch anbieten/annehmen/erfüllen mit Lohn und Ansehen, wirksame Balance in Börse, Kartell-Überfall und Konvoi.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex, nestSites } from "@tidefront/world";
import { cartelChance, settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import {
  acceptGesuch, addBot, ansehenAll, balance, balanceNow, chooseBase, declineGesuch, ensurePolitikPlan, invalidatePolitikCache, kiAccess, lageView,
  marketView, politikKiView, politikOverview, processDue, register, seed, seeratVote, settleGesuche, offerGesuche, trade, type Engine,
} from "../src/index.ts";
import { politikMeta } from "../src/politik-view.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `pol${++keyN}-${Date.now()}`;
let fieldN = 0;
const PROD = ["stahlwerk", "raffinerie", "chipfabrik", "versorgungshof"];

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

/** Mensch mit Börse, großem Lager, ohne Anfängerschutz, gerade gesehen (zählt als aktiv). */
async function human(name: string, res: Record<string, number> = {}) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(5 * fieldN++);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.buildings.hafenkommandantur = 5; s.buildings.kommandozentrale = 5; s.buildings.lagerkomplex = 10;
    for (const b of PROD) s.buildings[b] = 5;
    s.buildings.kraftwerk = 10;
    for (const [k, v] of Object.entries(res)) s.resources[k] = v;
  });
  await setCredits(p.playerId, 20_000);
  await db.update(tables.player).set({ lastSeenAt: new Date() }).where(eq(tables.player.id, p.playerId));
  return { playerId: p.playerId, baseId };
}

async function ki(profile: string, fill: Record<string, number>) {
  const r = await addBot(engine, profile);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { playerId: number }).playerId;
  const [b] = await db.select().from(tables.base).where(eq(tables.base.playerId, id));
  await patchBase(b.id, (s) => {
    s.buildings.lagerkomplex = 10; s.buildings.hafenkommandantur = 3;
    for (const b of PROD) s.buildings[b] = 8;
    s.buildings.kraftwerk = 12;
    const cap = storageCapacity(settle(s, Date.now(), balance), balance);
    for (const [k, v] of Object.entries(fill)) s.resources[k] = Math.floor(cap * v);
  });
  await setCredits(id, 500_000);
  return { playerId: id, baseId: b.id };
}

/** Ereignisse bis ms (ohne Kartell-Überfälle und Weltereignisse, die hier nur stören). */
async function runUntil(ms: number) {
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.status, "pending"),
    inArray(tables.gameEvent.type, ["raid_launch", "attack_warning", "world_event_spawn", "field_tick", "market_news_tick"])));
  while ((await processDue(engine, ms, 500)) > 0);
}

async function moveEvent(type: string, field: string, id: number, atMs: number) {
  await db.execute(sql`update game_event set due_at = ${new Date(atMs).toISOString()}::timestamptz
    where status = 'pending' and type = ${type} and payload->>${field} = ${String(id)}`);
}

let seasonId = 0;
let A: Awaited<ReturnType<typeof human>>;
let B: Awaited<ReturnType<typeof human>>;
let C: Awaited<ReturnType<typeof human>>;
let hanse: Awaited<ReturnType<typeof ki>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Saison vor 8,6 Tagen begonnen (das erste Gezeit-Fenster liegt an Tag 9,5 … 10,5).
  const start = Date.now() - 8.6 * DAY;
  const [s] = await db.update(tables.season).set({ startsAt: new Date(start), endsAt: new Date(start + 42 * DAY) }).where(eq(tables.season.status, "running")).returning();
  seasonId = s.id;
  A = await human("PolA", { stahl: 60_000, treibstoff: 60_000, elektronik: 30_000, proviant: 60_000 });
  B = await human("PolB");
  C = await human("PolC");
  hanse = await ki("haendler", { stahl: 0.6, treibstoff: 0.6, elektronik: 0.5, proviant: 0.6 });
});

after(async () => {
  await client.end();
});

test("Saisonplan: einmal je Saison, 3 Gezeit-Fenster und 4 Wochenfenster, Sitzungen mit Ereignissen; meta liefert den Plan", async () => {
  const n = await ensurePolitikPlan(db, Date.now());
  assert.equal(n, 7);
  assert.equal(await ensurePolitikPlan(db, Date.now()), 0, "zweiter Lauf tut nichts");
  const w = await db.select().from(tables.politikFenster).where(eq(tables.politikFenster.seasonId, seasonId));
  assert.equal(w.filter((x) => x.slot === "gezeit").length, 3);
  assert.equal(w.filter((x) => x.slot === "woche" && x.effect === "ruhig").length, 4);
  const s = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.seasonId, seasonId));
  assert.equal(s.length, 7);
  const ev = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.status, "pending"), inArray(tables.gameEvent.type, ["politik_start", "seerat_close"])));
  assert.ok(ev.length >= 8, "Ereignisse für künftige Fenster und Sitzungen");
  const meta = await politikMeta(db);
  assert.equal(meta.plan.windows.length, 7);
  assert.ok(meta.validUntilMs !== null);
});

test("Seerat: Sitzung öffnet (Push an Nichtwähler, Lage), Stimme geheim und änderbar, Auszählung mit KI-Stimme, Fenster und Nachricht", async () => {
  const [g1] = await db.select().from(tables.politikFenster).where(and(eq(tables.politikFenster.seasonId, seasonId), eq(tables.politikFenster.slot, "gezeit"), eq(tables.politikFenster.idx, 1)));
  const [sz] = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.fensterId, g1.id));
  const now = Date.now();
  await db.update(tables.seeratSitzung).set({ opensAt: new Date(now - HOUR), closesAt: new Date(now + HOUR) }).where(eq(tables.seeratSitzung.id, sz.id));
  await moveEvent("seerat_open", "sitzungId", sz.id, now - HOUR);
  await moveEvent("seerat_close", "sitzungId", sz.id, now + HOUR);
  const options = sz.options as string[];
  assert.equal(options[0], "plan");
  assert.equal(options[2], "ruhig");


  await runUntil(now);
  const [open] = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, sz.id));
  assert.equal(open.status, "offen");
  const lage = await lageView(engine, B.playerId);
  assert.ok(lage.waiting.some((r) => r.key === `seerat:${sz.id}`), "Lage: Der Seerat tagt");

  assert.deepEqual(await seeratVote(engine, A.playerId, key(), { sitzungId: sz.id, option: "bogus" }), { ok: false, code: "bad_option" });
  assert.deepEqual(await seeratVote(engine, hanse.playerId, key(), { sitzungId: sz.id, option: options[1] }), { ok: false, code: "bot" });
  assert.equal((await seeratVote(engine, A.playerId, key(), { sitzungId: sz.id, option: "plan" })).ok, true);
  assert.equal((await seeratVote(engine, A.playerId, key(), { sitzungId: sz.id, option: options[1] })).ok, true, "Stimme änderbar");
  assert.equal((await seeratVote(engine, B.playerId, key(), { sitzungId: sz.id, option: options[1] })).ok, true);
  assert.equal((await seeratVote(engine, C.playerId, key(), { sitzungId: sz.id, option: options[1] })).ok, true);
  assert.equal((await lageView(engine, B.playerId)).waiting.some((r) => r.key === `seerat:${sz.id}`), false, "nach der Stimme keine Lage-Zeile");

  const ovB = await politikOverview(engine, B.playerId);
  const viewB = ovB.seerat.find((x) => x.id === sz.id)!;
  assert.equal(viewB.status, "offen");
  assert.equal(viewB.myVote, options[1]);
  assert.equal(viewB.votes, 3);
  assert.equal(viewB.tally, null, "geheim bis zum Schluss");

  await runUntil(now + HOUR + 1000);
  const [closed] = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, sz.id));
  assert.equal(closed.status, "geschlossen");
  assert.equal(closed.result, options[1], JSON.stringify(closed.tally));
  const tally = closed.tally as { kiVotes: { kiId: number; weight: number }[]; humanVotes: Record<string, number>; quorumMet: boolean };
  assert.equal(tally.quorumMet, true);
  assert.deepEqual(tally.humanVotes, { [options[1]]: 3 });
  assert.equal(tally.kiVotes.length, 1);
  assert.equal(tally.kiVotes[0].weight, 1, "KI zusammen eine Stimme");
  const [w] = await db.select().from(tables.politikFenster).where(eq(tables.politikFenster.id, g1.id));
  assert.equal(w.effect, options[1]);
  assert.equal(w.source, "seerat");
  const msgs = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, C.playerId), sql`${tables.message.subject} like 'Seerat:%'`));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].body, /KI-Spieler \(zusammen eine Stimme\)/);
  assert.deepEqual(await seeratVote(engine, A.playerId, key(), { sitzungId: sz.id, option: "plan" }), { ok: false, code: "session_closed" });
  const after = (await politikOverview(engine, C.playerId)).seerat.find((x) => x.id === sz.id)!;
  assert.equal(after.myVote, options[1]);
  assert.ok(after.tally, "nach dem Schluss Ergebnis (ohne Namen)");
  assert.equal(JSON.stringify(after.tally).includes("PolA"), false);

  // Wirkung im Fenster: der Beschluss verschiebt die Regler, vorher nicht.
  const inside = await balanceNow(db, w.startsAt.getTime() + HOUR);
  assert.ok(inside.politikNow, "Beschluss wirkt im Fenster");
  assert.equal(await balanceNow(db, w.startsAt.getTime() - HOUR), balance);
});

test("Wirksame Balance in Börse, Kartell-Überfall und Konvoi (Handelskrise, Kartellfehde, Geleitschutz)", async () => {
  const now = Date.now();
  const ins = async (idx: number, effect: string) => {
    const [r] = await db.insert(tables.politikFenster).values({ seasonId, slot: "gezeit", idx, planKind: effect, effect, source: "admin", startsAt: new Date(now - HOUR), endsAt: new Date(now + 2 * HOUR) }).returning();
    invalidatePolitikCache();
    return r.id;
  };
  const drop = async (id: number) => {
    await db.delete(tables.politikFenster).where(eq(tables.politikFenster.id, id));
    invalidatePolitikCache();
  };
  // Handelskrise: Gebühr 6 %, Tageslimit 15 % – in Ansicht und Handel (kleines Lager, damit die Menge den Kurs kaum bewegt).
  await patchBase(B.baseId, (s) => { s.buildings.lagerkomplex = 1; s.resources.stahl = 3000; });
  const before = await marketView(engine, B.playerId);
  assert.equal(before.fee, 0.04);
  const limit20 = before.resources.find((r) => r.id === "stahl")!.dailyLimit;
  const krise = await ins(91, "handelskrise");
  const mv = await marketView(engine, B.playerId);
  assert.ok(Math.abs(mv.fee - 0.06) < 1e-12);
  assert.equal(mv.baseFee, 0.04);
  const limit15 = mv.resources.find((r) => r.id === "stahl")!.dailyLimit;
  assert.ok(Math.abs(limit15 - Math.floor(limit20 * 0.75)) <= 1, `${limit15} vs ${limit20}`);
  const qty = Math.floor((limit15 + limit20) / 2);
  const price = mv.resources.find((r) => r.id === "stahl")!.price;
  const r = await trade(engine, B.playerId, key(), { side: "sell", resource: "stahl", qty, expectedPrice: price });
  assert.deepEqual(r, { ok: false, code: "daily_limit" }, "Menge über dem verkleinerten Tageslimit");
  const meta = await politikMeta(db);
  assert.ok(meta.plan.windows.some((x) => x.id === krise));
  assert.equal(meta.validUntilMs, now + 2 * HOUR);
  await drop(krise);

  // Kartellfehde: der nächste Überfall kommt nach 36 statt 18 h.
  const fehde = await ins(92, "kartellfehde");
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.baseId, B.baseId)));
  await db.insert(tables.gameEvent).values({ dueAt: new Date(now), type: "raid_launch", payload: {}, baseId: B.baseId });
  while ((await processDue(engine, now, 50)) > 0);
  const [next] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.baseId, B.baseId), eq(tables.gameEvent.status, "pending")));
  assert.equal(next.dueAt.getTime() - now, balance.pirates.raidIntervalHours * 2 * HOUR);
  await drop(fehde);

  // Geleitschutz: Kartellchance der Konvois halbiert (dieselbe Balance liest createConvoy).
  const geleit = await ins(93, "geleitschutz");
  const eff = await balanceNow(db, now);
  assert.ok(Math.abs(cartelChance(600, 20_000, eff) - cartelChance(600, 20_000, balance) / 2) < 1e-9);
  await drop(geleit);
  assert.equal(await balanceNow(db, now), balance);
});

test("Gesuch: Angebot je Spieler und Tag, Treuhand aus dem KI-Lager, Annahme als Liefervertrag mit Tagesbefehl, Erfüllung zahlt Lohn und Ansehen", async () => {
  const now = Date.now();
  const kiBefore = await db.select().from(tables.base).where(eq(tables.base.id, hanse.baseId));
  const offered = await db.transaction((tx) => offerGesuche(tx, now));
  assert.ok(offered.includes(A.playerId), `Angebot für A (${JSON.stringify(offered)})`);
  assert.deepEqual(await db.transaction((tx) => offerGesuche(tx, now + 1000)), [], "höchstens eines je Tag");
  const [g] = await db.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.playerId, A.playerId));
  assert.equal(g.status, "angeboten");
  assert.equal(g.kiId, hanse.playerId);
  assert.equal(g.expiresAt.getTime() - g.offeredAt.getTime(), 24 * HOUR);
  const reward = g.reward as Record<string, number>;
  assert.ok(Object.keys(reward).length > 0 && g.value > 0);
  for (const [res, q] of Object.entries(reward)) {
    assert.ok(await stock(hanse.baseId, res) <= Math.ceil(((kiBefore[0].state as BaseState).resources[res] ?? 0) + 2000) - q + 1, `Treuhand ${res}`);
  }
  const view = await politikKiView(engine, A.playerId);
  assert.equal(view.gesuche[0].status, "angeboten");
  assert.equal(view.kis.find((k) => k.id === hanse.playerId)!.level, "bekannt");
  assert.ok((await lageView(engine, A.playerId)).waiting.some((x) => x.key === `gesuch:${g.id}`));

  // Gesuch von B ablehnen: Lohn zurück ins Lager.
  const [gb] = await db.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.playerId, B.playerId));
  if (gb) {
    const r0 = Object.entries(gb.reward as Record<string, number>)[0];
    const s0 = await stock(hanse.baseId, r0[0]);
    assert.equal((await declineGesuch(engine, B.playerId, key(), gb.id)).ok, true);
    assert.ok(await stock(hanse.baseId, r0[0]) >= s0 + r0[1] - 1);
    assert.deepEqual(await declineGesuch(engine, B.playerId, key(), gb.id), { ok: false, code: "gesuch_gone" });
  }
  assert.deepEqual(await acceptGesuch(engine, B.playerId, key(), g.id), { ok: false, code: "no_gesuch" });

  const res = await acceptGesuch(engine, A.playerId, key(), g.id);
  assert.equal(res.ok, true, JSON.stringify(res));
  const [taken] = await db.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.id, g.id));
  assert.equal(taken.status, "angenommen");
  assert.ok(taken.contractId && taken.challengeId);
  const [dc] = await db.select().from(tables.dailyChallenge).where(eq(tables.dailyChallenge.id, taken.challengeId!));
  assert.equal(dc.kind, "gesuch");
  const [c] = await db.select().from(tables.marketContract).where(eq(tables.marketContract.id, taken.contractId!));
  assert.equal(c.sellerId, A.playerId);
  assert.equal(c.buyerId, hanse.playerId);
  assert.equal(c.resource, g.resource);
  assert.equal(c.qty, g.qty);
  assert.deepEqual(await acceptGesuch(engine, A.playerId, key(), g.id), { ok: false, code: "gesuch_gone" });

  await runUntil(c.settleAt.getTime() + 1000);
  const [cc] = await db.select().from(tables.marketContract).where(eq(tables.marketContract.id, c.id));
  assert.equal(cc.status, "erfuellt");
  const resKey = Object.keys(reward)[0];
  const mine = await stock(A.baseId, resKey);
  await db.transaction((tx) => settleGesuche(tx, c.settleAt.getTime() + 2000, A.playerId));
  const [done] = await db.select().from(tables.kiGesuch).where(eq(tables.kiGesuch.id, g.id));
  assert.equal(done.status, "erfuellt");
  assert.ok(await stock(A.baseId, resKey) >= mine + reward[resKey] - 1, "Lohn im Heimathafen");
  const [dc2] = await db.select().from(tables.dailyChallenge).where(eq(tables.dailyChallenge.id, taken.challengeId!));
  assert.ok(dc2.completedAt, "Tagesbefehl erledigt");
  const st = (await ansehenAll(db, A.playerId, c.settleAt.getTime() + 3000)).get(hanse.playerId)!;
  assert.deepEqual(st.history.map((h) => h.reason).sort(), ["gesuch", "vertrag"]);
  assert.ok(st.value > 6.5 && st.value <= 7, String(st.value));
  const acc = await kiAccess(db, { id: hanse.playerId, profile: "haendler" }, A.playerId, c.settleAt.getTime() + 3000);
  assert.equal(acc.refuses, false);
  assert.equal(acc.level, "bekannt");
});

test("Ansehen: Überfall auf den KI-Spieler sperrt Händler 72 h, Stufe Misstraut senkt das Kontingent", async () => {
  const now = Date.now();
  await db.insert(tables.battleReport).values({
    kind: "ueberfall", title: "Überfall", attackerPlayerId: C.playerId, defenderPlayerId: hanse.playerId, defenderBaseId: hanse.baseId, winner: "attacker",
    balanceVersion: "test", report: {}, createdAt: new Date(now - HOUR),
  });
  const acc = await kiAccess(db, { id: hanse.playerId, profile: "haendler" }, C.playerId, now);
  assert.equal(acc.refuses, true);
  assert.equal(acc.reason, "ueberfall");
  assert.equal(acc.value, -30);
  assert.equal(acc.level, "misstraut");
  assert.equal(acc.quotaShare, 0.15);
  assert.equal(acc.gesuche, false);
  const later = await kiAccess(db, { id: hanse.playerId, profile: "haendler" }, C.playerId, now + 72 * HOUR);
  assert.equal(later.reason, null, "nach 72 h keine Sperre mehr");
  const rot = await kiAccess(db, { id: hanse.playerId, profile: "freibeuter" }, C.playerId, now);
  assert.equal(rot.refuses, false, "Freibeuter lehnt nie ab");
});
