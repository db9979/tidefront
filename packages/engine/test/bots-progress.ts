// Messlauf KI-Spieler (kein Test, von Hand): drei Bots spielen DAYS Spieltage gegen die echte Engine (verstellte Uhr)
// und je Tag erscheint eine Zeile je Bot: Kommandozentrale, Häfen, Gebäudestufen, gewonnene Überfälle, höchste besiegte
// Neststufe, Patrouillen, Satelliten, Punkte. Die Datenbank wird geleert.
//   TEST_DATABASE_URL=postgres://… DAYS=42 node packages/engine/test/bots-progress.ts
// Vergleich mit der Modellkurve: npm run -s sim (KZ 4 an Tag 14, KZ 6–7 an Tag 21–28, Nest 3/4/5 an Tag 7/14/21).
import { sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { computeStandings, ensureFieldPlanner, ensureStartBots, loadBots, processDue, runOneBot, seed, basesOfPlayer, setIntelFog, type Engine } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL fehlt");
const DAYS = Number(process.env.DAYS ?? 14);
const STEP = 10 * 60000;
const { db, client } = createDb(url, 10);
const engine: Engine = { db, notify: () => {}, log: (m, d) => console.error(m, JSON.stringify(d ?? {})) };
const realNow = Date.now.bind(Date);
await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
await migrateDb(db);
await seed(db, "TEST:100");
await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%'`);
await setIntelFog(db, true);
let fake = process.env.T0 ? Number(process.env.T0) : realNow();
Date.now = () => fake;
const t0 = fake;
await ensureStartBots(engine, fake);
await ensureFieldPlanner(db, fake);
for (let t = t0; t <= t0 + DAYS * 86400000; t += STEP) {
  fake = t;
  while ((await processDue(engine, t, 500)) > 0);
  if ((t - t0) % (6 * 3600000) === 0) await ensureFieldPlanner(db, t);
  for (const b of await loadBots(db)) {
    if ((b.state.nextActAt ?? 0) > t) continue;
    await runOneBot(engine, b, t);
  }
  if ((t - t0) % 86400000 !== 0 || t === t0) continue;
  const day = (t - t0) / 86400000;
  const st = await computeStandings(db, t0, t);
  const out: string[] = [];
  for (const b of await loadBots(db)) {
    const bases = await basesOfPlayer(db, b.id);
    const h = bases.find((x) => x.isHome) ?? bases[0];
    if (!h) { out.push(`${b.profile}: ohne Hafen`); continue; }
    const B = h.state.buildings;
    const lvls = bases.reduce((s, x) => s + Object.values(x.state.buildings).reduce((a, v) => a + v, 0), 0);
    const [nw] = await db.execute<{ mx: number | null; won: number; n: number }>(sql`select max((regexp_match(title, 'Stufe (\\d+)'))[1]::int) filter (where winner = 'attacker') as mx,
      count(*) filter (where winner = 'attacker')::int as won, count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind = 'ueberfall' and nest_id is not null`);
    const [sat] = await db.execute<{ n: number }>(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind = 'satellit' and title like '%gestartet'`);
    const [pat] = await db.execute<{ n: number }>(sql`select count(*)::int as n from command_log where player_id = ${b.id} and key like '%-patrol'`);
    const s = st.find((r) => r.playerId === b.id);
    out.push(`${b.profile.padEnd(10)} KZ ${B.kommandozentrale ?? 0} Häfen ${bases.length} Stufen ${lvls} Werft ${B.werft ?? 0} Rampe ${B.startrampe ?? 0} ` +
      `Nester ${nw.won}/${nw.n} max ${nw.mx ?? 0} Patr ${pat.n} Sat ${sat.n} | Ausbau ${s?.ausbau ?? 0} Militär ${s?.militaer ?? 0} Gesamt ${s?.total ?? 0}`);
  }
  console.log(`Tag ${day}`);
  for (const l of out) console.log("  " + l);
  if (process.env.BOT_DUMP) for (const b of await loadBots(db)) for (const x of await basesOfPlayer(db, b.id)) {
    const r = Object.fromEntries(Object.entries(x.state.resources).map(([k, v]) => [k, Math.round(v)]));
    console.log(`    ${b.profile} ${x.name}: Lager ${JSON.stringify(r)} Bau ${x.state.buildQueue.length} Ausb ${x.state.trainingQueue.length} Einheiten ${JSON.stringify(x.state.units)} weg ${JSON.stringify(x.state.unitsAway ?? {})}`);
  }
}
if (process.env.BOT_LOG) for (const b of await loadBots(db)) console.log(`# ${b.name}:\n# ${(b.state.log ?? []).map((l) => l.text).join("\n# ")}`);
Date.now = realNow;
await client.end();
