// Integrationstests Mehrere Häfen P1 (TEST_DATABASE_URL; die Datenbank wird geleert): Gründung mit Geleit und Ladung,
// Obergrenze inkl. laufender Gründungen, Mindestabstand, Reichweite, Wettlauf um ein Feld, Schutz der Kolonie,
// Forschungsamt gesperrt, Verlegung mit Veteranen und Admiral, Transport in eigenen Hafen, Saisonende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, TRADE_PORTS, hexAtLonLat, hexCenter, hexDistanceKm, isCoast, nestSites, placeNameAt } from "@tidefront/world";
import { hexSteps, type BaseState } from "@tidefront/game-core";
import {
  admiralSpecIds, balance, basesOfPlayer, chooseBase, homeBaseOf, launchMission, missionPreview, processDue, register,
  runningSeason, seasonEnd, seed, upgrade, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `ex${++keyN}-${Date.now()}`;
const E = balance.expansion!;
const SHIP = E.colonyShip;
const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
const ports = new Set(TRADE_PORTS.map(([lon, lat]) => { const h = hexAtLonLat(lon, lat); return `${h.col},${h.row}`; }));
type Hex = { col: number; row: number };

/** Küstenfeld, das die Regeln erfüllt: Abstand zu allen Häfen ≥ minSteps, Entfernung zu `near` in [minKm, maxKm]. */
async function freeCoast(near: Hex | null, minKm: number, maxKm: number, minSteps = E.minDistanceHex + 1, avoid: Hex[] = []): Promise<Hex> {
  const bases = await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base);
  for (let row = 20; row < ROWS; row++) for (let col = 10; col < COLS; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || nests.has(k) || ports.has(k)) continue;
    const h = { col, row };
    if ([...bases, ...avoid].some((b) => hexSteps(b, h) < minSteps)) continue;
    if (near) { const d = hexDistanceKm(near, h); if (d < minKm || d > maxKm) continue; }
    return h;
  }
  throw new Error("kein Küstenfeld");
}

/** Küstenfeld (kein Nest, kein Hafen) im Abstand [minSteps, maxSteps] Feldschritte um `c`. */
function coastAround(c: Hex, minSteps: number, maxSteps: number): Hex {
  for (let r = c.row - maxSteps; r <= c.row + maxSteps; r++) for (let k = c.col - maxSteps; k <= c.col + maxSteps; k++) {
    const h = { col: k, row: r };
    const d = hexSteps(h, c);
    if (d >= minSteps && d <= maxSteps && isCoast(k, r) && !nests.has(`${k},${r}`) && !ports.has(`${k},${r}`)) return h;
  }
  throw new Error("kein Küstenfeld in der Nähe");
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

async function newPlayer(name: string, field: Hex, kz = 5) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: 23, tzOffsetMinutes: 60 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 200_000, treibstoff: 200_000, elektronik: 200_000, proviant: 200_000 };
    Object.assign(s.buildings, { kommandozentrale: kz, hafenkommandantur: 6, werft: 6, lagerkomplex: 12, flugfeld: 2 });
    s.units = { [SHIP]: 3, korvette: 20, zerstoerer: 5 };
  });
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%'`);
  return { playerId: p.playerId, baseId, ...field };
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

let A: Awaited<ReturnType<typeof newPlayer>>;
let colonyId = 0;

