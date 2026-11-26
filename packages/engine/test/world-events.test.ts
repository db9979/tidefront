// Integrationstests Weltereignisse gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, like, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexCenter, hexDistanceKm, COLS, ROWS } from "@tidefront/world";
import {
  buildRoute, productionRates, settle, storageCapacity, worldEventsBalance,
  type BaseState, type WorldEventKind,
} from "@tidefront/game-core";
import {
  balance, chooseBase, computeStandings, ensureWorldEventPlanner, launchMission, missionPreview, processDue, register,
  runningSeason, seed, siegeEffects, spawnWorldEvent, trade, worldEventsView, type Engine,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const w = () => worldEventsBalance(balance);
let keyN = 0;
const key = () => `we${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

/** Freies Küstenfeld 100–400 km von `near` entfernt (das skip-te solche Feld). */
function coastNear(near: { col: number; row: number }, skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = Math.max(0, near.row - 5); row <= Math.min(ROWS - 1, near.row + 5); row++) {
    for (let col = Math.max(0, near.col - 5); col <= Math.min(COLS - 1, near.col + 5); col++) {
      const d = hexDistanceKm(near, { col, row });
      if (isCoast(col, row) && !nests.has(`${col},${row}`) && d >= 100 && d <= 400 && k++ === skip) return { col, row };
    }
  }
  throw new Error("no coast near");
}

/** Spieler mit Hafen; ohne Anfängerschutz (Hafen „alt“), außer protectedBeginner. */
async function newPlayer(name: string, field: number | { col: number; row: number }, protectedBeginner = false) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = typeof field === "number" ? freeCoast(field) : field;
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  if (!protectedBeginner) await patchBase(baseId, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  return { playerId: p.playerId, baseId, ...f };
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

async function eventRow(id: number) {
  const [e] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, id));
  return e;
}

async function spawn(kind: WorldEventKind, focusBaseId: number) {
  const s = await runningSeason(db);
  const r = await db.transaction((tx) => spawnWorldEvent(tx, Date.now(), kind, s!.id, 0, focusBaseId));
  assert.ok(r, "kein Ereignis");
  assert.equal(r.kind, kind);
  return r.id;
}

async function arm(baseId: number, units: Record<string, number>) {
  await patchBase(baseId, (s) => {
    s.units = { ...units };
    s.resources.treibstoff = 1_000_000;
    s.buildings.kommandozentrale = 15;
    s.buildings.hafenkommandantur = 10;
  });
}

/** Läuft alle fälligen Ereignisse bis `ms` ab. */
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
  // Jeder Test für sich: alle bisherigen Häfen wieder im Anfängerschutz, keine Kartell-Überfälle, keine Ereignisse.
  await db.execute(sql`update base set state = jsonb_set(state, '{protection,createdAtMs}', to_jsonb(${Date.now()}::bigint))`);
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
  await db.update(tables.worldEvent).set({ status: "ended", outcome: "test" });
});

after(async () => {
  await client.end();
});

test("Planung: erstes Ereignis nach Saisonbeginn, nie gegen Anfängerschutz, nächstes nach 2–4 Tagen", async () => {
  const season = (await runningSeason(db))!;
  const at = await ensureWorldEventPlanner(db, Date.now());
  assert.ok(at! >= season.startsAt.getTime() + w().firstSpawnAfterHours * HOUR);
  assert.equal(await ensureWorldEventPlanner(db, Date.now()), null, "nur ein geplantes Ereignis");
  // Nur Anfänger: kein Ereignis, neuer Versuch nach retryHours.
  await newPlayer("Neu", 30, true);
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(eq(tables.gameEvent.type, "world_event_spawn"));
  const t0 = Date.now();
  await processDue(engine, t0 + 1000);
  assert.equal((await db.select().from(tables.worldEvent).where(sql`status <> 'ended'`)).length, 0);
  let [next] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "world_event_spawn"), eq(tables.gameEvent.status, "pending")));
  assert.ok(Math.abs(next.dueAt.getTime() - t0 - w().retryHours * HOUR) < 60000);
  // Ein erfahrener Spieler: das Ereignis entsteht, nächstes in 48–96 h.
  const p = await newPlayer("Alt", 31);
  await db.update(tables.gameEvent).set({ dueAt: new Date() }).where(eq(tables.gameEvent.id, next.id));
  const t1 = Date.now();
  await processDue(engine, t1 + 1000);
  const open = await db.select().from(tables.worldEvent).where(sql`status <> 'ended'`);
  assert.equal(open.length, 1);
  if (open[0].kind === "belagerung") assert.equal(open[0].targetBaseId, p.baseId);
  [next] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "world_event_spawn"), eq(tables.gameEvent.status, "pending")));
  const gap = next.dueAt.getTime() - t1;
  assert.ok(gap >= w().spawnIntervalHours[0] * HOUR - 60000 && gap <= w().spawnIntervalHours[1] * HOUR + 60000, `Abstand ${gap / HOUR} h`);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, p.playerId));
  assert.ok(msgs.some((m) => m.fromPlayerId === null), "Ankündigung als Systemnachricht");
});

test("Schatzschiff abfangen: Abfangpunkt beim Planen, nur der erste Sieger erhält die Beute", async () => {
  const a = await newPlayer("Kaperer", 60);
  const b = await newPlayer("Spaeter", coastNear(a, 0));
  const id = await spawn("schatzschiff", a.baseId);
  // Langsame Fahrt (48 h), damit beide sicher abfangen können.
  const e = await eventRow(id);
  const path = e.data as { path: { col: number; row: number }[] };
  const now = Date.now();
  const route = buildRoute(path.path.map((h) => hexCenter(h.col, h.row)), now, now + 48 * HOUR);
  await db.update(tables.worldEvent).set({ data: { ...(e.data as object), route }, endsAt: new Date(now + 48 * HOUR) }).where(eq(tables.worldEvent.id, id));
  const fleet = { zerstoerer: 40, landungsschiff: 2 };
  await arm(a.baseId, fleet);
  await arm(b.baseId, fleet);
  // Nur Überfälle; Vorschau liefert den Abfangpunkt.
  const scout = await launchMission(engine, a.playerId, key(), { type: "aufklaerung", units: fleet, col: 0, row: 0, eventId: id });
  assert.deepEqual(scout, { ok: false, code: "event_needs_raid" });
  const pv = await missionPreview(engine, a.playerId, { type: "ueberfall", units: fleet, col: 0, row: 0, eventId: id });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  const ma = await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: fleet, col: 0, row: 0, eventId: id });
  const mb = await launchMission(engine, b.playerId, key(), { type: "ueberfall", units: fleet, col: 0, row: 0, eventId: id });
  assert.equal(ma.ok, true, JSON.stringify(ma));
  assert.equal(mb.ok, true, JSON.stringify(mb));
  const arrA = (ma as { arriveAtMs: number }).arriveAtMs;
  const arrB = (mb as { arriveAtMs: number }).arriveAtMs;
  assert.ok(arrA < now + 48 * HOUR && arrB < now + 48 * HOUR);
  const [first, second] = arrA <= arrB ? [a, b] : [b, a];
  await runUntil(Math.max(arrA, arrB) + 1000);
  const done = await eventRow(id);
  assert.equal(done.status, "ended");
  assert.equal(done.outcome, "defeated");
  assert.equal(done.winnerPlayerId, first.playerId);
  const reports = await db.select().from(tables.battleReport).where(like(tables.battleReport.kind, "weltereignis%"));
  const won = reports.find((r) => r.attackerPlayerId === first.playerId)!;
  const late = reports.find((r) => r.attackerPlayerId === second.playerId)!;
  assert.equal(won.kind, "weltereignis");
  assert.equal(won.winner, "attacker");
  const loot = (won.report as { battle: { loot: Record<string, number> } }).battle.loot;
  const total = Object.values(loot).reduce((x, y) => x + y, 0);
  assert.ok(total > 0 && total <= 2 * 4000, `Beute ${total} durch Laderaum begrenzt`);
  assert.equal(late.kind, "weltereignis_leer");
  // Nach Ablauf aller Rückfahrten: Beute daheim, der Zweite kommt vollzählig und leer zurück.
  const missions = await db.select().from(tables.mission).where(eq(tables.mission.targetKind, "event"));
  await runUntil(Math.max(...missions.map((m) => m.returnAt!.getTime())) + 1000);
  const sFirst = await stateOf(first.baseId);
  const sSecond = await stateOf(second.baseId);
  assert.equal(sSecond.units.zerstoerer, 40);
  assert.ok(sFirst.resources.stahl >= loot.stahl);
  // Vorbei: neue Missionen werden abgelehnt.
  const again = await launchMission(engine, b.playerId, key(), { type: "ueberfall", units: { zerstoerer: 1 }, col: 0, row: 0, eventId: id });
  assert.deepEqual(again, { ok: false, code: "event_over" });
});

test("Großflotte: Ankündigung, Schwächung auf See (Verluste bleiben, Beute und Kampfpunkte), Hafenangriffe mit Schutzregeln", async () => {
  const a = await newPlayer("Ziel", 90);
  const s = await newPlayer("Schild", coastNear(a, 0));
  const c = await newPlayer("Jaeger", coastNear(a, 3));
  // Schild: Schutz nach Niederlage für die ganze Dauer.
  await patchBase(s.baseId, (st) => { st.protection.defeatShieldUntilMs = Date.now() + 5 * DAY; });
  const id = await spawn("grossflotte", a.baseId);
  let e = await eventRow(id);
  assert.equal(e.status, "announced");
  assert.ok(Math.abs(e.activeAt.getTime() - e.startsAt.getTime() - w().grossflotte.announceHours * HOUR) < 1000);
  const targets = (e.data as { targets: { baseId: number }[] }).targets.map((t) => t.baseId);
  assert.equal(targets[0], a.baseId);
  assert.ok(targets.includes(s.baseId), "Nachbarhafen gehört zur Zielregion");
  const view = await worldEventsView(engine, a.playerId);
  assert.ok(view.nearby.includes(id));
  const initial = (e.units as Record<string, number>).schnellboot;
  // Jäger greift die Flotte vor dem Auslaufen an.
  await arm(c.baseId, { korvette: 6, landungsschiff: 1 });
  const m = await launchMission(engine, c.playerId, key(), { type: "ueberfall", units: { korvette: 6, landungsschiff: 1 }, col: 0, row: 0, eventId: id });
  assert.equal(m.ok, true, JSON.stringify(m));
  const arrive = (m as { arriveAtMs: number }).arriveAtMs;
  assert.ok(arrive < e.activeAt.getTime(), "Ankunft vor dem Auslaufen");
  await runUntil(arrive + 1000);
  e = await eventRow(id);
  const left = (e.units as Record<string, number>).schnellboot ?? 0;
  assert.ok(left < initial, `Flotte geschwächt: ${initial} → ${left}`);
  const [dmg] = await db.select().from(tables.worldEventDamage).where(eq(tables.worldEventDamage.eventId, id));
  assert.equal(dmg.playerId, c.playerId);
  assert.ok(dmg.hp > 0);
  const season = (await runningSeason(db))!;
  const standings = await computeStandings(db, season.startsAt.getTime(), Date.now());
  assert.ok(standings.find((r) => r.playerId === c.playerId)!.kampf > 0, "Kampfpunkte für Schaden");
  // Auslaufen und Angriffe: Ziel (ungeschützt) wird angegriffen, Schild zieht sie vorbei.
  await runUntil(e.activeAt.getTime() + targets.length * w().grossflotte.attackIntervalHours * HOUR + 1000);
  e = await eventRow(id);
  assert.equal(e.status, "ended");
  const st = (e.data as { targets: { baseId: number; status: string }[] }).targets;
  assert.equal(st.find((t) => t.baseId === a.baseId)!.status, "attacked");
  assert.equal(st.find((t) => t.baseId === s.baseId)!.status, "skipped");
  const onA = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.defenderBaseId, a.baseId)));
  assert.equal(onA.length, 1);
  const onS = await db.select().from(tables.battleReport).where(eq(tables.battleReport.defenderBaseId, s.baseId));
  assert.equal(onS.length, 0);
  // Verluste der Flotte sind geblieben: beim Hafenangriff fuhr der geschwächte Verband.
  const attackUnits = (onA[0].report as { battle: { attacker: { before: Record<string, number> } } }).battle.attacker.before;
  assert.equal(attackUnits.schnellboot, left);
});

test("Belagerung: keine Börsenkäufe, Produktion −30 %, Ring brechen nur durch andere", async () => {
  const a = await newPlayer("Belagert", 120);
  const b = await newPlayer("Retter", coastNear(a, 0));
  await patchBase(a.baseId, (s) => {
    s.buildings.stahlwerk = 8; s.buildings.kraftwerk = 10; s.buildings.lagerkomplex = 10; s.buildings.hafenkommandantur = 6;
    s.resources = { stahl: 100, treibstoff: 50000, elektronik: 100, proviant: 50000 };
  });
  const id = await spawn("belagerung", a.baseId);
  const e = await eventRow(id);
  assert.equal(e.targetBaseId, a.baseId);
  const fx = await siegeEffects(db, a.baseId, Date.now());
  assert.ok(fx && fx.marketBlocked && Math.abs(fx.productionFactor - 0.7) < 1e-9);
  const buy = await trade(engine, a.playerId, key(), { side: "buy", resource: "stahl", qty: 10, expectedPrice: 1 });
  assert.deepEqual(buy, { ok: false, code: "siege" });
  // Stündlicher Abzug: 30 % der Gebäudeproduktion.
  const before = await stateOf(a.baseId);
  const tick = e.startsAt.getTime() + w().belagerung.tickMinutes * 60000;
  await processDue(engine, tick + 10);
  const afterTick = await stateOf(a.baseId);
  const expected = settle(before, tick, balance);
  const perHour = productionRates(before, balance).buildingPerHour.stahl;
  assert.ok(expected.resources.stahl < storageCapacity(before, balance));
  const want = expected.resources.stahl - perHour * 0.3 * ((tick - e.startsAt.getTime()) / HOUR);
  assert.ok(perHour > 0);
  assert.ok(Math.abs(afterTick.resources.stahl - want) < 0.01, `${afterTick.resources.stahl} ≈ ${want}`);
  // Der Belagerte selbst kann den Ring nicht brechen.
  await arm(a.baseId, { zerstoerer: 30 });
  const self = await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: { zerstoerer: 30 }, col: 0, row: 0, eventId: id });
  assert.deepEqual(self, { ok: false, code: "own_siege" });
  // Ein anderer bricht ihn.
  await arm(b.baseId, { zerstoerer: 30, landungsschiff: 2 });
  const m = await launchMission(engine, b.playerId, key(), { type: "ueberfall", units: { zerstoerer: 30, landungsschiff: 2 }, col: 0, row: 0, eventId: id });
  assert.equal(m.ok, true, JSON.stringify(m));
  await runUntil((m as { arriveAtMs: number }).arriveAtMs + 1000);
  const done = await eventRow(id);
  assert.equal(done.status, "ended");
  assert.equal(done.outcome, "defeated");
  assert.equal(done.winnerPlayerId, b.playerId);
  assert.equal(await siegeEffects(db, a.baseId, Date.now()), null);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.attackerPlayerId, b.playerId)));
  const loot = (rep.report as { battle: { loot: Record<string, number> } }).battle.loot;
  assert.ok(Object.values(loot).reduce((x, y) => x + y, 0) > 0, "Beute für den Bruch");
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, a.playerId));
  assert.ok(msgs.some((x) => (x.subject ?? "").includes("gebrochen")));
  const view = await worldEventsView(engine, a.playerId);
  assert.equal(view.ownSiege, null);
});

test("Mehrere Häfen: Belagerung einer Kolonie wirkt nur dort; Lesemodell je aktivem Hafen", async () => {
  const c = await newPlayer("Kolonist", 140);
  const c2 = await addSecondHarbor(db, c.playerId, { patch: (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; s.buildings.hafenkommandantur = 6; } });
  await patchBase(c.baseId, (s) => { s.buildings.hafenkommandantur = 6; s.resources.stahl = 100; });
  const id = await spawn("belagerung", c2.baseId);
  assert.equal((await eventRow(id)).targetBaseId, c2.baseId);
  assert.ok((await worldEventsView(engine, c.playerId, c2.baseId)).ownSiege, "Kolonie sieht den Ring");
  assert.equal((await worldEventsView(engine, c.playerId)).ownSiege, null, "Heimathafen frei");
  await assert.rejects(worldEventsView(engine, c.playerId, 999999), /no_base/);
  const buyCol = await trade(engine, c.playerId, key(), { side: "buy", resource: "stahl", qty: 10, expectedPrice: 1, baseId: c2.baseId });
  assert.deepEqual(buyCol, { ok: false, code: "siege" });
  const buyHome = await trade(engine, c.playerId, key(), { side: "buy", resource: "stahl", qty: 10, expectedPrice: 1 });
  assert.notEqual((buyHome as { code?: string }).code, "siege");
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, c.playerId));
  assert.ok(msgs.some((x) => (x.subject ?? "").includes(c2.name)), "Text nennt den Hafen");
});

test("Saisonende räumt Ereignisse ab, der Planer setzt in der neuen Saison neu an", async () => {
  const a = await newPlayer("Ende", 150);
  const id = await spawn("belagerung", a.baseId);
  await db.insert(tables.worldEventDamage).values({ eventId: id, playerId: a.playerId, hp: 1, loot: {}, attacks: 1 });
  const season = (await runningSeason(db))!;
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await processDue(engine, Date.now());
  const s2 = (await runningSeason(db))!;
  assert.equal(s2.number, season.number + 1);
  assert.equal((await db.select().from(tables.worldEvent)).length, 0);
  assert.equal((await db.select().from(tables.worldEventDamage)).length, 0);
  const pending = await db.select().from(tables.gameEvent).where(and(like(tables.gameEvent.type, "world_event%"), eq(tables.gameEvent.status, "pending")));
  assert.equal(pending.length, 0);
  const at = await ensureWorldEventPlanner(db, Date.now());
  assert.equal(at, s2.startsAt.getTime() + w().firstSpawnAfterHours * HOUR);
});
