// Stabilität: Fälligkeit bei Wiederholungen (orig_due_at), Wächter der Ereignis-Queue, Admin „neu einreihen“,
// spielerweite Sperre (Satelliten parallel aus zwei Häfen), Saisonwechsel wartet auf laufende Befehle.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  chooseBase, launchSatellite, listFailedEvents, processDue, register, requeueEvent, runEventWatchdog, seed,
  worldLockShared, type Engine,
} from "../src/index.ts";
import { HANDLERS } from "../src/handlers.ts";
import { MAX_EVENT_ATTEMPTS } from "../src/context.ts";
import { scheduleEvent } from "../src/store.ts";
import { satRules } from "../src/intel-sat.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const logs: { msg: string; data: unknown }[] = [];
const engine: Engine = { db, notify: () => {}, log: (msg, data) => { logs.push({ msg, data }); } };
let keyN = 0;
const key = () => `st-${++keyN}-${Date.now()}`;
const HOUR = 3600000;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 8; row < ROWS && !r.ok; row++) for (let col = 2; col < COLS && !r.ok; col += 4) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await patchBase(r.baseId!, (s) => { s.resources = { ...rich }; });
  return { playerId: p.playerId, baseId: r.baseId! };
}

const pendingOf = (type: string) => db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, type), eq(tables.gameEvent.status, "pending")));
const eventById = async (id: number) => (await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.id, id)))[0];
/** Wiederholung sofort fällig machen (statt 2^n Sekunden zu warten). */
const makeDue = (id: number) => db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.id, id));

let A: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%'`);
  A = await newPlayer("Stabil");
});

after(async () => {
  delete HANDLERS.test_flaky;
  await client.end();
});

test("Wiederholung: Handler erhält die ursprüngliche Fälligkeit, nicht den Wiederholungszeitpunkt", async () => {
  const calls: number[] = [];
  let fail = 2;
  HANDLERS.test_flaky = async (_tx, _ev, due) => {
    calls.push(due);
    if (fail-- > 0) throw new Error("vorübergehend");
    return { notify: [] };
  };
  const due0 = Date.now() - 5 * 60000;
  const [ev] = await db.insert(tables.gameEvent).values({ type: "test_flaky", dueAt: new Date(due0), payload: { probe: 1 }, baseId: null }).returning();
  await processDue(engine, Date.now(), 10);
  let row = await eventById(ev.id);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.equal(row.origDueAt?.getTime(), due0, "ursprüngliche Fälligkeit gemerkt");
  assert.ok(row.dueAt.getTime() > Date.now(), "Wiederholung später");
  await makeDue(ev.id);
  await processDue(engine, Date.now(), 10);
  row = await eventById(ev.id);
  assert.equal(row.attempts, 2);
  assert.equal(row.origDueAt?.getTime(), due0, "bleibt beim zweiten Fehlversuch");
  await makeDue(ev.id);
  await processDue(engine, Date.now(), 10);
  row = await eventById(ev.id);
  assert.equal(row.status, "done");
  assert.deepEqual(calls, [due0, due0, due0], "jeder Versuch mit derselben Spielzeit");
});

