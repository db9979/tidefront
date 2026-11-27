// Integrationstests Konvois für Börse und Verträge gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird
// geleert): Börsenkauf erzeugt einen Konvoi vom Handelshafen (mit/ohne Geleit), Kartell-Überfall auf den Börsenkonvoi
// mit und ohne Geleit, fremder Konvoi in Sensorreichweite sichtbar ohne Krieg (Allianz teilt Sicht), kein Abfangen
// ohne Krieg. Entscheidung „Konvois: Börse und Verträge auf See“ (ENTSCHEIDUNGEN-5.md).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm, isCoast, isTradePortHex, nearestTradePortBySea, nestSites, terrainAt } from "@tidefront/world";
import { convoysOf, type BaseState } from "@tidefront/game-core";
import {
  balance, chooseBase, clearSightCache, createAlliance, marketQuote, missionPreview, navalView, processDue, register, seed, setIntelFog, trade, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `mcv${++keyN}-${Date.now()}`;
const used = new Set<string>();

function coastNear(near: { col: number; row: number } | null, minKm = 100, maxKm = 400): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 10; row < ROWS - 8; row++) for (let col = 8; col < COLS - 8; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    if (near) {
      const d = hexDistanceKm(near, { col, row });
      if (d < minKm || d > maxKm) continue;
    }
    // Börsentests: der Handelshafen soll weit genug weg sein (Kartell ab cartelMinDistanceKm).
    if (!near && nearestTradePortBySea({ col, row }).distanceKm < 300) continue;
    used.add(k);
    return { col, row };
  }
  throw new Error("no coast");
}

function seaNear(near: { col: number; row: number }, minKm: number, maxKm: number): { col: number; row: number } {
  for (let r = near.row - 4; r <= near.row + 4; r++) for (let c = near.col - 4; c <= near.col + 4; c++) {
    const d = hexDistanceKm(near, { col: c, row: r });
    if (terrainAt(c, r) === "sea" && d >= minKm && d <= maxKm) return { col: c, row: r };
  }
  throw new Error("no sea");
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string, field: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 40_000, treibstoff: 40_000, elektronik: 20_000, proviant: 20_000 };
    s.buildings.kommandozentrale = 12; s.buildings.hafenkommandantur = 8; s.buildings.lagerkomplex = 12; s.buildings.radarstation = 0;
  });
  return { playerId: p.playerId, baseId, ...field };
}

/** Taler für Käufe: einmal Stahl verkaufen. */
async function credits(playerId: number) {
  const q = await trade(engine, playerId, key(), { side: "sell", resource: "stahl", qty: 3000, expectedPrice: await price("sell", 3000) });
  assert.equal(q.ok, true, JSON.stringify(q));
}

async function buy(playerId: number, qty: number, escort?: Record<string, number>) {
  return trade(engine, playerId, key(), { side: "buy", resource: "stahl", qty, expectedPrice: await price("buy", qty), ...(escort ? { escort } : {}) });
}

async function price(side: "buy" | "sell", qty: number): Promise<number> {
  const q = await marketQuote(engine, { side, resource: "stahl", qty });
  assert.ok(q.ok, JSON.stringify(q));
  return (q as { executionPrice: number }).executionPrice;
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
  clearSightCache();
});

after(async () => {
  await client.end();
});

