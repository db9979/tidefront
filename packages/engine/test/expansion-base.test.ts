// Integrationstests Mehrere Häfen – Fundament (P0) gegen ein echtes PostgreSQL (wird geleert): Migration mit
// Bestandsdaten setzt is_home, Teil-Unique-Index des Heimathafens, Besitzprüfung der baseId, Mehrzeilen-Fehler
// (Rangliste, Spielerliste, Weltereignis-Empfänger), Forschung des Heimathafens in der Kolonie, Befehle je Hafen.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenter, isCoast, nestSites, isTradePortHex } from "@tidefront/world";
import { createBase, researchModifiers, type BaseState } from "@tidefront/game-core";
import {
  balance,
  baseView,
  basesOfPlayer,
  chooseBase,
  computeStandings,
  FOUNDING_TYPE,
  homeBaseOf,
  launchMission,
  listPlayers,
  lockOwnBase,
  missionPreview,
  modifierSourcesFor,
  modsOf,
  ownBase,
  register,
  seed,
  trade,
  train,
  TRANSFER_TYPE,
  upgrade,
  type Engine,
} from "../src/index.ts";
import { playersWithBase } from "../src/world-events.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `x${++keyN}-${Date.now()}`;
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations", import.meta.url));

function coast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newPlayer(name: string, field: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = coast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, ...f };
}

/** Kolonie per SQL (Gründung kommt erst mit P1); state: Vorgabe Startzustand. */
async function addColony(playerId: number, field: number, state?: BaseState, isHome = false): Promise<number> {
  const f = coast(field);
  const s = state ?? createBase(balance, Date.now(), hexCenter(f.col, f.row));
  const [r] = await db.insert(tables.base).values({ playerId, name: `Kolonie ${field}`, ...f, state: { ...s, site: hexCenter(f.col, f.row) }, isHome }).returning({ id: tables.base.id });
  return r.id;
}

async function rawState(baseId: number): Promise<unknown> {
  const [b] = await db.select({ state: tables.base.state }).from(tables.base).where(eq(tables.base.id, baseId));
  return b.state;
}

after(async () => {
  await client.end();
});

