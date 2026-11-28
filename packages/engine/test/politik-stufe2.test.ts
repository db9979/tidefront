// Weltpolitik Stufe 2 (docs/REGELN-WELTPOLITIK.md) gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird
// geleert): Ruf-Buchungen aus den Belegen der Saison (Vertrag, Handel, Hilfe, Kartell-Abwehr; Schwachziel, Strafe,
// Blockade, Paktbruch), Wirkung „Berüchtigt“ und Rangliste, Ächtung im Seerat (wirkt 72 h, nur gegen Berüchtigte)
// und die Sturmzeit im Wetterfeld.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex, nestSites } from "@tidefront/world";
import { stormAt, weatherAt, type BaseState } from "@tidefront/game-core";
import {
  addBot, aechtungUntil, balanceNow, cancelPact, chooseBase, clearRankingCache, clearRufCache, ensurePolitikPlan, invalidatePolitikCache, kiAccess,
  notoriousBounty, politikOverview, processDue, proposePact, rankingView, register, rufOf, seed, seeratVote, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `pol2-${++keyN}-${Date.now()}`;
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

/** Mensch mit Hafen, seit 30 Tagen angemeldet (kein Anfängerschutz des Rufs), gerade gesehen (zählt als aktiv). */
async function human(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(5 * fieldN++);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  await db.update(tables.player).set({ lastSeenAt: new Date(), createdAt: new Date(Date.now() - 30 * DAY) }).where(eq(tables.player.id, p.playerId));
  return { playerId: p.playerId, baseId };
}

async function ki(profile: string) {
  const r = await addBot(engine, profile);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { playerId: number }).playerId;
  const [b] = await db.select().from(tables.base).where(eq(tables.base.playerId, id));
  return { playerId: id, baseId: b.id };
}

async function report(v: { kind: string; attacker: number | null; defender: number | null; winner: string | null; atMs: number; report: unknown }) {
  await db.insert(tables.battleReport).values({
    kind: v.kind, title: v.kind, attackerPlayerId: v.attacker, defenderPlayerId: v.defender, winner: v.winner, balanceVersion: "test",
    report: v.report as object, createdAt: new Date(v.atMs),
  });
}

async function contract(v: { kind: "ki" | "spieler"; status: string; seller: number; buyer: number; atMs: number; sellerPenalty?: number }) {
  await db.insert(tables.marketContract).values({
    kind: v.kind, status: v.status, sellerId: v.seller, buyerId: v.buyer, proposerId: v.seller, resource: "stahl", qty: 100, buyerUnit: 1, sellerUnit: 1,
    course: 1, delivery: "abstrakt", dueAt: new Date(v.atMs), settleAt: new Date(v.atMs), closedAt: new Date(v.atMs), sellerPenaltyCents: v.sellerPenalty ?? 0,
    createdAt: new Date(v.atMs - HOUR),
  });
}

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
let D: Awaited<ReturnType<typeof human>>;
let hanse: Awaited<ReturnType<typeof ki>>;
let rot: Awaited<ReturnType<typeof ki>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Saison vor 12 Tagen begonnen: die Wochensitzung an Tag 14 liegt in der Zukunft.
  const start = Date.now() - 12 * DAY;
  const [s] = await db.update(tables.season).set({ startsAt: new Date(start), endsAt: new Date(start + 42 * DAY) }).where(eq(tables.season.status, "running")).returning();
  seasonId = s.id;
  A = await human("RufA");
  B = await human("RufB");
  C = await human("RufC");
  D = await human("RufD");
  hanse = await ki("haendler");
  rot = await ki("freibeuter");
  await ensurePolitikPlan(db, Date.now());
});

after(async () => {
  await client.end();
});

