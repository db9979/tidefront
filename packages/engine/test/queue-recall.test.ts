// Integrationstests Bauschlange und Rückruf gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { upgradeCost, type BaseState } from "@tidefront/game-core";
import {
  balance,
  baseView,
  cancelBuild,
  chooseBase,
  launchMission,
  processDue,
  recallOwnMission,
  register,
  seed,
  upgrade,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `q${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newPlayer(name: string, field: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, ...f };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function buildEvents(baseId: number) {
  return db
    .select()
    .from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.baseId, baseId), eq(tables.gameEvent.type, "build_complete"), eq(tables.gameEvent.status, "pending")));
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

test("Bauschlange: bis queueSlots Aufträge, je ein Ereignis, Abschluss der Reihe nach", async () => {
  const p = await newPlayer("Queue", 2);
  await patchBase(p.baseId, (s) => { s.resources = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 }; });
  for (const id of ["stahlwerk", "stahlwerk", "kraftwerk"]) {
    const r = await upgrade(engine, p.playerId, key(), id);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  assert.deepEqual(await upgrade(engine, p.playerId, key(), "raffinerie"), { ok: false, code: "queue_full" });
  const s = await stateOf(p.baseId);
  assert.deepEqual(s.buildQueue.map((o) => [o.buildingId, o.targetLevel]), [["stahlwerk", 1], ["stahlwerk", 2], ["kraftwerk", 1]]);
  assert.equal(s.buildQueue[1].startedAt, s.buildQueue[0].finishesAt);
  const events = await buildEvents(p.baseId);
  assert.deepEqual(events.map((e) => e.dueAt.getTime()).sort(), s.buildQueue.map((o) => o.finishesAt).sort());
  const view = await baseView(engine, p.playerId);
  assert.equal(view.base!.buildQueue.length, 3);
  assert.equal(view.base!.buildQueueSlots, balance.building.queueSlots);
  const sw = view.base!.buildings.find((b) => b.id === "stahlwerk")!;
  assert.equal(sw.level, 0);
  assert.equal(sw.planned, 2);
  assert.deepEqual(sw.cost, upgradeCost("stahlwerk", 2, balance));
  // Erstes Ereignis: nur der erste Auftrag.
  await processDue(engine, s.buildQueue[0].finishesAt + 1);
  let st = await stateOf(p.baseId);
  assert.equal(st.buildings.stahlwerk, 1);
  assert.equal(st.buildQueue.length, 2);
  await processDue(engine, s.buildQueue[2].finishesAt + 1);
  st = await stateOf(p.baseId);
  assert.equal(st.buildings.stahlwerk, 2);
  assert.equal(st.buildings.kraftwerk, 1);
  assert.deepEqual(st.buildQueue, []);
});

test("Bauschlange: Abbruch eines wartenden Auftrags erstattet voll, Nachrücker bekommen neue Ereignisse", async () => {
  const p = await newPlayer("Abbruch", 5);
  await patchBase(p.baseId, (s) => { s.resources = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 }; s.buildings.kommandozentrale = 2; });
  for (const id of ["stahlwerk", "kraftwerk", "stahlwerk"]) assert.equal((await upgrade(engine, p.playerId, key(), id)).ok, true);
  const before = await stateOf(p.baseId);
  // Unbekannter Auftrag
  assert.deepEqual(await cancelBuild(engine, p.playerId, key(), { buildingId: "raffinerie", targetLevel: 1 }), { ok: false, code: "no_order" });
  // Wartenden Kraftwerk-Auftrag abbrechen: volle Erstattung, der zweite Stahlwerk-Auftrag rückt nach.
  const r = await cancelBuild(engine, p.playerId, key(), { buildingId: "kraftwerk", targetLevel: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((r as { refund: Record<string, number> }).refund, upgradeCost("kraftwerk", 0, balance));
  const s = await stateOf(p.baseId);
  assert.deepEqual(s.buildQueue.map((o) => [o.buildingId, o.targetLevel]), [["stahlwerk", 1], ["stahlwerk", 2]]);
  assert.equal(s.buildQueue[1].startedAt, before.buildQueue[0].finishesAt);
  assert.ok(s.buildQueue[1].finishesAt < before.buildQueue[2].finishesAt);
  const due = (await buildEvents(p.baseId)).map((e) => e.dueAt.getTime());
  assert.ok(due.includes(s.buildQueue[1].finishesAt));
  // Laufenden Auftrag abbrechen: der spätere Stahlwerk-Auftrag wird ungültig und voll erstattet.
  const r2 = await cancelBuild(engine, p.playerId, key(), { buildingId: "stahlwerk", targetLevel: 1 });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal((r2 as { removed: number }).removed, 2);
  assert.deepEqual((await stateOf(p.baseId)).buildQueue, []);
  // Alte Ereignisse laufen ins Leere.
  await processDue(engine, before.buildQueue[2].finishesAt + 1);
  assert.equal((await stateOf(p.baseId)).buildings.stahlwerk, 0);
});

test("Rückruf: Transport kehrt mit Ladung um, verschwindet beim Ziel, Ankunft läuft ins Leere", async () => {
  const a = await newPlayer("Ruf", 8);
  const b = await newPlayer("Ziel", 30);
  await patchBase(a.baseId, (s) => { s.units = { landungsschiff: 1 }; s.resources.treibstoff = 50000; s.resources.stahl = 3000; });
  const m = await launchMission(engine, a.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: b.col, row: b.row, cargo: { stahl: 1000 } });
  assert.equal(m.ok, true, JSON.stringify(m));
  const missionId = (m as { missionId: number }).missionId;
  const fuelAfterLaunch = (await stateOf(a.baseId)).resources.treibstoff;
  assert.equal((await baseView(engine, b.playerId)).base!.incoming.length, 1);
  // Fremder Spieler darf nicht zurückrufen.
  assert.deepEqual(await recallOwnMission(engine, b.playerId, key(), missionId), { ok: false, code: "no_mission" });
  const r = await recallOwnMission(engine, a.playerId, key(), missionId);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, missionId));
  assert.equal(row.status, "returning");
  const plan = row.plan as { departAtMs: number; recalledAtMs: number; arriveAtMs: number };
  assert.equal(row.returnAt!.getTime(), plan.recalledAtMs + (plan.recalledAtMs - plan.departAtMs));
  assert.equal((await baseView(engine, b.playerId)).base!.incoming.length, 0);
  const own = (await baseView(engine, a.playerId)).base!.missions.find((x) => x.id === missionId)!;
  assert.equal(own.recalled, true);
  assert.deepEqual(await recallOwnMission(engine, a.playerId, key(), missionId), { ok: false, code: "not_outbound" });
  // Rückkehr: Schiff und Ladung zurück, Treibstoff bleibt verbraucht.
  const targetStahl = (await stateOf(b.baseId)).resources.stahl;
  await processDue(engine, row.returnAt!.getTime() + 1);
  let s = await stateOf(a.baseId);
  assert.equal(s.units.landungsschiff, 1);
  assert.deepEqual(s.unitsAway, {});
  assert.ok(s.resources.stahl >= 3000 - 1);
  assert.ok(s.resources.treibstoff < fuelAfterLaunch + 100);
  // Die ursprüngliche Ankunft bewirkt nichts mehr.
  await processDue(engine, plan.arriveAtMs + 1);
  const [done] = await db.select().from(tables.mission).where(eq(tables.mission.id, missionId));
  assert.equal(done.status, "done");
  assert.equal(done.reportId, null);
  // Ohne Lieferung wächst der Zielhafen nur um seine eigene Produktion bis zur ursprünglichen Ankunft.
  const growthHours = Math.max(0, plan.arriveAtMs - Date.now()) / 3600000 + 1;
  const stahlRate = Math.max(0, (await baseView(engine, b.playerId)).base!.rates.stahl ?? 0);
  assert.ok((await stateOf(b.baseId)).resources.stahl < targetStahl + stahlRate * growthHours + 1);
  s = await stateOf(a.baseId);
  assert.equal(s.units.landungsschiff, 1);
});

test("Rückruf: Kartell-Verbände und fremde IDs sind nicht abrufbar", async () => {
  const p = await newPlayer("Kein", 11);
  const [raid] = await db
    .insert(tables.mission)
    .values({ playerId: null, baseId: null, type: "kartell", targetKind: "base", targetId: p.baseId, targetCol: p.col, targetRow: p.row, plan: { units: {}, departAtMs: Date.now(), arriveAtMs: Date.now() + 3600000 }, status: "outbound", arriveAt: new Date(Date.now() + 3600000) })
    .returning({ id: tables.mission.id });
  assert.deepEqual(await recallOwnMission(engine, p.playerId, key(), raid.id), { ok: false, code: "no_mission" });
  assert.deepEqual(await recallOwnMission(engine, p.playerId, key(), 999999), { ok: false, code: "no_mission" });
});
