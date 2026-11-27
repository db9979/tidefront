// Integrationstests Lagezentrum (lage.get) und feste Lieferzeit der Börse gegen ein echtes PostgreSQL
// (TEST_DATABASE_URL; die Datenbank wird geleert). Entscheidungen „Lagezentrum“ und „Feste Lieferzeit für
// Börsenlieferungen“ (packages/game-core/ENTSCHEIDUNGEN-5.md).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex, nearestTradePortBySea, nestSites } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import { chooseBase, lageView, marketQuote, register, seed, trade, type Engine } from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `lage${++keyN}-${Date.now()}`;
const used = new Set<string>();

/** Freies Küstenfeld, dessen nächster Handelshafen (über See) im Bereich [minKm, maxKm] liegt. */
function coastByPort(minKm: number, maxKm: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 10; row < ROWS - 8; row++) for (let col = 8; col < COLS - 8; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    const d = nearestTradePortBySea({ col, row }).distanceKm;
    if (d < minKm || d > maxKm) continue;
    used.add(k);
    return { col, row };
  }
  throw new Error(`kein Küstenfeld mit Handelshafen in ${minKm}–${maxKm} km`);
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string, field: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 40_000, treibstoff: 40_000, elektronik: 20_000, proviant: 20_000 };
    s.buildings.kommandozentrale = 12; s.buildings.hafenkommandantur = 8; s.buildings.lagerkomplex = 12; s.buildings.werft = 3;
  });
  return { playerId: p.playerId, baseId, ...field };
}

async function buyStahl(playerId: number, qty: number) {
  const sell = await marketQuote(engine, { side: "sell", resource: "stahl", qty: 3000 });
  assert.ok(sell.ok);
  const sold = await trade(engine, playerId, key(), { side: "sell", resource: "stahl", qty: 3000, expectedPrice: (sell as { executionPrice: number }).executionPrice });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const q = await marketQuote(engine, { side: "buy", resource: "stahl", qty });
  assert.ok(q.ok);
  const r = await trade(engine, playerId, key(), { side: "buy", resource: "stahl", qty, expectedPrice: (q as { executionPrice: number }).executionPrice });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as unknown as { delivery: { id: string; departMs: number; arriveMs: number } }).delivery;
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

test("Börsenkauf kommt nach genau 4 h an – nah und fern gleich, Konvoi mit derselben Fahrzeit", async () => {
  const near = await newPlayer("Nahhafen", coastByPort(20, 150));
  const far = await newPlayer("Fernhafen", coastByPort(500, 5000));
  assert.ok(nearestTradePortBySea(far).distanceKm - nearestTradePortBySea(near).distanceKm > 300, "Entfernungen deutlich verschieden");
  for (const p of [near, far]) {
    const d = await buyStahl(p.playerId, 400);
    assert.equal(d.arriveMs - d.departMs, 4 * HOUR, "feste Lieferzeit");
    const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, d.id));
    assert.ok(cv, "Börsenkonvoi");
    assert.equal(cv.arriveAt.getTime() - cv.departAt.getTime(), 4 * HOUR, "Konvoi fährt in derselben Zeit (Geschwindigkeit angepasst)");
  }
});

