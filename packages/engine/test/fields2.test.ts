// Integrationstests Felder 2: Geleitabteilung für Ertragskonvois, Verstärkung einer Besatzung (auch aus einem anderen
// Hafen), Radar-Vorwarnung bei Angriffen auf Felder, Wochenziele „feldertrag“ und „gruendung“
// (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexDistanceKm, COLS, ROWS } from "@tidefront/world";
import { mulberry32, type BaseState } from "@tidefront/game-core";
import {
  chooseBase, ensureFieldPlanner, fieldRecall, fieldsView, launchMission, missionPreview, processDue, register, seed, setFieldEscort,
  weeklyView, type Engine,
} from "../src/index.ts";
import { setRandomSeedSource } from "../src/store.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `fe${++keyN}-${Date.now()}`;
const used = new Set<string>();

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
    s.buildings.radarstation = 5;
    s.buildings.kraftwerk = 15;
    s.units = { ...s.units, zerstoerer: 30, korvette: 30 };
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

async function missionRow(id: number) {
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  return m;
}

/** Freies, unbewachtes Feld nahe `near` (kampflos besetzbar). */
async function freeField(near: { col: number; row: number }) {
  const all = (await db.select().from(tables.resourceField)).filter((x) => x.ownerId === null);
  const f = all.sort((x, y) => hexDistanceKm(x, near) - hexDistanceKm(y, near))[0];
  await db.update(tables.resourceField).set({ guard: {}, guardAt: new Date(Date.now() + 30 * DAY) }).where(eq(tables.resourceField.id, f.id));
  return f;
}

async function capture(p: { playerId: number }, f: { id: number; col: number; row: number }, units: Record<string, number>, baseId?: number) {
  const go = await launchMission(engine, p.playerId, key(), { type: "besetzen", units, col: f.col, row: f.row, fieldId: f.id, stayAll: true, ...(baseId ? { baseId } : {}) });
  assert.equal(go.ok, true, JSON.stringify(go));
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const row = await fieldRow(f.id);
  assert.equal(row.ownerId, p.playerId);
  return (go as { missionId: number }).missionId;
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
});

after(async () => {
  setRandomSeedSource(null);
  await client.end();
});

