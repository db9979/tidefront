// Integrationstests Nest Stufe 6 (TEST_DATABASE_URL; die Datenbank wird geleert): Seed legt die Plätze an, eine
// laufende Welt ohne Stufe 6 bekommt sie beim erneuten Seed nachgetragen (vorhandene Nester unverändert, Feld mit
// Hafen übersprungen), der Saisonwechsel trägt den übersprungenen Platz nach; eigene Wiederkehr 24 h in der Karte.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { LATE_NEST_LEVEL, LATE_NEST_POINTS, hexAtLonLat, nestSites } from "@tidefront/world";
import { chooseBase, mapView, register, runningSeason, seasonEnd, seed, type Engine } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
});

after(async () => {
  await client.end();
});

let playerId = 0;
const allNests = () => db.select().from(tables.nest).orderBy(tables.nest.id);

test("Seed legt alle Nestplätze an, auch die der Stufe 6", async () => {
  await seed(db, "TEST:100");
  const rows = await allNests();
  assert.equal(rows.length, nestSites().length);
  const six = rows.filter((n) => n.level === LATE_NEST_LEVEL);
  assert.equal(six.length, LATE_NEST_POINTS.length);
});

test("Laufende Welt: Stufe 6 wird nachgetragen, vorhandene Nester bleiben, Feld mit Hafen wird übersprungen", async () => {
  // Stand vor v1.15: keine Nester der Stufe 6; ein Nest gerade besiegt; ein Spieler hat sich auf Bermuda niedergelassen.
  await db.delete(tables.nest).where(eq(tables.nest.level, LATE_NEST_LEVEL));
  const before = await allNests();
  const defeated = new Date(Date.now() - HOUR);
  await db.update(tables.nest).set({ defeatedAt: defeated }).where(eq(tables.nest.id, before[0].id));
  const bermuda = hexAtLonLat(-64.8, 32.3);
  const p = await register(db, { inviteCode: "TEST", name: "Inselkapitän", password: "geheim123" });
  playerId = p.playerId;
  const r = await chooseBase(engine, p.playerId, "n6-1", { ...bermuda, name: "Bermuda", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));

  await seed(db, "TEST:100");
  const rows = await allNests();
  // alte Nester unverändert (gleiche IDs, Felder, Stufen, Besiegt-Zeitpunkt)
  for (const old of before) {
    const now = rows.find((n) => n.id === old.id)!;
    assert.deepEqual({ col: now.col, row: now.row, level: now.level }, { col: old.col, row: old.row, level: old.level });
  }
  assert.equal(rows.find((n) => n.id === before[0].id)!.defeatedAt?.getTime(), defeated.getTime());
  const six = rows.filter((n) => n.level === LATE_NEST_LEVEL);
  assert.equal(six.length, LATE_NEST_POINTS.length - 1);
  assert.ok(!six.some((n) => n.col === bermuda.col && n.row === bermuda.row), "kein Nest auf dem Hafen");

  // idempotent
  await seed(db, "TEST:100");
  assert.equal((await allNests()).length, rows.length);
});

test("Karte: Nest 6 nach Sieg 24 h verlassen, Stufe 5 nach 12 h", async () => {
  const [n6] = await db.select().from(tables.nest).where(eq(tables.nest.level, LATE_NEST_LEVEL)).limit(1);
  const [n5] = await db.select().from(tables.nest).where(eq(tables.nest.level, 5)).limit(1);
  const at = new Date(Date.now() - 13 * HOUR);
  await db.update(tables.nest).set({ defeatedAt: at }).where(sql`${tables.nest.id} in (${n6.id}, ${n5.id})`);
  const map = await mapView(engine, playerId);
  const v6 = map.nests.find((n) => n.id === n6.id)!;
  const v5 = map.nests.find((n) => n.id === n5.id)!;
  assert.equal(v6.empty, true);
  assert.equal(v6.respawnAtMs, at.getTime() + 24 * HOUR);
  assert.equal(v5.empty, false);
});

test("Saisonwechsel: Nester wieder besetzt, übersprungener Platz der Stufe 6 jetzt angelegt", async () => {
  const season = (await runningSeason(db))!;
  await db.transaction((tx) => seasonEnd(tx, { id: 0, type: "season_end", dueAt: new Date(), payload: { seasonId: season.id }, baseId: null }, Date.now()));
  const rows = await allNests();
  assert.equal(rows.length, nestSites().length);
  assert.equal(rows.filter((n) => n.level === LATE_NEST_LEVEL).length, LATE_NEST_POINTS.length);
  assert.equal(rows.filter((n) => n.defeatedAt !== null).length, 0);
});
