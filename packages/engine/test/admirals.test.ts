// Integrationstests Admirale gegen ein echtes PostgreSQL (wird geleert): Ernennen (Kosten, Plätze, Namen),
// Auslaufen mit Admiral (Vorschau, besetzt), Kampf mit Bericht (Erfahrung, Hafenkommandant, Wurf aus dem Seed),
// Lösegeld mit Journal, zweite Spezialisierung, passive Wirkung des Hafenkommandanten.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { admiralFateRoll, type BaseState, type Mission } from "@tidefront/game-core";
import {
  admiralView,
  appointAdmiral,
  auditLedger,
  balance,
  chooseAdmiralSpec,
  chooseBase,
  launchMission,
  missionPreview,
  modifierSourcesFor,
  processDue,
  ransomAdmiral,
  register,
  reportGet,
  seed,
  stationAdmiral,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `adm${++keyN}-${Date.now()}`;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };
const cfg = balance.admirals!;

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
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, name, ...f };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Kredite gutschreiben, mit Gegenbuchung im Journal (Prüflauf bleibt ausgeglichen). */
async function grantCredits(playerId: number, amount: number) {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const t = p.trader as { credits: number };
  await db.update(tables.player).set({ trader: { ...t, credits: t.credits + amount } }).where(eq(tables.player.id, playerId));
  await db.insert(tables.tradeLedger).values([
    { tradeId: `grant-${playerId}-${amount}`, tMs: Date.now(), account: `player:${playerId}`, asset: "credits", amount: amount.toFixed(2) },
    { tradeId: `grant-${playerId}-${amount}`, tMs: Date.now(), account: "test", asset: "credits", amount: (-amount).toFixed(2) },
  ]);
}

async function creditsOf(playerId: number): Promise<number> {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  return (p.trader as { credits: number }).credits;
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Angreiferin", 2);
  B = await newPlayer("Hafenherr", 7);
  for (const p of [A, B]) {
    await patchBase(p.baseId, (s) => {
      s.buildings.hafenkommandantur = 4; s.buildings.lagerkomplex = 10; s.buildings.werft = 6; s.buildings.kommandozentrale = 10;
      s.resources = { ...rich }; s.protection.createdAtMs = 0;
    });
  }
  await patchBase(A.baseId, (s) => { s.units = { korvette: 4, zerstoerer: 6 }; });
  await patchBase(B.baseId, (s) => { s.units = { zerstoerer: 20 }; });
  await grantCredits(A.playerId, 10000);
  await grantCredits(B.playerId, 10000);
});

after(async () => {
  await client.end();
});

test("Ernennen: Kosten in Krediten und Elektronik, Plätze nach Hafenkommandantur, Namen aus der Liste", async () => {
  const before = await creditsOf(A.playerId);
  const r = await appointAdmiral(engine, A.playerId, key(), { name: null, spec: "logistik" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await creditsOf(A.playerId), before - cfg.cost.credits);
  const v = await admiralView(engine, A.playerId);
  assert.equal(v!.slots, 1, "Stufe 4: ein Platz");
  assert.equal(v!.list.length, 1);
  assert.equal(v!.list[0].status, "bereit");
  assert.equal(v!.list[0].stationed, true, "der erste wird Hafenkommandant");
  assert.equal(v!.list[0].rankName, "Kapitän zur See");
  // Platz voll; ungültige Spezialisierung und fremder Name
  assert.equal((await appointAdmiral(engine, A.playerId, key(), { name: null, spec: "angriff" })).ok, false);
  await patchBase(A.baseId, (s) => { s.buildings.hafenkommandantur = 5; });
  assert.deepEqual(await appointAdmiral(engine, A.playerId, key(), { name: null, spec: "schwimmen" }), { ok: false, code: "admiral_spec" });
  assert.deepEqual(await appointAdmiral(engine, A.playerId, key(), { name: "Graf Erfunden", spec: "angriff" }), { ok: false, code: "admiral_name" });
  const second = await appointAdmiral(engine, A.playerId, key(), { name: v!.names[0], spec: "angriff" });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal((await admiralView(engine, A.playerId))!.list.length, 2);
  assert.equal((await auditLedger(engine)).creditMismatches.length, 0, "Journal stimmt");
});

test("Auslaufen mit Admiral: Logistik senkt Treibstoff in der Vorschau, Admiral ist unterwegs und besetzt", async () => {
  const list = (await admiralView(engine, A.playerId))!.list;
  const log = list.find((a) => a.specs[0] === "logistik")!;
  const at = { col: B.col, row: B.row };
  const p0 = await missionPreview(engine, A.playerId, { type: "aufklaerung", units: { korvette: 1 }, ...at });
  const p1 = await missionPreview(engine, A.playerId, { type: "aufklaerung", units: { korvette: 1 }, ...at, admiralId: log.id });
  assert.ok(p0.ok && p1.ok);
  if (!p0.ok || !p1.ok) return;
  assert.ok(p1.fuelCost < p0.fuelCost, `${p1.fuelCost} < ${p0.fuelCost}`);
  assert.ok(p1.travelSeconds < p0.travelSeconds);
  const r = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, ...at, admiralId: log.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  assert.equal((m.plan as Mission).admiralId, log.id);
  assert.equal((await admiralView(engine, A.playerId))!.list.find((a) => a.id === log.id)!.status, "unterwegs");
  const again = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, ...at, admiralId: log.id });
  assert.deepEqual(again, { ok: false, code: "admiral_busy" });
  // Rückkehr: wieder bereit
  await processDue(engine, (m.plan as Mission).returnAtMs + 1000);
  assert.equal((await admiralView(engine, A.playerId))!.list.find((a) => a.id === log.id)!.status, "bereit");
});

