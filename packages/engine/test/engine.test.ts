// Integrationstests gegen ein echtes PostgreSQL. TEST_DATABASE_URL muss gesetzt sein; die Datenbank wird geleert.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  auditLedger,
  baseView,
  chooseBase,
  launchMission,
  processDue,
  register,
  seed,
  trade,
  train,
  upgrade,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `k${++keyN}-${Date.now()}`;

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

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

test("Registrierung nur mit gültigem Einladungscode, Namen eindeutig", async () => {
  await assert.rejects(register(db, { inviteCode: "FALSCH", name: "x1", password: "geheim123" }), /invite_invalid/);
  await register(db, { inviteCode: "TEST", name: "Anna", password: "geheim123" });
  await assert.rejects(register(db, { inviteCode: "TEST", name: "anna", password: "geheim123" }), /name_taken/);
});

test("Stützpunkt nur auf freiem Küstenfeld; Ausbau läuft über das Ereignis", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Bert", password: "geheim123" });
  const sea = { col: 30, row: 30 };
  const bad = await chooseBase(engine, p.playerId, key(), { ...sea, name: "Meer", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.deepEqual(bad, { ok: false, code: "not_coast" });
  const f = freeCoast(0);
  const ok = await chooseBase(engine, p.playerId, key(), { ...f, name: "Bert", nightShieldStartHour: 22, tzOffsetMinutes: 60 });
  assert.equal(ok.ok, true);
  const baseId = (ok as { baseId: number }).baseId;
  const up = await upgrade(engine, p.playerId, key(), "stahlwerk");
  assert.equal(up.ok, true);
  const s = await stateOf(baseId);
  assert.equal(s.buildQueue.length, 1);
  // Der Worker arbeitet das Ereignis zur Fertigstellung ab, auch ohne dass der Spieler online ist.
  await processDue(engine, s.buildQueue[0].finishesAt + 1);
  const after = await stateOf(baseId);
  assert.equal(after.buildings.stahlwerk, 1);
  assert.equal(after.buildQueue.length, 0);
});

test("Idempotenz: derselbe Schlüssel wirkt nur einmal", async () => {
  const p = await newPlayer("Cleo", 3);
  const k = key();
  const a = await upgrade(engine, p.playerId, k, "raffinerie");
  const b = await upgrade(engine, p.playerId, k, "raffinerie");
  assert.deepEqual(a, b);
  const s = await stateOf(p.baseId);
  assert.equal(s.buildQueue.length, 1);
});

test("Gleichzeitige Befehle erzeugen nie negative Bestände", async () => {
  const p = await newPlayer("Dora", 6);
  await patchBase(p.baseId, (s) => {
    s.buildings.kaserne = 3;
    s.resources = { stahl: 300, treibstoff: 1000, elektronik: 500, proviant: 1000 };
  });
  // 10 Schützen kosten 300 Stahl; 20 gleichzeitige Aufträge, nur einer darf durchgehen.
  const results = await Promise.all(Array.from({ length: 20 }, () => train(engine, p.playerId, key(), "schuetzen", 10)));
  assert.equal(results.filter((r) => r.ok).length, 1);
  const s = await stateOf(p.baseId);
  for (const v of Object.values(s.resources)) assert.ok(v >= 0);
  assert.ok(s.resources.stahl < 1);
  // Ebenso Ausbauten in Konkurrenz
  await patchBase(p.baseId, (st) => { st.resources.stahl = 5000; });
  const ups = await Promise.all(["stahlwerk", "raffinerie", "chipfabrik", "kraftwerk", "lagerkomplex"].map((b) => upgrade(engine, p.playerId, key(), b)));
  assert.equal(ups.filter((r) => r.ok).length, 1);
  for (const v of Object.values((await stateOf(p.baseId)).resources)) assert.ok(v >= 0);
});

test("Überfall auf ein Piratennest: Abfahrt, Kampf, Beute, Rückkehr, Bericht", async () => {
  const p = await newPlayer("Emil", 9);
  await patchBase(p.baseId, (s) => {
    s.units = { korvette: 4, landungsschiff: 2, schuetzen: 150 };
    s.resources.treibstoff = 50000;
  });
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const here = await baseView(engine, p.playerId);
  const near = nests
    .map((n) => ({ n, d: Math.hypot(n.col - here.base!.col, n.row - here.base!.row) }))
    .sort((a, b) => a.d - b.d)[0].n;
  const sent = { korvette: 4, landungsschiff: 2, schuetzen: 150 };
  const m = await launchMission(engine, p.playerId, key(), { type: "ueberfall", units: sent, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  let s = await stateOf(p.baseId);
  assert.equal(s.units.korvette, 0);
  assert.equal(s.unitsAway.korvette, 4);
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await processDue(engine, mission.arriveAt.getTime() + 1);
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, mission.id));
  assert.equal(arrived.status, "returning");
  assert.ok(arrived.reportId);
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, arrived.reportId!));
  assert.equal(report.winner, "attacker");
  const [nest] = await db.select().from(tables.nest).where(eq(tables.nest.id, near.id));
  assert.ok(nest.defeatedAt);
  const stahlBefore = s.resources.stahl;
  await processDue(engine, arrived.returnAt!.getTime() + 1);
  s = await stateOf(p.baseId);
  assert.deepEqual(s.unitsAway, {});
  assert.ok(s.units.korvette > 0);
  assert.ok(s.resources.stahl >= stahlBefore + (arrived.cargoHome as Record<string, number>).stahl);
  const [done] = await db.select().from(tables.mission).where(eq(tables.mission.id, mission.id));
  assert.equal(done.status, "done");
});