test("Endgültig fehlgeschlagen: Admin listet und reiht neu ein (Spielzeit bleibt), Doppel wird abgelehnt", async () => {
  const calls: number[] = [];
  let failing = true;
  HANDLERS.test_flaky = async (_tx, _ev, due) => {
    calls.push(due);
    if (failing) throw new Error("kaputt");
    return { notify: [] };
  };
  const due0 = Date.now() - 60000;
  const [ev] = await db.insert(tables.gameEvent).values({ type: "test_flaky", dueAt: new Date(due0), payload: { probe: 2 }, baseId: null }).returning();
  for (let i = 0; i < MAX_EVENT_ATTEMPTS; i++) {
    if (i > 0) await makeDue(ev.id);
    await processDue(engine, Date.now(), 10);
  }
  assert.equal((await eventById(ev.id)).status, "failed");
  const list = await listFailedEvents(db);
  const f = list.events.find((e) => e.id === ev.id);
  assert.ok(f && list.total >= 1);
  assert.equal(f.origDueAtMs, due0);
  assert.match(f.lastError ?? "", /kaputt/);
  failing = false;
  assert.deepEqual(await requeueEvent(db, ev.id), { ok: true });
  assert.deepEqual(await requeueEvent(db, ev.id), { ok: false, code: "not_failed" });
  await processDue(engine, Date.now(), 10);
  assert.equal((await eventById(ev.id)).status, "done");
  assert.equal(calls.at(-1), due0, "neu eingereiht: ursprüngliche Spielzeit");

  // Kette: liegt schon ein offenes Ereignis desselben Typs für dasselbe Objekt vor, wird nicht doppelt eingereiht.
  const [dead] = await db.insert(tables.gameEvent).values({ type: "radar_post_tick", dueAt: new Date(due0), payload: { postId: 999999 }, baseId: null, status: "failed" }).returning();
  await scheduleEvent(db, "radar_post_tick", Date.now() + HOUR, { postId: 999999 }, null);
  assert.deepEqual(await requeueEvent(db, dead.id), { ok: false, code: "already_pending" });
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.payload}->>'postId' = '999999'`);
});

test("Wächter: hängende Missionen bekommen Ankunft/Rückkehr, wiederholt gescheiterte fahren heim", async () => {
  const now = Date.now();
  const plan = { units: { korvette: 2 }, departAtMs: now - 2 * HOUR, arriveAtMs: now - HOUR, returnAtMs: now + HOUR, type: "ueberfall" };
  const mk = async (status: string, extra: Partial<typeof tables.mission.$inferInsert> = {}) => {
    const [m] = await db.insert(tables.mission).values({
      playerId: A.playerId, baseId: A.baseId, type: "ueberfall", targetKind: "nest", targetId: 1, targetCol: 1, targetRow: 1,
      plan, status, arriveAt: new Date(now - HOUR), ...extra,
    }).returning();
    return m.id;
  };
  const outbound = await mk("outbound");
  const returning = await mk("returning", { returning: { korvette: 2 }, cargoHome: {}, returnAt: new Date(now - 10 * 60000) });
  const broken = await mk("outbound");
  for (let i = 0; i < 2; i++) {
    await db.insert(tables.gameEvent).values({ type: "mission_arrive", dueAt: new Date(now - HOUR), payload: { missionId: broken }, status: "failed", attempts: 5 });
  }
  const r = await runEventWatchdog(engine, now);
  assert.equal(r.missions, 2);
  assert.equal(r.sentHome, 1);
  const evs = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.status, "pending"));
  const of = (id: number) => evs.filter((e) => (e.payload as { missionId?: number }).missionId === id);
  assert.deepEqual(of(outbound).map((e) => e.type), ["mission_arrive"]);
  assert.ok(of(outbound)[0].dueAt.getTime() >= now, "Ankunft nicht in der Vergangenheit");
  assert.deepEqual(of(returning).map((e) => e.type), ["mission_return"]);
  assert.deepEqual(of(broken).map((e) => e.type), ["mission_return"]);
  const [b] = await db.select().from(tables.mission).where(eq(tables.mission.id, broken));
  assert.equal(b.status, "returning");
  assert.deepEqual(b.returning, { korvette: 2 });
  // Zweiter Lauf: nichts mehr zu tun (keine Doppel).
  const again = await runEventWatchdog(engine, now);
  assert.equal(again.missions + again.sentHome, 0);
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.payload}->>'missionId' in (${String(outbound)}, ${String(returning)}, ${String(broken)})`);
  await db.delete(tables.mission).where(sql`${tables.mission.id} in (${outbound}, ${returning}, ${broken})`);
});

