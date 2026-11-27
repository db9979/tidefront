// Aufklärung auf Sicht gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Wendepunkt in Lagebild-Reichweite,
// Lagebild am Wendepunkt, kürzere Fahrt, „Aufklärer gesichtet“ nur bei Wendepunkt im Ausguck/Radar, Kampagne mit Zielen
// in Reichweite (docs/VORLAGE-NESTER.md 2, ENTSCHEIDUNGEN-5.md).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenterXY } from "@tidefront/world";
import type { BaseState, Mission } from "@tidefront/game-core";
import {
  chooseBase, clearPersistThrottle, clearSightCache, knownFor, launchIntelOp, launchMission, mapViewFor,
  processDue, register, seed, sightOf, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `rs-${++keyN}-${realNow()}`;
const HOUR = 3600000;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };
const HOME = { col: 40, row: 30 };
const at = (dc: number, dr = 0) => ({ col: HOME.col + dc, row: HOME.row + dr });

async function newPlayer(name: string, pos: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => { s.site = undefined; s.resources = { ...rich }; s.resUpdatedAt = fake; s.protection.createdAtMs = 0; s.buildings.hafenkommandantur = 10; s.buildings.kommandozentrale = 10; });
  return { playerId: p.playerId, baseId: r.baseId!, name };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function nestAt(pos: { col: number; row: number }, level = 2): Promise<number> {
  await db.delete(tables.nest).where(sql`${tables.nest.col} = ${pos.col} and ${tables.nest.row} = ${pos.row}`);
  const [n] = await db.insert(tables.nest).values({ ...pos, level }).returning({ id: tables.nest.id });
  return n.id;
}

const fresh = () => { clearSightCache(); clearPersistThrottle(); };
const nestOf = async (playerId: number, id: number, t = fake) => (await mapViewFor(db, playerId, t)).nests.find((n) => n.id === id)!;
const missionOf = async (id: number) => (await db.select().from(tables.mission).where(eq(tables.mission.id, id)))[0];
async function advance(to: number) {
  fake = to;
  while ((await processDue(engine, to, 500)) > 0);
  fresh();
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  Date.now = () => fake;
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} = 'raid_launch'`);
  A = await newPlayer("Sicht", HOME);
  B = await newPlayer("Ziel", at(4, 0));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch'`);
});

beforeEach(fresh);

after(async () => {
  Date.now = realNow;
  await client.end();
});

test("Drohne klärt ein Nest aus 200 km auf: Wendepunkt, Lagebild, halbe Fahrt", async () => {
  const target = at(-6, 0);
  const id = await nestAt(target, 3);
  await patchBase(A.baseId, (s) => { s.units.aufklaerungsdrohne = 2; s.units.korvette = 2; });
  const r = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, ...target });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const m = await missionOf(r.missionId);
  const plan = m.plan as Mission;
  assert.equal(plan.sightTurn?.rangeKm, 200);
  const tgt = hexCenterXY(target.col, target.row);
  assert.ok(Math.abs(Math.hypot(plan.sightTurn!.x - tgt.x, plan.sightTurn!.y - tgt.y) - 200) < 1, "Wendepunkt 200 km vor dem Ziel");
  assert.ok(plan.sightTurn!.km < plan.distanceKm - 150, "kürzere Fahrt");
  await advance(m.arriveAt.getTime() + 1000);
  const rep = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "aufklaerung"), eq(tables.battleReport.nestId, id)));
  assert.equal(rep.length, 1, "Lagebild am Wendepunkt");
  const known = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["nest"]);
  assert.equal(known.get(`nest:${id}`)?.level, "lagebild");
  const back = await missionOf(r.missionId);
  assert.equal(back.status, "returning");
  assert.equal(back.returnAt!.getTime() - plan.departAtMs, 2 * (plan.arriveAtMs - plan.departAtMs), "Heimfahrt so lang wie die Hinfahrt");
  await advance(back.returnAt!.getTime() + 1000);
  const n = (await mapViewFor(db, A.playerId, fake)).nests.find((x) => x.id === id)!;
  assert.equal(n.level, 3);
});

test("„Aufklärer gesichtet“ nur, wenn der Wendepunkt im Ausguck oder Radar des Zielhafens liegt", async () => {
  const sightings = async () => (await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "sichtung"), eq(tables.battleReport.defenderBaseId, B.baseId)))).length;
  await patchBase(B.baseId, (s) => { s.buildings.radarstation = 0; });
  await patchBase(A.baseId, (s) => { s.units.aufklaerungsdrohne = 2; s.units.korvette = 2; });
  const target = at(4, 0);
  const drone = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, ...target });
  assert.equal(drone.ok, true, JSON.stringify(drone));
  if (!drone.ok) return;
  await advance((await missionOf(drone.missionId)).arriveAt.getTime() + 1000);
  assert.equal(await sightings(), 0, "Drohne bei 200 km: außerhalb des Ausgucks (120 km)");
  const ship = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, ...target });
  assert.equal(ship.ok, true, JSON.stringify(ship));
  if (!ship.ok) return;
  assert.equal(((await missionOf(ship.missionId)).plan as Mission).sightTurn?.rangeKm, 105);
  await advance((await missionOf(ship.missionId)).arriveAt.getTime() + 1000);
  assert.equal(await sightings(), 1, "Schiff bei 105 km: im Ausguck gesehen");
  await advance((await missionOf(ship.missionId)).returnAt!.getTime() + 1000);
  await advance((await missionOf(drone.missionId)).returnAt!.getTime() + 1000);
});

test("Kampagne: zweites Ziel schon in Reichweite ist im selben Augenblick aufgeklärt; Heimfahrt vom Wendepunkt", async () => {
  const n1 = await nestAt(at(-5, 3), 2);
  const n2 = await nestAt(at(-4, 3), 2); // 100 km vom Wendepunkt vor dem ersten Ziel
  await patchBase(A.baseId, (s) => { s.units.aufklaerungsdrohne = 2; });
  const r = await launchIntelOp(engine, A.playerId, key(), { op: "kampagne", units: { aufklaerungsdrohne: 1 }, targets: [at(-5, 3), at(-4, 3)] });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const first = await missionOf(r.missionId);
  assert.equal((first.plan as Mission).sightTurn?.rangeKm, 200);
  const t1 = first.arriveAt.getTime();
  await advance(t1 + 1000);
  const end = await missionOf(r.missionId);
  assert.equal(end.status, "returning", "beide Ziele aufgeklärt");
  const reps = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "aufklaerung"), eq(tables.battleReport.attackerPlayerId, A.playerId)));
  assert.ok(reps.some((x) => x.nestId === n1) && reps.some((x) => x.nestId === n2), JSON.stringify([n1, n2, reps.map((x) => x.nestId)]));
  assert.ok(end.returnAt!.getTime() - t1 <= t1 - (first.plan as Mission).departAtMs + 15 * 60000, "Heimweg ab dem Wendepunkt (Feldmitte), nicht ab dem Ziel");
  await advance(end.returnAt!.getTime() + 1000);
});