test("Kartell: kein Überfall unter Anfängerschutz, danach Kampf und Schutz nach Niederlage", async () => {
  const p = await newPlayer("Fritz", 12);
  const [ev] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${p.baseId} and ${tables.gameEvent.type} = 'raid_launch'`);
  // Unter Anfängerschutz: nur Neuplanung, kein Verband.
  await processDue(engine, ev.dueAt.getTime() + 1);
  let raids = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${p.baseId}`);
  assert.equal(raids.length, 0);
  // Schutz aufheben, nächsten Überfall auslösen.
  await patchBase(p.baseId, (s) => { s.protection.createdAtMs = 0; s.resources.stahl = 20000; });
  const [next] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${p.baseId} and ${tables.gameEvent.type} = 'raid_launch' and ${tables.gameEvent.status} = 'pending'`);
  await processDue(engine, next.dueAt.getTime() + 1);
  raids = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${p.baseId}`);
  assert.equal(raids.length, 1);
  await processDue(engine, raids[0].arriveAt.getTime() + 1);
  const [report] = await db.select().from(tables.battleReport).where(sql`${tables.battleReport.kind} = 'kartell' and ${tables.battleReport.defenderBaseId} = ${p.baseId}`);
  assert.equal(report.winner, "attacker"); // unverteidigt
  const s = await stateOf(p.baseId);
  assert.ok(s.resources.stahl < 20000);
  assert.ok(s.protection.defeatShieldUntilMs > raids[0].arriveAt.getTime());
});

