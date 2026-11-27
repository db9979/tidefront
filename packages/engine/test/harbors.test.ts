// Integrationstests Mehrere Häfen – verwalten (TEST_DATABASE_URL; die Datenbank wird geleert): Umbenennen,
// Ortsname neuer Kolonien, „Eingehend“ mit eigener Verlegung, Spielerhandel spielerweit freigeschaltet,
// Kolonie aufgeben (Hinderungsgründe, Aufräumen, Heimathafen bleibt).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenter, isCoast, nestSites, placeNameAt } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  abandonColony, abandonInfo, admiralSpecIds, baseView, basesOfPlayer, chooseBase, colonyNameAt, createOffer, homeBaseOf,
  launchMission, processDue, register, renameBase, seed, upgrade, withdrawOffer, type Engine,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `hb${++keyN}-${Date.now()}`;
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

function coast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 20; row < ROWS; row++) for (let col = 10; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("kein Küstenfeld");
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string, skip: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = coast(skip);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 200_000, treibstoff: 200_000, elektronik: 200_000, proviant: 200_000 };
    Object.assign(s.buildings, { kommandozentrale: 9, hafenkommandantur: 6, werft: 6, lagerkomplex: 12 });
    s.units = { korvette: 20, landungsschiff: 4 };
  });
  return { playerId: p.playerId, baseId, ...f };
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} like 'field%'`);
});

after(async () => {
  await client.end();
});

let A: Awaited<ReturnType<typeof newPlayer>>;
let colony: Awaited<ReturnType<typeof addSecondHarbor>>;

test("Umbenennen: gültiger Name, Prüfung von Zeichen/Länge, doppelter eigener Name, fremder Hafen", async () => {
  A = await newPlayer("Verwalter", 0);
  const B = await newPlayer("Fremder", 40);
  colony = await addSecondHarbor(db, A.playerId, { near: A, maxKm: 700, minKm: 250, name: "Kolonie Alt" });
  assert.equal(code(await renameBase(engine, A.playerId, key(), colony.baseId, "  Neue   Bucht ")), "ok");
  assert.equal((await basesOfPlayer(db, A.playerId)).find((b) => b.id === colony.baseId)?.name, "Neue Bucht");
  assert.equal(code(await renameBase(engine, A.playerId, key(), colony.baseId, "X")), "bad_base_name");
  assert.equal(code(await renameBase(engine, A.playerId, key(), colony.baseId, "Böse<script>")), "bad_base_name");
  assert.equal(code(await renameBase(engine, A.playerId, key(), colony.baseId, "a".repeat(33))), "bad_base_name");
  assert.equal(code(await renameBase(engine, A.playerId, key(), colony.baseId, "hafen verwalter")), "base_name_taken");
  // Heimathafen ohne baseId; fremder Hafen → no_base.
  assert.equal(code(await renameBase(engine, A.playerId, key(), undefined, "Heimat Nord")), "ok");
  assert.equal((await homeBaseOf(db, A.playerId))?.name, "Heimat Nord");
  assert.equal(code(await renameBase(engine, A.playerId, key(), B.baseId, "Gekapert")), "no_base");
});

test("Name einer neuen Kolonie: Ortsname aus der Karte, bei Doppel mit „II“", async () => {
  const f = coast(80);
  const place = placeNameAt(hexCenter(f.col, f.row))!;
  assert.ok(place);
  assert.equal(await colonyNameAt(db, A.playerId, f.col, f.row), place);
  await db.update(tables.base).set({ name: place }).where(eq(tables.base.id, colony.baseId));
  assert.equal(await colonyNameAt(db, A.playerId, f.col, f.row), `${place} II`);
  await db.update(tables.base).set({ name: "Neue Bucht" }).where(eq(tables.base.id, colony.baseId));
});

test("Eingehend: eigene Verlegung im Zielhafen sichtbar und gekennzeichnet, keine Angriffswarnung", async () => {
  const go = await launchMission(engine, A.playerId, key(), { type: "verlegung", units: { korvette: 4, landungsschiff: 1 }, col: colony.col, row: colony.row, cargo: { stahl: 300 } });
  assert.equal(go.ok, true, JSON.stringify(go));
  const v = (await baseView(engine, A.playerId, colony.baseId)).base!;
  const i = v.incoming.find((x) => x.id === (go as { missionId: number }).missionId);
  assert.ok(i, "Verlegung unter Eingehend");
  assert.equal(i.type, "verlegung");
  assert.equal(i.own, true);
  assert.equal(i.from, "Heimat Nord");
  assert.deepEqual(i.units, { korvette: 4, landungsschiff: 1 });
  assert.equal(i.cargo?.stahl, 300);
  assert.equal(v.bases.find((b) => b.id === colony.baseId)?.underAttack, false);
  // Solange sie unterwegs ist, lässt sich die Kolonie nicht aufgeben.
  assert.ok((await abandonInfo(engine, A.playerId, colony.baseId)).blockers.includes("incoming_own"));
  assert.equal(code(await abandonColony(engine, A.playerId, key(), colony.baseId)), "incoming_own");
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const after = (await baseView(engine, A.playerId, colony.baseId)).base!;
  assert.equal(after.incoming.length, 0);
});

test("Spielerhandel: Freischaltung spielerweit (höchste Hafenkommandantur), Ware aus der Kolonie", async () => {
  await patchBase(colony.baseId, (s) => { s.buildings.hafenkommandantur = 0; s.resUpdatedAt = Date.now(); });
  const o = await createOffer(engine, A.playerId, key(), { give: "stahl", giveQty: 500, want: "proviant", wantQty: 100, visibility: "public", baseId: colony.baseId });
  assert.equal(o.ok, true, JSON.stringify(o));
  const [row] = await db.select().from(tables.playerOffer).where(eq(tables.playerOffer.id, (o as { offerId: number }).offerId));
  assert.equal(row.sellerBaseId, colony.baseId);
  assert.equal(code(await abandonColony(engine, A.playerId, key(), colony.baseId)), "offers_open");
  assert.equal(code(await withdrawOffer(engine, A.playerId, key(), row.id)), "ok");
  // Ohne Hafenkommandantur 3 in irgendeinem Hafen bleibt der Handel gesperrt.
  const C = await newPlayer("Neuling", 60);
  await patchBase(C.baseId, (s) => { s.buildings.hafenkommandantur = 2; });
  assert.equal(code(await createOffer(engine, C.playerId, key(), { give: "stahl", giveQty: 500, want: "proviant", wantQty: 100, visibility: "public" })), "locked");
});

test("Kolonie aufgeben: Heimathafen nie, Verbände unterwegs blockieren; danach aufgeräumt", async () => {
  const home = (await homeBaseOf(db, A.playerId))!;
  assert.equal(code(await abandonColony(engine, A.playerId, key(), home.id)), "home_base");
  assert.deepEqual((await abandonInfo(engine, A.playerId)).blockers, ["home_base"]);
  // Transport aus der Kolonie in den Heimathafen: Verband unterwegs.
  await patchBase(colony.baseId, (s) => { s.units.landungsschiff = 1; s.resources.treibstoff = 50_000; s.resUpdatedAt = Date.now(); });
  const tr = await launchMission(engine, A.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: home.col, row: home.row, cargo: { stahl: 100 } });
  // (aktiver Hafen ohne baseId = Heimathafen → own_base; aus der Kolonie mit baseId)
  assert.equal(code(tr), "own_base");
  const tr2 = await launchMission(engine, A.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: home.col, row: home.row, cargo: { stahl: 100 }, baseId: colony.baseId });
  assert.equal(tr2.ok, true, JSON.stringify(tr2));
  assert.equal(code(await abandonColony(engine, A.playerId, key(), colony.baseId)), "missions_out");
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (tr2 as { missionId: number }).missionId));
  await runUntil((m.plan as { returnAtMs: number }).returnAtMs + 1000);

  // Admiral, Minenfeld und laufender Ausbau in der Kolonie.
  const [adm] = await db.insert(tables.admiral).values({ playerId: A.playerId, baseId: colony.baseId, name: "Admiral Kolonie", spec1: admiralSpecIds()[0] }).returning({ id: tables.admiral.id });
  const [mine] = await db.insert(tables.minefield).values({
    ownerId: A.playerId, baseId: colony.baseId, col: colony.col, row: colony.row, strength: 5, maxStrength: 5, createdAt: new Date(), expiresAt: new Date(Date.now() + DAY),
  }).returning({ id: tables.minefield.id });
  assert.equal(code(await upgrade(engine, A.playerId, key(), "stahlwerk", colony.baseId)), "ok");
  const info = await abandonInfo(engine, A.playerId, colony.baseId);
  assert.deepEqual(info.blockers, []);
  assert.equal(info.admirals, 1);
  assert.ok((info.units.korvette ?? 0) >= 4);

  const r = await abandonColony(engine, A.playerId, key(), colony.baseId);
  assert.deepEqual(r, { ok: true, homeBaseId: home.id });
  assert.deepEqual((await basesOfPlayer(db, A.playerId)).map((b) => b.id), [home.id]);
  const [a] = await db.select().from(tables.admiral).where(eq(tables.admiral.id, adm.id));
  assert.equal(a.baseId, home.id, "Admiral wechselt in den Heimathafen");
  const [mf] = await db.select().from(tables.minefield).where(eq(tables.minefield.id, mine.id));
  assert.equal(mf.baseId, null, "Minenfeld bleibt ohne Hafen");
  const pending = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.baseId, colony.baseId), eq(tables.gameEvent.status, "pending"), eq(tables.gameEvent.type, "build_complete")));
  assert.equal(pending.length, 0);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, A.playerId));
  assert.ok(msgs.some((x) => (x.subject ?? "").includes("aufgegeben")));
  // Der alte Hafen ist nicht mehr eigen: Ansicht mit seiner baseId → no_base; Heimathafen bleibt.
  await assert.rejects(baseView(engine, A.playerId, colony.baseId), /no_base/);
  assert.equal((await baseView(engine, A.playerId)).base?.id, home.id);
  // Wiederholung mit neuem Schlüssel: Hafen gibt es nicht mehr.
  assert.equal(code(await abandonColony(engine, A.playerId, key(), colony.baseId)), "no_base");
  // Fällige Ereignisse laufen ohne Fehler weiter.
  await runUntil(Date.now() + 3 * 3600000);
});
