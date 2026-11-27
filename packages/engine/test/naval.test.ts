// Integrationstests See: Minen, Blockade und Konvois gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexDistanceKm, terrainAt, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  acceptOffer, balance, chooseBase, createOffer, launchMission, liftBlockade, missionPreview, modifiersFor, navalRouteMines, navalView,
  processDue, register, seed, trade, type Engine,
} from "../src/index.ts";
import { pair } from "../src/alliance-core.ts";
import { modsOf } from "../src/modifiers.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `nv${++keyN}-${Date.now()}`;
const used = new Set<string>();

function coastNear(near: { col: number; row: number } | null, minKm = 100, maxKm = 400): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 8; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    if (near) {
      const d = hexDistanceKm(near, { col, row });
      if (d < minKm || d > maxKm) continue;
    }
    used.add(k);
    return { col, row };
  }
  throw new Error("no coast");
}

function seaNear(near: { col: number; row: number }, maxKm: number): { col: number; row: number } {
  for (let r = near.row - 4; r <= near.row + 4; r++) for (let c = near.col - 4; c <= near.col + 4; c++) {
    if (terrainAt(c, r) === "sea" && hexDistanceKm(near, { col: c, row: r }) <= maxKm) return { col: c, row: r };
  }
  throw new Error("no sea");
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
  });
  return { playerId: p.playerId, baseId, ...field };
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

async function arm(baseId: number, units: Record<string, number>) {
  await patchBase(baseId, (s) => { s.units = { ...s.units, ...units }; });
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
  await db.delete(tables.minefield);
});

after(async () => {
  await client.end();
});

test("Minen: legen nahe dem eigenen Hafen, fremder Verband verliert Schiffe, eigene sind sicher", async () => {
  const a = await newPlayer("Leger", coastNear(null));
  const b = await newPlayer("Raeuber", coastNear(a));
  await arm(a.baseId, { minenleger: 4, korvette: 5 });
  await patchBase(a.baseId, (s) => { s.buildings.werft = 5; });
  const sea = seaNear(a, 150);
  const bad = await launchMission(engine, a.playerId, key(), { type: "minen", units: { korvette: 2 }, ...sea });
  assert.deepEqual(bad, { ok: false, code: "no_minelayer" });
  const pv = await missionPreview(engine, a.playerId, { type: "minen", units: { minenleger: 4 }, ...sea });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  const before = (await stateOf(a.baseId)).resources.stahl;
  const lay = await launchMission(engine, a.playerId, key(), { type: "minen", units: { minenleger: 4 }, ...sea });
  assert.equal(lay.ok, true, JSON.stringify(lay));
  assert.ok((await stateOf(a.baseId)).resources.stahl < before, "Legen kostet Stahl");
  await runUntil((lay as { arriveAtMs: number }).arriveAtMs + 1000);
  const [field] = await db.select().from(tables.minefield).where(eq(tables.minefield.ownerId, a.playerId));
  assert.ok(field && field.strength === 4 * balance.units.minenleger.mineLayer!);
  // Fremde sehen das Feld nicht (ohne Radar), der Besitzer schon.
  assert.equal((await navalView(engine, a.playerId)).minefields.length, 1);
  await patchBase(b.baseId, (s) => { s.buildings.radarstation = 0; });
  assert.equal((await navalView(engine, b.playerId)).minefields.length, 0);

  // Ein starkes Feld direkt vor A: B überfällt A und verliert Schiffe auf der Hinfahrt.
  await db.insert(tables.minefield).values({ ownerId: a.playerId, baseId: a.baseId, col: a.col, row: a.row, strength: 150, maxStrength: 150, createdAt: new Date(), expiresAt: new Date(Date.now() + DAY) });
  await arm(b.baseId, { korvette: 40 });
  const raid = await launchMission(engine, b.playerId, key(), { type: "ueberfall", units: { korvette: 40 }, col: a.col, row: a.row });
  assert.equal(raid.ok, true, JSON.stringify(raid));
  await runUntil((raid as { arriveAtMs: number }).arriveAtMs + 1000);
  const reports = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "minen"), eq(tables.battleReport.attackerPlayerId, b.playerId)));
  assert.equal(reports.length, 1, "Minenbericht");
  const after = (reports[0].report as { mines: { after: Record<string, number> } }).mines.after;
  assert.ok((after.korvette ?? 0) < 40, "Verluste");
  const known = await navalView(engine, b.playerId);
  assert.ok(known.minefields.some((f) => f.col === a.col && f.row === a.row && f.via === "bekannt"), "nach Treffer bekannt");
  // Planung warnt jetzt vor dem bekannten Feld.
  assert.ok((await navalRouteMines(engine, b.playerId, a.col, a.row)).length >= 1);
});