test("Felder 2: Geleitabteilung begleitet Ertragskonvois, verteidigt nur gegen das Kartell; Radar-Vorwarnung bei Angriff", async () => {
  setRandomSeedSource(mulberry32(Number(process.env.TF_TEST_SEED ?? 382001))); // TE-02: Kampf- und Kartellwürfe deterministisch
  const a = await newPlayer("Geleitherr", coastNear(null));
  const b = await newPlayer("Angreifer", coastNear(a));
  assert.ok(await ensureFieldPlanner(db, Date.now()));
  const target = await freeField(a);
  const gid = await capture(a, target, { zerstoerer: 2, korvette: 3 });

  // Geleit festlegen: nur Schiffe der Besatzung, der Rest bleibt gültige Besatzung.
  const tooMuch = await setFieldEscort(engine, a.playerId, key(), target.id, { zerstoerer: 2, korvette: 3 });
  assert.equal(tooMuch.ok ? "ok" : tooMuch.code, "field_escort_too_large");
  const bad = await setFieldEscort(engine, a.playerId, key(), target.id, { korvette: 4 });
  assert.equal(bad.ok ? "ok" : bad.code, "field_escort_invalid");
  const other = await setFieldEscort(engine, b.playerId, key(), target.id, { korvette: 1 });
  assert.equal(other.ok ? "ok" : other.code, "no_field");
  const ok = await setFieldEscort(engine, a.playerId, key(), target.id, { korvette: 2 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  let mine = (await fieldsView(engine, a.playerId))!.mine.find((m) => m.id === target.id)!;
  assert.deepEqual(mine.escort, { korvette: 2 });
  assert.deepEqual(mine.defenders, { zerstoerer: 2, korvette: 1 });

  // Lieferzyklus: Konvoi mit Geleit (missionId = Besatzung).
  await db.update(tables.resourceField).set({ lastTickAt: new Date(Date.now() - 4 * HOUR) }).where(eq(tables.resourceField.id, target.id));
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(sql`${tables.gameEvent.type} = 'field_tick' and ${tables.gameEvent.status} = 'pending'`);
  await runUntil(Date.now() + 1000);
  const [cv] = await db.select().from(tables.convoy).where(and(eq(tables.convoy.kind, "feld"), eq(tables.convoy.recipientId, a.playerId)));
  assert.ok(cv, "Ertragskonvoi unterwegs");
  assert.equal(cv.missionId, gid);
  assert.deepEqual(cv.escort, { korvette: 2 });

  // Kartell fängt ab: das Geleit kämpft (2 Korvetten gegen Schnellboote) und hält.
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(), payload: { convoyId: cv.id }, baseId: null });
  await runUntil(Date.now() + 1000);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "konvoi"), eq(tables.battleReport.defenderPlayerId, a.playerId)));
  assert.ok(rep, "Konvoibericht");
  assert.equal((rep.report as { convoy: { held: boolean } }).convoy.held, true, JSON.stringify(rep.report));
  const g1 = (await missionRow(gid)).returning as Record<string, number>;
  assert.equal(g1.zerstoerer, 2);
  assert.ok((g1.korvette ?? 0) >= 1, "Verluste höchstens im Geleit");

  // Ertrag läuft ein: Zähler für das Wochenziel „feldertrag“.
  await runUntil(cv.arriveAt.getTime() + 1000);
  const [cnt] = await db.select().from(tables.achievementCounter).where(and(eq(tables.achievementCounter.playerId, a.playerId), eq(tables.achievementCounter.counter, "feldertrag")));
  assert.ok(cnt && Number(cnt.value) > 0, "Zähler feldertrag");

  // Kartellangriff aufs Feld: die ganze Besatzung kämpft, auch das Geleit (angekündigt, es kehrt zurück).
  const before = (await missionRow(gid)).returning as Record<string, number>;
  await db.insert(tables.gameEvent).values({ type: "field_raid", dueAt: new Date(), payload: { fieldId: target.id, ownerId: a.playerId, units: { schnellboot: 1 } }, baseId: null });
  await runUntil(Date.now() + 1000);
  const [raid] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "feld"), eq(tables.battleReport.defenderPlayerId, a.playerId), sql`${tables.battleReport.attackerPlayerId} is null`));
  const defFleet = (raid.report as { battle: { defender: { before: Record<string, number> } } }).battle.defender;
  const fought = defFleet.before;
  assert.equal(fought.korvette ?? 0, before.korvette ?? 0, `Geleit kämpft mit: ${JSON.stringify(defFleet)}`);
  const after1 = (await missionRow(gid)).returning as Record<string, number>;
  assert.ok((after1.korvette ?? 0) >= 2, `Geleit noch da: ${JSON.stringify(after1)}`);

  // Rivale greift an: Vorwarnung (Radar 5 am Heimathafen, Anteil radarWarningFactor), Push und Meldung.
  const atk = await launchMission(engine, b.playerId, key(), { type: "besetzen", units: { zerstoerer: 12 }, col: target.col, row: target.row, fieldId: target.id, stayAll: true });
  assert.equal(atk.ok, true, JSON.stringify(atk));
  const arrive = (atk as { arriveAtMs: number }).arriveAtMs;
  const [warn] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "field_warning"), eq(tables.gameEvent.status, "pending")));
  assert.ok(warn && warn.dueAt.getTime() < arrive, "Vorwarnung vor Ankunft geplant");
  await runUntil(warn.dueAt.getTime() + 1000);
  const msgs = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, a.playerId), sql`${tables.message.subject} like 'Angriff auf %erkannt'`));
  assert.equal(msgs.length, 1, "Meldung an den Besitzer");
  const atkId = (atk as { missionId: number }).missionId;
  const detectedAt = ((await missionRow(atkId)).plan as { detectedAtMs?: number }).detectedAtMs;
  assert.ok(detectedAt && detectedAt < arrive, "Erkennung im Plan gemerkt");
  // Die Ansicht läuft in Echtzeit: Erkennung auf „jetzt“ vorziehen.
  await db.update(tables.mission).set({ plan: sql`jsonb_set(${tables.mission.plan}, '{detectedAtMs}', to_jsonb(${Date.now() - 1000}::bigint))` }).where(eq(tables.mission.id, atkId));
  mine = (await fieldsView(engine, a.playerId))!.mine.find((m) => m.id === target.id)!;
  assert.equal(mine.incoming.length, 1, "Angriff in „Meine Felder“ sichtbar");
  await runUntil(arrive + 1000);
  assert.equal((await fieldRow(target.id)).ownerId, b.playerId);
  const old = await missionRow(gid);
  assert.equal(old.status, "returning");
  assert.ok(((old.returning as Record<string, number>).korvette ?? 0) >= 2, "Geleitabteilung war unterwegs und kehrt heim");
});

