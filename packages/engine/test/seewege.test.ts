// Integrationstest Seewege (Entscheidung „T. Seewege und Bordsicht“): Start speichert die Route im Plan, Vorschau und
// Missionsliste zeigen sie, Fahrzeit nach Routenlänge, Rückruf mitten auf der Route, Bordsicht wandert entlang der
// Route (Sensor mit Mission), alte Missionen ohne Route gerade (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { hexAtLonLat, hexAtXY, hexCenterXY, hexDistanceKm, isCoast, isNavigable, pointAlongRoute, seaRoute } from "@tidefront/world";
import { fleetPosition, type BaseState, type Mission } from "@tidefront/game-core";
import { baseView, chooseBase, launchMission, mapViewFor, missionPreview, recallOwnMission, register, seed, type Engine } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `sw${++keyN}-${Date.now()}`;

/** Küstenfeld nahe Länge/Breite (Spiralsuche). */
function coastAt(lon: number, lat: number) {
  const h = hexAtLonLat(lon, lat);
  for (let r = 0; r < 4; r++) for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
    if (isCoast(h.col + dc, h.row + dr)) return { col: h.col + dc, row: h.row + dr };
  }
  throw new Error("keine Küste");
}

async function newPlayer(name: string, field: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  s.protection.createdAtMs = Date.now() - 30 * DAY;
  s.resources = { stahl: 500_000, treibstoff: 500_000, elektronik: 500_000, proviant: 500_000 };
  s.buildings.kommandozentrale = 10;
  s.buildings.hafenkommandantur = 5;
  s.units = { ...s.units, korvette: 10 };
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
  return { playerId: p.playerId, baseId, ...field };
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

test("Seewege: Überfall Livorno → Adria fährt um Italien; Vorschau, Plan, Missionsliste, Rückruf und Bordsicht folgen der Route", async () => {
  const a = await newPlayer("Genuese", coastAt(10.3, 43.5));
  const b = await newPlayer("Venezianer", coastAt(13.8, 45.6));
  const route = seaRoute(a, b);
  assert.ok(route.km > 2 * hexDistanceKm(a, b), "Umweg um den Stiefel");
  const input = { type: "ueberfall", units: { korvette: 2 }, col: b.col, row: b.row };
  const p = await missionPreview(engine, a.playerId, input);
  assert.equal(p.ok, true, JSON.stringify(p));
  if (!p.ok || !("route" in p) || !p.route) throw new Error("Vorschau ohne Route");
  assert.equal(p.route.km, route.km, "Vorschau: Weglänge der Route");
  const base = (route.km / 60) * 3600;
  assert.ok(p.travelSeconds >= base - 1e-6 && p.travelSeconds <= base * 1.31, "Fahrzeit nach Route (Korvette 60 km/h, höchstens Sturmzuschlag)");
  const r = await launchMission(engine, a.playerId, key(), input);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, r.missionId));
  const plan = m.plan as Mission;
  assert.deepEqual(plan.route?.hexes, route.hexes, "Route im Missionsplan gespeichert");
  const factor = plan.weather?.shipFactor ?? 1;
  assert.ok(Math.abs(plan.travelSeconds - (route.km / 60) * 3600 * factor) < 1e-6);
  // Missionsliste der Oberfläche trägt die Route.
  const v = await baseView(engine, a.playerId);
  const listed = v.base!.missions.find((x) => x.id === r.missionId)!;
  assert.deepEqual(listed.route?.hexes, route.hexes);
  // Bordsicht unterwegs: Sensor mit Mission an der Position auf der Route (nicht auf der Luftlinie über Land).
  const half = plan.departAtMs + (plan.arriveAtMs - plan.departAtMs) / 2;
  const home = hexCenterXY(a.col, a.row);
  const tgt = hexCenterXY(b.col, b.row);
  const pos = fleetPosition(m, home, tgt, half)!;
  const expect = pointAlongRoute(route, route.km / 2);
  assert.ok(Math.hypot(pos.at.x - expect.x, pos.at.y - expect.y) < 1);
  const h = hexAtXY(pos.at.x, pos.at.y);
  assert.ok(isNavigable(h.col, h.row), "Position auf Wasser");
  const map = await mapViewFor(db, a.playerId, half);
  const own = map.intel.sensors.find((s) => s.kind === "verband" && s.own);
  assert.ok(own, "Bordsicht-Sensor des Verbands");
  assert.equal(own!.missionId, r.missionId, "Sensor nennt die Mission (Karte führt die Aufhellung nach)");
  assert.deepEqual({ col: own!.col, row: own!.row }, { col: h.col, row: h.row });
  // Rückruf mitten auf der Route: Heimfahrt so lange wie die bisherige Fahrt, Wendepunkt auf der Route.
  const t0 = Date.now();
  const back = await recallOwnMission(engine, a.playerId, key(), r.missionId);
  assert.equal(back.ok, true, JSON.stringify(back));
  const [m2] = await db.select().from(tables.mission).where(eq(tables.mission.id, r.missionId));
  const p2 = m2.plan as Mission;
  assert.equal(m2.status, "returning");
  const turn = fleetPosition(m2, home, tgt, p2.recalledAtMs!)!;
  const done = (p2.recalledAtMs! - p2.departAtMs) / (p2.arriveAtMs - p2.departAtMs);
  const turnExpect = pointAlongRoute(route, route.km * done);
  assert.ok(Math.hypot(turn.at.x - turnExpect.x, turn.at.y - turnExpect.y) < 1, "Wendepunkt auf der Route");
  const end = fleetPosition(m2, home, tgt, m2.returnAt!.getTime())!;
  assert.ok(Math.hypot(end.at.x - home.x, end.at.y - home.y) < 1, "Rückkehr in den Hafen");
  assert.ok(m2.returnAt!.getTime() - t0 < 60_000, "kurz nach dem Start zurückgerufen: kurze Heimfahrt");
});

test("Seewege: Missionen ohne Route (Bestand vor der Umstellung) fahren weiter gerade", async () => {
  const home = { x: 0, y: 0 };
  const tgt = { x: 100, y: 0 };
  const now = Date.now();
  const m = { status: "outbound", arriveAt: new Date(now + 3600000), returnAt: null, plan: { departAtMs: now - 3600000, travelSeconds: 7200 } };
  const pos = fleetPosition(m, home, tgt, now)!;
  assert.ok(Math.abs(pos.at.x - 50) < 1e-6 && Math.abs(pos.at.y) < 1e-6);
});
