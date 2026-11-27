// Seekabel, Grüner Hafen, Ökostrom-Erfolg (v1.21) gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert):
// Kabel zwischen eigenen Häfen, zwischen Allianzpartnern mit Preis (Journal, Prüflauf), Sabotage trennt,
// Austritt aus der Allianz trennt, Modifikator-Quelle „Ökostrom“, Erfolg „Grüner Hafen“, Auszeichnung „Grünster Hafen“.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm } from "@tidefront/world";
import { cableDelivered, type BaseState } from "@tidefront/game-core";
import {
  acceptRequest, achievementsView, allianceView, auditLedger, awardsFor, balance, cableAccept, cableCut, cableOffer, cableSetPrice,
  cablesView, chooseBase, computeStandings, createAlliance, leaveAlliance, modifierBreakdown, register, requestJoin, seed, spyPreview,
  type Engine,
} from "../src/index.ts";
import { cableTick } from "../src/power-cable.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `k${++keyN}-${Date.now()}`;
const HOUR = 3600000;
const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
const HOME = { col: 40, row: 30 };

async function newPlayer(name: string, pos: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => {
    s.site = undefined; s.resources = { ...rich }; s.protection.createdAtMs = 0;
    s.buildings = { ...s.buildings, seekabel: 1 };
  });
  return { playerId: p.playerId, baseId: r.baseId!, name, ...pos };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select({ state: tables.base.state }).from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function credits(playerId: number): Promise<number> {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  return (p.trader as { credits: number }).credits;
}

/** Kredite gutschreiben, ausgeglichen im Journal (Gegenkonto test). */
async function grant(playerId: number, amount: number) {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const t = p.trader as { credits: number };
  await db.update(tables.player).set({ trader: { ...t, credits: t.credits + amount } }).where(eq(tables.player.id, playerId));
  await db.insert(tables.tradeLedger).values([
    { tradeId: `test-${playerId}-${amount}`, tMs: Date.now(), account: `player:${playerId}`, asset: "credits", amount: amount.toFixed(2) },
    { tradeId: `test-${playerId}-${amount}`, tMs: Date.now(), account: "test", asset: "credits", amount: (-amount).toFixed(2) },
  ]);
}

const tick = (cableId: number, at = Date.now()) => db.transaction((tx) => cableTick(tx, { payload: { cableId } }, at));
const code = async (p: Promise<unknown>) => ((await p) as { code?: string }).code;

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;
let C: Awaited<ReturnType<typeof newPlayer>>;
let colony = 0;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Kabelleger", HOME);
  B = await newPlayer("Partnerin", { col: HOME.col + 3, row: HOME.row });
  C = await newPlayer("Fremder", { col: HOME.col + 2, row: HOME.row + 1 });
  const a = await createAlliance(engine, A.playerId, { name: "Stromverbund", tag: "SV" });
  await requestJoin(engine, B.playerId, a.allianceId);
  const req = (await allianceView(engine, A.playerId)).requests.find((x) => x.player.id === B.playerId)!;
  await acceptRequest(engine, A.playerId, req.id);
  colony = (await addSecondHarbor(db, A.playerId, { at: { col: HOME.col + 1, row: HOME.row }, patch: (s) => { s.buildings = { ...s.buildings, seekabel: 1 }; } })).baseId;
});

after(async () => {
  await client.end();
});