test("Ruf: Plus aus Verträgen, Handel, Hilfe und Kartell-Abwehr; Minus aus Schwachziel, Strafe, Blockade und Paktbruch", async () => {
  const now = Date.now();
  // A: KI-Vertrag erfüllt (+2), 2 500 Taler Gebühr an der Börse (+2), Hilfe im Hafen von B (+2), Konvoi gegen 6 Boote (+1).
  await contract({ kind: "ki", status: "erfuellt", seller: A.playerId, buyer: hanse.playerId, atMs: now - 5 * HOUR });
  await db.insert(tables.tradeLedger).values([
    { tradeId: "rt-1", tMs: now - 4 * HOUR, account: `player:${A.playerId}`, asset: "credits", amount: "-10000" },
    { tradeId: "rt-1", tMs: now - 4 * HOUR, account: "market", asset: "credits", amount: "7500" },
    { tradeId: "rt-1", tMs: now - 4 * HOUR, account: "fees", asset: "credits", amount: "2500" },
    // Handel zwischen zwei Menschen zählt nicht (Freunde schieben sich sonst Ruf zu).
    { tradeId: "rt-2", tMs: now - 4 * HOUR, account: `player:${A.playerId}`, asset: "credits", amount: "-5000" },
    { tradeId: "rt-2", tMs: now - 4 * HOUR, account: `player:${B.playerId}`, asset: "credits", amount: "4000" },
    { tradeId: "rt-2", tMs: now - 4 * HOUR, account: "fees", asset: "credits", amount: "1000" },
  ]);
  await report({ kind: "kartell", attacker: null, defender: B.playerId, winner: "defender", atMs: now - 3 * HOUR, report: { guests: [{ playerId: A.playerId }] } });
  await report({ kind: "konvoi", attacker: null, defender: A.playerId, winner: "defender", atMs: now - 2 * HOUR, report: { convoy: { force: { schnellboot: 4, kanonenboot: 2 } } } });
  await report({ kind: "konvoi", attacker: null, defender: A.playerId, winner: "defender", atMs: now - 2 * HOUR + 1, report: { convoy: { force: { schnellboot: 3 } } } });
  const a = (await rufOf(db, A.playerId, now))!;
  assert.deepEqual(a.history.map((h) => h.reason), ["vertrag", "handel", "hilfe", "kartell"]);
  assert.ok(a.value > 6.5 && a.value < 7, `A: ${a.value} (gesättigt knapp unter 7)`);
  assert.equal(a.level, "unbescholten");

  // C: Schwachziel-Überfall auf D (−8), Überfall auf den KI-Spieler zählt nicht im Ruf, Vertragsstrafe (−10),
  // Blockade vor D seit 30 h ohne Krieg (2 Tage: −6), Paktbruch an B (−15).
  await report({ kind: "ueberfall", attacker: C.playerId, defender: D.playerId, winner: "attacker", atMs: now - 6 * HOUR, report: { attacker: { weakTarget: true } } });
  await report({ kind: "ueberfall", attacker: C.playerId, defender: hanse.playerId, winner: "attacker", atMs: now - 80 * HOUR, report: { attacker: { weakTarget: true } } });
  await report({ kind: "ueberfall", attacker: C.playerId, defender: A.playerId, winner: "attacker", atMs: now - 6 * HOUR, report: { attacker: { weakTarget: false } } });
  await contract({ kind: "spieler", status: "teilweise", seller: C.playerId, buyer: D.playerId, atMs: now - 5 * HOUR, sellerPenalty: 5000 });
  const [cb] = await db.select().from(tables.base).where(eq(tables.base.id, C.baseId));
  await db.insert(tables.blockade).values({
    missionId: 0, attackerId: C.playerId, attackerBaseId: C.baseId, targetBaseId: D.baseId, targetPlayerId: D.playerId, col: cb.col, row: cb.row,
    units: { korvette: 4 }, status: "active", startsAt: new Date(now - 30 * HOUR), endsAt: new Date(now + 10 * HOUR),
  });
  const c1 = (await rufOf(db, C.playerId, now))!;
  assert.deepEqual(c1.history.map((h) => h.reason).filter((r) => r !== "zerfall").sort(), ["blockade", "blockade", "schwachziel", "strafe"]);
  assert.ok(c1.value >= -24 && c1.value <= -23.5, `C: ${c1.value} (−8 −10 −3 −3, Zerfall am Tageswechsel)`);
  assert.equal(c1.level, "unbescholten");

  assert.equal((await proposePact(engine, C.playerId, `p:${B.playerId}`)).ok, true);
  assert.equal((await proposePact(engine, B.playerId, `p:${C.playerId}`)).ok, true);
  const [pact] = await db.select().from(tables.diplomacy).where(eq(tables.diplomacy.kind, "pakt"));
  const cancelled = await cancelPact(engine, C.playerId, pact.id);
  assert.equal(cancelled.ok, true);
  const endsAt = (cancelled as { endsAtMs: number }).endsAtMs;
  await report({ kind: "ueberfall", attacker: C.playerId, defender: B.playerId, winner: "attacker", atMs: endsAt + HOUR, report: { attacker: { weakTarget: false } } });
  const c2 = (await rufOf(db, C.playerId, endsAt + 2 * HOUR))!;
  assert.ok(c2.history.some((h) => h.reason === "paktbruch" && h.delta === -15), JSON.stringify(c2.history));
  assert.ok(c2.value <= -30, `C berüchtigt: ${c2.value}`);
  assert.equal(c2.level, "beruechtigt");

  // Wirkung: Händler lehnt ab und gibt keine Gesuche, Freibeuter schließt weiter ab, Kopfgeld +0,1.
  const at = endsAt + 2 * HOUR;
  const h = await kiAccess(db, { id: hanse.playerId, profile: "haendler" }, C.playerId, at);
  assert.equal(h.reason, "beruechtigt");
  assert.equal(h.gesuche, false);
  assert.equal((await kiAccess(db, { id: rot.playerId, profile: "freibeuter" }, C.playerId, at)).refuses, false);
  assert.equal(await notoriousBounty(db, C.playerId, at), 0.1);
  assert.equal(await notoriousBounty(db, A.playerId, at), 0);
});

