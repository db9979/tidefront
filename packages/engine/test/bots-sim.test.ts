// Testlauf KI-Spieler über mehrere Spieltage (TEST_DATABASE_URL; die Datenbank wird geleert): drei Bots spielen mit
// verstellter Uhr (Date.now) gegen die echte Engine – Ereignisse, Kartell-Überfälle, Felder und Befehle wie im Betrieb.
// Erwartung: jeder Bot wächst sinnvoll, der Freibeuter (stark) liegt vor dem Händler (leicht) und gewinnt Überfälle;
// mit Kartennebel klären Festung und Freibeuter Nester auf und die Bots befassen sich mit Feldern (Aufklärung, Kampf
// oder Besitz). Die Bedingungen prüfen das Verhalten, nicht zufällige Ergebnisse einzelner Kämpfe (früher: „hält ein
// Feld“ – schlug sporadisch fehl). Zahlen im Testprotokoll (Felder je Tag; BOT_SIM_SHIPS=1: Schiffe und gemerktes Feldziel).
// Feste Startzeit (BOT_SIM_T0, Vorgabe unten): Tageszeit und Zufall der Bots hängen an der Uhr, so ist der Lauf
// wiederholbar. Die Schwellen sind mit Abstand gewählt und wurden mit acht Startzeiten geprüft (Messlauf über 42 Tage:
// test/bots-progress.ts). Früher fiel die Festung bei manchen Startzeiten auf 20 Gebäudestufen an Tag 8 (Strom-Sperre).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import {
  computeStandings, ensureFieldPlanner, ensureStartBots, loadBots, processDue, runOneBot, seed, basesOfPlayer, setIntelFog, type Engine,
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
  // Lagebild: Vorgabe an; BOT_SIM_FOG=0 rechnet zum Vergleich ohne Kartennebel (wie bis 0.17).
  await setIntelFog(db, process.env.BOT_SIM_FOG !== "0");
});

after(async () => {
  Date.now = realNow;
  await client.end();
});

