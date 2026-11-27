// Aufholhilfe (Server): Startpaket ab Saisontag 8 einmalig, stündlicher Zufluss nach Rückstand der Ausbaupunkte, Gutschrift
// bezahlt nur Gebäude (Bots wie Menschen über startUpgrade), ist weder handel- noch plünderbar.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex } from "@tidefront/world";
import { applyDefenseResult, defenderFromBase, refValue, upgradeCost, type Balance, type BaseState, type BattleReport } from "@tidefront/game-core";
import {
  balance,
  baseView,
  buildingValue,
  cancelBuild,
  chooseBase,
  createOffer,
  register,
  runCatchUp,
  seed,
  train,
  upgrade,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const bal = balance as unknown as Balance;
const cu = bal.catchUp!;
const DAY = 86400000;
let keyN = 0;
const key = () => `cu${++keyN}-${Date.now()}`;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

/** Freie Küstenfelder (kein Hafen, Nest, Feld, Handelshafen), weit auseinander. */
async function freeHex(n: number) {
  const taken = new Set([
    ...(await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)),
    ...(await db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest)),
    ...(await db.select({ col: tables.resourceField.col, row: tables.resourceField.row }).from(tables.resourceField)),
  ].map((x) => `${x.col},${x.row}`));
  let i = 0;
  for (let row = 5; row < ROWS; row += 7) for (let col = 3; col < COLS; col += 5) {
    if (!isCoast(col, row) || isTradePortHex(col, row) || taken.has(`${col},${row}`)) continue;
    if (i++ === n) return { col, row };
  }
  throw new Error("kein freies Feld");
}

async function newPlayer(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...(await freeHex(0)), name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId };
}

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select({ state: tables.base.state }).from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function patch(baseId: number, fn: (s: BaseState) => BaseState) {
  await db.update(tables.base).set({ state: fn(await stateOf(baseId)) }).where(eq(tables.base.id, baseId));
}

async function setSeasonStart(daysAgo: number) {
  await db.update(tables.season).set({ startsAt: new Date(Date.now() - daysAgo * DAY) }).where(eq(tables.season.status, "running"));
}

const BIG = { stahlwerk: 12, raffinerie: 10, chipfabrik: 8, versorgungshof: 8, kraftwerk: 10, lagerkomplex: 8, kommandozentrale: 8, kaserne: 4, hafenkommandantur: 4 };
const ZERO = { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 };

let veteran: { playerId: number; baseId: number };
let late: { playerId: number; baseId: number };

