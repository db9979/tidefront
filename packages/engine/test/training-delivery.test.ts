// Teillieferung der Ausbildung (0.44) gegen ein echtes PostgreSQL: Lieferung über die Ereigniskette ohne Abruf des
// Spielers, Angriff während der Ausbildung verteidigt mit den bereits gelieferten Anlagen, Meldung nur am Ende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import { chooseBase, processDue, register, seed, train, type Engine } from "../src/index.ts";
import type { NoticeJob } from "../src/context.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const jobs: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (j) => { jobs.push(...j); } };
let keyN = 0;
const key = () => `td${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
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

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const s = await stateOf(baseId);
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function pendingTrainingEvents(baseId: number) {
  return db.select().from(tables.gameEvent).where(and(
    eq(tables.gameEvent.baseId, baseId), eq(tables.gameEvent.type, "training_complete"), eq(tables.gameEvent.status, "pending"),
  ));
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Kartell-Planung und Weltereignisse stören die Zeitreise nicht.
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
});

after(async () => {
  await client.end();
});

test("Teillieferung ohne Spielerabruf: je Anlage ein Ereignis, Meldung nur am Ende", async () => {
  const p = await newPlayer("Tilda", 21);
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.baseId, p.baseId), eq(tables.gameEvent.type, "raid_launch")));
  await patchBase(p.baseId, (s) => { s.resources = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 }; });
  const r = await train(engine, p.playerId, key(), "kuestenbatterie", 3);
  assert.equal(r.ok, true, JSON.stringify(r));
  const order = (await stateOf(p.baseId)).trainingQueue[0];
  const each = (order.finishesAt - order.startedAt) / 3;
  let ev = await pendingTrainingEvents(p.baseId);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].dueAt.getTime(), order.startedAt + Math.floor(each), "Ereignis zur ersten Anlage");

  jobs.length = 0;
  await processDue(engine, order.startedAt + Math.floor(each) + 1);
  let s = await stateOf(p.baseId);
  assert.equal(s.defenses.kuestenbatterie ?? 0, 1);
  assert.equal(s.trainingQueue[0].done, 1);
  ev = await pendingTrainingEvents(p.baseId);
  assert.equal(ev.length, 1, "Kette: genau ein Folgeereignis");
  assert.equal(ev[0].dueAt.getTime(), order.startedAt + Math.floor(2 * each));
  assert.equal(jobs.filter((j) => j.notice.kind === "training").length, 0, "keine Meldung je Einheit");

  await processDue(engine, order.finishesAt + 1);
  s = await stateOf(p.baseId);
  assert.equal(s.defenses.kuestenbatterie, 3);
  assert.deepEqual(s.trainingQueue, []);
  assert.equal((await pendingTrainingEvents(p.baseId)).length, 0);
  const done = jobs.filter((j) => j.notice.kind === "training");
  assert.equal(done.length, 1, "eine Meldung am Ende");
  assert.match(done[0].notice.body, /3/);
});

test("Angriff während der Ausbildung: bereits gelieferte Anlagen verteidigen", async () => {
  const p = await newPlayer("Ulla", 24);
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.baseId, p.baseId), eq(tables.gameEvent.type, "raid_launch")));
  await patchBase(p.baseId, (s) => {
    s.resources = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
    s.protection.createdAtMs = 0;
    s.units = {};
    s.defenses = {};
  });
  const r = await train(engine, p.playerId, key(), "kuestenbatterie", 4);
  assert.equal(r.ok, true, JSON.stringify(r));
  const order = (await stateOf(p.baseId)).trainingQueue[0];
  const second = order.startedAt + Math.floor(((order.finishesAt - order.startedAt) * 2) / 4);
  const arrive = second + 1000; // zwei Anlagen fertig, zwei in Ausbildung
  const units = { schnellboot: 2, piratenmiliz: 4 };
  const [raid] = await db.insert(tables.mission).values({
    playerId: null, baseId: null, type: "kartell", targetKind: "base", targetId: p.baseId, targetCol: p.col, targetRow: p.row,
    plan: { units, attacker: { units, troopSpaceBonus: { schnellboot: 8 }, unlimitedCargo: true }, departAtMs: arrive - 60000, arriveAtMs: arrive },
    status: "outbound", arriveAt: new Date(arrive),
  }).returning({ id: tables.mission.id });
  await db.insert(tables.gameEvent).values({ type: "raid_arrive", dueAt: new Date(arrive), payload: { missionId: raid.id }, baseId: p.baseId });

  await processDue(engine, arrive + 1);
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, raid.id));
  assert.ok(m.reportId, "Kampf ausgetragen");
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, m.reportId!));
  const before = (report.report as { battle: { defender: { before: Record<string, number> } } }).battle.defender.before;
  assert.equal(before.kuestenbatterie, 2, "nur die beiden gelieferten Anlagen kämpfen");
  const s = await stateOf(p.baseId);
  assert.equal(s.trainingQueue[0].done, 2, "Rest bleibt in Ausbildung");
  assert.equal((await pendingTrainingEvents(p.baseId)).length, 1);
});