test("Börsenkauf: Konvoi vom nächsten Handelshafen zum Käuferhafen, Ankunft wie die Lieferung, auf der Karte", async () => {
  const a = await newPlayer("Kaeufer", coastNear(null));
  await credits(a.playerId);
  const r = await buy(a.playerId, 500);
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = (r as unknown as { delivery: { id: string; departMs: number; arriveMs: number } }).delivery;
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, d.id));
  assert.ok(cv, "Börsenkauf reist als Konvoi");
  const port = nearestTradePortBySea(a);
  assert.equal(cv.kind, "boerse");
  assert.equal(cv.senderId, null);
  assert.equal(cv.recipientId, a.playerId);
  assert.deepEqual([cv.fromCol, cv.fromRow, cv.toCol, cv.toRow], [port.col, port.row, a.col, a.row]);
  assert.equal(cv.departAt.getTime(), d.departMs);
  assert.equal(cv.arriveAt.getTime(), d.arriveMs);
  assert.deepEqual(cv.cargo, { stahl: 500 });
  const v = (await navalView(engine, a.playerId)).convoys.find((c) => c.id === cv.id)!;
  assert.ok(v.own && v.kind === "boerse" && v.sender === `Handelshafen ${port.name}` && v.route && v.route.length >= 2);
  assert.deepEqual(v.cargo, { stahl: 500 });
  // Ankunft: die Lieferung kommt an, der Konvoi ist eingelaufen.
  await db.update(tables.convoy).set({ cartelAt: null }).where(eq(tables.convoy.id, cv.id));
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.type, "convoy_raid"), sql`${tables.gameEvent.payload}->>'convoyId' = ${String(cv.id)}`));
  await runUntil(d.arriveMs + 1000);
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cv.id));
  assert.equal(cv2.status, "arrived");
  const [del] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, d.id));
  assert.equal(del.status, "delivered");
  assert.equal(del.qty, 500, "ohne Überfall volle Menge");
});

test("Börsenkonvoi: Kartell nimmt ohne Geleit lossShareUnescorted, gegen starkes Geleit nichts", async () => {
  const a = await newPlayer("Ungeleitet", coastNear(null));
  await credits(a.playerId);
  const r = await buy(a.playerId, 1000);
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = (r as unknown as { delivery: { id: string; arriveMs: number } }).delivery;
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, d.id));
  const raidAt = cv.departAt.getTime() + 1000;
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(raidAt), payload: { convoyId: cv.id }, baseId: null });
  await runUntil(raidAt + 10);
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cv.id));
  const lostShare = convoysOf(balance)!.lossShareUnescorted;
  assert.deepEqual(cv2.cargo, { stahl: 1000 - Math.floor(1000 * lostShare) });
  const [del] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, d.id));
  assert.equal(del.qty, 1000 - Math.floor(1000 * lostShare), "Lieferung gekürzt");
  const ev = (cv2.events as { by: string; escortHeld: boolean | null }[])[0];
  assert.equal(ev.by, "kartell");
  assert.equal(ev.escortHeld, null);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "konvoi"), eq(tables.battleReport.defenderPlayerId, a.playerId)));
  assert.ok(rep, "Bericht an den Käufer");

  // Mit Geleit: 20 Zerstörer fahren dem Konvoi entgegen und schlagen den Kartellverband zurück.
  const b = await newPlayer("Geleitet", coastNear(null));
  await credits(b.playerId);
  await patchBase(b.baseId, (s) => { s.units = { ...s.units, zerstoerer: 20 }; s.buildings.werft = 6; });
  const bad = await buy(b.playerId, 500, { schuetzen: 5 });
  assert.deepEqual(bad, { ok: false, code: "escort_ships_only" });
  assert.equal((await db.select().from(tables.delivery).where(eq(tables.delivery.playerId, b.playerId))).length, 0, "abgelehnt: kein Kauf");
  const rb = await buy(b.playerId, 1000, { zerstoerer: 20 });
  assert.equal(rb.ok, true, JSON.stringify(rb));
  const db2 = (rb as unknown as { delivery: { id: string } }).delivery;
  const [cb] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, db2.id));
  assert.ok(cb.escortMissionId, "Geleitmission");
  assert.deepEqual(cb.escort, { zerstoerer: 20 });
  const [bs] = await db.select().from(tables.base).where(eq(tables.base.id, b.baseId));
  assert.equal((bs.state as BaseState).units.zerstoerer ?? 0, 0, "Geleit ist ausgelaufen");
  const at2 = cb.departAt.getTime() + 2000;
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(at2), payload: { convoyId: cb.id }, baseId: null });
  await runUntil(at2 + 10);
  const [cb2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cb.id));
  const ev2 = (cb2.events as { by: string; escortHeld: boolean | null }[]).at(-1)!;
  assert.equal(ev2.escortHeld, true, "Geleit hält");
  assert.deepEqual(cb2.cargo, { stahl: 1000 });
});

