// Integrationstest Rückkehrkarte „Seit deinem letzten Besuch“ (lage.since / lage.ack, UX 0.43 B1, Entscheidung E-3b)
// gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import type { BaseState } from "@tidefront/game-core";
import { chooseBase, clearRankingCache, lageAck, lageSince, recordSummaryEntry, register, seed, sendMessage, SINCE_MAX_MS, type Engine } from "../src/index.ts";
import { freeCoastField } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let n = 0;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

async function player(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const field = await freeCoastField(db);
  const r = await chooseBase(engine, p.playerId, `since${++n}`, { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId };
}

test("Rückkehrkarte: ereignisgesteuert, Zeitraum, Nachricht mit Absender, Bau fertig, Quittung", async () => {
  const a = await player("Heimkehrer");
  const b = await player("Schreiber");
  // Lager groß, Produktion klein: ohne Ereignis keine Karte.
  const [row] = await db.select().from(tables.base).where(eq(tables.base.id, a.baseId));
  const s = row.state as BaseState;
  s.buildings.lagerkomplex = 15;
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, a.baseId));
  clearRankingCache();
  await lageAck(engine, a.playerId);
  const [p0] = await db.select({ at: tables.player.lageAckAt, rank: tables.player.lageAckRank }).from(tables.player).where(eq(tables.player.id, a.playerId));
  assert.ok(p0.at, "Quittung gespeichert");
  assert.equal(typeof p0.rank, "number", "Rang-Schnappschuss");
  const quiet = await lageSince(engine, a.playerId);
  assert.equal(quiet.show, false, "nichts passiert – keine Karte");
  assert.equal(quiet.first, false);
  assert.ok(quiet.toMs >= quiet.fromMs);

  // Nachricht und fertiger Bau → Karte mit Absender und Gebäude.
  await sendMessage(engine, b.playerId, { toPlayerId: a.playerId, subject: "Handel?", body: "Stahl gegen Proviant?" });
  await recordSummaryEntry(engine, a.playerId, { kind: "build", title: "Ausbau fertig", body: "Stahlwerk ist jetzt auf Stufe 3." });
  const v = await lageSince(engine, a.playerId);
  assert.equal(v.show, true);
  assert.equal(v.messages.count, 1);
  assert.deepEqual(v.messages.items.map((m) => [m.from, m.subject]), [["Schreiber", "Handel?"]]);
  assert.deepEqual(v.done.builds, ["Stahlwerk ist jetzt auf Stufe 3"]);

  // Quittung: danach wieder ruhig.
  await lageAck(engine, a.playerId, Date.now() + 1000);
  assert.equal((await lageSince(engine, a.playerId, Date.now() + 2000)).show, false);

  // Rangänderung seit der Quittung zählt als Anlass.
  await db.update(tables.player).set({ lageAckRank: 99 }).where(eq(tables.player.id, a.playerId));
  const moved = await lageSince(engine, a.playerId, Date.now() + 2000);
  assert.equal(moved.show, true);
  assert.equal(moved.rank?.before, 99);
  assert.notEqual(moved.rank?.now, 99);
});

test("Rückkehrkarte: lange weg – Rückblick gekappt, Produktion über 10 % des Lagers zählt", async () => {
  const a = await player("Langeweg");
  const now = Date.now();
  await db.update(tables.player).set({ lageAckAt: new Date(now - 10 * 24 * HOUR), lageAckRank: null, createdAt: new Date(now - 30 * 24 * HOUR) }).where(eq(tables.player.id, a.playerId));
  const v = await lageSince(engine, a.playerId, now);
  assert.equal(v.capped, true);
  assert.equal(v.toMs - v.fromMs, SINCE_MAX_MS);
  assert.ok(v.production && v.production.share >= 0.1, "72 h Produktion im kleinen Startlager");
  assert.equal(v.show, true);
  assert.ok(Object.values(v.production!.amounts).some((x) => x > 0));
  // Ohne Quittung: Rückblick 24 h, als „erstes Mal“ markiert.
  await db.update(tables.player).set({ lageAckAt: null }).where(eq(tables.player.id, a.playerId));
  const f = await lageSince(engine, a.playerId, now);
  assert.equal(f.first, true);
  assert.equal(f.toMs - f.fromMs, 24 * HOUR);
  // Nie vor der Anmeldung: ein Spieler von vor 2 h blickt höchstens 2 h zurück.
  await db.update(tables.player).set({ createdAt: new Date(now - 2 * HOUR) }).where(eq(tables.player.id, a.playerId));
  const n = await lageSince(engine, a.playerId, now);
  assert.equal(n.toMs - n.fromMs, 2 * HOUR);
});
