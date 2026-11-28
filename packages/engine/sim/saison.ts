// Saisonlauf (Welle 2, Abschlussprüfung 0.38): 42 Spieltage gegen die echte Engine mit den echten Worker-Schritten
// (worker-steps.ts: Wartung alle 10 min mit Ereignissen dazwischen, Minutenschritte, KI-Züge über runBotsDue), drei
// KI-Spieler und passive Menschen. Misst je Tag Weltereignisse, Marktnachrichten, Nachrichten, Kartellverlust in % der
// Tagesproduktion, Punkteanteile je Quelle, Nest-6-Beute nach Laderaum und KI-Kennzahlen; prüft sie mit Wächtern
// (saison-guards.ts). Exit-Code 1, wenn ein Fehler-Wächter anschlägt (mit --strict auch bei Warnungen).
//
// Aufruf: SIM_DATABASE_URL=postgres://… npm run sim:saison [-- --strict]
// ACHTUNG: löscht das Schema der angegebenen Datenbank (nur Wegwerf-Postgres!). Ohne SIM_FORCE=1 nur localhost.
// Optionen (Umgebung): DAYS (42), HUMANS (4 passive Menschen), SEED (Zufall), SIM_OUT (JSON-Bericht in diese Datei).
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, type Db } from "@tidefront/db";
import { mulberry32, productionRates, settle, type BaseState } from "@tidefront/game-core";
import { COLS, ROWS, hexDistanceKm, isCoast, nestSites } from "@tidefront/world";
import {
  AlertMemory, balance, basesOfPlayer, chooseBase, computeStandings, ensureFieldPlanner, ensureStartBots, loadBots, maintenanceSteps,
  minuteSteps, processDue, register, runBotsDue, runStep, runSteps, seed, setIntelFog, StepStats, auditLedger, type Engine,
} from "../src/index.ts";
import { setRandomSeedSource } from "../src/store.ts";
import { EVENT_RANGE_KM } from "../src/bots-world-events.ts";
import { evaluateGuards, exitCode, GUARD_LIMITS, type SeasonMetrics } from "./saison-guards.ts";

const url = process.env.SIM_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("SIM_DATABASE_URL fehlt (Wegwerf-Postgres; das Schema wird gelöscht).");
  process.exit(2);
}
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && process.env.SIM_FORCE !== "1") {
  console.error("Saisonlauf nur gegen localhost (sonst SIM_FORCE=1) – das Schema wird gelöscht.");
  process.exit(2);
}
const DAYS = Number(process.env.DAYS ?? 42);
const HUMANS = Number(process.env.HUMANS ?? 4);
const STRICT = process.argv.includes("--strict");
const STEP = 10 * 60000;
const DAY = 86400000;
const price = (r: string) => balance.market.refPrice[r] ?? 1;
const resValue = (m: Record<string, number> | null | undefined) => Object.entries(m ?? {}).reduce((a, [r, n]) => a + (Number(n) || 0) * price(r), 0);
const unitValue = (id: string) => resValue((balance.units[id] ?? balance.defenses[id])?.cost ?? {});

const { db, client } = createDb(url, 10);
const engine: Engine = { db, notify: () => {}, log: (m, d) => { if (/failed|slow|AUDIT/.test(m)) console.error(m, JSON.stringify(d ?? {}).slice(0, 300)); } };
const realNow = Date.now.bind(Date);
const started = realNow();
let fake = Number(process.env.T0 ?? Date.UTC(2026, 10, 30, 5, 0));
const t0 = fake;
Date.now = () => fake;
setRandomSeedSource(mulberry32(Number(process.env.SEED ?? 4242)));

await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
await migrateDb(db);
await seed(db, "TEST:100");
await setIntelFog(db, true);
await db.execute(sql`update season set starts_at = to_timestamp(${t0 / 1000}), ends_at = to_timestamp(${(t0 + 42 * DAY) / 1000}) where status = 'running'`);
await db.execute(sql`update game_event set due_at = to_timestamp(${(t0 + 42 * DAY) / 1000}) where type = 'season_end' and status = 'pending'`);
const [{ id: seasonId }] = await db.execute<{ id: number }>(sql`select id from season where status = 'running' order by id desc limit 1`);
await ensureStartBots(engine, fake);
await ensureFieldPlanner(db, fake);
const humans = await addHumans(db, HUMANS);

const stats = new StepStats();
const alerts = new AlertMemory();
const maintenance = maintenanceSteps(engine);
const minutely = minuteSteps(engine, alerts);
const due = async () => { let n = 0, k; while ((k = await processDue(engine, fake, 500)) > 0) n += k; return n; };