test("Gründung: Vorschau, Ablehnungen, Obergrenze inkl. laufender Gründung, neuer Hafen, Kolonieschiff verbraucht, Geleit kehrt heim", async () => {
  A = await newPlayer("Kolonist", await freeCoast(null, 0, 0));
  const target = await freeCoast(A, 350, 600);
  const units = { [SHIP]: 1, korvette: 2 };
  const pv = await missionPreview(engine, A.playerId, { type: "gruendung", units, col: target.col, row: target.row, cargo: { stahl: 1500 } });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.deepEqual((pv as { expansion: unknown }).expansion, { bases: 1, pending: 0, allowed: 2, max: E.maxBases, fee: {} }); // 2. Hafen ohne Gründungsgebühr
  // Ablehnungen in der Vorschau.
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units: { korvette: 2 }, col: target.col, row: target.row })), "colony_ship");
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units: { [SHIP]: 2 }, col: target.col, row: target.row })), "colony_ship");
  const far = await freeCoast(A, E.maxRangeKm + 50, E.maxRangeKm + 600);
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units, col: far.col, row: far.row })), "too_far");
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units, col: A.col, row: A.row })), "field_taken");
  const own = coastAround(A, 1, E.minDistanceOwnHex - 1);
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units, ...own })), "too_close_own");

  const go = await launchMission(engine, A.playerId, key(), { type: "gruendung", units, col: target.col, row: target.row, cargo: { stahl: 1500 } });
  assert.equal(go.ok, true, JSON.stringify(go));
  // Obergrenze: Kommandozentrale 5 erlaubt 2 Häfen – die laufende Gründung zählt mit.
  const other = await freeCoast(A, 350, 800, E.minDistanceHex + 1, [target]);
  assert.equal(code(await launchMission(engine, A.playerId, key(), { type: "gruendung", units: { [SHIP]: 1 }, col: other.col, row: other.row })), "command_level");
  let s = await stateOf(A.baseId);
  assert.equal(s.units[SHIP], 2);
  assert.equal(s.unitsAway[SHIP], 1);
  const arriveAt = (go as { arriveAtMs: number }).arriveAtMs;
  await runUntil(arriveAt + 1000);

  const bases = await basesOfPlayer(db, A.playerId);
  assert.equal(bases.length, 2);
  const col = bases.find((b) => !b.isHome)!;
  colonyId = col.id;
  assert.deepEqual([col.col, col.row], [target.col, target.row]);
  assert.equal(col.name, placeNameAt(hexCenter(target.col, target.row)), "Ortsname aus der Karte");
  assert.equal(col.state.resources.stahl, E.startResources.stahl + 1500);
  assert.equal(col.state.resources.elektronik, E.startResources.elektronik);
  assert.ok(col.state.colony);
  // Schutz: Anfängerschutz erbt den Beginn (vorbei), 24 h Gründungsschutz, Nachtschild übernommen.
  const home = (await homeBaseOf(db, A.playerId))!;
  assert.equal(col.state.protection.createdAtMs, home.state.protection.createdAtMs);
  assert.ok(Math.abs((col.state.protection.foundingShieldUntilMs ?? 0) - (arriveAt + E.colonyShieldHours * HOUR)) < 5000);
  assert.equal(col.state.protection.nightShieldStartHour, 23);
  assert.equal(col.state.protection.tzOffsetMinutes, 60);
  // Erster Kartell-Überfall nach firstRaidAfterHours.
  const [raid] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.baseId, col.id)));
  assert.ok(raid && Math.abs(raid.dueAt.getTime() - (arriveAt + E.firstRaidAfterHours * HOUR)) < 5000);
  // Bericht, Erfolgszähler.
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "gruendung"), eq(tables.battleReport.attackerPlayerId, A.playerId)));
  assert.match(rep.title, /gegründet/);
  const [cnt] = await db.select().from(tables.achievementCounter).where(and(eq(tables.achievementCounter.playerId, A.playerId), eq(tables.achievementCounter.counter, "kolonien")));
  assert.equal(cnt?.value, 1);
  // Geleit kehrt heim, das Kolonieschiff nicht.
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (go as { missionId: number }).missionId));
  assert.equal(m.status, "returning");
  assert.deepEqual(m.returning, { korvette: 2 });
  await runUntil(m.returnAt!.getTime() + 1000);
  s = await stateOf(A.baseId);
  assert.equal(s.units[SHIP], 2, "verbraucht");
  assert.equal(s.unitsAway[SHIP] ?? 0, 0);
  assert.equal(s.units.korvette, 20);
  // Danach erlaubt Kommandozentrale 8 keinen dritten Hafen.
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "gruendung", units: { [SHIP]: 1 }, col: other.col, row: other.row })), "command_level");
  // Kolonie: Zeit auf jetzt, damit spätere Befehle nicht vor dem Gründungszeitpunkt rechnen.
  await patchBase(colonyId, (st) => { st.resUpdatedAt = Date.now(); });
});

test("Forschungsamt in der Kolonie gesperrt, Mindestabstand zu fremden Häfen", async () => {
  assert.equal(code(await upgrade(engine, A.playerId, key(), "forschungsamt", colonyId)), "home_only");
  assert.equal(code(await upgrade(engine, A.playerId, key(), "stahlwerk", colonyId)), "ok");
  const col = (await basesOfPlayer(db, A.playerId)).find((b) => b.id === colonyId)!;
  const B = await newPlayer("Nachbar", await freeCoast(col, 600, 900), 9);
  // Feld 1–3 Schritte neben A's Kolonie: zu nah an fremdem Hafen.
  const close = coastAround(col, 1, E.minDistanceHex - 1);
  assert.equal(code(await missionPreview(engine, B.playerId, { type: "gruendung", units: { [SHIP]: 1 }, ...close })), "too_close");
});