test("Börse: Verkauf, Kauf mit Lieferung, Schutzregeln und Prüflauf", async () => {
  const p = await newPlayer("Gesa", 15);
  const locked = await trade(engine, p.playerId, key(), { side: "sell", resource: "stahl", qty: 100, expectedPrice: 1 });
  assert.deepEqual(locked, { ok: false, code: "locked" });
  await patchBase(p.baseId, (s) => { s.buildings.hafenkommandantur = 3; s.buildings.kommandozentrale = 1; s.resources.stahl = 5000; });
  const tooBig = await trade(engine, p.playerId, key(), { side: "sell", resource: "stahl", qty: 100000, expectedPrice: 1 });
  assert.equal(tooBig.ok, false);
  const sold = await trade(engine, p.playerId, key(), { side: "sell", resource: "stahl", qty: 500, expectedPrice: 0.99875 });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const s = await stateOf(p.baseId);
  assert.ok(s.resources.stahl < 4600);
  const bought = await trade(engine, p.playerId, key(), { side: "buy", resource: "proviant", qty: 200, expectedPrice: 0.6003 });
  assert.equal(bought.ok, true, JSON.stringify(bought));
  const [d] = await db.select().from(tables.delivery).where(eq(tables.delivery.playerId, p.playerId));
  assert.equal(d.status, "underway");
  const mid = await auditLedger(engine);
  assert.equal(mid.ok, true, JSON.stringify(mid));
  await processDue(engine, d.arriveAt.getTime() + 1);
  const [d2] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, d.id));
  assert.equal(d2.status, "delivered");
  const audit = await auditLedger(engine);
  assert.equal(audit.ok, true, JSON.stringify(audit));
  // Gleichzeitige Verkäufe: Bestand nie negativ, Journal stimmt.
  await patchBase(p.baseId, (st) => { st.resources.elektronik = 300; });
  const sells = await Promise.all(Array.from({ length: 8 }, () => trade(engine, p.playerId, key(), { side: "sell", resource: "elektronik", qty: 100, expectedPrice: 2.9975 })));
  assert.ok(sells.filter((r) => r.ok).length <= 3);
  assert.ok((await stateOf(p.baseId)).resources.elektronik >= 0);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Spieler gegen Spieler: geschütztes Ziel abgelehnt, Aufklärung liefert Lagebild", async () => {
  const a = await newPlayer("Hugo", 18);
  const b = await newPlayer("Ida", 21);
  await patchBase(a.baseId, (s) => { s.units = { korvette: 2, landungsschiff: 1, schuetzen: 50, aufklaerungsdrohne: 0 }; s.resources.treibstoff = 50000; s.buildings.hafenkommandantur = 4; });
  const attack = await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: { korvette: 1, landungsschiff: 1, schuetzen: 50 }, col: b.col, row: b.row });
  assert.deepEqual(attack, { ok: false, code: "target_protected" });
  const scout = await launchMission(engine, a.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: b.col, row: b.row });
  assert.equal(scout.ok, true, JSON.stringify(scout));
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (scout as { missionId: number }).missionId));
  await processDue(engine, m.arriveAt.getTime() + 1);
  const [m2] = await db.select().from(tables.mission).where(eq(tables.mission.id, m.id));
  const [r] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, m2.reportId!));
  assert.equal(r.kind, "aufklaerung");
  assert.ok((r.report as { scout: { resources: Record<string, number> } }).scout.resources.stahl > 0);
});

test("Aufräumen und Prüflauf laufen ohne Fehler", async () => {
  const { cleanup } = await import("../src/index.ts");
  await cleanup(engine, Date.now(), 48);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Transport liefert Ladung beim Ziel ab; Wrackgut wird geborgen", async () => {
  const a = await newPlayer("Jana", 24);
  const b = await newPlayer("Kurt", 27);
  await patchBase(a.baseId, (s) => { s.units = { landungsschiff: 1 }; s.resources.treibstoff = 50000; s.resources.stahl = 3000; });
  const before = (await stateOf(b.baseId)).resources.stahl;
  const m = await launchMission(engine, a.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: b.col, row: b.row, cargo: { stahl: 1000 } });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  // Wrack am Ziel, eine Stunde vor Ankunft entstanden (2 % verfallen)
  await db.insert(tables.wreck).values({ col: b.col, row: b.row, stahl: 500, elektronik: 100, createdAt: new Date(row.arriveAt.getTime() - HOUR) });
  await processDue(engine, row.arriveAt.getTime() + 1);
  assert.ok((await stateOf(b.baseId)).resources.stahl >= before + 1000);
  const [back] = await db.select().from(tables.mission).where(eq(tables.mission.id, row.id));
  const cargo = back.cargoHome as Record<string, number>;
  assert.ok(cargo.stahl > 400 && cargo.elektronik > 80, JSON.stringify(cargo));
  const left = await db.select().from(tables.wreck).where(sql`${tables.wreck.col} = ${b.col} and ${tables.wreck.row} = ${b.row}`);
  assert.equal(left.length, 0);
  await processDue(engine, back.returnAt!.getTime() + 1);
  assert.equal((await stateOf(a.baseId)).units.landungsschiff, 1);
});
