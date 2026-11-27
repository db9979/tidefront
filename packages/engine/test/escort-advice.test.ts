// Integrationstests „Empfohlenes Geleit“ gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert):
// Die Empfehlung aus game-core (recommendEscort) wird in der Börsen-Order übernommen, das Geleit läuft aus und hält
// beim Kartell-Überfall; dazu mehrere Überfälle auf Konvois mit dem empfohlenen Geleit (in der Regel abgewehrt) und
// die KI-Spieler (großer Kauf mit Geleit, kleiner ohne). ENTSCHEIDUNGEN-5.md „Empfohlenes Geleit“.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex, nearestTradePortBySea, nestSites } from "@tidefront/world";
import { cargoValue, market as marketCore, recommendEscort, type BaseState, type Counts } from "@tidefront/game-core";
import { balance, chooseBase, marketQuote, processDue, register, seed, trade, type Engine } from "../src/index.ts";
import { marketBalance } from "../src/context.ts";
import { BOT_ESCORT_MIN_VALUE, botMarketEscort } from "../src/bots-econ.ts";

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `esc${++keyN}-${Date.now()}`;
const used = new Set<string>();

function coast(): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 10; row < ROWS - 8; row++) for (let col = 8; col < COLS - 8; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    if (nearestTradePortBySea({ col, row }).distanceKm < 300) continue;
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

async function newPlayer(name: string, fleet: Counts) {
  const field = coast();
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 40_000, treibstoff: 40_000, elektronik: 20_000, proviant: 20_000 };
    s.buildings.kommandozentrale = 12; s.buildings.hafenkommandantur = 8; s.buildings.lagerkomplex = 12; s.buildings.radarstation = 0; s.buildings.werft = 6;
    s.units = { ...s.units, ...fleet };
  });
  const [pl] = await db.select().from(tables.player).where(eq(tables.player.id, p.playerId));
  await db.update(tables.player).set({ trader: { ...(pl.trader as object), credits: 50_000 } }).where(eq(tables.player.id, p.playerId));
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return { playerId: p.playerId, baseId, ...field, state: b.state as BaseState };
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

/** Empfehlung für einen Börsenkauf, wie die Order sie zeigt (ohne Forschung: keine Modifikatoren). */
function advise(base: { col: number; row: number; state: BaseState }, qty: number) {
  const port = nearestTradePortBySea(base);
  return recommendEscort({
    value: qty * (balance.market.refPrice.stahl ?? 1), riskKm: marketCore.deliveryRiskKm(marketBalance.market, port.distanceKm), market: true,
    trip: { km: port.distanceKm, awayHours: marketCore.deliveryTravelMs(marketBalance.market, port.distanceKm) / 3600000 }, home: base.state.units,
  }, balance);
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

test("Empfehlung übernommen: Geleit läuft mit dem Börsenkonvoi aus und hält beim Kartell-Überfall", async () => {
  const a = await newPlayer("Empfohlen", { korvette: 20 });
  const qty = 3500; // unter der Kursgrenze je Order (maxImpactPerTrade)
  const adv = advise(a, qty);
  assert.equal(adv.status, "ok", JSON.stringify(adv));
  const q = await marketQuote(engine, { side: "buy", resource: "stahl", qty });
  assert.ok(q.ok, JSON.stringify(q));
  const r = await trade(engine, a.playerId, key(), { side: "buy", resource: "stahl", qty, expectedPrice: (q as { executionPrice: number }).executionPrice, escort: adv.units });
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = (r as unknown as { delivery: { id: string } }).delivery;
  const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, d.id));
  assert.deepEqual(cv.escort, adv.units, "Geleit wie empfohlen");
  assert.ok(cv.escortMissionId);
  const at = cv.departAt.getTime() + 1000;
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(at), payload: { convoyId: cv.id }, baseId: null });
  await runUntil(at + 10);
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, cv.id));
  const ev = (cv2.events as { by: string; escortHeld: boolean | null }[]).at(-1)!;
  assert.equal(ev.by, "kartell");
  assert.equal(ev.escortHeld, true, "das empfohlene Geleit hält");
  assert.deepEqual(cv2.cargo, { stahl: qty });
});

test("In der Regel: mehrere Überfälle auf Konvois mit dem empfohlenen Geleit – höchstens wenige gehen verloren", async () => {
  const a = await newPlayer("Statistik", { korvette: 10, zerstoerer: 4 });
  const cargo = { elektronik: 4000 }; // Warenwert 12 000: 10 Schnellboote
  const adv = recommendEscort({ value: cargoValue(cargo, balance), riskKm: 400, market: false, trip: { km: 300, awayHours: 8 }, home: a.state.units }, balance);
  assert.equal(adv.status, "ok", JSON.stringify(adv));
  assert.ok(adv.winRate! >= 0.9);
  // Transportkonvois (das Geleit fährt im Verband, ohne Geleitmission): je ein Überfall mit Zufallsseed des Servers.
  const N = 12;
  const now = Date.now();
  const ids: number[] = [];
  for (let i = 0; i < N; i++) {
    const [cv] = await db.insert(tables.convoy).values({
      kind: "transport", senderId: a.playerId, recipientId: a.playerId, recipientBaseId: a.baseId,
      fromCol: a.col, fromRow: a.row, toCol: a.col + 3, toRow: a.row, cargo, escort: adv.units,
      departAt: new Date(now - 3600000), arriveAt: new Date(now + 3600000),
    }).returning();
    ids.push(cv.id);
    await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(now), payload: { convoyId: cv.id }, baseId: null });
  }
  await runUntil(now + 10);
  let held = 0;
  for (const id of ids) {
    const [cv] = await db.select().from(tables.convoy).where(eq(tables.convoy.id, id));
    if ((cv.events as { escortHeld: boolean | null }[]).at(-1)?.escortHeld === true) held++;
  }
  // Erwartet ≥ 90 % (Probekampf); 8 von 12 lässt Raum für die Streuung (Fehlschlag bei 90 % unter 0,5 %).
  assert.ok(held >= 8, `nur ${held} von ${N} gehalten`);
});

test("KI-Spieler: großer Kauf mit empfohlenem Geleit (Schiffe daheim), kleiner Kauf und ohne Schiffe ohne", async () => {
  const a = await newPlayer("KiFlotte", { korvette: 12 });
  const big = Math.ceil(BOT_ESCORT_MIN_VALUE / (balance.market.refPrice.stahl ?? 1));
  const e = botMarketEscort(a as never, "stahl", big, {});
  assert.ok(e && Object.values(e).some((n) => n > 0), "großer Kauf: Geleit");
  assert.deepEqual(e, advise(a, big).units);
  assert.equal(botMarketEscort(a as never, "stahl", Math.floor(big / 2), {}), null, "kleiner Kauf: ohne");
  const b = await newPlayer("KiOhne", Object.fromEntries(Object.keys(balance.units).map((id) => [id, 0])));
  assert.equal(botMarketEscort(b as never, "stahl", big, {}), null, "keine Schiffe: ohne");
});