const perDay: SeasonMetrics["perDay"] = [];
const cartel = new Map<number, number[]>();
const last = { we: 0, news: 0, msg: 0 };
const maxId = async (table: string) => (await db.execute<{ m: number | null }>(sql`select max(id)::int as m from ${sql.raw(table)}`))[0].m ?? 0;
const countAfter = async (table: string, id: number, extra = sql``) => (await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(table)} where id > ${id} ${extra}`))[0].n;
let seasonOver = false;
let botRows = await loadBots(db);
const lastStockHours = new Map<number, number>();
const cartelKinds = new Map<string, number>();
const eventsInRange = new Map<number, Set<number>>(); // v1.35: je KI die Weltereignisse in Reichweite eines eigenen Hafens
let finalBots: SeasonMetrics["bots"] = [];
let finalNest6: SeasonMetrics["nest6"] = [];

for (let t = t0 + STEP; t <= t0 + DAYS * DAY; t += STEP) {
  fake = t;
  await runStep(engine, stats, "events", t, due);
  await runSteps(engine, stats, maintenance, () => fake, due);
  await runSteps(engine, stats, minutely, () => fake);
  for (let i = 0; i < 10; i++) {
    const r = await runStep(engine, stats, "bot turns", t, () => runBotsDue(engine, fake));
    if (!r || r.turns === 0) break;
  }
  if ((t - t0) % DAY !== 0) continue;
  const day = (t - t0) / DAY;
  const running = (await db.execute<{ id: number }>(sql`select id from season where status = 'running' order by id desc limit 1`))[0]?.id;
  if (running !== seasonId) seasonOver = true;
  const we = await countAfter("world_event", last.we, sql`and kind <> 'finale'`);
  const news = await countAfter("market_news", last.news);
  const msg = await countAfter("message", last.msg);
  [last.we, last.news, last.msg] = [await maxId("world_event"), await maxId("market_news"), await maxId("message")];
  const players = botRows.length + humans.length;
  perDay.push({ day, worldEvents: we, newsRows: news, messagesPerPlayer: msg / Math.max(1, players) });
  if (!seasonOver) {
    botRows = await loadBots(db);
    if (day >= 7) for (const b of botRows) cartel.set(b.id, [...(cartel.get(b.id) ?? []), await cartelShare(db, b.id, t)]);
    await trackEventsInRange();
    if (day % 7 === 0 || day === DAYS) await weekly(day, t);
    // Kennzahlen der KI und Nest-6-Beute täglich festhalten: das Saisonende löscht Häfen, Nester und Berichte.
    finalBots = await botMetrics(t);
    finalNest6 = await nest6Loot();
  }
  console.log(`Tag ${day}: Weltereignisse ${we}, Marktnachrichten ${news}, Nachrichten ${msg}${seasonOver ? " (Saison beendet)" : ""} – ${Math.round((realNow() - started) / 1000)} s`);
}

const metrics: SeasonMetrics = {
  days: DAYS,
  perDay,
  failedEvents: (await db.execute<{ n: number }>(sql`select count(*)::int as n from game_event where status = 'failed'`))[0].n,
  auditOk: (await auditLedger(engine)).ok,
  bots: seasonOver ? finalBots : await botMetrics(fake),
  nest6: seasonOver ? finalNest6 : await nest6Loot(),
  stepMax: stats.entries().filter((e) => !["bot turns", "events", "events (between)"].includes(e.step))
    .reduce((acc, e) => { const x = acc.find((a) => a.step === e.step); if (x) x.maxMs = Math.max(x.maxMs, e.maxMs); else acc.push({ step: e.step, maxMs: e.maxMs }); return acc; }, [] as { step: string; maxMs: number }[]),
};
const results = evaluateGuards(metrics);

console.log(`\nSchrittdauer (ms, ${Math.round((realNow() - started) / 1000)} s Laufzeit):`);
const byStep = new Map<string, { runs: number; total: number; max: number }>();
for (const e of stats.entries()) { const s = byStep.get(e.step) ?? { runs: 0, total: 0, max: 0 }; s.runs += e.runs; s.total += e.totalMs; s.max = Math.max(s.max, e.maxMs); byStep.set(e.step, s); }
for (const [step, s] of [...byStep].sort((a, b) => b[1].total - a[1].total)) console.log(`  ${step.padEnd(22)} n ${String(s.runs).padStart(6)}  Ø ${(s.total / s.runs).toFixed(1).padStart(7)}  max ${s.max.toFixed(0).padStart(6)}  Summe ${(s.total / 1000).toFixed(1)} s`);
console.log(`\nKartellverlust der KI nach Berichtsart (Richtwert, ab Tag 7): ${[...cartelKinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")}`);
console.log(`\nWächter (Grenzen in saison-guards.ts):`);
for (const r of results) console.log(`  ${r.ok ? "ok     " : r.level === "fehler" ? "FEHLER " : "WARNUNG"} ${r.text}`);
if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, JSON.stringify({ limits: GUARD_LIMITS, metrics, results }, null, 1));
Date.now = realNow;
setRandomSeedSource(null);
await client.end();
process.exit(exitCode(results, STRICT));

// ---------------------------------------------------------------- Hilfen

/** Passive Menschen an freien Küstenfeldern (bauen nichts; Ziel für Kartell und KI). */
async function addHumans(d: Db, n: number): Promise<number[]> {
  const out: number[] = [];
  const nests = new Set(nestSites().map((x) => `${x.col},${x.row}`));
  const taken = new Set((await d.execute<{ col: number; row: number }>(sql`select col, row from base`)).map((b) => `${b.col},${b.row}`));
  for (let row = 12; row < ROWS - 8 && out.length < n; row += 7) for (let col = 10; col < COLS - 8 && out.length < n; col += 9) {
    if (!isCoast(col, row) || nests.has(`${col},${row}`) || taken.has(`${col},${row}`)) continue;
    const p = await register(d, { inviteCode: "TEST", name: `Mensch${out.length + 1}`, password: "geheim123" });
    if (!("playerId" in p)) continue;
    const r = await chooseBase(engine, p.playerId, `sim-base-${out.length}`, { col, row, name: `Hafen M${out.length + 1}`, nightShieldStartHour: null, tzOffsetMinutes: 60, timeZone: "Europe/Berlin" });
    if (!r.ok) continue;
    out.push(p.playerId);
    taken.add(`${col},${row}`);
  }
  return out;
}

/** Gewöhnliche Weltereignisse, die in Reichweite (EVENT_RANGE_KM) eines Hafens der KI liegen, je KI sammeln. */
async function trackEventsInRange(): Promise<void> {
  const evs = await db.execute<{ id: number; col: number; row: number }>(sql`select id, col, row from world_event where kind <> 'finale'`);
  for (const b of botRows) {
    const set = eventsInRange.get(b.id) ?? new Set<number>();
    const bases = await basesOfPlayer(db, b.id);
    for (const e of evs) if (bases.some((x) => hexDistanceKm(x, e) <= EVENT_RANGE_KM)) set.add(e.id);
    eventsInRange.set(b.id, set);
  }
}

/** Kartellverlust des Spielers am Saisontag bis t (Beute + bleibende Einheitenverluste) in Anteilen der Tagesproduktion. */
async function cartelShare(d: Db, playerId: number, t: number): Promise<number> {
  const reps = await d.execute<{ kind: string; report: { battle?: { loot?: Record<string, number>; defender?: { losses?: Record<string, number>; returned?: Record<string, number> } } } }>(sql`
    select kind, report from battle_report where attacker_player_id is null and defender_player_id = ${playerId}
      and created_at > to_timestamp(${(t - DAY) / 1000}) and created_at <= to_timestamp(${t / 1000}) and report ? 'battle'`);
  let loss = 0;
  for (const { kind, report } of reps) {
    const b = report.battle ?? {};
    let one = resValue(b.loot);
    for (const [id, n] of Object.entries(b.defender?.losses ?? {})) one += Math.max(0, n - (b.defender?.returned?.[id] ?? 0)) * unitValue(id);
    loss += one;
    cartelKinds.set(kind, (cartelKinds.get(kind) ?? 0) + one); // v1.35: Aufschlüsselung nach Berichtsart (Hafen, Feld, Konvoi, Weltereignis)
  }
  const rows = await d.execute<{ per_hour: Record<string, number> }>(sql`
    select per_hour from base_day where player_id = ${playerId} and day = (select max(day) from base_day where player_id = ${playerId})`);
  const prod = rows.reduce((a, r) => a + resValue(r.per_hour), 0) * 24;
  return prod > 0 ? loss / prod : 0;
}

async function botMetrics(t: number): Promise<SeasonMetrics["bots"]> {
  const st = await computeStandings(db, t0, t);
  const out: SeasonMetrics["bots"] = [];
  for (const b of botRows) {
    const s = st.find((x) => x.playerId === b.id);
    const q = async (x: ReturnType<typeof sql>) => (await db.execute<{ n: number | null }>(x))[0].n;
    out.push({
      profile: b.profile,
      cartelShareByDay: cartel.get(b.id) ?? [],
      points: { ausbau: s?.ausbau ?? 0, militaer: s?.militaer ?? 0, kampf: s?.kampf ?? 0, beute: s?.beute ?? 0, befehle: s?.befehle ?? 0, total: s?.total ?? 0 },
      trades: (await q(sql`select count(*)::int as n from command_log where player_id = ${b.id} and command = 'trade' and response->>'ok' = 'true'`)) ?? 0,
      stockHours: lastStockHours.get(b.id) ?? 0,
      nest4Day: await q(sql`select floor(extract(epoch from min(br.created_at) - to_timestamp(${t0 / 1000})) / 86400)::int + 1 as n
        from battle_report br join nest n on n.id = br.nest_id where br.attacker_player_id = ${b.id} and br.winner = 'attacker' and n.level >= 4`),
      worldEventAttacks: (await q(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind in ('weltereignis', 'weltereignis_leer') and title not like '%Armada%'`)) ?? 0,
      worldEventsInRange: eventsInRange.get(b.id)?.size ?? 0,
    });
  }
  return out;
}

async function nest6Loot(): Promise<SeasonMetrics["nest6"]> {
  const rows = await db.execute<{ at: string | Date; report: { nest?: { level?: number; garrison?: { loot?: Record<string, number> } | null }; battle?: { loot?: Record<string, number> } } }>(sql`
    select created_at as at, report from battle_report where winner = 'attacker' and attacker_player_id is not null and (report->'nest'->>'level')::int = 6`);
  const sum = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);
  return rows.map((r) => ({ offered: sum(r.report.nest?.garrison?.loot), taken: sum(r.report.battle?.loot), day: Math.floor((new Date(r.at).getTime() - t0) / DAY) + 1 }));
}


/** Wochenzeile je KI-Spieler (wie bots-progress.ts) und Lager in Stunden Produktion. */
async function weekly(day: number, t: number): Promise<void> {
  const st = await computeStandings(db, t0, t);
  console.log(`  Woche bis Tag ${day}:`);
  for (const b of botRows) {
    const bases = await basesOfPlayer(db, b.id);
    let stockV = 0, rateV = 0;
    for (const x of bases) {
      const s = settle(x.state as BaseState, t, balance);
      const pr = productionRates(s, balance, undefined, t);
      stockV += resValue(s.resources);
      for (const r of balance.resources) rateV += Math.max(0, pr.perHour[r] ?? 0) * price(r);
    }
    lastStockHours.set(b.id, stockV / Math.max(1, rateV));
    const h = bases.find((x) => x.isHome) ?? bases[0];
    const q = async (x: ReturnType<typeof sql>) => (await db.execute<{ n: number | null }>(x))[0].n ?? 0;
    const trades = await q(sql`select count(*)::int as n from command_log where player_id = ${b.id} and command = 'trade' and response->>'ok' = 'true'`);
    const claims = await q(sql`select count(*)::int as n from command_log where player_id = ${b.id} and command in ('dailyClaim', 'weeklyClaim') and response->>'ok' = 'true'`);
    const [nw] = await db.execute<{ mx: number | null; won: number; n: number }>(sql`
      select max(n.level) filter (where br.winner = 'attacker') as mx, count(*) filter (where br.winner = 'attacker')::int as won, count(*)::int as n
      from battle_report br join nest n on n.id = br.nest_id where br.attacker_player_id = ${b.id} and br.kind = 'ueberfall'`);
    const leer = await q(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind = 'leer'`);
    const we = await q(sql`select count(*)::int as n from battle_report where attacker_player_id = ${b.id} and kind in ('weltereignis', 'weltereignis_leer') and title not like '%Armada%'`);
    const troops = Object.entries(h?.state.units ?? {}).filter(([id]) => balance.units[id]?.branch === "land").reduce((a, [, n]) => a + n, 0);
    const s = st.find((r) => r.playerId === b.id);
    const c = cartel.get(b.id) ?? [];
    console.log(`    ${b.profile.padEnd(10)} KZ ${h?.state.buildings.kommandozentrale ?? 0} Häfen ${bases.length} Börse ${trades} Abholungen ${claims} Nester ${nw.won}/${nw.n} max ${nw.mx ?? 0} leer ${leer} WE ${we} Lager ${Math.round(stockV / Math.max(1, rateV))} h Truppen daheim ${troops} Kartell Ø ${c.length ? Math.round((c.reduce((a, x) => a + x, 0) / c.length) * 100) : 0} % | Ausbau ${s?.ausbau} Militär ${s?.militaer} Kampf ${s?.kampf} Beute ${s?.beute} Befehle ${s?.befehle} = ${s?.total}`);
  }
}