test("Wettlauf um ein Feld: der zweite bekommt „Feld besetzt“, Kolonieschiff und Ladung kehren heim", async () => {
  const P = await newPlayer("Erster", await freeCoast(null, 0, 0), 9);
  const target = await freeCoast(P, 300, 500);
  const Q = await newPlayer("Zweiter", await freeCoast(target, 350, 700, E.minDistanceHex + 1, [target]), 9);
  const a = await launchMission(engine, P.playerId, key(), { type: "gruendung", units: { [SHIP]: 1 }, ...target, cargo: { stahl: 1000 } });
  const b = await launchMission(engine, Q.playerId, key(), { type: "gruendung", units: { [SHIP]: 1, korvette: 1 }, ...target, cargo: { stahl: 1000 } });
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  const ta = (a as { arriveAtMs: number }).arriveAtMs;
  const tb = (b as { arriveAtMs: number }).arriveAtMs;
  const [winner, loser, loserMission] = ta <= tb ? [P, Q, b] : [Q, P, a];
  await runUntil(Math.max(ta, tb) + 1000);
  const owners = await db.select().from(tables.base).where(and(eq(tables.base.col, target.col), eq(tables.base.row, target.row)));
  assert.equal(owners.length, 1);
  assert.equal(owners[0].playerId, winner.playerId);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "gruendung"), eq(tables.battleReport.attackerPlayerId, loser.playerId)));
  assert.match(rep.title, /gescheitert: Feld besetzt/);
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (loserMission as { missionId: number }).missionId));
  assert.equal((m.returning as Record<string, number>)[SHIP], 1);
  assert.deepEqual(m.cargoHome, { stahl: 1000 });
  await runUntil(m.returnAt!.getTime() + 1000);
  const s = await stateOf(loser.baseId);
  assert.equal(s.units[SHIP], 3, "Kolonieschiff zurück");
  assert.equal((await basesOfPlayer(db, loser.playerId)).length, 1);
});

test("Verlegung: Einheiten wechseln den Hafen, Veteranen gemischt, Admiral wechselt; Transport in eigenen Hafen", async () => {
  await patchBase(A.baseId, (s) => { s.veterancy = { korvette: 20 }; s.units.landungsschiff = 2; });
  await patchBase(colonyId, (s) => { s.units = { korvette: 2 }; s.veterancy = {}; s.resUpdatedAt = Date.now(); });
  const [adm] = await db.insert(tables.admiral).values({ playerId: A.playerId, baseId: A.baseId, name: "Admiral Test", spec1: admiralSpecIds()[0] }).returning({ id: tables.admiral.id });
  const col = (await basesOfPlayer(db, A.playerId)).find((b) => b.id === colonyId)!;
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "verlegung", units: { korvette: 1 }, col: A.col, row: A.row })), "same_base");
  const other = await freeCoast(A, 100, 2000);
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "verlegung", units: { korvette: 1 }, ...other })), "transfer_needs_own_base");
  const pv = await missionPreview(engine, A.playerId, { type: "verlegung", units: { korvette: 6 }, col: col.col, row: col.row, admiralId: adm.id });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.equal((pv as { returnAtMs: number; arriveAtMs: number }).returnAtMs, (pv as { arriveAtMs: number }).arriveAtMs);
  const go = await launchMission(engine, A.playerId, key(), { type: "verlegung", units: { korvette: 6, landungsschiff: 1 }, col: col.col, row: col.row, admiralId: adm.id, cargo: { proviant: 500 } });
  assert.equal(go.ok, true, JSON.stringify(go));
  const before = await stateOf(colonyId);
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const to = await stateOf(colonyId);
  assert.equal(to.units.korvette, 8);
  assert.equal(to.veterancy?.korvette, (0 * 2 + 20 * 6) / 8);
  assert.ok(to.resources.proviant >= before.resources.proviant + 300, "Ladung angekommen (abzüglich Unterhalt)");
  const from = await stateOf(A.baseId);
  assert.equal(from.units.korvette, 14);
  assert.equal(from.unitsAway.korvette ?? 0, 0);
  assert.equal(from.veterancy?.korvette, 20);
  const [a] = await db.select().from(tables.admiral).where(eq(tables.admiral.id, adm.id));
  assert.equal(a.baseId, colonyId, "Admiral wechselt den Hafen");
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (go as { missionId: number }).missionId));
  assert.equal(m.status, "done");
  const [rep] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, m.reportId!));
  assert.equal(rep.kind, "verlegung");

  // Transport in den eigenen Hafen (nicht in den Ausgangshafen).
  assert.equal(code(await missionPreview(engine, A.playerId, { type: "transport", units: { korvette: 1 }, col: A.col, row: A.row, cargo: {} })), "own_base");
  const tr = await launchMission(engine, A.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: col.col, row: col.row, cargo: { stahl: 2000 } });
  assert.equal(tr.ok, true, JSON.stringify(tr));
  const st0 = (await stateOf(colonyId)).resources.stahl;
  await runUntil((tr as { arriveAtMs: number }).arriveAtMs + 1000);
  assert.ok((await stateOf(colonyId)).resources.stahl >= st0 + 2000 - 1, "Ladung angekommen");
});

test("Saisonende löscht alle Häfen; der erste Hafen der neuen Saison ist der Heimathafen", async () => {
  const season = (await runningSeason(db))!;
  await db.transaction((tx) => seasonEnd(tx, { id: 0, type: "season_end", dueAt: new Date(), payload: { seasonId: season.id }, baseId: null }, Date.now()));
  assert.equal((await basesOfPlayer(db, A.playerId)).length, 0);
  const f = await freeCoast(null, 0, 0);
  const r = await chooseBase(engine, A.playerId, key(), { ...f, name: "Neuer Hafen", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const home = await homeBaseOf(db, A.playerId);
  assert.equal(home?.id, (r as { baseId: number }).baseId);
  assert.equal(home?.isHome, true);
  assert.equal(home?.state.colony, undefined);
});