test("Blockade: Produktion gedrosselt, Verkauf gesperrt, Lieferung zurückgehalten; Verteidiger bricht sie", async () => {
  const a = await newPlayer("Hafen", coastNear(null));
  const b = await newPlayer("Blockierer", coastNear(a));
  await arm(b.baseId, { zerstoerer: 5, schuetzen: 10 });
  assert.deepEqual(await launchMission(engine, b.playerId, key(), { type: "blockade", units: { korvette: 2 }, col: a.col, row: a.row, holdHours: 4 }), { ok: false, code: "blockade_too_weak" });
  assert.deepEqual(await launchMission(engine, b.playerId, key(), { type: "blockade", units: { zerstoerer: 5, schuetzen: 1 }, col: a.col, row: a.row, holdHours: 4 }), { ok: false, code: "blockade_ships_only" });
  const l = await launchMission(engine, b.playerId, key(), { type: "blockade", units: { zerstoerer: 5 }, col: a.col, row: a.row, holdHours: 4 });
  assert.equal(l.ok, true, JSON.stringify(l));
  const arrive = (l as { arriveAtMs: number }).arriveAtMs;
  await runUntil(arrive + 1000);
  const [bl] = await db.select().from(tables.blockade).where(eq(tables.blockade.attackerId, b.playerId));
  assert.equal(bl.status, "active");
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, bl.missionId));
  assert.equal(m.status, "holding");
  const mods = await modifiersFor(db, a.playerId, { nowMs: arrive + 2000 });
  assert.equal(mods.production?.stahl, balance.blockade!.productionFactor);
  // Börsenverkauf gesperrt.
  await patchBase(a.baseId, (s) => { s.buildings.hafenkommandantur = 10; });
  // Die Ankunft liegt in der Zukunft: für den Börsentest die Blockade auf „jetzt“ vorziehen.
  await db.update(tables.blockade).set({ startsAt: new Date(Date.now() - 1000) }).where(eq(tables.blockade.id, bl.id));
  const sold = await trade(engine, a.playerId, key(), { side: "sell", resource: "stahl", qty: 10, expectedPrice: 1 });
  assert.deepEqual(sold, { ok: false, code: "blockade" });
  // Lieferung zurückgehalten.
  await db.insert(tables.delivery).values({ id: "nv-test-1", playerId: a.playerId, baseId: a.baseId, resource: "stahl", qty: 100, departAt: new Date(), arriveAt: new Date(arrive + 2000) });
  await db.insert(tables.gameEvent).values({ type: "delivery_arrive", dueAt: new Date(arrive + 2000), payload: { deliveryId: "nv-test-1" }, baseId: a.baseId });
  await runUntil(arrive + 3000);
  const [d] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, "nv-test-1"));
  assert.equal(d.status, "underway");
  assert.ok(d.arriveAt.getTime() > arrive + 3000);
  // Kartenansicht: Ziel sieht die Blockade und kann angreifen.
  const view = await navalView(engine, a.playerId);
  assert.equal(view.blockades[0]?.role, "target");
  assert.equal(view.blockades[0]?.canAttack, true);
  // Verteidiger greift an und bricht die Blockade.
  await arm(a.baseId, { zerstoerer: 40 });
  const atk = await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: { zerstoerer: 40 }, col: a.col, row: a.row, blockadeId: bl.id });
  assert.equal(atk.ok, true, JSON.stringify(atk));
  await runUntil((atk as { arriveAtMs: number }).arriveAtMs + 1000);
  const [after] = await db.select().from(tables.blockade).where(eq(tables.blockade.id, bl.id));
  assert.equal(after.status, "ended");
  assert.equal(after.outcome, "broken");
  const [m2] = await db.select().from(tables.mission).where(eq(tables.mission.id, bl.missionId));
  assert.equal(m2.status, "returning");
  await runUntil(arrive + 3 * HOUR);
  const [d2] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, "nv-test-1"));
  assert.equal(d2.status, "delivered");
});