test(`Testlauf über ${DAYS} Spieltage: alle Bots wachsen, Freibeuter stärker als Händler`, { timeout: 30 * 60000 }, async () => {
  let fake = Number(process.env.BOT_SIM_T0 ?? 1795000000000);
  Date.now = () => fake;
  const t0 = fake;
  await ensureStartBots(engine, fake);
  await ensureFieldPlanner(db, fake);
  const bots = await loadBots(db);
  // Lagebild Stufe 3 (BOT_SIM_SPACE=1): Freibeuter und Festung mit Startrampe und Raumfahrt (sonst erst ab etwa Tag 28).
  if (process.env.BOT_SIM_SPACE) {
    for (const b of bots.filter((x) => x.profile !== "haendler")) {
      for (const base of (await basesOfPlayer(db, b.id)).filter((x) => x.isHome)) {
        const s = base.state;
        Object.assign(s.buildings, { kommandozentrale: Math.max(8, s.buildings.kommandozentrale ?? 0), forschungsamt: 5, radarstation: 6, startrampe: 1 });
        s.research = { ...(s.research ?? { order: null }), levels: { ...(s.research?.levels ?? {}), optischer_satellit: 1 } };
        for (const r of Object.keys(s.resources)) s.resources[r] = Math.max(s.resources[r], 20000);
        await db.update(tables.base).set({ state: s }).where(sql`id = ${base.id}`);
      }
    }
  }
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
      const fieldRows = await db.execute<{ player_id: number; n: number }>(sql`select player_id, count(*)::int as n from resource_field where player_id is not null group by player_id`);
      const fieldsOf = (id: number) => fieldRows.find((x) => x.player_id === id)?.n ?? 0;
      daily.push(`Tag ${(t - t0) / 86400000}: ` + s.filter((r) => r.bot).map((r) => `${r.name} ${r.total} (Felder ${fieldsOf(r.playerId)})`).join(", "));
      if (process.env.BOT_SIM_SHIPS) {
        for (const b of await loadBots(db)) {
          const ships = (await basesOfPlayer(db, b.id)).map((x) => JSON.stringify({ home: x.state.units, away: x.state.unitsAway }));
          daily.push(`  ${b.name}: ${ships.join(" | ")} Ziel ${JSON.stringify(b.state.fieldTarget ?? null)}`);
        }
      }
    }
  }
  fake = t0 + DAYS * 86400000;
  const standings = (await computeStandings(db, t0, fake)).filter((r) => r.bot);
  const byProfile = new Map<string, (typeof standings)[number]>();
  const lines: string[] = [];
  const fieldsHeld = new Map<string, number>();
  const raidsWon = new Map<string, number>();
  const nestScouts = new Map<string, number>();
  const satsLaunched = new Map<string, number>();
  let fieldActivity = 0;
  const checks: (() => void)[] = [];
  for (const b of await loadBots(db)) {
    const s = standings.find((r) => r.playerId === b.id)!;
    byProfile.set(b.profile, s);
    const bases = await basesOfPlayer(db, b.id);
    const levels = bases.reduce((sum, x) => sum + Object.values(x.state.buildings).reduce((a, v) => a + v, 0), 0);
    const [raids] = await db.execute<{ n: number; won: number }>(sql`select count(*)::int as n, count(*) filter (where winner = 'attacker')::int as won
      from battle_report where attacker_player_id = ${b.id} and kind = 'ueberfall'`);
    const [fields] = await db.execute<{ n: number }>(sql`select count(*)::int as n from resource_field where player_id = ${b.id}`);
    const [taken] = await db.execute<{ n: number }>(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind = 'feld' and winner = 'attacker'`);
    fieldsHeld.set(b.profile, fields.n);
    raidsWon.set(b.profile, raids.won);
    const [trades] = await db.execute<{ n: number }>(sql`select count(*)::int as n from command_log where player_id = ${b.id} and command in ('trade', 'offerCreate', 'offerAccept')`);
    const [scouts] = await db.execute<{ n: number; nest: number; field: number }>(sql`select count(*)::int as n, count(*) filter (where nest_id is not null)::int as nest,
      count(*) filter (where report ? 'field')::int as field from battle_report where attacker_player_id = ${b.id} and kind = 'aufklaerung'`);
    nestScouts.set(b.profile, scouts.nest);
    const [sats] = await db.execute<{ n: number }>(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind = 'satellit' and title like '%gestartet'`);
    satsLaunched.set(b.profile, sats.n);
    fieldActivity += fields.n + taken.n + scouts.field;
    lines.push(`${b.name} (${b.profile}): Züge ${turns.get(b.id)}, Häfen ${bases.length}, Gebäudestufen ${levels}, ` +
      `Punkte ${s.total} (Ausbau ${s.ausbau}, Militär ${s.militaer}, Kampf ${s.kampf}, Beute ${s.beute}), ` +
      `Überfälle ${raids.n} (gewonnen ${raids.won}), Felder ${fields.n} (Feldkämpfe gewonnen ${taken.n}), Handel ${trades.n}, ` +
      `Aufklärungen ${scouts.n} (Nester ${scouts.nest}, Felder ${scouts.field}), Satelliten ${sats.n}`);
    // BOT_SIM_SPACE: künstlicher Start mit Startrampe und Vorräten; die Wachstumsschwellen gelten für den normalen Start.
    if (!process.env.BOT_SIM_SPACE) checks.push(() => {
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
  assert.ok((raidsWon.get("freibeuter") ?? 0) >= 1, "Freibeuter gewinnt Überfälle");
  assert.ok((raidsWon.get("freibeuter") ?? 0) > (raidsWon.get("haendler") ?? 0), "Freibeuter gewinnt mehr Überfälle als der Händler");
  // Felder (M.10): Bots befassen sich mit Feldern – aufklären, angreifen oder halten (unabhängig vom Kampfglück).
  // Lagebild Stufe 3 (BOT_SIM_SPACE=1): Satelliten liefern das Lagebild – Aufklärungsfahrten werden dann seltener.
  if (process.env.BOT_SIM_SPACE) assert.ok((satsLaunched.get("freibeuter") ?? 0) >= 1, "Freibeuter startet einen Satelliten");
  else if (process.env.BOT_SIM_FOG !== "0") {
    assert.ok(fieldActivity >= 1, "Bots klären Felder auf oder nehmen sie");
    // Lagebild Stufe 2: ohne Aufklärung sähen Festung und Freibeuter keine Nester (früher: Festung 0 Überfälle).
    assert.ok((nestScouts.get("festung") ?? 0) >= 1, "Festung klärt Nester auf");
    assert.ok((nestScouts.get("freibeuter") ?? 0) >= 1, "Freibeuter klärt Nester auf");
  }
});
