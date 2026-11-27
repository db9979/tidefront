// Testlauf KI-Spieler über mehrere Spieltage (TEST_DATABASE_URL; die Datenbank wird geleert): drei Bots spielen mit
// verstellter Uhr (Date.now) gegen die echte Engine – Ereignisse, Kartell-Überfälle, Felder und Befehle wie im Betrieb.
// Erwartung: jeder Bot wächst sinnvoll, der Freibeuter (stark) liegt vor dem Händler (leicht). Zahlen im Testprotokoll.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import {
  computeStandings, ensureFieldPlanner, ensureStartBots, loadBots, processDue, runOneBot, seed, basesOfPlayer, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const DAYS = Number(process.env.BOT_SIM_DAYS ?? 8);
const STEP = 10 * 60000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%'`);
});

after(async () => {
  Date.now = realNow;
  await client.end();
});

test(`Testlauf über ${DAYS} Spieltage: alle Bots wachsen, Freibeuter stärker als Händler`, { timeout: 30 * 60000 }, async () => {
  let fake = realNow();
  Date.now = () => fake;
  const t0 = fake;
  await ensureStartBots(engine, fake);
  await ensureFieldPlanner(db, fake);
  const bots = await loadBots(db);
  const turns = new Map<number, number>(bots.map((b) => [b.id, 0]));
  const turnMs: number[] = [];
  const daily: string[] = [];
  for (let t = t0; t <= t0 + DAYS * 86400000; t += STEP) {
    fake = t;
    while ((await processDue(engine, t, 500)) > 0);
    if ((t - t0) % (6 * 3600000) === 0) await ensureFieldPlanner(db, t);
    for (const b of await loadBots(db)) {
      if ((b.state.nextActAt ?? 0) > t) continue;
      turnMs.push(await runOneBot(engine, b, t));
      turns.set(b.id, (turns.get(b.id) ?? 0) + 1);
    }
    if ((t - t0) % 86400000 === 0 && t > t0) {
      const s = await computeStandings(db, t0, t);
      daily.push(`Tag ${(t - t0) / 86400000}: ` + s.filter((r) => r.bot).map((r) => `${r.name} ${r.total}`).join(", "));
    }
  }
  fake = t0 + DAYS * 86400000;
  const standings = (await computeStandings(db, t0, fake)).filter((r) => r.bot);
  const byProfile = new Map<string, (typeof standings)[number]>();
  const lines: string[] = [];
  const checks: (() => void)[] = [];
  for (const b of await loadBots(db)) {
    const s = standings.find((r) => r.playerId === b.id)!;
    byProfile.set(b.profile, s);
    const bases = await basesOfPlayer(db, b.id);
    const levels = bases.reduce((sum, x) => sum + Object.values(x.state.buildings).reduce((a, v) => a + v, 0), 0);
    const [raids] = await db.execute<{ n: number; won: number }>(sql`select count(*)::int as n, count(*) filter (where winner = 'attacker')::int as won
      from battle_report where attacker_player_id = ${b.id} and kind = 'ueberfall'`);
    const [fields] = await db.execute<{ n: number }>(sql`select count(*)::int as n from resource_field where player_id = ${b.id}`);
    const [trades] = await db.execute<{ n: number }>(sql`select count(*)::int as n from command_log where player_id = ${b.id} and command in ('trade', 'offerCreate', 'offerAccept')`);
    lines.push(`${b.name} (${b.profile}): Züge ${turns.get(b.id)}, Häfen ${bases.length}, Gebäudestufen ${levels}, ` +
      `Punkte ${s.total} (Ausbau ${s.ausbau}, Militär ${s.militaer}, Kampf ${s.kampf}, Beute ${s.beute}), ` +
      `Überfälle ${raids.n} (gewonnen ${raids.won}), Felder ${fields.n}, Handel ${trades.n}`);
    checks.push(() => {
      assert.ok(levels >= 40, `${b.name} baut aus (${levels} Stufen)`);
      assert.ok(s.ausbau > 100, `${b.name} wächst`);
      assert.ok(s.militaer > 10, `${b.name} rüstet`);
    });
    if (process.env.BOT_SIM_LOG) console.log(`# Log ${b.name}:\n# ${(b.state.log ?? []).slice(0, 15).map((l) => l.text).join("\n# ")}`);
  }
  const sorted = [...turnMs].sort((a, b) => a - b);
  console.log(`# ${daily.join("\n# ")}`);
  console.log(`# ${lines.join("\n# ")}`);
  console.log(`# Bot-Zug: ${turnMs.length} Züge, Median ${sorted[Math.floor(sorted.length / 2)]} ms, 95 % ${sorted[Math.floor(sorted.length * 0.95)]} ms, max ${sorted[sorted.length - 1]} ms`);
  for (const c of checks) c();
  assert.ok(byProfile.get("freibeuter")!.total > byProfile.get("haendler")!.total, "Freibeuter stärker als Händler");
});
