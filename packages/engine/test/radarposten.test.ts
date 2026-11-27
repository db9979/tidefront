// Lagebild Stufe 2 (5.3) gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Radarposten errichten
// (Prüfungen, Kosten, Besatzung bleibt, Rest fährt heim), Reichweite als Sensor, Treibstoff je Stunde, Höchstzahl und
// Mindestabstand, Abbau mit 50 % Rückerstattung, Angriff wie auf ein Feld (Pioniere verloren).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm, isTradePortHex, neighbors, terrainAt } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  chooseBase, clearPersistThrottle, clearSightCache, dismantlePost, launchIntelOp, mapViewFor, previewIntelOp, processDue,
  register, seed, sightOf, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `rp-${++keyN}-${realNow()}`;
const HOUR = 3600000;
type Hex = { col: number; row: number };

async function newPlayer(name: string, pos: Hex) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => {
    s.site = undefined; s.resources = { stahl: 20000, treibstoff: 20000, elektronik: 20000, proviant: 20000 }; s.resUpdatedAt = fake;
    s.protection.createdAtMs = 0; s.buildings.hafenkommandantur = 6; s.buildings.radarstation = 3; s.buildings.kaserne = 3;
  });
  return { playerId: p.playerId, baseId: r.baseId!, name };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}
const stateOf = async (id: number) => (await db.select().from(tables.base).where(eq(tables.base.id, id)))[0].state as BaseState;
const missionOf = async (id: number) => (await db.select().from(tables.mission).where(eq(tables.mission.id, id)))[0];
async function advance(to: number) {
  fake = to;
  while ((await processDue(engine, to, 500)) > 0);
  clearSightCache();
  clearPersistThrottle();
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;
let site1: Hex, site2: Hex, site3: Hex, siteFar: Hex;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  Date.now = () => fake;
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  const nests = new Set((await db.select().from(tables.nest)).map((n) => `${n.col},${n.row}`));
  const coast: Hex[] = [];
  for (let row = 10; row < ROWS - 10; row++) for (let col = 10; col < COLS - 10; col++) {
    if (terrainAt(col, row) === "coast" && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && neighbors(col, row).some((h) => terrainAt(h.col, h.row) === "sea")) coast.push({ col, row });
  }
  site1 = coast[Math.floor(coast.length / 2)];
  site3 = coast.find((c) => c !== site1 && hexDistanceKm(c, site1) < 250)!;
  site2 = coast.find((c) => hexDistanceKm(c, site1) > 350 && hexDistanceKm(c, site1) < 700 && hexDistanceKm(c, site3) > 350)!;
  siteFar = coast.find((c) => hexDistanceKm(c, site1) > 350 && hexDistanceKm(c, site2) > 350 && hexDistanceKm(c, site1) < 1200)!;
  assert.ok(site1 && site2 && site3 && siteFar, "Küstenfelder gefunden");
  const sea = neighbors(site1.col, site1.row).find((h) => terrainAt(h.col, h.row) === "sea")!;
  A = await newPlayer("Posten", sea);
  const seaB = neighbors(site2.col, site2.row).find((h) => terrainAt(h.col, h.row) === "sea")!;
  B = await newPlayer("Stoertrupp", seaB);
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
});

after(async () => {
  Date.now = realNow;
  await client.end();
});

