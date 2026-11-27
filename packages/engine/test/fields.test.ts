// Integrationstests Felder: Rohstofffelder einnehmen, Ertrag als Konvoi, Angriff, Rückruf, Kartell (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexDistanceKm, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import { balance, chooseBase, ensureFieldPlanner, fieldRecall, fieldsView, launchMission, missionPreview, processDue, register, seed, setIntelFog, type Engine } from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `fd${++keyN}-${Date.now()}`;
const used = new Set<string>();
const F = (balance as unknown as { fields: { count: number; minKmFromBase: number; guardRespawnHours: number } }).fields;

function coastNear(near: { col: number; row: number } | null, minKm = 300, maxKm = 700): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 20; row < ROWS; row++) for (let col = 10; col < COLS; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || nests.has(k) || used.has(k)) continue;
    if (near) {
      const d = hexDistanceKm(near, { col, row });
      if (d < minKm || d > maxKm) continue;
    }
    used.add(k);
    return { col, row };
  }
  throw new Error("no coast");
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

async function newPlayer(name: string, field: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 500_000, treibstoff: 500_000, elektronik: 500_000, proviant: 500_000 };
    s.buildings.kommandozentrale = 15;
    s.buildings.hafenkommandantur = 10;
    s.buildings.lagerkomplex = 15;
    s.units = { ...s.units, zerstoerer: 30, korvette: 30, schuetzen: 50, aufklaerungsdrohne: 5 };
  });
  return { playerId: p.playerId, baseId, ...field };
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

async function fieldRow(id: number) {
  const [f] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.id, id));
  return f;
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await setIntelFog(db, false); // Feldregeln ohne Kartennebel (Lagebild: lagebild.test.ts)
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
});

after(async () => {
  await client.end();
});