test("Kabel zwischen eigenen Häfen: sofort in Betrieb, Verlust je 100 km, Puffer, trennen", async () => {
  const view = await cablesView(engine, A.playerId, A.baseId);
  assert.ok(view.candidates.some((c) => c.baseId === colony && c.own && c.station === 1));
  assert.equal(await code(cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: A.baseId, price: 0 })), "cable_self");
  assert.equal(await code(cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: C.baseId, price: 0 })), "cable_not_ally");
  const r = await cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: colony, price: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const cableId = (r as { cableId: number }).cableId;
  assert.equal((r as { status: string }).status, "aktiv");
  assert.equal(await code(cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: B.baseId, price: 0 })), "cable_busy");
  assert.equal((await stateOf(A.baseId)).cable?.role, "out");
  assert.equal((await stateOf(colony)).cable?.role, "in");
  const [row] = await db.select().from(tables.powerCable).where(eq(tables.powerCable.id, cableId));
  assert.equal(row.price, 0, "eigene Häfen: kein Preis");
  const ev = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.type, "cable_tick"));
  assert.equal(ev.length, 1);
  // 40 gesendet → kommt mit Verlust an (Puffer 60), Kolonie ohne Bedarf zieht nichts.
  await patchBase(A.baseId, (s) => { s.cable = { ...s.cable!, sent: 40 }; });
  await tick(cableId);
  const want = 40 * cableDelivered(row.distanceKm, balance);
  assert.ok(Math.abs(((await stateOf(colony)).cable!.buffer ?? 0) - want) < 0.01);
  assert.equal((await stateOf(A.baseId)).cable!.sent, 0);
  assert.equal(await credits(A.playerId), 0);
  const v = await cablesView(engine, A.playerId, colony);
  assert.equal(v.cables[0].role, "in");
  assert.ok(Math.abs(v.cables[0].delivered - want) < 0.1);
  assert.equal((await cableCut(engine, A.playerId, key(), cableId)).ok, true);
  assert.equal((await stateOf(A.baseId)).cable, null);
  assert.equal((await stateOf(colony)).cable, null);
  assert.equal((await db.select().from(tables.powerCable)).length, 0);
  await tick(cableId); // überholte Abrechnung tut nichts
});

test("Kabel zu einem Allianzpartner: Anfrage, Annahme, Preis über das Journal, Prüflauf ausgeglichen", async () => {
  const far = await addSecondHarbor(db, B.playerId, { at: { col: HOME.col + 8, row: HOME.row }, patch: (s) => { s.buildings = { ...s.buildings, seekabel: 1 }; } });
  assert.ok(hexDistanceKm(HOME, far) > 600);
  assert.equal(await code(cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: far.baseId, price: 0 })), "cable_too_far");
  assert.equal(await code(cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: B.baseId, price: 99 })), "cable_price");
  const r = await cableOffer(engine, A.playerId, key(), { fromBaseId: A.baseId, toBaseId: B.baseId, price: 0.5 });
  assert.equal((r as { status: string }).status, "angefragt");
  const cableId = (r as { cableId: number }).cableId;
  assert.equal((await stateOf(B.baseId)).cable ?? null, null, "erst nach Annahme angeschlossen");
  assert.equal(await code(cableAccept(engine, A.playerId, key(), cableId)), "cable_not_party");
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, B.playerId));
  assert.ok(msgs.some((m) => m.subject === "Seekabel angeboten"));
  assert.equal((await cableAccept(engine, B.playerId, key(), cableId)).ok, true);
  await grant(B.playerId, 100);
  await patchBase(A.baseId, (s) => { s.cable = { ...s.cable!, sent: 50 }; });
  await tick(cableId);
  const [row] = await db.select().from(tables.powerCable).where(eq(tables.powerCable.id, cableId));
  const delivered = Math.floor(50 * cableDelivered(row.distanceKm, balance) * 1000) / 1000;
  const cost = Math.floor(delivered * 0.5 * 100) / 100;
  assert.ok(Math.abs(row.delivered - delivered) < 1e-6, `${row.delivered}`);
  assert.equal(row.paid, cost);
  assert.equal(await credits(B.playerId), Math.round((100 - cost) * 100) / 100);
  assert.equal(await credits(A.playerId), cost);
  assert.equal((await auditLedger(engine)).ok, true);
  // Preis ändern (nur der Abgebende); Kredite reichen nur für einen Teil.
  assert.equal(await code(cableSetPrice(engine, B.playerId, key(), cableId, 1)), "cable_not_party");
  assert.equal((await cableSetPrice(engine, A.playerId, key(), cableId, 2)).ok, true);
  await patchBase(B.baseId, (s) => { s.cable = { ...s.cable!, buffer: 0 }; });
  await patchBase(A.baseId, (s) => { s.cable = { ...s.cable!, sent: 500 }; });
  const before = await credits(B.playerId);
  await tick(cableId);
  const buf = (await stateOf(B.baseId)).cable!.buffer!;
  assert.ok(buf <= before / 2 + 1e-6 && buf > 0, `${buf}`);
  assert.ok((await credits(B.playerId)) >= 0);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Sabotage an der Kabelstation: Sendung geht verloren; Sabotage nur durch Kriegsgegner", async () => {
  const [c] = await db.select().from(tables.powerCable);
  await patchBase(B.baseId, (s) => { s.intel = { sabotage: { target: "seekabel", fromMs: Date.now() - 1000, untilMs: Date.now() + HOUR }, lastSabotageAtMs: Date.now() }; s.cable = { ...s.cable!, buffer: 0 }; });
  await patchBase(A.baseId, (s) => { s.cable = { ...s.cable!, sent: 30 }; });
  const lostBefore = c.lost;
  await tick(c.id);
  const [after1] = await db.select().from(tables.powerCable).where(eq(tables.powerCable.id, c.id));
  assert.equal((await stateOf(B.baseId)).cable!.buffer, 0);
  assert.ok(after1.lost - lostBefore >= 30 - 1e-6);
  const v = await cablesView(engine, B.playerId, B.baseId);
  assert.equal(v.cables[0].sabotaged, true);
  // C ist nicht im Krieg mit A: Kabel sabotieren abgelehnt (andere Ziele bleiben möglich).
  await patchBase(C.baseId, (s) => { s.buildings = { ...s.buildings, nachrichtendienst: 5 }; s.units = { spion: 4 }; });
  const pv = await spyPreview(engine, C.playerId, { kind: "sabotage", col: A.col, row: A.row, building: "seekabel" });
  assert.equal(pv.code, "cable_sabotage_war");
  const pk = await spyPreview(engine, C.playerId, { kind: "sabotage", col: A.col, row: A.row, building: "kraftwerk" });
  assert.notEqual(pk.code, "cable_sabotage_war");
});