test("Radarposten: Prüfungen, Errichten, Reichweite, Treibstoff, Höchstzahl, Abbau", async () => {
  await patchBase(A.baseId, (s) => { s.units = { ...s.units, pioniere: 20, landungsschiff: 3, korvette: 2 }; });
  const p = (o: Partial<Parameters<typeof previewIntelOp>[2]>) => previewIntelOp(engine, A.playerId, { op: "radarposten", units: { pioniere: 5, landungsschiff: 1 }, col: site1.col, row: site1.row, ...o });
  assert.equal((await p({ units: { pioniere: 4, landungsschiff: 1 } })).code, "post_crew");
  const sea = neighbors(site1.col, site1.row).find((h) => terrainAt(h.col, h.row) === "sea")!;
  assert.equal((await p({ col: sea.col, row: sea.row })).code, "post_site", "offene See ist kein Küstenfeld");
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 2; });
  assert.equal((await p({})).code, "post_radar");
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 3; });
  const ok = await p({});
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const before = await stateOf(A.baseId);
  const r = await launchIntelOp(engine, A.playerId, key(), { op: "radarposten", units: { pioniere: 6, landungsschiff: 1, korvette: 1 }, col: site1.col, row: site1.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const after1 = await stateOf(A.baseId);
  assert.ok(before.resources.stahl - after1.resources.stahl >= 1500, "Kosten 1 500 Stahl");
  assert.ok(before.resources.elektronik - after1.resources.elektronik >= 1000);
  // Zweiter Posten zu nah am ersten (unterwegs zählt mit).
  assert.equal((await p({ col: site3.col, row: site3.row })).code, "post_too_close");
  await advance((await missionOf(r.missionId)).arriveAt.getTime() + 1000);
  const [post] = await db.select().from(tables.radarPost).where(eq(tables.radarPost.playerId, A.playerId));
  assert.ok(post, "Posten steht");
  assert.deepEqual(post.crew, { pioniere: 6 });
  const crew = await missionOf(r.missionId);
  assert.equal(crew.status, "stationed");
  const sight = await sightOf(db, A.playerId, fake);
  assert.ok(sight.sensors.some((s) => s.kind === "posten" && s.km === 250), "Reichweite 250 km");
  const view = await mapViewFor(db, A.playerId, fake);
  assert.ok(view.posts.some((x) => x.id === post.id && x.own && x.rangeKm === 250));
  // Betrieb: 3 Treibstoff je Stunde; ohne Treibstoff aus.
  const t0 = (await stateOf(A.baseId)).resources.treibstoff;
  await advance(fake + HOUR + 1000);
  const t1 = (await stateOf(A.baseId)).resources.treibstoff;
  assert.ok(t1 <= t0 + 400, "Treibstoff abgezogen (neben der Produktion)");
  await patchBase(A.baseId, (s) => { s.resources.treibstoff = 0; s.resUpdatedAt = fake + HOUR + 1000; }); // keine Produktion bis zum Takt
  await advance(fake + HOUR + 1000);
  assert.equal((await db.select().from(tables.radarPost).where(eq(tables.radarPost.id, post.id)))[0].offline, true, "ohne Treibstoff aus");
  clearSightCache();
  assert.ok(!(await sightOf(db, A.playerId, fake)).sensors.some((s) => s.kind === "posten"));
  await patchBase(A.baseId, (s) => { s.resources.treibstoff = 20000; s.resUpdatedAt = fake; });
  // Höchstzahl 2 (Hafenkommandantur < 8): zweiter Posten geht, dritter nicht.
  const r2 = await launchIntelOp(engine, A.playerId, key(), { op: "radarposten", units: { pioniere: 5, landungsschiff: 1 }, col: site2.col, row: site2.row });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal((await p({ col: siteFar.col, row: siteFar.row })).code, "post_limit");
  await patchBase(A.baseId, (s) => { s.buildings.hafenkommandantur = 8; });
  assert.notEqual((await p({ col: siteFar.col, row: siteFar.row })).code, "post_limit", "Hafenkommandantur 8: drei Posten");
  // Abbau: Besatzung fährt mit 50 % der Kosten heim.
  const s0 = await stateOf(A.baseId);
  const d = await dismantlePost(engine, A.playerId, key(), post.id);
  assert.equal(d.ok, true, JSON.stringify(d));
  if (!d.ok) return;
  assert.equal((await db.select().from(tables.radarPost).where(eq(tables.radarPost.id, post.id))).length, 0);
  await advance(d.returnAtMs + 1000);
  const s1 = await stateOf(A.baseId);
  assert.ok(s1.resources.elektronik - s0.resources.elektronik >= 500, "500 Elektronik zurück");
  assert.equal(s1.unitsAway.pioniere ?? 0, 5, "nur noch die Besatzung des zweiten Postens unterwegs");
});

test("Radarposten angreifen: Truppen schlagen die Besatzung, Posten zerstört, Pioniere verloren", async () => {
  const [post] = await db.select().from(tables.radarPost).where(eq(tables.radarPost.playerId, A.playerId));
  if (!post) {
    // zweiter Posten noch unterwegs: ankommen lassen
    const [m] = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'radarposten' and ${tables.mission.status} = 'outbound'`);
    await advance(m.arriveAt.getTime() + 1000);
  }
  const [target] = await db.select().from(tables.radarPost).where(eq(tables.radarPost.playerId, A.playerId));
  assert.ok(target);
  await patchBase(B.baseId, (s) => { s.units = { ...s.units, schuetzen: 60, landungsschiff: 2, korvette: 4 }; });
  const r = await launchIntelOp(engine, B.playerId, key(), { op: "postenangriff", units: { schuetzen: 60, landungsschiff: 2, korvette: 4 }, postId: target.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  await advance((await missionOf(r.missionId)).arriveAt.getTime() + 1000);
  assert.equal((await db.select().from(tables.radarPost).where(eq(tables.radarPost.id, target.id))).length, 0, "Posten zerstört");
  const [rep] = await db.select().from(tables.battleReport).where(sql`${tables.battleReport.kind} = 'posten' and ${tables.battleReport.defenderPlayerId} = ${A.playerId}`);
  assert.match(rep.title, /zerstört/);
  await advance(fake + 1000);
  const s = await stateOf(A.baseId);
  assert.equal(s.unitsAway.pioniere ?? 0, 0, "Pioniere verloren (nicht mehr unterwegs)");
});