test("Kampf: Bericht nennt beide Admirale; Hafenkommandant gewinnt Erfahrung, Wurf des Verlierers aus dem Seed", async () => {
  const rb = await appointAdmiral(engine, B.playerId, key(), { name: null, spec: "verteidigung" });
  assert.equal(rb.ok, true);
  const att = (await admiralView(engine, A.playerId))!.list.find((a) => a.specs[0] === "angriff")!;
  // Kartell-Überfälle aus dem vorigen Test können Schutz und Bestand verändert haben.
  await patchBase(B.baseId, (s) => { s.units = { zerstoerer: 20 }; s.protection.defeatShieldUntilMs = 0; });
  await patchBase(A.baseId, (s) => { s.units = { korvette: 4, zerstoerer: 6 }; s.unitsAway = {}; });
  const r = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 4 }, col: B.col, row: B.row, admiralId: att.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m0] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  await processDue(engine, (m0.plan as Mission).arriveAtMs + 1000);
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, m0.id));
  const rep = await reportGet(engine, A.playerId, m.reportId!);
  const d = rep!.data as { admirals: { attacker: { name: string; roll: number | null; fate: string; lines: { path: string; factor: number }[]; lossShare: number }; defender: { xpGain: number; lines: { path: string }[] } } };
  assert.equal(rep!.winner, "defender");
  assert.equal(d.admirals.attacker.name, att.name);
  assert.ok(d.admirals.attacker.lines.some((l) => l.path === "attack.see" && l.factor > 1));
  assert.ok(d.admirals.defender.lines.some((l) => l.path === "hp.anlage"), "Verteidigung wirkt daheim auch auf Anlagen");
  assert.ok(d.admirals.defender.xpGain >= cfg.xp.minWin);
  if (d.admirals.attacker.lossShare > cfg.risk.lossShare) {
    assert.equal(d.admirals.attacker.roll, admiralFateRoll(rep!.seed!, "attacker", cfg.risk.die));
  } else assert.equal(d.admirals.attacker.roll, null);
  const vb = (await admiralView(engine, B.playerId))!.list[0];
  assert.equal(vb.xp, d.admirals.defender.xpGain);
  assert.equal(vb.wins, 1);
  // Der Verteidiger sieht die Admirale ebenfalls
  const repB = await reportGet(engine, B.playerId, m.reportId!);
  assert.ok((repB!.data as { admirals?: unknown }).admirals);
});

test("Gefangen: Lösegeld bringt ihn zurück (Kredite mit Journal); zweite Spezialisierung ab Rang 3", async () => {
  const a = (await admiralView(engine, A.playerId))!.list[0];
  await db.update(tables.admiral).set({ captiveUntil: new Date(Date.now() + 3600000), woundedUntil: null }).where(eq(tables.admiral.id, a.id));
  assert.equal((await admiralView(engine, A.playerId))!.list[0].status, "gefangen");
  const before = await creditsOf(A.playerId);
  const r = await ransomAdmiral(engine, A.playerId, key(), { admiralId: a.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await creditsOf(A.playerId), before - cfg.risk.ransomCredits);
  assert.equal((await admiralView(engine, A.playerId))!.list[0].status, "bereit");
  assert.deepEqual(await ransomAdmiral(engine, A.playerId, key(), { admiralId: a.id }), { ok: false, code: "admiral_not_captive" });
  assert.equal((await auditLedger(engine)).creditMismatches.length, 0);
  // Zweite Spezialisierung
  assert.deepEqual(await chooseAdmiralSpec(engine, A.playerId, key(), { admiralId: a.id, spec: "aufklaerung" }), { ok: false, code: "admiral_rank" });
  await db.update(tables.admiral).set({ xp: cfg.ranks[cfg.secondSpecFromRank - 1].minXp }).where(eq(tables.admiral.id, a.id));
  assert.equal((await admiralView(engine, A.playerId))!.list[0].canChooseSecond, true);
  assert.equal((await chooseAdmiralSpec(engine, A.playerId, key(), { admiralId: a.id, spec: "aufklaerung" })).ok, true);
  assert.deepEqual((await admiralView(engine, A.playerId))!.list[0].specs, ["logistik", "aufklaerung"]);
});

test("Hafenkommandant mit Aufklärung: längere Radar-Vorwarnzeit über das Modifikatoren-System; abberufen wirkt sofort", async () => {
  const a = (await admiralView(engine, A.playerId))!.list[0];
  assert.equal((await stationAdmiral(engine, A.playerId, key(), { admiralId: a.id })).ok, true);
  const src = (await modifierSourcesFor(db, A.playerId)).find((s) => s.id === "admiral");
  assert.ok(src && (src.mods.radarWarning ?? 1) > 1, JSON.stringify(src));
  assert.equal((await stationAdmiral(engine, A.playerId, key(), { admiralId: null })).ok, true);
  const off = (await modifierSourcesFor(db, A.playerId)).find((s) => s.id === "admiral");
  assert.deepEqual(off?.mods, {});
});
