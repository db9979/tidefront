// Hotfix 0.38.1 (TE-01): Spielersperren mit FOR NO KEY UPDATE. FOR UPDATE auf player ließ jedes Einfügen mit Fremdschlüssel
// auf diesen Spieler (Nachricht, Mission, Zähler …) bis zum Ende der sperrenden Transaktion warten. Echtes PostgreSQL
// (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, nestSites } from "@tidefront/world";
import { chooseBase, register, seed, type Engine } from "../src/index.ts";
import { lockTraders } from "../src/contracts-core.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
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

test("Spielersperre (Handel/Vertrag) hält Nachricht und Mission an denselben Spieler nicht auf", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Sperre", password: "geheim123" });
  const f = freeCoast(5);
  const r = await chooseBase(engine, p.playerId, "lock-1", { ...f, name: "Hafen Sperre", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  let release!: () => void;
  const hold = new Promise<void>((res) => { release = res; });
  let locked!: () => void;
  const isLocked = new Promise<void>((res) => { locked = res; });
  // Transaktion 1 sperrt den Spieler wie ein laufender Handel (lockTraders) und hält die Sperre.
  const holder = db.transaction(async (tx) => {
    await lockTraders(tx, [p.playerId]);
    locked();
    await hold;
  });
  await isLocked;
  try {
    // Transaktion 2: Einfügen mit Fremdschlüssel auf den Spieler – darf nicht warten (lock_timeout 1 s).
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '1000ms'`);
      await tx.insert(tables.message).values({ toPlayerId: p.playerId, fromPlayerId: null, subject: "Test", body: "nicht warten" });
      await tx.insert(tables.mission).values({
        playerId: p.playerId, baseId, type: "test", targetKind: "feld", targetCol: f.col, targetRow: f.row, plan: {}, status: "done", arriveAt: new Date(),
      });
    });
  } finally {
    release();
    await holder;
  }
});

test("keine Spielersperre mehr mit FOR UPDATE im Engine-Code", () => {
  const dir = fileURLToPath(new URL("../src/", import.meta.url));
  const bad: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const text = readFileSync(dir + name, "utf8");
    // Ein Ausdruck: von „.from(tables.player)“ bis zum nächsten Semikolon.
    for (const m of text.matchAll(/\.from\(tables\.player\)[^;]*?;/gs)) if (/\.for\("update"/.test(m[0])) bad.push(name);
    if (/from player where[^`]*for update/i.test(text)) bad.push(name);
  }
  assert.deepEqual(bad, [], "FOR NO KEY UPDATE verwenden (TE-01)");
});
