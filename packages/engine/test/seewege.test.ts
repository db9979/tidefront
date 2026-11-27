// Integrationstest Seewege (Entscheidung „U. Seewege und Bordsicht“): Start speichert die Route im Plan, Vorschau und
// Missionsliste zeigen sie, Fahrzeit nach Routenlänge, Rückruf mitten auf der Route, Bordsicht wandert entlang der
// Route (Sensor mit Mission), alte Missionen ohne Route gerade (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { hexAtLonLat, hexAtXY, hexCenterXY, hexDistanceKm, isCoast, isNavigable, nearestTradePort, nearestTradePortBySea, nestSites, pointAlongRoute, seaRoute } from "@tidefront/world";
import { fleetPosition, type BaseState, type Mission } from "@tidefront/game-core";
import { RAID_LEAD_MS, baseView, chooseBase, launchMission, mapViewFor, missionPreview, processDue, recallOwnMission, register, seed, type Engine } from "../src/index.ts";
import { CARTEL_LEAD_CAP, cartelRaidPlan } from "../src/kartell-route.ts";

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

test("Seewege: Kartell-Vorlauf 1 h auf offener See, länger um Land (gedeckelt); Überfall trägt die Route", async () => {
  const nests = nestSites();
  // Rechnung: Vorlauf = 1 h × (Seeweg / Luftlinie des gewählten Nests), höchstens CARTEL_LEAD_CAP.
  for (const [lon, lat] of [[-9.1, 38.7], [13.8, 45.6], [18.5, 59.3], [-70.2, 43.6]] as const) {
    const h = coastAt(lon, lat);
    const p = cartelRaidPlan(nests, h);
    assert.ok(p.route, "Route vom Nest");
    assert.ok(p.leadMs >= RAID_LEAD_MS && p.leadMs <= CARTEL_LEAD_CAP * RAID_LEAD_MS);
    const last = p.route!.hexes[p.route!.hexes.length - 1];
    assert.deepEqual(last, [h.col, h.row], "Route endet am Hafen");
  }
  // Ablauf: raid_launch legt die Kartell-Mission mit Route an; Position unterwegs liegt auf der Route.
  const v = await newPlayer("Zielhafen", coastAt(16.4, 43.5));
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, v.baseId));
  const s = b.state as BaseState;
  s.protection.createdAtMs = 0;
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, v.baseId));
  const [ev] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${v.baseId} and ${tables.gameEvent.type} = 'raid_launch' and ${tables.gameEvent.status} = 'pending'`);
  assert.ok(ev, "raid_launch geplant");
  await processDue(engine, ev.dueAt.getTime() + 1, 1000);
  const [m] = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${v.baseId}`);
  assert.ok(m, "Kartell läuft aus");
  const plan = m.plan as Mission;
  assert.ok(plan.route && plan.route.hexes.length >= 2, "Route im Plan");
  const lead = m.arriveAt.getTime() - plan.departAtMs;
  const nest = { col: plan.route!.hexes[0][0], row: plan.route!.hexes[0][1] };
  const expect = Math.round(RAID_LEAD_MS * Math.min(CARTEL_LEAD_CAP, Math.max(1, plan.route!.km / hexDistanceKm(nest, v))));
  assert.equal(lead, expect, "Vorlauf nach Routenlänge");
  const mid = fleetPosition(m, hexCenterXY(nest.col, nest.row), hexCenterXY(v.col, v.row), plan.departAtMs + lead / 2)!;
  const on = pointAlongRoute(plan.route!, plan.route!.km / 2);
  assert.ok(Math.hypot(mid.at.x - on.x, mid.at.y - on.y) < 1, "Kartell auf halber Route");
});

test("Seewege: Börsenlieferung nach dem Seeweg zum nächsten Handelshafen", () => {
  const h = coastAt(13.8, 45.6); // Adria: Genua liegt in Luftlinie nah, über Wasser weit
  const sea = nearestTradePortBySea(h);
  const air = nearestTradePort(h);
  assert.ok(sea.distanceKm >= air.distanceKm);
  assert.ok(Number.isFinite(sea.distanceKm) && sea.name !== "");
});