test("Hotfix TST-01: U-Boote allein halten weder Ertragskonvoi noch Feld gegen das Kartell, überleben aber", async () => {
  setRandomSeedSource(mulberry32(382003));
  const a = await newPlayer("Tauchherr", coastNear(null));
  await patchBase(a.baseId, (s) => { s.units = { ...s.units, uboot: 4 }; s.buildings.werft = Math.max(s.buildings.werft ?? 0, 5); });
  await ensureFieldPlanner(db, Date.now());
  const target = await freeField(a);
  const gid = await capture(a, target, { korvette: 2, uboot: 2 });
  const esc = await setFieldEscort(engine, a.playerId, key(), target.id, { uboot: 2 });
  assert.equal(esc.ok, true, JSON.stringify(esc));
  // Ertragskonvoi nur mit U-Booten als Geleit: das Kartell nimmt Ladung, die U-Boote bleiben.
  await db.update(tables.resourceField).set({ lastTickAt: new Date(Date.now() - 4 * HOUR) }).where(eq(tables.resourceField.id, target.id));
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(sql`${tables.gameEvent.type} = 'field_tick' and ${tables.gameEvent.status} = 'pending'`);
  await runUntil(Date.now() + 1000);
  const [cv] = await db.select().from(tables.convoy).where(and(eq(tables.convoy.kind, "feld"), eq(tables.convoy.recipientId, a.playerId)));
  assert.ok(cv, "Ertragskonvoi unterwegs");
  assert.deepEqual(cv.escort, { uboot: 2 });
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(), payload: { convoyId: cv.id }, baseId: null });
  await runUntil(Date.now() + 1000);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "konvoi"), eq(tables.battleReport.defenderPlayerId, a.playerId)));
  assert.ok(rep, "Konvoibericht");
  assert.equal((rep.report as { convoy: { held: boolean } }).convoy.held, false, "U-Boote halten den Konvoi nicht");
  assert.equal(((await missionRow(gid)).returning as Record<string, number>).uboot, 2, "U-Boote überleben");
  // Kartell gegen eine Besatzung nur aus U-Booten: das Feld ist verloren, die U-Boote kehren heim.
  await db.update(tables.mission).set({ returning: { uboot: 2 } }).where(eq(tables.mission.id, gid));
  await db.update(tables.resourceField).set({ escort: {} }).where(eq(tables.resourceField.id, target.id));
  await db.insert(tables.gameEvent).values({ type: "field_raid", dueAt: new Date(), payload: { fieldId: target.id, ownerId: a.playerId, units: { schnellboot: 2 } }, baseId: null });
  await runUntil(Date.now() + 1000);
  assert.equal((await fieldRow(target.id)).ownerId, null, "Feld an das Kartell verloren");
  const old = await missionRow(gid);
  assert.equal(old.status, "returning");
  assert.equal((old.returning as Record<string, number>).uboot, 2, "U-Boote kehren heim");
});