test("Lagebild: fremder Konvoi in Sensorreichweite sichtbar ohne Krieg (Allianz teilt Sicht), ohne Ladung; kein Abfangen ohne Krieg", async () => {
  await setIntelFog(db, true);
  const c = await newPlayer("Beobachter", coastNear(null));
  const s = await newPlayer("Absender", coastNear(c, 600, 1500));
  const r = await newPlayer("Empfaenger", coastNear(s, 100, 600));
  const far = await newPlayer("Fern", coastNear(c, 1500, 4000));
  // Konvoi S → R, der gerade an C vorbeifährt (Ausguck: Erkennung).
  const p0 = seaNear(c, 20, 90);
  const p1 = seaNear(c, 30, 110);
  const now = Date.now();
  const [cv] = await db.insert(tables.convoy).values({
    kind: "handel", senderId: s.playerId, recipientId: r.playerId, recipientBaseId: r.baseId,
    fromCol: p0.col, fromRow: p0.row, toCol: p1.col, toRow: p1.row, cargo: { elektronik: 4000 },
    departAt: new Date(now - HOUR), arriveAt: new Date(now + HOUR),
  }).returning();
  const seen = (await navalView(engine, c.playerId)).convoys.find((v) => v.id === cv.id);
  assert.ok(seen, "in Sicht ohne Krieg");
  assert.equal(seen!.own, false);
  assert.equal(seen!.enemy, false);
  assert.equal(seen!.cargo, null, "Ladung erst mit Lagebild");
  assert.equal(seen!.size, "gross");
  assert.equal(seen!.route, null, "kein Ziel, keine Route");
  assert.equal(seen!.kind, "handel", "Ausguck erkennt die Art");
  assert.equal(seen!.recipient, "Empfaenger");
  assert.equal(seen!.escorted, false);
  assert.ok(seen!.intel?.level);
  // Weit weg, ohne Sensoren: nicht sichtbar.
  assert.equal((await navalView(engine, far.playerId)).convoys.some((v) => v.id === cv.id), false);
  // Allianz teilt Sicht.
  const al = await createAlliance(engine, c.playerId, { name: "Konvoibund", tag: "KVB" });
  assert.equal(al.ok, true, JSON.stringify(al));
  await db.insert(tables.allianceMember).values({ playerId: far.playerId, allianceId: (al as { allianceId: number }).allianceId, role: "mitglied" });
  clearSightCache();
  assert.equal((await navalView(engine, far.playerId)).convoys.some((v) => v.id === cv.id), true, "Allianz teilt Sicht");
  // Lagebild des Zielhafens (Spionage): Ladung genau.
  await db.insert(tables.intelSighting).values({ owner: `p:${c.playerId}`, kind: "base", objectId: r.baseId, level: "lagebild", source: "Spionage", seenAt: new Date(now - 60_000), data: {} });
  const exact = (await navalView(engine, c.playerId)).convoys.find((v) => v.id === cv.id)!;
  // Mitglied einer Allianz: Wissen der Allianz zählt auch (owner p:… gehört zu den Schlüsseln).
  assert.deepEqual(exact.cargo, { elektronik: 4000 });
  // Kein Abfangen ohne Krieg.
  await patchBase(c.baseId, (st) => { st.units = { ...st.units, zerstoerer: 5 }; });
  const pv = await missionPreview(engine, c.playerId, { type: "abfangen", units: { zerstoerer: 5 }, col: p0.col, row: p0.row, convoyId: cv.id });
  assert.deepEqual({ ok: pv.ok, code: (pv as { code?: string }).code }, { ok: false, code: "convoy_not_enemy" });
  // Ohne Kartennebel: wie bisher nur eigene und feindliche.
  await setIntelFog(db, false);
  assert.equal((await navalView(engine, c.playerId)).convoys.some((v) => v.id === cv.id), false);
  await setIntelFog(db, true);
  await db.delete(tables.allianceMember);
});
