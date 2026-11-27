// Einstieg für neue Spieler (Prüfbericht 0.22): Start-Nest Stufe 1 in ≤ 300 km bei jeder Hafenwahl, bekannt trotz
// Kartennebel und im Auftragsbuch genannt; der Auftrags-Verband siegt gegen Nest 1; Belohnungen füllen nur das Lager.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, QUICK_PICKS, ROWS, hexAtLonLat, hexDistanceKm, isCoast, isTradePortHex, terrainAt } from "@tidefront/world";
import { createBase, nestWinRate, smallestWinningRaid, storageCapacity, type Balance } from "@tidefront/game-core";
import {
  balance,
  chooseBase,
  deliverToStorage,
  GUIDE_GOALS,
  guideView,
  nearestOpenLevel1,
  register,
  seed,
  START_NEST_KM,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const bal = balance as unknown as Balance;
let keyN = 0;
const key = () => `ein${++keyN}-${Date.now()}`;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

/** Freies Küstenfeld nächst einem Ort (wie die Schnellwahl im Browser). */
async function freeNear(lon: number, lat: number) {
  const target = hexAtLonLat(lon, lat);
  const taken = new Set([
    ...(await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)),
    ...(await db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest)),
    ...(await db.select({ col: tables.resourceField.col, row: tables.resourceField.row }).from(tables.resourceField)),
  ].map((x) => `${x.col},${x.row}`));
  let best: { col: number; row: number } | null = null, bestD = Infinity;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (!isCoast(col, row) || isTradePortHex(col, row) || taken.has(`${col},${row}`)) continue;
    const d = hexDistanceKm(target, { col, row });
    if (d < bestD) { bestD = d; best = { col, row }; }
  }
  return best!;
}

test("Neuer Spieler: an jedem Schnellwahl-Ort ein unbesiegtes Nest Stufe 1 in ≤ 300 km, bekannt und im Auftragsbuch", async () => {
  for (const [i, q] of QUICK_PICKS.entries()) {
    const p = await register(db, { inviteCode: "TEST", name: `Neu${i}`, password: "geheim123" });
    const home = await freeNear(q.lon, q.lat);
    const r = await chooseBase(engine, p.playerId, key(), { ...home, name: `Hafen ${q.name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
    assert.equal(r.ok, true, `${q.name}: ${JSON.stringify(r)}`);
    const n = await nearestOpenLevel1(db, home, Date.now());
    assert.ok(n, `${q.name}: kein Nest 1 in ${START_NEST_KM} km`);
    assert.ok(n.distanceKm <= START_NEST_KM, `${q.name}: ${n.distanceKm} km`);
    // Regeln für Nestplätze: Küste (Seeplätze) bzw. Seefeld vor der Küste (neue Start-Nester), kein Handelshafen,
    // kein Hafen, kein Rohstofffeld.
    assert.notEqual(terrainAt(n.col, n.row), "land");
    assert.equal(isTradePortHex(n.col, n.row), false);
    assert.equal((await db.select().from(tables.base).where(and(eq(tables.base.col, n.col), eq(tables.base.row, n.row)))).length, 0);
    assert.equal((await db.select().from(tables.resourceField).where(and(eq(tables.resourceField.col, n.col), eq(tables.resourceField.row, n.row)))).length, 0);
    // Auftragsbuch nennt das Nest mit Stufe (auch unter Kartennebel).
    const v = await guideView(engine, p.playerId);
    assert.ok(v.nestTarget, q.name);
    assert.equal(v.nestTarget.level, 1);
    assert.equal(v.nestTarget.guaranteed, true);
    assert.ok(v.nestTarget.distanceKm <= START_NEST_KM);
    // Lagebild: das Start-Nest ist dem Spieler bekannt.
    const known = await db.select().from(tables.intelSighting).where(and(eq(tables.intelSighting.owner, `p:${p.playerId}`), eq(tables.intelSighting.kind, "nest")));
    if (known.length > 0) assert.ok(known.some((k) => k.objectId === n.id), `${q.name}: Start-Nest nicht im Lagebild`);
  }
});

test("Zweiter Spieler daneben: vorhandenes Start-Nest genügt, kein weiteres", async () => {
  const q = QUICK_PICKS[0];
  const before = (await db.select({ id: tables.nest.id }).from(tables.nest)).length;
  const p = await register(db, { inviteCode: "TEST", name: "Nachbar", password: "geheim123" });
  const home = await freeNear(q.lon, q.lat);
  const r = await chooseBase(engine, p.playerId, key(), { ...home, name: "Hafen Nachbar", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await db.select({ id: tables.nest.id }).from(tables.nest)).length, before);
  assert.ok((await nearestOpenLevel1(db, home, Date.now()))!.distanceKm <= START_NEST_KM);
});

test("Besiegtes Start-Nest zählt nicht: der nächste neue Spieler bekommt ein offenes", async () => {
  const q = QUICK_PICKS[1];
  const home = await freeNear(q.lon, q.lat);
  const n = await nearestOpenLevel1(db, home, Date.now());
  assert.ok(n);
  await db.update(tables.nest).set({ defeatedAt: new Date() }).where(eq(tables.nest.level, 1));
  const p = await register(db, { inviteCode: "TEST", name: "Spaet", password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...home, name: "Hafen Spät", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const fresh = await nearestOpenLevel1(db, home, Date.now());
  assert.ok(fresh && fresh.distanceKm <= START_NEST_KM);
  assert.notEqual(fresh.id, n.id);
});

test("Vorschlag siegt gegen Nest 1: Auftrags-Verband und kleinster Verband aus dem Probekampf", () => {
  const goal = { korvette: GUIDE_GOALS.korvette, landungsschiff: GUIDE_GOALS.landungsschiff, schuetzen: GUIDE_GOALS.schuetzen };
  assert.ok(nestWinRate(goal, 1, bal)! >= 0.85, `Auftrags-Verband: ${nestWinRate(goal, 1, bal)}`);
  // Befund: mit 20 Schützen siegt der alte Vorschlag fast nie.
  assert.ok(nestWinRate({ ...goal, schuetzen: 20 }, 1, bal)! < 0.5);
  const plan = smallestWinningRaid(goal, 1, bal);
  assert.equal(plan.enough, true);
  assert.ok(plan.winRate! >= 0.85, String(plan.winRate));
  for (const [id, n] of Object.entries(plan.units)) assert.ok(n <= (goal as Record<string, number>)[id], id);
  // Gegenprobe mit anderen Seeds (Streuung des echten Kampfes): der Vorschlag hält.
  assert.ok(nestWinRate(plan.units, 1, bal, { runs: 300 })! >= 0.8);
  // Zu wenig vorhanden: Vorschlag ist alles, nicht genug.
  const weak = smallestWinningRaid({ ...goal, schuetzen: 20 }, 1, bal);
  assert.equal(weak.enough, false);
});

test("Belohnung füllt das Lager höchstens bis zur Kapazität; Überlauf wird gemeldet", () => {
  const s = createBase(bal, 0, { lat: 48, lon: -4 });
  const cap = storageCapacity(s, bal);
  s.resources = { ...s.resources, stahl: cap - 100, proviant: cap + 50 };
  const r = deliverToStorage(s, { stahl: 300, proviant: 200, elektronik: 10 }, 0);
  assert.equal(r.state.resources.stahl, cap);
  assert.equal(r.state.resources.proviant, cap + 50); // darüber bleibt, sinkt aber nicht
  assert.deepEqual(r.lost, { stahl: 200, proviant: 200 });
  assert.equal(r.state.resources.elektronik, (s.resources.elektronik ?? 0) + 10);
});