test("Frühe Saison: kein Startpaket; ab Saisontag 8: 15 % des Median-Ausbauwerts, einmalig", async () => {
  await setSeasonStart(1);
  veteran = await newPlayer("Alteingesessen");
  assert.equal((await stateOf(veteran.baseId)).catchUp, undefined, "Tag 2: kein Paket");
  // Der Alteingesessene ist seit 9 Tagen dabei und hat ausgebaut (Median-Grundlage: Hafen ≥ 3 Tage alt).
  await patch(veteran.baseId, (s) => ({ ...s, buildings: { ...s.buildings, ...BIG } }));
  await db.update(tables.base).set({ createdAt: new Date(Date.now() - 9 * DAY) }).where(eq(tables.base.id, veteran.baseId));
  await setSeasonStart(9); // Saisontag 10
  late = await newPlayer("Spaetling");
  const s = await stateOf(late.baseId);
  const median = buildingValue(BIG);
  assert.ok(s.catchUp, "Startpaket fehlt");
  assert.equal(s.catchUp.pack, Math.round(cu.latePackShare * median));
  assert.equal(s.catchUp.credit, s.catchUp.pack);
  // Einmalig: eine zweite Hafenwahl ist nicht möglich, die Gutschrift bleibt.
  const again = await chooseBase(engine, late.playerId, key(), { ...(await freeHex(0)), name: "Zweiter", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(again.ok, false);
  assert.equal((await stateOf(late.baseId)).catchUp?.credit, s.catchUp.credit);
  // Ansicht: Bauhof bekommt Betrag und Herkunft.
  const v = await baseView(engine, late.playerId);
  assert.equal(v.base?.catchUp?.pack, s.catchUp.pack);
  assert.equal(v.base?.catchUp?.credit, Math.floor(s.catchUp.credit));
});

test("Stündlicher Lauf: Bonus nach Rückstand (Deckel +50 %), Zufluss nur bei Hilfe, nicht beim Spitzenreiter", async () => {
  await patch(late.baseId, (s) => ({ ...s, buildings: { ...s.buildings, stahlwerk: 4, raffinerie: 2, kraftwerk: 3 }, catchUp: { ...s.catchUp!, credit: 0, lastAtMs: Date.now() - 3600000 } }));
  const n = await runCatchUp(engine, Date.now(), { force: true });
  assert.ok(n >= 1);
  const s = await stateOf(late.baseId);
  assert.ok(s.catchUp!.ratio! < cu.full, `Verhältnis ${s.catchUp!.ratio}`);
  assert.equal(s.catchUp!.bonus, cu.cap, "voller Bonus = Deckel 50 %");
  assert.equal(s.catchUp!.active, true);
  // Zufluss mit dem Bonus des vorigen Laufs (Startwert 0): erst ab dem nächsten Lauf.
  await patch(late.baseId, (x) => ({ ...x, catchUp: { ...x.catchUp!, lastAtMs: Date.now() - 3600000 } }));
  await runCatchUp(engine, Date.now(), { force: true });
  const s2 = await stateOf(late.baseId);
  assert.ok(s2.catchUp!.credit > 0, "Zufluss fehlt");
  assert.ok(s2.catchUp!.earned >= s2.catchUp!.credit - 1e-6);
  // Ohne force: höchstens einmal je refreshMinutes.
  assert.equal(await runCatchUp(engine, Date.now()), 0);
  // Spitzenreiter (Verhältnis ≥ 70 %) bekommt kein Konto.
  assert.equal((await stateOf(veteran.baseId)).catchUp, undefined);
});

test("Gutschrift bezahlt nur Gebäude: Ausbau zieht zuerst aus ihr, Ausbildung nicht; Abbruch erstattet in die Gutschrift", async () => {
  await patch(late.baseId, (s) => ({ ...s, resources: { ...ZERO }, resUpdatedAt: Date.now(), buildings: { ...s.buildings, kaserne: 1 }, catchUp: { ...s.catchUp!, credit: 50000 } }));
  const t = await train(engine, late.playerId, key(), "schuetzen", 1);
  assert.equal(t.ok, false);
  assert.equal(!t.ok && t.code, "insufficient_resources");
  assert.equal((await stateOf(late.baseId)).catchUp!.credit, 50000, "Ausbildung lässt die Gutschrift unberührt");
  const level = (await stateOf(late.baseId)).buildings.kommandozentrale ?? 0;
  const u = await upgrade(engine, late.playerId, key(), "kommandozentrale");
  assert.equal(u.ok, true, JSON.stringify(u));
  const after = await stateOf(late.baseId);
  const cost = refValue(upgradeCost("kommandozentrale", level, bal), bal);
  assert.ok(Math.abs(after.catchUp!.credit - (50000 - cost)) < 1e-6);
  assert.ok(Object.values(after.resources).every((v) => v < 1), "Lager unberührt");
  const c = await cancelBuild(engine, late.playerId, key());
  assert.equal(c.ok, true);
  const back = await stateOf(late.baseId);
  assert.ok(back.catchUp!.credit > 50000 - cost, "Abbruch erstattet in die Gutschrift");
  assert.ok(Object.values(back.resources).every((v) => v < 1), "nichts ins Lager");
});

test("Nicht handelbar und nicht plünderbar: Angebot ohne Lagerbestand abgelehnt, Beute greift nur das Lager", async () => {
  await patch(late.baseId, (s) => ({ ...s, resources: { ...ZERO }, resUpdatedAt: Date.now(), buildings: { ...s.buildings, hafenkommandantur: 5 }, catchUp: { ...s.catchUp!, credit: 80000 } }));
  const o = await createOffer(engine, late.playerId, key(), { give: "stahl", giveQty: 100, want: "treibstoff", wantQty: 50, visibility: "public" });
  assert.equal(o.ok, false);
  assert.equal(!o.ok && o.code, "funds");
  const s = await stateOf(late.baseId);
  const d = defenderFromBase(s, bal);
  assert.deepEqual(d.resources, s.resources, "Kampf sieht nur das Lager");
  const side = { before: {}, final: {}, survivors: {}, losses: {} };
  const report = { attacker: side, defender: side, loot: { stahl: 1000 }, winner: "attacker" } as unknown as BattleReport;
  const hit = applyDefenseResult(s, report, Date.now(), bal);
  assert.equal(hit.catchUp?.credit, 80000);
});