test("Migration mit Bestandsdaten: alle bestehenden Häfen werden Heimathafen", async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  // Stand vor 0015: Migrationen bis 0014 aus einem Teilordner.
  const dir = mkdtempSync(join(tmpdir(), "tf-mig-"));
  try {
    mkdirSync(join(dir, "meta"));
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const idx = journal.entries.findIndex((e) => e.tag.endsWith("_expansion"));
    assert.ok(idx > 0);
    const before = journal.entries.slice(0, idx);
    writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: before }));
    for (const f of readdirSync(MIGRATIONS)) if (before.some((e) => f === `${e.tag}.sql`)) copyFileSync(join(MIGRATIONS, f), join(dir, f));
    await migrateDb(db, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (let i = 0; i < 3; i++) {
    const f = coast(40 + i);
    await db.execute(sql`insert into player (name, pass_hash, trader) values (${`Alt${i}`}, 'x', '{}'::jsonb)`);
    await db.execute(sql`insert into base (player_id, name, col, row, state)
      select id, ${`Althafen ${i}`}, ${f.col}, ${f.row}, '{}'::jsonb from player where name = ${`Alt${i}`}`);
  }
  await migrateDb(db, MIGRATIONS);
  const rows = await db.execute<{ is_home: boolean }>(sql`select is_home from base`);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.is_home === true));
  const [col] = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.columns where table_name = 'player_offer' and column_name = 'seller_base_id'`);
  assert.equal(col.n, 1);

  // Frischer Stand für die übrigen Tests.
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

test("Teil-Unique-Index: zweiter Heimathafen scheitert, zweiter Nicht-Heimathafen erlaubt; chooseBase setzt is_home", async () => {
  const p = await newPlayer("Ida", 1);
  const home = await homeBaseOf(db, p.playerId);
  assert.equal(home?.id, p.baseId);
  assert.equal(home?.isHome, true);
  await assert.rejects(() => addColony(p.playerId, 2, undefined, true));
  const colony = await addColony(p.playerId, 3);
  const all = await basesOfPlayer(db, p.playerId);
  assert.deepEqual(all.map((b) => [b.id, b.isHome]), [[p.baseId, true], [colony, false]]);
  // chooseBase bleibt einmalig.
  const again = await chooseBase(engine, p.playerId, key(), { ...coast(4), name: "Noch einer", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.deepEqual(again, { ok: false, code: "has_base" });
  // ownBase/lockOwnBase: ohne baseId Heimathafen, Kolonie mit baseId.
  assert.equal((await ownBase(db, p.playerId)).id, p.baseId);
  assert.equal((await ownBase(db, p.playerId, colony)).id, colony);
  assert.equal(await db.transaction(async (tx) => (await lockOwnBase(tx, p.playerId, colony)).id), colony);
});

test("Besitzprüfung: fremde oder unbekannte baseId → no_base, nichts geändert", async () => {
  const a = await newPlayer("Anke", 5);
  const b = await newPlayer("Bert", 6);
  const before = await rawState(b.baseId);
  for (const id of [b.baseId, 999999]) {
    assert.deepEqual(await upgrade(engine, a.playerId, key(), "stahlwerk", id), { ok: false, code: "no_base" });
    assert.deepEqual(await train(engine, a.playerId, key(), "schuetzen", 1, id), { ok: false, code: "no_base" });
    assert.deepEqual(
      await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: { schuetzen: 1 }, col: 3, row: 3, baseId: id }),
      { ok: false, code: "no_base" },
    );
    assert.deepEqual(
      await trade(engine, a.playerId, key(), { side: "sell", resource: "stahl", qty: 1, expectedPrice: 1, baseId: id }),
      { ok: false, code: "no_base" },
    );
    assert.deepEqual(await missionPreview(engine, a.playerId, { type: "ueberfall", units: { schuetzen: 1 }, col: 3, row: 3, baseId: id }), { ok: false, code: "no_base" });
    await assert.rejects(() => baseView(engine, a.playerId, id), /no_base/);
    await assert.rejects(() => ownBase(db, a.playerId, id), /no_base/);
  }
  assert.deepEqual(await rawState(b.baseId), before);
  const missions = await db.select().from(tables.mission).where(eq(tables.mission.playerId, a.playerId));
  assert.equal(missions.length, 0);
});

test("Befehl mit baseId der Kolonie wirkt auf die Kolonie; base.get liefert Hafenliste", async () => {
  const p = await newPlayer("Kai", 8);
  const colony = await addColony(p.playerId, 9);
  const homeBefore = await rawState(p.baseId);
  const r = await upgrade(engine, p.playerId, key(), "stahlwerk", colony);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [c] = await db.select().from(tables.base).where(eq(tables.base.id, colony));
  assert.equal((c.state as BaseState).buildQueue.length, 1);
  assert.equal((c.state as BaseState).buildQueue[0].buildingId, "stahlwerk");
  const homeAfter = (await rawState(p.baseId)) as BaseState;
  assert.equal(homeAfter.buildQueue.length, (homeBefore as BaseState).buildQueue.length);
  const ev = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.baseId, colony), eq(tables.gameEvent.type, "build_complete")));
  assert.equal(ev.length, 1);

  const home = await baseView(engine, p.playerId);
  assert.equal(home.base?.id, p.baseId);
  assert.equal(home.base?.isHome, true);
  assert.deepEqual(home.base?.bases.map((b) => [b.id, b.isHome, b.underAttack]), [[p.baseId, true, false], [colony, false, false]]);
  const view = await baseView(engine, p.playerId, colony);
  assert.equal(view.base?.id, colony);
  assert.equal(view.base?.isHome, false);
  assert.equal(view.base?.buildQueue.length, 1);

  // Gründung/Verlegung laufen über die Weiche (P1, expansion.ts); ohne Kolonieschiff bzw. Zielhafen abgelehnt.
  for (const [type, expected] of [[FOUNDING_TYPE, "command_level"], [TRANSFER_TYPE, "transfer_needs_own_base"]] as const) {
    assert.deepEqual(await launchMission(engine, p.playerId, key(), { type, units: {}, col: 3, row: 3 }), { ok: false, code: expected });
    const pv = await missionPreview(engine, p.playerId, { type, units: {}, col: 3, row: 3 });
    assert.equal(pv.ok, false);
    assert.equal((pv as { code: string }).code, expected);
  }
});

test("Rangliste, Spielerliste, Weltereignis-Empfänger ohne Doppel bei zwei Häfen; Punkte = Summe", async () => {
  const p = await newPlayer("Zora", 11);
  const nowMs = Date.now();
  const s0 = (await computeStandings(db, nowMs - 3600000, nowMs)).find((s) => s.playerId === p.playerId)!;
  assert.equal(s0.bases, 1);
  const home = (await homeBaseOf(db, p.playerId))!;
  const colony = await addColony(p.playerId, 12, structuredClone(home.state));
  const standings = await computeStandings(db, nowMs - 3600000, nowMs);
  const mine = standings.filter((s) => s.playerId === p.playerId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].bases, 2);
  assert.equal(mine[0].base?.id, p.baseId);
  assert.equal(mine[0].ausbau, s0.ausbau * 2);
  assert.equal(mine[0].militaer, s0.militaer * 2);
  assert.equal(new Set(standings.map((s) => s.playerId)).size, standings.length);

  const players = await listPlayers(db);
  const rows = players.filter((r) => r.id === p.playerId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].baseName, "Hafen Zora");
  assert.equal(rows[0].baseCount, 2);
  assert.equal(new Set(players.map((r) => r.id)).size, players.length);

  const recipients = await playersWithBase(db);
  assert.equal(recipients.filter((r) => r.playerId === p.playerId).length, 1);
  assert.equal(new Set(recipients.map((r) => r.playerId)).size, recipients.length);
  assert.notEqual(colony, p.baseId);
});

test("Forschung des Heimathafens wirkt in der Kolonie", async () => {
  const p = await newPlayer("Fiete", 14);
  const levels = { hochofen: 3 };
  const [h] = await db.select().from(tables.base).where(eq(tables.base.id, p.baseId));
  const hs = h.state as BaseState;
  hs.research = { ...(hs.research ?? {}), levels } as BaseState["research"];
  await db.update(tables.base).set({ state: hs }).where(eq(tables.base.id, p.baseId));
  const colonyId = await addColony(p.playerId, 15);
  const colony = (await basesOfPlayer(db, p.playerId)).find((b) => b.id === colonyId)!;
  assert.equal(colony.isHome, false);
  assert.ok(!colony.state.research?.levels?.hochofen);
  const sources = await modifierSourcesFor(db, p.playerId, { state: colony.state, baseId: colony.id, isHome: false });
  const research = sources.find((s) => s.id === "forschung")!;
  const expected = researchModifiers(levels, balance);
  assert.ok(Object.keys(expected).length > 0);
  assert.deepEqual(research.mods, expected);
  // modsOf über die Zeile (isHome aus BaseRow) liefert dasselbe wie für den Heimathafen.
  const home = (await homeBaseOf(db, p.playerId))!;
  const colonyMods = await modsOf(db, colony);
  const homeMods = await modsOf(db, { ...home, state: { ...colony.state, research: home.state.research } });
  assert.deepEqual(colonyMods, homeMods);
});
