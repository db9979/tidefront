// Regression Hotfix 0.38.1 (ST-01/AN-01): Weltereignis-Flut. Eine ganze Saison mit simulierten 10-Minuten-Wartungsläufen
// (processDue + ensureWorldEventPlanner wie im Worker), mit und ohne Saisonfinale. Vorher entstand nach einem Spawn ohne
// Nachfolger (Termin hinter der Finale-Ankündigung bzw. Saisonende − 36 h, auch im Retry-Pfad) bei jedem Lauf sofort ein
// neues Ereignis (25–91 an einem Tag). Echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, nestSites } from "@tidefront/world";
import { finaleBalance, finaleOrdinaryUntil, finaleSchedule, mulberry32, worldEventsBalance, WORLD_EVENT_KINDS, type BaseState } from "@tidefront/game-core";
import { balance, chooseBase, ensureWorldEventPlanner, processDue, register, runningSeason, seed, spawnWorldEvent, type Engine } from "../src/index.ts";
import { setRandomSeedSource } from "../src/store.ts";

const url = process.env.TEST_DATABASE_URL;
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const w = () => worldEventsBalance(balance);
let keyN = 0;
const key = () => `wes${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

/** Vier Spieler ohne Anfängerschutz (gültige Ziele für alle drei Arten). */
async function players(prefix: string, firstField: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = await register(db, { inviteCode: "TEST", name: `${prefix}${i}`, password: "geheim123" });
    const f = freeCoast(firstField + i * 7);
    const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${prefix}${i}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const baseId = (r as { baseId: number }).baseId;
    const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
    const s = b.state as BaseState;
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
    ids.push(baseId);
  }
  return ids;
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

/** Saison im 10-Minuten-Takt bis kurz vor Saisonende; Rückgabe: gewöhnliche Ereignisse der Saison und größte Gleichzeitigkeit. */
async function simulateSeason() {
  const season = (await runningSeason(db))!;
  const start = season.startsAt.getTime();
  const end = season.endsAt.getTime();
  let maxOpen = 0;
  for (let t = start; t < end - 10 * MIN; t += 10 * MIN) {
    // Kartell-Überfälle auf die Häfen gehören nicht zu dieser Prüfung (und kosten nur Laufzeit).
    await db.delete(tables.gameEvent).where(and(eq(tables.gameEvent.type, "raid_launch"), eq(tables.gameEvent.status, "pending")));
    await runUntil(t);
    await ensureWorldEventPlanner(db, t);
    const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.worldEvent)
      .where(and(inArray(tables.worldEvent.status, ["announced", "active"]), sql`${tables.worldEvent.kind} <> 'finale'`));
    maxOpen = Math.max(maxOpen, o.n);
  }
  const events = await db.select().from(tables.worldEvent)
    .where(and(eq(tables.worldEvent.seasonId, season.id), inArray(tables.worldEvent.kind, [...WORLD_EVENT_KINDS])))
    .orderBy(asc(tables.worldEvent.startsAt));
  return { season, start, end, maxOpen, starts: events.map((e) => e.startsAt.getTime()) };
}

function checkSpacing(starts: number[], start: number, label: string) {
  const perDay = new Map<number, number>();
  for (const s of starts) perDay.set(Math.floor((s - start) / DAY), (perDay.get(Math.floor((s - start) / DAY)) ?? 0) + 1);
  const worst = Math.max(0, ...perDay.values());
  assert.ok(worst <= 1, `${label}: höchstens ein Ereignis je Tag, war ${worst} (${JSON.stringify([...perDay])})`);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= w().spawnIntervalHours[0] * HOUR - MIN, `${label}: Abstand ${(gap / HOUR).toFixed(1)} h < ${w().spawnIntervalHours[0]} h`);
  }
  assert.ok(starts.length >= 4, `${label}: Ereignisse entstehen weiterhin (${starts.length})`);
}

const finaleBlock = finaleBalance(balance);

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  setRandomSeedSource(mulberry32(380001)); // deterministisch (TE-02)
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  setRandomSeedSource(null);
  if (finaleBlock) (worldEventsBalance(balance) as { finale?: unknown }).finale = finaleBlock;
  await client.end();
});

test("Deckel maxConcurrent: bei vollen Ereignissen kein weiteres, neuer Versuch nach retryHours", async () => {
  const season = (await runningSeason(db))!;
  const bases = await players("Deckel", 400);
  const max = w().maxConcurrent!;
  assert.ok(max >= 1);
  const now = Date.now();
  for (let i = 0; i < max; i++) {
    const r = await db.transaction((tx) => spawnWorldEvent(tx, now, "belagerung", season.id, 0, bases[i]));
    assert.ok(r, "Ereignis angelegt");
  }
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "world_event_spawn"));
  await db.insert(tables.gameEvent).values({ type: "world_event_spawn", dueAt: new Date(now), payload: { seasonId: season.id, kind: "belagerung" }, baseId: null });
  await processDue(engine, now + 1000, 1);
  const open = await db.select().from(tables.worldEvent).where(inArray(tables.worldEvent.status, ["announced", "active"]));
  assert.equal(open.length, max, "kein weiteres Ereignis über dem Deckel");
  const [next] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "world_event_spawn"), eq(tables.gameEvent.status, "pending")));
  assert.ok(next && Math.abs(next.dueAt.getTime() - now - w().retryHours * HOUR) < MIN, "Retry geplant");
  // Aufräumen für die Saisonläufe: Saison beenden, neue beginnt jetzt.
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await runUntil(Date.now());
});

test("Ganze Saison ohne Saisonfinale: höchstens ein Ereignis je 48 h, keines in den letzten 36 h", async () => {
  delete (worldEventsBalance(balance) as { finale?: unknown }).finale;
  try {
    await players("Ohne", 0);
    const r = await simulateSeason();
    checkSpacing(r.starts, r.start, "ohne Finale");
    assert.ok(r.maxOpen <= w().maxConcurrent!, `gleichzeitig ${r.maxOpen}`);
    for (const s of r.starts) assert.ok(s <= r.end - w().minSeasonHoursLeft * HOUR, "kein Ereignis kurz vor Saisonende");
  } finally {
    if (finaleBlock) (worldEventsBalance(balance) as { finale?: unknown }).finale = finaleBlock;
  }
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await runUntil(Date.now());
});

test("Ganze Saison mit Saisonfinale: keine Flut vor dem Ende der gewöhnlichen Ereignisse, danach keins (v1.35: bis 37,5)", { skip: !finaleBlock }, async () => {
  await players("Mit", 200);
  const r = await simulateSeason();
  checkSpacing(r.starts, r.start, "mit Finale");
  assert.ok(r.maxOpen <= w().maxConcurrent!, `gleichzeitig ${r.maxOpen}`);
  // v1.35 (Nutzerentscheid 9C): gewöhnliche Ereignisse bis ordinaryEventsUntilDays (37,5 = Erscheinen), nicht mehr ab der Ankündigung.
  const until = finaleOrdinaryUntil(r.start, r.end, balance);
  assert.ok(until > finaleSchedule(r.start, r.end, balance).announceMs);
  for (const s of r.starts) assert.ok(s < until, "nach dem Ende der gewöhnlichen Ereignisse kein neues");
  const [fin] = await db.select().from(tables.worldEvent).where(and(eq(tables.worldEvent.kind, "finale"), eq(tables.worldEvent.seasonId, r.season.id)));
  assert.ok(fin, "Saisonfinale angekündigt");
});
