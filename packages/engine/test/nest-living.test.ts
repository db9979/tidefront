// Lebendige Nester gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Wurf beim Anlegen und bei jeder
// Wiederbesetzung (geheim bis dahin), Lagebild aus Aufklärung mit Wurf und Stand (24 h genau), Erholung nach gewonnener
// Abwehr (sofort ≥ 70 %, Kampfbericht = Lagebild der Überlebenden), Beutewachstum im Kampf, KI probt ohne Lagebild gegen
// den ungünstigsten Wurf, Saisonwechsel setzt zurück (docs/VORLAGE-NESTER.md 3, ENTSCHEIDUNGEN-5.md).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS } from "@tidefront/world";
import { nestDefenders, rolledGarrison, worstRoll, type BaseState, type BattleReport, type NestRoll } from "@tidefront/game-core";
import { balance } from "../src/context.ts";
import { chooseBase, clearPersistThrottle, clearSightCache, launchMission, mapViewFor, processDue, register, seed, type Engine } from "../src/index.ts";
import { botNestDefender, probe } from "../src/bots-war.ts";
import { ensureNestRolls, resetNestLife } from "../src/nest-live.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `nl-${++keyN}-${realNow()}`;
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
  A = await newPlayer("Jaeger", HOME);
  B = await newPlayer("Fern", at(0, 9));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch'`);
});

beforeEach(fresh);

after(async () => {
  Date.now = realNow;
  await client.end();
});

const nestRow = async (id: number) => (await db.select().from(tables.nest).where(eq(tables.nest.id, id)))[0];
const mapNest = async (id: number) => { fresh(); return (await mapViewFor(db, A.playerId, fake)).nests.find((n) => n.id === id)!; };

test("Wurf beim ersten Abruf: Stufe 1 fest, Stufe 4 in der Spanne; ohne Lagebild keine Besatzung auf der Karte", async () => {
  const n1 = await nestAt(at(-1, 0), 1);
  const n4 = await nestAt(at(1, 0), 4);
  assert.equal((await nestRow(n4)).roll, null);
  const v = await mapNest(n4);
  assert.equal(v.level, 4, "im Ausguck erkannt");
  assert.equal(v.lagebild, null, "Erkennung zeigt keinen Wurf");
  const r4 = await nestRow(n4);
  const roll = r4.roll as NestRoll;
  assert.ok(roll.factor >= 0.8 && roll.factor <= 1.2, JSON.stringify(roll));
  assert.equal(r4.lootAt!.getTime(), fake, "Beute wächst ab jetzt");
  assert.deepEqual(((await nestRow(n1)).roll as NestRoll).factor, 1);
});

test("Aufklärung liefert das Lagebild (Wurf, Stand); nach 24 h nur noch Spanne", async () => {
  const id = await nestAt(at(-3, 0), 3);
  await ensureNestRolls(db, fake);
  await patchBase(A.baseId, (s) => { s.units.aufklaerungsdrohne = 2; });
  const r = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { aufklaerungsdrohne: 1 }, ...at(-3, 0) });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const m = await missionOf(r.missionId);
  await advance(m.arriveAt.getTime() + 1000);
  const v = await mapNest(id);
  assert.ok(v.lagebild, "genaues Lagebild");
  assert.deepEqual(v.lagebild!.roll, (await nestRow(id)).roll);
  const rep = (await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "aufklaerung"), eq(tables.battleReport.nestId, id))))[0];
  const g = (rep.report as { nest: { garrison: { units: Record<string, number>; lootFactor: number } } }).nest.garrison;
  assert.deepEqual(g.units, rolledGarrison(3, (await nestRow(id)).roll as NestRoll, balance).units, "Bericht zeigt die gewürfelte Besatzung");
  assert.ok(g.lootFactor >= 1 && g.lootFactor <= 1.3);
  await advance((await missionOf(r.missionId)).returnAt!.getTime() + 1000);
  fake += 25 * HOUR;
  assert.equal((await mapNest(id)).lagebild, null, "älter als 24 h: nicht mehr genau");
});