test("Austritt aus der Allianz trennt das Kabel bei der nächsten Abrechnung", async () => {
  const [c] = await db.select().from(tables.powerCable);
  assert.equal((await leaveAlliance(engine, B.playerId)).ok, true);
  await tick(c.id);
  assert.equal((await db.select().from(tables.powerCable)).length, 0);
  assert.equal((await stateOf(A.baseId)).cable, null);
  assert.equal((await stateOf(B.baseId)).cable, null);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, A.playerId));
  assert.ok(msgs.some((m) => m.subject === "Seekabel getrennt"));
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Grüner Hafen: Quelle „Ökostrom“ im Info-Blatt; Erfolg nach genutztem Ökostrom; Auszeichnung Grünster Hafen", async () => {
  const h = Math.floor(Date.now() / HOUR);
  await patchBase(A.baseId, (s) => {
    s.powerLog = { storedGreen: 0, hours: Array.from({ length: 24 }, (_, i) => [h - 23 + i, 50, 60] as [number, number, number]), greenUsed: 10500, fuelMade: 0, sent: 0, drawn: 0, wasted: 0 };
  });
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, A.baseId));
  const br = await modifierBreakdown(db, { playerId: A.playerId, id: b.id, isHome: true, state: b.state as BaseState }, Date.now());
  const green = br.sources.find((s) => s.id === "oekostrom")!;
  assert.equal(green.label, "Ökostrom");
  assert.equal(green.mods.production?.stahl, 1.03);
  // 50/60 = 83 % ≥ 60 %. Unter 60 %: keine Wirkung.
  await patchBase(colony, (s) => {
    s.powerLog = { storedGreen: 0, hours: [[h, 10, 60]], greenUsed: 100, fuelMade: 0, sent: 0, drawn: 0, wasted: 0 };
  });
  const [cb] = await db.select().from(tables.base).where(eq(tables.base.id, colony));
  const brc = await modifierBreakdown(db, { playerId: A.playerId, id: cb.id, isHome: false, state: cb.state as BaseState }, Date.now());
  assert.deepEqual(brc.sources.find((s) => s.id === "oekostrom")!.mods, {});
  // Erfolg: 10600 genutzt → Bronze (10000); zweiter Abruf zählt nicht doppelt.
  const list = await achievementsView(engine, A.playerId);
  const a = list.achievements.find((x) => x.id === "gruenerhafen")!;
  assert.equal(a.value, 10600);
  assert.equal(a.tier, 1);
  assert.equal((await achievementsView(engine, A.playerId)).achievements.find((x) => x.id === "gruenerhafen")!.value, 10600);
  // Rangliste/Saisonende: Grünster Hafen = meister Ökostrom in einem Hafen.
  const standings = await computeStandings(db, 0, Date.now());
  const sa = standings.find((s) => s.playerId === A.playerId)!;
  assert.equal(sa.oekostrom, 10500);
  const awards = awardsFor(standings);
  assert.ok(awards.get(A.playerId)?.includes("best_oekostrom"));
  assert.ok(!awards.get(B.playerId)?.includes("best_oekostrom"));
});
