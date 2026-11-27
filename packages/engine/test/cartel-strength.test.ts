// Verwaltung: Regler Kartell-Stärke (server_setting cartel_strength) gegen ein echtes PostgreSQL (wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createDb, migrateDb } from "@tidefront/db";
import { composeRaid } from "@tidefront/game-core";
import {
  balance,
  cartelStrength,
  clampCartelStrength,
  scaledRaidBalance,
  setCartelStrength,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 4);

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
});

after(async () => {
  await client.end();
});

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

test("Kartell-Stärke: Vorgabe 100, Speichern mit Grenzen 25–300", async () => {
  assert.equal(await cartelStrength(db), 100);
  assert.deepEqual(await setCartelStrength(db, 150), { ok: true, pct: 150 });
  assert.equal(await cartelStrength(db), 150);
  assert.equal((await setCartelStrength(db, 999)).pct, 300);
  assert.equal((await setCartelStrength(db, 3)).pct, 25);
  assert.equal(clampCartelStrength(Number.NaN), 100);
  await setCartelStrength(db, 100);
});

test("Kartell-Stärke: 100 % lässt die Balance unverändert, sonst wächst der Verband mit dem Regler", () => {
  assert.equal(scaledRaidBalance(balance, 100), balance);
  const units = { schuetzen: 200, korvette: 10 };
  const defenses = {};
  const seed = 12345;
  const n50 = total(composeRaid(units, defenses, scaledRaidBalance(balance, 50), seed).units);
  const n100 = total(composeRaid(units, defenses, balance, seed).units);
  const n200 = total(composeRaid(units, defenses, scaledRaidBalance(balance, 200), seed).units);
  assert.ok(n50 < n100 && n100 < n200, `${n50} < ${n100} < ${n200}`);
  assert.equal(balance.pirates.raidStrengthShareOfDefense, scaledRaidBalance(balance, 200).pirates.raidStrengthShareOfDefense / 2);
});