test("Blockade: Rückruf beendet sie, Verband kehrt heim", async () => {
  const a = await newPlayer("Ziel2", coastNear(null));
  const b = await newPlayer("Blockierer2", coastNear(a));
  await arm(b.baseId, { zerstoerer: 4 });
  const l = await launchMission(engine, b.playerId, key(), { type: "blockade", units: { zerstoerer: 4 }, col: a.col, row: a.row, holdHours: 2 });
  assert.equal(l.ok, true, JSON.stringify(l));
  await runUntil((l as { arriveAtMs: number }).arriveAtMs + 1000);
  const [bl] = await db.select().from(tables.blockade).where(eq(tables.blockade.attackerId, b.playerId));
  assert.equal((await liftBlockade(engine, a.playerId, key(), bl.id)).ok, false);
  assert.equal((await liftBlockade(engine, b.playerId, key(), bl.id)).ok, true);
  const [rm] = await db.select().from(tables.mission).where(eq(tables.mission.id, bl.missionId));
  assert.equal(rm.status, "returning");
  await runUntil(rm.returnAt!.getTime() + 1000);
  const s = await stateOf(b.baseId);
  assert.equal(s.units.zerstoerer, 4);
  assert.equal(s.unitsAway.zerstoerer ?? 0, 0);
});

test("Konvois: Kartell fängt einen Transport ab, Kriegsgegner bringt eine Handelslieferung trotz Geleit auf", async () => {
  const a = await newPlayer("Sender", coastNear(null));
  const b = await newPlayer("Empfaenger", coastNear(a));
  await arm(a.baseId, { landungsschiff: 2 });
  const tr = await launchMission(engine, a.playerId, key(), { type: "transport", units: { landungsschiff: 2 }, col: b.col, row: b.row, cargo: { stahl: 4000 } });
  assert.equal(tr.ok, true, JSON.stringify(tr));
  const mid = (tr as { missionId: number }).missionId;
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.missionId, mid));
  assert.ok(cv, "Transport reist als Konvoi");
  // Kartell erzwingen: ohne Kriegsschiffe kämpft nur das Landungsschiff.
  const raidAt = cv.departAt.getTime() + 1000;
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(raidAt), payload: { convoyId: cv.id }, baseId: null });
  await runUntil(raidAt + 10);
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cv.id));
  assert.equal((cv2.events as unknown[]).length, 1);
  const lost = 4000 - ((cv2.cargo as Record<string, number>).stahl ?? 0);
  const held = (cv2.events as { escortHeld: boolean | null }[])[0].escortHeld;
  if (held === true) assert.equal(lost, 0);
  else assert.ok(lost > 0);
  const stahlBefore = (await stateOf(b.baseId)).resources.stahl;
  await runUntil((tr as { arriveAtMs: number }).arriveAtMs + 1000);
  assert.ok((await stateOf(b.baseId)).resources.stahl >= stahlBefore + 4000 - lost - 1);

  // Handel mit Geleitschutz; Kriegsgegner C fängt die Lieferung an A ab.
  const c = await newPlayer("Kaper", coastNear(a, 50, 800));
  const offer = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 3000, want: "proviant", wantQty: 100, visibility: "public" });
  assert.equal(offer.ok, true, JSON.stringify(offer));
  await arm(a.baseId, { korvette: 1 });
  const acc = await acceptOffer(engine, a.playerId, key(), (offer as { offerId: number }).offerId, { korvette: 1 });
  assert.equal(acc.ok, true, JSON.stringify(acc));
  const [dc] = await db.select().from(tables.convoy).where(and(eq(tables.convoy.recipientId, a.playerId), eq(tables.convoy.kind, "handel")));
  assert.ok(dc.escortMissionId, "Geleitmission");
  assert.deepEqual(dc.escort, { korvette: 1 });
  // Lange Fahrt, damit C abfangen kann; Krieg zwischen C und A.
  const far = Date.now() + 2 * DAY;
  await db.update(tables.convoy).set({ arriveAt: new Date(far), cartelAt: null }).where(eq(tables.convoy.id, dc.id));
  await db.update(tables.delivery).set({ arriveAt: new Date(far) }).where(eq(tables.delivery.id, dc.deliveryId!));
  await db.update(tables.gameEvent).set({ dueAt: new Date(far) }).where(sql`${tables.gameEvent.payload}->>'deliveryId' = ${dc.deliveryId}`);
  await db.update(tables.gameEvent).set({ dueAt: new Date(far) }).where(sql`${tables.gameEvent.payload}->>'missionId' = ${String(dc.escortMissionId)} and ${tables.gameEvent.type} = 'mission_arrive'`);
  await arm(c.baseId, { zerstoerer: 10 });
  const nope = await missionPreview(engine, c.playerId, { type: "abfangen", units: { zerstoerer: 10 }, col: 0, row: 0, convoyId: dc.id });
  assert.deepEqual({ ok: nope.ok, code: (nope as { code?: string }).code }, { ok: false, code: "convoy_not_enemy" });
  const [x, y] = pair(`p:${a.playerId}`, `p:${c.playerId}`);
  await db.insert(tables.diplomacy).values({ partyA: x, partyB: y, kind: "krieg", status: "aktiv", proposedBy: `p:${c.playerId}`, activeFrom: new Date(Date.now() - 1000) });
  assert.ok((await navalView(engine, c.playerId)).convoys.some((v) => v.id === dc.id && v.enemy), "Kriegsgegner sieht den Konvoi");
  const ic = await launchMission(engine, c.playerId, key(), { type: "abfangen", units: { zerstoerer: 10 }, col: 0, row: 0, convoyId: dc.id });
  assert.equal(ic.ok, true, JSON.stringify(ic));
  await runUntil((ic as { arriveAtMs: number }).arriveAtMs + 1000);
  const [dc2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, dc.id));
  const ev = (dc2.events as { by: string; escortHeld: boolean | null; lost: Record<string, number> }[]).at(-1)!;
  assert.equal(ev.by, "spieler");
  assert.equal(ev.escortHeld, false, "10 Zerstörer schlagen eine Korvette");
  assert.ok((ev.lost.stahl ?? 0) > 0);
  const [del] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, dc.deliveryId!));
  assert.equal(del.qty, (dc.cargo as Record<string, number>).stahl - ev.lost.stahl);
  const [im] = await db.select().from(tables.mission).where(eq(tables.mission.id, (ic as { missionId: number }).missionId));
  assert.deepEqual(im.cargoHome, {}, "Zerstörer haben keinen Laderaum: die Ladung sinkt");
});