test("Wächter: abgerissene Ketten (Kartell, Radarposten, Seekabel, Satellit) werden neu angelegt", async () => {
  const now = Date.now();
  await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.baseId, A.baseId)));
  const [post] = await db.insert(tables.radarPost).values({ playerId: A.playerId, baseId: A.baseId, col: 3, row: 3, lastTickAt: new Date(now) }).returning();
  const [cable] = await db.insert(tables.powerCable).values({
    fromBaseId: A.baseId, toBaseId: A.baseId, fromPlayerId: A.playerId, toPlayerId: A.playerId, status: "aktiv", distanceKm: 1, createdAt: new Date(now),
  }).returning();
  const [idle] = await db.insert(tables.powerCable).values({
    fromBaseId: A.baseId, toBaseId: A.baseId, fromPlayerId: A.playerId, toPlayerId: A.playerId, status: "angefragt", distanceKm: 1, createdAt: new Date(now),
  }).returning();
  const sat = { id: now, type: "optisch", launchedAtMs: now - HOUR, expiresAtMs: now + 48 * HOUR, x0: 100, periodMs: 6 * HOUR, stripKm: 200, shiftKm: 300, liveMs: 30 * 60000, passes: 0, seen: 0, clouded: 0 };
  await patchBase(A.baseId, (s) => { (s as { satellites?: unknown[] }).satellites = [sat]; });
  const r = await runEventWatchdog(engine, now);
  assert.equal(r.chains.raid_launch, 1);
  assert.equal(r.chains.radar_post_tick, 1);
  assert.equal(r.chains.cable_tick, 1, "nur das aktive Kabel");
  assert.equal(r.chains.satellite_pass, 1);
  assert.equal(r.chains.satellite_end, 1);
  const [raid] = (await pendingOf("raid_launch")).filter((e) => e.baseId === A.baseId);
  assert.ok(raid.dueAt.getTime() > now, "kein sofortiger Überfall");
  assert.equal((await pendingOf("cable_tick")).filter((e) => (e.payload as { cableId: number }).cableId === idle.id).length, 0);
  assert.equal((await pendingOf("radar_post_tick")).filter((e) => (e.payload as { postId: number }).postId === post.id).length, 1);
  const again = await runEventWatchdog(engine, now);
  assert.deepEqual(again.chains, {}, "zweiter Lauf legt nichts doppelt an");
  // Aufräumen, damit spätere Tests keine Kabel/Posten abrechnen.
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} in ('cable_tick', 'radar_post_tick', 'satellite_pass', 'satellite_end')`);
  await db.delete(tables.powerCable).where(sql`${tables.powerCable.id} in (${cable.id}, ${idle.id})`);
  await db.delete(tables.radarPost).where(eq(tables.radarPost.id, post.id));
  await patchBase(A.baseId, (s) => { (s as { satellites?: unknown[] }).satellites = []; });
});

test("Satelliten: Höchstzahl spielerweit auch bei gleichzeitigen Starts aus zwei Häfen, IDs eindeutig", async () => {
  const P = await newPlayer("Orbiter");
  await patchBase(P.baseId, (s) => {
    s.buildings.startrampe = 1; s.research = { levels: { optischer_satellit: 1 }, order: null };
  });
  const colony = await addSecondHarbor(db, P.playerId, { patch: (s) => { s.buildings.startrampe = 1; } });
  const rs = await Promise.all([
    launchSatellite(engine, P.playerId, key(), { type: "optisch", baseId: P.baseId }),
    launchSatellite(engine, P.playerId, key(), { type: "optisch", baseId: colony.baseId }),
  ]);
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs));
  assert.equal((rs.find((r) => !r.ok) as { code: string }).code, "sat_limit");
  // Höchstzahl 2 (moreTech) und eingefrorene Uhr: zwei Starts in derselben Millisekunde bekommen verschiedene IDs.
  const sb = satRules()!;
  await patchBase(P.baseId, (s) => { s.research = { levels: { optischer_satellit: 1, [sb.moreTech]: 1 }, order: null }; });
  const firstId = (await Promise.all([P.baseId, colony.baseId].map(async (b) => (await db.select().from(tables.base).where(eq(tables.base.id, b)))[0].state as BaseState)))
    .flatMap((st) => st.satellites ?? [])[0].id;
  const real = Date.now;
  Date.now = () => firstId; // Start in derselben Millisekunde wie der erste Satellit
  try {
    const r2 = await launchSatellite(engine, P.playerId, key(), { type: "optisch", baseId: colony.baseId });
    assert.equal(r2.ok, true, JSON.stringify(r2));
  } finally {
    Date.now = real;
  }
  const ids: number[] = [];
  for (const b of [P.baseId, colony.baseId]) {
    const [row] = await db.select().from(tables.base).where(eq(tables.base.id, b));
    for (const x of (row.state as BaseState).satellites ?? []) ids.push(x.id);
  }
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, "eindeutige IDs");
});

test("Saisonwechsel wartet auf laufende Befehle (geteilte Weltsperre)", async () => {
  const [season] = await db.select().from(tables.season).where(eq(tables.season.status, "running"));
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  let ended = false;
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const holder = db.transaction(async (tx) => {
    await worldLockShared(tx); // wie ein laufender Befehl
    await held;
  });
  await new Promise((r) => setTimeout(r, 50));
  const worker = (async () => {
    while ((await processDue(engine, Date.now(), 50)) > 0) { /* weiter */ }
    ended = true;
  })();
  await new Promise((r) => setTimeout(r, 400));
  const [still] = await db.select().from(tables.season).where(eq(tables.season.id, season.id));
  assert.equal(still.status, "running", "Saisonende wartet");
  assert.equal(ended, false);
  release();
  await holder;
  await worker;
  const [done] = await db.select().from(tables.season).where(eq(tables.season.id, season.id));
  assert.equal(done.status, "finished");
});