test("Abwehr: Überlebende, sofort ≥ 70 %, Kampfbericht = Lagebild; Eroberung würfelt neu, Wiederbesetzung macht das Lagebild ungenau", async () => {
  const pos = at(0, 2);
  const id = await nestAt(pos, 3);
  await ensureNestRolls(db, fake);
  await db.update(tables.nest).set({ lootAt: new Date(fake - 40 * HOUR) }).where(eq(tables.nest.id, id)); // Beute am Deckel
  await patchBase(A.baseId, (s) => { s.units.korvette = 25; s.units.zerstoerer = 12; s.units.landungsschiff = 8; s.units.schuetzen = 260; s.units.kampfpanzer = 12; });
  // Zu schwacher Überfall: das Nest gewinnt.
  const weak = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 1, schuetzen: 20 }, ...pos });
  assert.equal(weak.ok, true, JSON.stringify(weak));
  if (!weak.ok) return;
  await advance((await missionOf(weak.missionId)).arriveAt.getTime() + 1000);
  const after1 = await nestRow(id);
  assert.equal(after1.defeatedAt, null, "Nest hält");
  assert.ok(after1.garrison && after1.garrisonAt, "Überlebende gespeichert");
  const full = rolledGarrison(3, after1.roll as NestRoll, balance);
  const v = await mapNest(id);
  assert.ok(v.lagebild, "Kampfbericht = Lagebild");
  assert.ok(v.lagebild!.garrison);
  // Hochrechnung: sofort mindestens 70 % des Wurfs (game-core garrisonAt).
  const { garrisonAt } = await import("@tidefront/game-core");
  const now = garrisonAt(3, { roll: after1.roll as NestRoll, garrison: after1.garrison as never, garrisonAtMs: after1.garrisonAt!.getTime(), lootAtMs: after1.lootAt!.getTime() }, fake, balance);
  for (const [u, n] of Object.entries(full.units)) assert.ok(now.units[u] >= Math.round(0.7 * n) - 1, `${u}: ${now.units[u]} von ${n}`);
  const oldRoll = after1.roll;
  const oldLoot = after1.lootAt!.getTime();
  await advance((await missionOf(weak.missionId)).returnAt!.getTime() + 1000);
  // Starker Überfall: Eroberung, Beute 130 %.
  // Deutlich überlegen (Kriegsglück und Wurf dürfen den Sieg nicht kippen).
  await patchBase(A.baseId, (s) => { s.units.korvette = 40; s.units.zerstoerer = 20; s.units.landungsschiff = 10; s.units.schuetzen = 400; s.units.kampfpanzer = 20; s.buildings.kommandozentrale = Math.max(s.buildings.kommandozentrale ?? 0, 20); });
  const strong = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 40, zerstoerer: 20, landungsschiff: 10, schuetzen: 400, kampfpanzer: 20 }, ...pos });
  assert.equal(strong.ok, true, JSON.stringify(strong));
  if (!strong.ok) return;
  const arrive = (await missionOf(strong.missionId)).arriveAt.getTime();
  await advance(arrive + 1000);
  const rep = (await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "ueberfall"), eq(tables.battleReport.nestId, id), eq(tables.battleReport.winner, "attacker"))))[0];
  assert.ok(rep, "erobert");
  const loot = (rep.report as { battle: BattleReport }).battle.loot;
  assert.equal(loot.stahl, Math.floor(6500 * 1.3), "Beute am Deckel 130 %");
  const conquered = await nestRow(id);
  assert.ok(conquered.defeatedAt);
  assert.ok(conquered.roll, "Wurf der Wiederbesetzung steht fest");
  assert.equal(conquered.garrison, null);
  assert.equal(conquered.lootAt!.getTime(), arrive + 12 * HOUR, "Beute ab Wiederbesetzung");
  assert.notEqual(conquered.lootAt!.getTime(), oldLoot);
  void oldRoll;
  assert.equal((await mapNest(id)).lagebild, null, "leer: kein Wurf sichtbar");
  fake = arrive + 13 * HOUR;
  assert.equal((await mapNest(id)).lagebild, null, "wiederbesetzt: altes Lagebild gilt nicht");
  await advance((await missionOf(strong.missionId)).returnAt!.getTime() + 1000);
});

test("KI probt ohne Lagebild gegen den ungünstigsten Wurf", async () => {
  const worst = nestDefenders(3, balance, "worst")[0];
  const mid = nestDefenders(3, balance, "mid")[0];
  assert.deepEqual(botNestDefender({ level: 3, lagebild: null }, fake).units, worst.units);
  assert.deepEqual(worst.units, rolledGarrison(3, worstRoll(3, balance), balance).units);
  // Ein Verband, der die Mitte sicher schlägt, den ungünstigsten Wurf aber nicht: die KI greift ohne Lagebild nicht an.
  let force = { korvette: 6, zerstoerer: 2, landungsschiff: 3, schuetzen: 60 } as Record<string, number>;
  for (let k = 0; k < 40; k++) {
    const pm = probe({ units: force }, mid, 40).winRate;
    if (pm >= 0.9) break;
    force = { ...force, schuetzen: force.schuetzen + 10, korvette: force.korvette + 1 };
  }
  const pMid = probe({ units: force }, mid, 40).winRate;
  const pBot = probe({ units: force }, botNestDefender({ level: 3, lagebild: null }, fake), 40).winRate;
  assert.ok(pMid >= 0.9 && pBot < pMid, `Mitte ${pMid}, ungünstig ${pBot}`);
  // Mit Lagebild probt sie genau gegen dieses.
  const roll: NestRoll = { factor: 0.8, defenses: { flakstellung: 0, kuestenbatterie: 0, bunkerlinie: 0 } };
  const exact = botNestDefender({ level: 3, lagebild: { atMs: fake, roll, garrison: null, garrisonAtMs: null, lootAtMs: fake } }, fake);
  assert.deepEqual(exact.units, rolledGarrison(3, roll, balance).units);
});

test("Saisonwechsel setzt Wurf, Besatzung und Beute zurück", async () => {
  const id = await nestAt(at(5, 3), 5);
  await ensureNestRolls(db, fake);
  await db.update(tables.nest).set({ garrison: { units: {}, defenses: {} }, garrisonAt: new Date(fake) }).where(eq(tables.nest.id, id));
  await db.transaction(async (tx) => resetNestLife(tx as never, fake + HOUR));
  const r = await nestRow(id);
  assert.equal(r.garrison, null);
  assert.ok(r.roll);
  assert.equal(r.lootAt!.getTime(), fake + HOUR);
  const c = await db.select({ n: sql<number>`count(*)::int` }).from(tables.nest).where(sql`${tables.nest.roll} is null`);
  assert.equal(c[0].n, 0);
});