test("Mehrere Häfen: Blockade wirkt nur auf ihren Hafen; Radar-Sicht aus allen Häfen; Minenwarnung ab aktivem Hafen", async () => {
  const a = await newPlayer("Doppelhafen", coastNear(null));
  const b = await newPlayer("Sperrer", coastNear(a));
  const a2 = await addSecondHarbor(db, a.playerId, { patch: (s) => { s.buildings.radarstation = 6; s.buildings.hafenkommandantur = 10; s.protection.createdAtMs = 0; } });
  await patchBase(a.baseId, (s) => { s.buildings.radarstation = 0; });
  const now = Date.now();
  await db.insert(tables.blockade).values({
    missionId: 0, attackerId: b.playerId, attackerBaseId: b.baseId, targetBaseId: a2.baseId, targetPlayerId: a.playerId,
    col: a2.col, row: a2.row, units: { zerstoerer: 5 }, startsAt: new Date(now - 1000), endsAt: new Date(now + HOUR),
  });
  // Produktion: nur der blockierte Hafen.
  const homeMods = await modifiersFor(db, a.playerId, { nowMs: now });
  assert.equal(homeMods.production?.stahl, undefined, "Heimathafen frei");
  const colMods = await modsOf(db, { playerId: a.playerId, state: await stateOf(a2.baseId), id: a2.baseId, isHome: false }, now);
  assert.equal(colMods.production?.stahl, balance.blockade!.productionFactor);
  // Lesemodell und Börse je Hafen.
  assert.equal((await navalView(engine, a.playerId)).ownBlockade, null);
  assert.ok((await navalView(engine, a.playerId, a2.baseId)).ownBlockade);
  await assert.rejects(navalView(engine, a.playerId, b.baseId), /no_base/);
  const sold = await trade(engine, a.playerId, key(), { side: "sell", resource: "stahl", qty: 10, expectedPrice: 1, baseId: a2.baseId });
  assert.deepEqual(sold, { ok: false, code: "blockade" });
  const home = await trade(engine, a.playerId, key(), { side: "sell", resource: "stahl", qty: 10, expectedPrice: 1 });
  assert.notEqual((home as { code?: string }).code, "blockade");
  // Radar: fremdes Feld vor dem zweiten Hafen ist sichtbar, obwohl der Heimathafen kein Radar hat.
  await db.insert(tables.minefield).values({ ownerId: b.playerId, baseId: b.baseId, col: a2.col, row: a2.row, strength: 10, maxStrength: 10, createdAt: new Date(), expiresAt: new Date(now + DAY) });
  const seen = (await navalView(engine, a.playerId)).minefields.find((f) => f.col === a2.col && f.row === a2.row);
  assert.equal(seen?.via, "radar");
  // Minenwarnung: die Route ab dem Heimathafen zum zweiten Hafen endet im bekannten Feld.
  assert.equal((await navalRouteMines(engine, a.playerId, a2.col, a2.row)).length >= 1, true);
  await db.delete(tables.blockade).where(eq(tables.blockade.targetBaseId, a2.baseId));
});