test("Felder: Verteilung, Aufklärung, Besetzen, Ertragskonvoi, Angriff, Rückruf, Kartell", async () => {
  const a = await newPlayer("Feldherr", coastNear(null));
  const b = await newPlayer("Rivale", coastNear(a));
  const at = await ensureFieldPlanner(db, Date.now());
  assert.ok(at, "field_tick geplant");
  const all = await db.select().from(tables.resourceField);
  assert.equal(all.length, F.count);
  for (const f of all) {
    assert.ok(hexDistanceKm(f, a) >= F.minKmFromBase && hexDistanceKm(f, b) >= F.minKmFromBase, "Mindestabstand zu Häfen");
  }
  const view = (await fieldsView(engine, a.playerId))!;
  assert.equal(view.maxFields, 3);
  const target = [...view.fields].sort((x, y) => hexDistanceKm(x, a) - hexDistanceKm(y, a))[0];
  assert.equal(target.relation, "kartell");
  assert.equal(target.guard, null, "Wache ohne Aufklärung unbekannt");

  // Aufklärung zeigt die Wache.
  const scout = await launchMission(engine, a.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(scout.ok, true, JSON.stringify(scout));
  await runUntil((scout as { arriveAtMs: number }).arriveAtMs + 1000);
  const seen = (await fieldsView(engine, a.playerId))!.fields.find((f) => f.id === target.id)!;
  assert.ok(seen.intel && (seen.intel.units.schnellboot ?? 0) > 0, JSON.stringify(seen));

  // Ablehnungen: Landtruppen, zu schwach.
  const land = await missionPreview(engine, a.playerId, { type: "besetzen", units: { korvette: 2, schuetzen: 10 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(land.ok ? "ok" : land.code, "field_ships_only");
  const weak = await missionPreview(engine, a.playerId, { type: "besetzen", units: { korvette: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(weak.ok ? "ok" : weak.code, "garrison_too_weak");

  // Besetzen: Sieg über die Wache, Mindestbesatzung bleibt, der Rest fährt heim.
  const go = await launchMission(engine, a.playerId, key(), { type: "besetzen", units: { zerstoerer: 8, korvette: 6 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(go.ok, true, JSON.stringify(go));
  const goId = (go as { missionId: number }).missionId;
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  let f = await fieldRow(target.id);
  assert.equal(f.ownerId, a.playerId);
  assert.equal(f.baseId, a.baseId, "Feld hängt am Heimathafen");
  const [gm] = await db.select().from(tables.mission).where(eq(tables.mission.id, goId));
  assert.equal(gm.status, "stationed");
  const garrison = gm.returning as Record<string, number>;
  const cp = Object.entries(garrison).reduce((s, [id, n]) => s + (balance.units[id].commandPoints ?? 0) * n, 0);
  assert.ok(cp >= 6 && cp <= 8, `Mindestbesatzung: ${JSON.stringify(garrison)}`);
  const rest = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'besetzen' and ${tables.mission.status} = 'returning' and ${tables.mission.playerId} = ${a.playerId}`);
  assert.equal(rest.length, 1, "Heimkehrer als eigene Mission");

  // Lieferzyklus: Konvoi mit Ertrag zum Heimathafen.
  await db.update(tables.resourceField).set({ lastTickAt: new Date(Date.now() - 4 * HOUR) }).where(eq(tables.resourceField.id, target.id));
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(sql`${tables.gameEvent.type} = 'field_tick' and ${tables.gameEvent.status} = 'pending'`);
  await runUntil(Date.now() + 1000);
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.kind, "feld"));
  assert.ok(cv, "Ertragskonvoi unterwegs");
  const res = Object.keys(cv.cargo as object)[0];
  const before = (await stateOf(a.baseId)).resources[res];
  await runUntil(cv.arriveAt.getTime() + 1000);
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cv.id));
  assert.equal(cv2.status, "arrived");
  assert.ok((await stateOf(a.baseId)).resources[res] > before, "Ertrag gutgeschrieben");

  // Rivale greift an und übernimmt mit seiner Besatzung.
  const atk = await launchMission(engine, b.playerId, key(), { type: "besetzen", units: { zerstoerer: 10 }, col: target.col, row: target.row, fieldId: target.id, stayAll: true });
  assert.equal(atk.ok, true, JSON.stringify(atk));
  await runUntil((atk as { arriveAtMs: number }).arriveAtMs + 1000);
  f = await fieldRow(target.id);
  assert.equal(f.ownerId, b.playerId);
  const [old] = await db.select().from(tables.mission).where(eq(tables.mission.id, goId));
  assert.notEqual(old.status, "stationed", "alte Besatzung aufgelöst");

  // Rückruf: Feld wird neutral, Wache kommt später.
  const rc = await fieldRecall(engine, b.playerId, key(), target.id);
  assert.equal(rc.ok, true, JSON.stringify(rc));
  f = await fieldRow(target.id);
  assert.equal(f.ownerId, null);
  assert.deepEqual(f.guard, {});
  assert.ok(f.guardAt && f.guardAt.getTime() > Date.now() + (F.guardRespawnHours - 1) * HOUR);

  // Kartell greift eine besetzte Feld an und gewinnt: Feld neutral mit Wache.
  const go2 = await launchMission(engine, a.playerId, key(), { type: "besetzen", units: { korvette: 2 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(go2.ok, true, JSON.stringify(go2));
  await runUntil((go2 as { arriveAtMs: number }).arriveAtMs + 1000);
  f = await fieldRow(target.id);
  assert.equal(f.ownerId, a.playerId, "ohne Wache kampflos besetzt");
  await db.insert(tables.gameEvent).values({ type: "field_raid", dueAt: new Date(), payload: { fieldId: target.id, ownerId: a.playerId, units: { schnellboot: 40 } }, baseId: null });
  await runUntil(Date.now() + 1000);
  f = await fieldRow(target.id);
  assert.equal(f.ownerId, null);
  assert.ok(((f.guard as Record<string, number>).schnellboot ?? 0) > 0, "Kartell hält das Feld");

  // Höchstzahl: ohne Hafenkommandantur kein Feld.
  await patchBase(a.baseId, (s) => { s.buildings.hafenkommandantur = 0; });
  const lim = await missionPreview(engine, a.playerId, { type: "besetzen", units: { zerstoerer: 2 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(lim.ok ? "ok" : lim.code, "field_limit");
});

test("Mehrere Häfen: Feld gehört dem Hafen, der es nimmt; Ertrag dorthin; Höchstzahl nach höchster Hafenkommandantur", async () => {
  const c = await newPlayer("Feldkolonist", coastNear(null));
  await patchBase(c.baseId, (s) => { s.buildings.hafenkommandantur = 0; });
  const free = (await db.select().from(tables.resourceField)).find((x) => x.ownerId === null)!;
  await db.update(tables.resourceField).set({ guard: {}, guardAt: new Date(Date.now() + 30 * DAY) }).where(eq(tables.resourceField.id, free.id));
  const c2 = await addSecondHarbor(db, c.playerId, {
    near: free, minKm: 60, maxKm: 400,
    patch: (s) => { s.buildings.hafenkommandantur = 10; s.buildings.kommandozentrale = 15; s.protection.createdAtMs = 0; s.units = { korvette: 6 }; },
  });
  assert.equal((await fieldsView(engine, c.playerId))!.maxFields, 3, "höchste Hafenkommandantur zählt (Kolonie Stufe 10)");
  const go = await launchMission(engine, c.playerId, key(), { type: "besetzen", units: { korvette: 2 }, col: free.col, row: free.row, fieldId: free.id, baseId: c2.baseId });
  assert.equal(go.ok, true, JSON.stringify(go));
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const f = await fieldRow(free.id);
  assert.equal(f.ownerId, c.playerId);
  assert.equal(f.baseId, c2.baseId, "Feld hängt am nehmenden Hafen");
  const mine = (await fieldsView(engine, c.playerId))!.mine.find((m) => m.id === free.id)!;
  assert.equal(mine.baseId, c2.baseId);
  assert.equal(mine.home, c2.name);
  // Ertragskonvoi zum nehmenden Hafen.
  await db.update(tables.resourceField).set({ lastTickAt: new Date(Date.now() - 4 * HOUR) }).where(eq(tables.resourceField.id, free.id));
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(sql`${tables.gameEvent.type} = 'field_tick' and ${tables.gameEvent.status} = 'pending'`);
  await runUntil(Date.now() + 1000);
  const cvs = await db.select().from(tables.convoy).where(eq(tables.convoy.recipientId, c.playerId));
  assert.ok(cvs.length > 0 && cvs.every((x) => x.recipientBaseId === c2.baseId), "Ertrag an den nehmenden Hafen");
  // Rückruf aus jedem aktiven Hafen erlaubt (Feld ist spielerweit).
  assert.equal((await fieldRecall(engine, c.playerId, key(), free.id)).ok, true);
});