test("Rangliste: fremder Ruf nur als Zeichen der äußeren Stufen, eigener mit Wert; der Ruf zählt nicht im Rang", async () => {
  // C ist erst nach dem Paktbruch (morgen) berüchtigt: für die Rangliste jetzt einen weiteren Schwachziel-Überfall buchen.
  await report({ kind: "ueberfall", attacker: C.playerId, defender: D.playerId, winner: "attacker", atMs: Date.now() - HOUR, report: { attacker: { weakTarget: true } } });
  clearRufCache();
  clearRankingCache();
  const view = await rankingView(engine, A.playerId);
  const rowC = view.rows.find((r) => r.playerId === C.playerId)!;
  const rowA = view.rows.find((r) => r.playerId === A.playerId)!;
  const rowB = view.rows.find((r) => r.playerId === B.playerId)!;
  assert.deepEqual(rowC.ruf, { level: "beruechtigt", value: null });
  assert.equal(rowA.ruf?.level, null);
  assert.equal(typeof rowA.ruf?.value, "number", "eigener Wert");
  assert.equal(rowB.ruf?.value, null);
  assert.equal(view.rows.find((r) => r.playerId === hanse.playerId)?.ruf ?? null, null, "KI-Spieler haben keinen Ruf");
  const ov = await politikOverview(engine, A.playerId);
  assert.equal(ov.ruf?.level, "unbescholten");
  assert.ok((ov.ruf?.history.length ?? 0) >= 4);
});