test("lage.get bündelt Angriff, Bau, Ausbildung, Mission, Konvoi, Vertrag; brief zählt nur Dringendes", async () => {
  const a = await newPlayer("Lagechef", coastByPort(150, 600));
  const foe = await newPlayer("Angreifer", coastByPort(150, 1200));
  const now = Date.now();
  // Bau und Ausbildung im Heimathafen, zweiter Hafen mit leerer Bauschlange.
  await patchBase(a.baseId, (s) => {
    s.buildQueue = [{ buildingId: "stahlwerk", targetLevel: 5, startedAt: now - MIN, finishesAt: now + HOUR }];
    s.trainingQueue = [{ kind: "unit", id: "korvette", count: 3, builtIn: "werft", startedAt: now - MIN, finishesAt: now + 2 * HOUR }];
  });
  const second = await addSecondHarbor(db, a.playerId, { name: "Kolonie Lage" });
  const d = await buyStahl(a.playerId, 300);
  // Eigene Mission unterwegs, fremder Angriff schon erkannt.
  const plan = (units: Record<string, number>, arrive: number) => ({ units, departAtMs: now - 10 * MIN, arriveAtMs: arrive, returnAtMs: arrive + HOUR });
  const [m] = await db.insert(tables.mission).values({
    playerId: a.playerId, baseId: a.baseId, type: "aufklaerung", targetKind: "base", targetId: foe.baseId, targetCol: foe.col, targetRow: foe.row,
    plan: plan({ korvette: 2 }, now + 30 * MIN), status: "outbound", arriveAt: new Date(now + 30 * MIN), returnAt: new Date(now + 90 * MIN),
  }).returning({ id: tables.mission.id });
  const [atk] = await db.insert(tables.mission).values({
    playerId: foe.playerId, baseId: foe.baseId, type: "ueberfall", targetKind: "base", targetId: a.baseId, targetCol: a.col, targetRow: a.row,
    plan: { ...plan({ korvette: 5 }, now + 15 * MIN), detectedAtMs: now - 5 * MIN }, status: "outbound", arriveAt: new Date(now + 15 * MIN), returnAt: new Date(now + 2 * HOUR),
  }).returning({ id: tables.mission.id });
  // Liefervertrag in der Nachfrist (Börsenkonvoi oben, vor dem Angriff: unter Angriff ist die Börse gesperrt).
  const [c] = await db.insert(tables.marketContract).values({
    kind: "ki", status: "nachfrist", buyerId: a.playerId, sellerId: null, buyerBaseId: a.baseId, proposerId: a.playerId, resource: "proviant", qty: 800,
    buyerUnit: 0.7, sellerUnit: 0.6, course: 0.6, delivery: "abstrakt", dueAt: new Date(now - HOUR), settleAt: new Date(now - HOUR), graceUntil: new Date(now + 11 * HOUR),
  }).returning({ id: tables.marketContract.id });

  const t0 = performance.now();
  const v = await lageView(engine, a.playerId);
  const ms = performance.now() - t0;
  console.log(`lage.get: ${ms.toFixed(1)} ms (2 Häfen, ${v.soon.length} + ${v.underway.length} + ${v.waiting.length} Zeilen)`);
  const kinds = v.soon.map((r) => r.key);
  assert.equal(v.soon[0].key, `angriff:${atk.id}`, "Angriff ganz oben");
  assert.equal(v.soon[0].tone, "alarm");
  assert.match(v.soon[0].sub ?? "", /Vorwarnzeit 20 min/);
  for (const k of [`ankunft:${m.id}`, `rueckkehr:${m.id}`, `nachfrist:${c.id}`, `bau:${a.baseId}:stahlwerk:5`]) assert.ok(kinds.includes(k), `${k} in ${kinds.join(", ")}`);
  assert.ok(kinds.some((k) => k.startsWith(`ausbildung:${a.baseId}:werft:korvette`)), "Ausbildung");
  const [cv] = await db.select({ id: tables.convoy.id }).from(tables.convoy).where(eq(tables.convoy.deliveryId, d.id));
  assert.ok(kinds.includes(`konvoi:${cv.id}`), "Konvoi-Ankunft");
  const way = v.underway.find((r) => r.key === `konvoi-weg:${cv.id}`);
  assert.ok(way && way.progress && way.progress.toMs - way.progress.fromMs === 4 * HOUR, "Konvoi unterwegs mit Fortschritt");
  assert.ok(v.underway.some((r) => r.key === `verband:${m.id}` && r.progress !== null), "Verband unterwegs");
  assert.ok(v.waiting.some((r) => r.key === `leer:${second.baseId}` && r.urgent), "leere Bauschlange der Kolonie");
  assert.ok(!v.waiting.some((r) => r.key === `leer:${a.baseId}`), "Heimathafen baut");
  { const { keys, ...n } = v.urgent; assert.deepEqual(n, { attacks: 1, grace: 1, idleQueues: 1, rewards: 0 }); assert.equal(keys.length, 3); assert.ok(keys.includes(`leer:${second.baseId}`)); }
  const jump = v.soon.find((r) => r.key === `ankunft:${m.id}`)!.jump;
  assert.deepEqual(jump, { to: "map", col: foe.col, row: foe.row, baseId: a.baseId, missionId: m.id });

  // Abholbare Erfolgsstufe zählt als dringend; brief liefert nur die Zahlen.
  await db.insert(tables.achievementTier).values({ playerId: a.playerId, achievementId: "handel", tier: 1, reward: { stahl: 100 } });
  const b = await lageView(engine, a.playerId, { brief: true });
  { const { keys, ...n } = b.urgent; assert.deepEqual(n, { attacks: 1, grace: 1, idleQueues: 1, rewards: 1 }); assert.equal(keys.length, 4); }
  assert.equal(b.soon.length + b.underway.length + b.waiting.length, 0);
  assert.ok(ms < 2000, "schlank");
});

test("lage.get ohne Hafen: leer", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Ohnehafen", password: "geheim123" });
  const v = await lageView(engine, p.playerId);
  assert.deepEqual(v.urgent, { attacks: 0, grace: 0, idleQueues: 0, rewards: 0, keys: [] });
  assert.equal(v.soon.length, 0);
});