test("Felder 2: Verstärkung aus demselben und aus einem anderen Hafen; Wochenziel Gründung", async () => {
  const c = await newPlayer("Verstaerker", coastNear(null));
  const target = await freeField(c);
  const gid = await capture(c, target, { korvette: 2 });

  // Vorschau: Besetzen gegen das eigene Feld ist eine Verstärkung (ohne Mindestbesatzung).
  const pv = await missionPreview(engine, c.playerId, { type: "besetzen", units: { zerstoerer: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  const go = await launchMission(engine, c.playerId, key(), { type: "besetzen", units: { zerstoerer: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(go.ok, true, JSON.stringify(go));
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const g = await missionRow(gid);
  assert.equal(g.status, "stationed");
  assert.deepEqual(g.returning, { korvette: 2, zerstoerer: 1 });
  assert.equal(((g.plan as { units: Record<string, number> }).units).zerstoerer, 1);
  assert.equal((await missionRow((go as { missionId: number }).missionId)).status, "done");

  // Aus einem anderen Hafen: Einheiten wechseln in den Hafen des Felds, Veteranen gewichtet gemischt.
  const c2 = await addSecondHarbor(db, c.playerId, {
    near: target, minKm: 60, maxKm: 500,
    patch: (s) => { s.buildings.hafenkommandantur = 5; s.protection.createdAtMs = 0; s.units = { korvette: 4 }; s.veterancy = { korvette: 400 }; },
  });
  const homeBefore = await stateOf(c.baseId);
  const go2 = await launchMission(engine, c.playerId, key(), { type: "besetzen", units: { korvette: 2 }, col: target.col, row: target.row, fieldId: target.id, baseId: c2.baseId });
  assert.equal(go2.ok, true, JSON.stringify(go2));
  await runUntil((go2 as { arriveAtMs: number }).arriveAtMs + 1000);
  const colony = await stateOf(c2.baseId);
  assert.equal(colony.unitsAway.korvette ?? 0, 0, "Kolonie führt die Schiffe nicht mehr");
  assert.equal(colony.units.korvette, 2);
  const home = await stateOf(c.baseId);
  assert.equal((home.unitsAway.korvette ?? 0) - (homeBefore.unitsAway.korvette ?? 0), 2, "Heimathafen führt sie als unterwegs");
  assert.ok((home.veterancy?.korvette ?? 0) > (homeBefore.veterancy?.korvette ?? 0), "Veteranen gemischt");
  assert.deepEqual((await missionRow(gid)).returning, { korvette: 4, zerstoerer: 1 });

  // Rückruf: alles kehrt in den Hafen des Felds heim, unitsAway geht auf.
  const rc = await fieldRecall(engine, c.playerId, key(), target.id);
  assert.equal(rc.ok, true, JSON.stringify(rc));
  await runUntil((rc as { returnAtMs: number }).returnAtMs + 1000);
  const back = await stateOf(c.baseId);
  assert.equal(back.unitsAway.korvette ?? 0, 0);
  assert.equal(back.unitsAway.zerstoerer ?? 0, 0);
  assert.equal(back.units.korvette, (homeBefore.units.korvette ?? 0) + 4);

  // Verstärkung für ein nicht mehr eigenes Feld: Prüfung schlägt fehl (kein eigenes Feld mehr → Angriff verlangt Besatzung).
  const weak = await missionPreview(engine, c.playerId, { type: "besetzen", units: { korvette: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(weak.ok ? "ok" : weak.code, "garrison_too_weak");

  // Wochenziel „gruendung“: aus den Häfen der Woche gelesen (zweiter Hafen wurde eben angelegt).
  const w = await weeklyView(engine, c.playerId);
  assert.ok(w.goals.length > 0);
  await db.update(tables.weeklyGoal).set({ kind: "gruendung", target: 1, progress: 0, completedAt: null }).where(eq(tables.weeklyGoal.id, w.goals[0].id));
  const w2 = await weeklyView(engine, c.playerId);
  const goal = w2.goals.find((x) => x.id === w.goals[0].id)!;
  assert.equal(goal.progress, 1, JSON.stringify(goal));
  assert.equal(goal.done, true);
});