test("Ächtung: Option nur mit Berüchtigten, Beschluss trifft nur Berüchtigte, wirkt 72 h (keine KI-Verträge und Gesuche, Kopfgeld +0,2)", async () => {
  const sessions = await db.select().from(tables.seeratSitzung).where(and(eq(tables.seeratSitzung.seasonId, seasonId), eq(tables.seeratSitzung.kind, "woche")));
  const s = sessions.find((x) => x.closesAt.getTime() > Date.now())!;
  assert.ok(s, "künftige Wochensitzung");
  assert.equal((s.options as string[]).includes("aechtung"), false, "im Plan noch ohne Ächtung");
  const now = Date.now();
  for (const id of [A, B, C, D]) await db.update(tables.player).set({ lastSeenAt: new Date(now) }).where(eq(tables.player.id, id.playerId));
  await moveEvent("seerat_open", "sitzungId", s.id, now - 1000);
  await db.update(tables.seeratSitzung).set({ opensAt: new Date(now - 1000), closesAt: new Date(now + HOUR) }).where(eq(tables.seeratSitzung.id, s.id));
  await runUntil(now);
  const [opened] = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, s.id));
  assert.equal(opened.status, "offen");
  assert.ok((opened.options as string[]).includes("aechtung"), "C ist berüchtigt: Ächtung steht zur Wahl");
  for (const p of [A, B, D]) assert.equal((await seeratVote(engine, p.playerId, key(), { sitzungId: s.id, option: "aechtung" })).ok, true);
  assert.equal((await seeratVote(engine, C.playerId, key(), { sitzungId: s.id, option: "ruhig" })).ok, true);
  const closeAt = now + 30 * 60_000;
  await moveEvent("seerat_close", "sitzungId", s.id, closeAt);
  await db.update(tables.seeratSitzung).set({ closesAt: new Date(closeAt) }).where(eq(tables.seeratSitzung.id, s.id));
  await runUntil(closeAt);
  const [closed] = await db.select().from(tables.seeratSitzung).where(eq(tables.seeratSitzung.id, s.id));
  assert.equal(closed.result, "aechtung");
  const [w] = await db.select().from(tables.politikFenster).where(eq(tables.politikFenster.id, s.fensterId));
  assert.equal(w.effect, "ruhig", "Ächtung verschiebt keinen Regler");
  const until = await aechtungUntil(db, C.playerId, closeAt + HOUR);
  assert.equal(until, closeAt + 72 * HOUR);
  assert.equal(await aechtungUntil(db, A.playerId, closeAt + HOUR), null, "nur Berüchtigte");
  const msg = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, C.playerId), eq(tables.message.subject, "Seerat: Du bist geächtet")));
  assert.equal(msg.length, 1);
  const all = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, A.playerId), eq(tables.message.subject, "Seerat: Du bist geächtet")));
  assert.equal(all.length, 0);
  const result = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, A.playerId), eq(tables.message.subject, "Seerat: Ächtung")));
  assert.equal(result.length, 1, "Ergebnis an alle (ohne Namen)");
  assert.doesNotMatch(result[0].body, /RufC/);

  const t = closeAt + 2 * HOUR;
  const f = await kiAccess(db, { id: rot.playerId, profile: "freibeuter" }, C.playerId, t);
  assert.equal(f.reason, "aechtung", "auch der Freibeuter schließt nicht ab");
  assert.equal(f.gesuche, false);
  assert.equal(f.aechtungUntilMs, closeAt + 72 * HOUR);
  assert.equal(await notoriousBounty(db, C.playerId, t), 0.2);
  const later = closeAt + 73 * HOUR;
  assert.equal(await aechtungUntil(db, C.playerId, later), null, "nach 72 h vorbei");
  assert.notEqual((await kiAccess(db, { id: rot.playerId, profile: "freibeuter" }, C.playerId, later)).reason, "aechtung");
  assert.ok((await notoriousBounty(db, C.playerId, later)) <= 0.1);
});

test("Sturmzeit: Fenster wirkt im Wetterfeld (Schwelle 0,7) und in der Aufschlüsselung, nur im Fenster", async () => {
  const now = Date.now();
  // Ausgewürfelte Fenster ruhigstellen (der Plan hängt vom Saisonbeginn ab und könnte selbst eine Sturmzeit enthalten).
  await db.update(tables.politikFenster).set({ effect: "ruhig" }).where(eq(tables.politikFenster.seasonId, seasonId));
  const [w] = await db.insert(tables.politikFenster).values({
    seasonId, slot: "gezeit", idx: 9, planKind: "sturmzeit", good: null, effect: "sturmzeit", source: "plan",
    startsAt: new Date(now - HOUR), endsAt: new Date(now + 71 * HOUR),
  }).returning();
  invalidatePolitikCache();
  const eff = await balanceNow(db, now);
  assert.ok(Math.abs(eff.weather!.stormFrom - 0.7) < 1e-9);
  assert.ok(eff.politikNow!.convoyCartelChance < 1);
  const st = stormAt(now);
  assert.ok(st, "Sturmzeit im Wetterfeld eingetragen");
  assert.ok(Math.abs(st!.stormFrom - 0.7) < 1e-9);
  assert.equal(stormAt(now + 72 * HOUR), null);
  const p = { lat: 48, lon: -15 };
  const x = weatherAt(p, now, eff.weather!);
  assert.equal(x.storm, x.wind >= 0.7);
  const ov = await politikOverview(engine, A.playerId);
  assert.ok(ov.lines.some((l) => l.key === "storm" && /Sturm schon ab/.test(l.text)), JSON.stringify(ov.lines));
  assert.ok(ov.windows.some((v) => v.id === w.id && v.name === "Sturmzeit" && v.active));
  await db.delete(tables.politikFenster).where(eq(tables.politikFenster.id, w.id));
  invalidatePolitikCache();
  await balanceNow(db, now);
  assert.equal(stormAt(now), null, "abgesagt: Wetter wieder normal");
});
