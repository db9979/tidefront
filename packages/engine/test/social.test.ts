// Integrationstests Rangliste, Nachrichten und Saisonende gegen ein echtes PostgreSQL (wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  auditLedger,
  balance,
  buildingValue,
  chooseBase,
  clearRankingCache,
  computeStandings,
  ensureSeason,
  GameError,
  hallOfFame,
  inbox,
  launchMission,
  markRead,
  processDue,
  rankingView,
  register,
  runningSeason,
  seasonEnd,
  seasonView,
  seed,
  sendMessage,
  sentMessages,
  trade,
  unreadCount,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const notes: [number[] | null, string][] = [];
const engine: Engine = { db, notify: (ids, kind) => notes.push([ids, kind]), log: () => {} };
let keyN = 0;
const key = () => `s${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newPlayer(name: string, field: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, ...f };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function addReport(v: { attacker: number | null; defender: number | null; kind?: string; battle?: unknown; atMs?: number }) {
  await db.insert(tables.battleReport).values({
    kind: v.kind ?? "ueberfall", title: "Test", attackerPlayerId: v.attacker, defenderPlayerId: v.defender,
    winner: "attacker", balanceVersion: "v1", report: v.battle === undefined ? { scout: {} } : { battle: v.battle },
    createdAt: new Date(v.atMs ?? Date.now()),
  });
}

const battle = (al: Record<string, number>, dl: Record<string, number>, loot: Record<string, number>) => ({
  attacker: { losses: al }, defender: { losses: dl }, loot,
});

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Arne", 3);
  B = await newPlayer("Bea", 9);
});

after(async () => {
  await client.end();
});

test("migrate legt genau eine laufende Saison an und plant ihr Ende", async () => {
  const s = await runningSeason(db);
  assert.ok(s);
  assert.equal(s.number, 1);
  assert.equal(s.endsAt.getTime() - s.startsAt.getTime(), 28 * 86400000);
  const again = await ensureSeason(db, Date.now());
  assert.equal(again.id, s.id);
  const ev = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.type, "season_end"));
  assert.equal(ev.length, 1);
  assert.equal(Number((ev[0].payload as { seasonId: number }).seasonId), s.id);
});

test("Rangliste: Punkte je Kategorie nach Formel", async () => {
  const season = (await runningSeason(db))!;
  await patchBase(A.baseId, (s) => {
    s.buildings = { stahlwerk: 2 };
    s.units = { korvette: 2 };
    s.unitsAway = {};
    s.defenses = {};
  });
  await patchBase(B.baseId, (s) => {
    s.buildings = {};
    s.units = {};
    s.defenses = { bunkerlinie: 1 };
  });
  // A überfällt B: B verliert Korvette und Küstenbatterie (550 + 600), A verliert 10 Schützen (500), Beute 1550.
  await addReport({ attacker: A.playerId, defender: B.playerId, battle: battle({ schuetzen: 10 }, { korvette: 1, kuestenbatterie: 1 }, { stahl: 1000, treibstoff: 550 }) });
  // A gegen ein Nest: 4 Schnellboote (je 250) und 10 Milizionäre (je 40) = 1400, Beute 900.
  await addReport({ attacker: A.playerId, defender: null, battle: battle({}, { schnellboot: 4, piratenmiliz: 10 }, { stahl: 900 }) });
  // Kartell gegen B: B vernichtet 2 Schnellboote (500), das Kartell erbeutet etwas (zählt für niemanden).
  await addReport({ kind: "kartell", attacker: null, defender: B.playerId, battle: battle({ schnellboot: 2 }, {}, { stahl: 5000 }) });
  // Zählen nicht: Aufklärung und ein Bericht vor Saisonbeginn.
  await addReport({ kind: "aufklaerung", attacker: A.playerId, defender: null });
  await addReport({ attacker: A.playerId, defender: B.playerId, atMs: season.startsAt.getTime() - 1000, battle: battle({}, { zerstoerer: 10 }, { stahl: 99999 }) });

  const rows = await computeStandings(db, season.startsAt.getTime(), Date.now());
  const a = rows.find((r) => r.playerId === A.playerId)!;
  const b = rows.find((r) => r.playerId === B.playerId)!;
  assert.equal(buildingValue({ stahlwerk: 2 }), 150 + 225);
  assert.deepEqual({ ausbau: a.ausbau, militaer: a.militaer, kampf: a.kampf, beute: a.beute, total: a.total },
    { ausbau: 3, militaer: 11, kampf: 25, beute: 24, total: 63 });
  assert.deepEqual({ ausbau: b.ausbau, militaer: b.militaer, kampf: b.kampf, beute: b.beute, total: b.total },
    { ausbau: 0, militaer: 4, kampf: 10, beute: 0, total: 14 });
  assert.equal(a.rank, 1);
  assert.equal(b.rank, 2);
  assert.equal(a.base?.name, "Hafen Arne");
  assert.equal(a.base?.protection, "anfaengerschutz");

  // Unterwegs zählt mit: Korvette auf Mission bleibt im Militärwert.
  await patchBase(A.baseId, (s) => { s.resources.treibstoff = 50000; s.buildings.hafenkommandantur = 2; });
  const nest = nestSites()[0];
  const m = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  clearRankingCache();
  const view = await rankingView(engine, A.playerId);
  const a2 = view.rows.find((r) => r.playerId === A.playerId)!;
  assert.equal(a2.militaer, 11);
  assert.equal(a2.own, true);
  assert.equal(view.season?.number, 1);
});

test("Nachrichten: senden, Posteingang, Gesendet, gelesen, Zähler, Systemnachricht", async () => {
  notes.length = 0;
  const r = await sendMessage(engine, A.playerId, { toPlayerId: B.playerId, subject: " Handel? ", body: "Stahl gegen Proviant?" });
  assert.equal(r.ok, true);
  assert.ok(notes.some(([ids, k]) => k === "messages" && ids?.[0] === B.playerId));
  assert.equal(await unreadCount(engine, B.playerId), 1);
  const inB = await inbox(engine, B.playerId);
  assert.equal(inB[0].subject, "Handel?");
  assert.equal(inB[0].other?.name, "Arne");
  assert.equal(inB[0].read, false);
  const outA = await sentMessages(engine, A.playerId);
  assert.equal(outA[0].other?.name, "Bea");
  // Fremde Nachricht lässt sich nicht als gelesen markieren.
  assert.equal((await markRead(engine, A.playerId, inB[0].id)).changed, false);
  assert.equal((await markRead(engine, B.playerId, inB[0].id)).changed, true);
  assert.equal((await markRead(engine, B.playerId, inB[0].id)).changed, false);
  assert.equal(await unreadCount(engine, B.playerId), 0);
  assert.equal((await sentMessages(engine, A.playerId))[0].read, true);
  await assert.rejects(sendMessage(engine, A.playerId, { toPlayerId: A.playerId, body: "selbst" }), (e: GameError) => e.code === "self");
  await assert.rejects(sendMessage(engine, A.playerId, { toPlayerId: 999999, body: "x" }), (e: GameError) => e.code === "no_recipient");
  await assert.rejects(sendMessage(engine, A.playerId, { toPlayerId: B.playerId, body: "   " }), (e: GameError) => e.code === "empty");
  await sendMessage(engine, null, { toPlayerId: B.playerId, body: "Systemhinweis" });
  const sys = (await inbox(engine, B.playerId))[0];
  assert.equal(sys.other, null);
  assert.equal(await unreadCount(engine, B.playerId), 1);
  const long = await sendMessage(engine, A.playerId, { toPlayerId: B.playerId, body: "x".repeat(2500) });
  const [row] = await db.select().from(tables.message).where(eq(tables.message.id, long.id));
  assert.equal(row.body.length, 2000);
});

test("Saisonende: Endstand, Auszeichnungen, Nachrichten, Reset, Prüflauf ok, idempotent", async () => {
  const season = (await runningSeason(db))!;
  // Börse: Verkauf (Kredite) und Kauf (Lieferung unterwegs), damit das Journal offene Salden hat.
  await patchBase(B.baseId, (s) => { s.buildings.hafenkommandantur = 3; s.buildings.kommandozentrale = 1; s.resources.stahl = 5000; });
  const sold = await trade(engine, B.playerId, key(), { side: "sell", resource: "stahl", qty: 500, expectedPrice: 0.99875 });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const bought = await trade(engine, B.playerId, key(), { side: "buy", resource: "proviant", qty: 200, expectedPrice: 0.6003 });
  assert.equal(bought.ok, true, JSON.stringify(bought));
  await db.update(tables.nest).set({ defeatedAt: new Date() }).where(eq(tables.nest.id, 1));
  await db.insert(tables.wreck).values({ col: 1, row: 1, stahl: 10, elektronik: 1, createdAt: new Date() });
  assert.equal((await auditLedger(engine)).ok, true);

  // Saisonende auf jetzt vorziehen und verarbeiten.
  const due = Date.now() - 1000;
  await db.update(tables.gameEvent).set({ dueAt: new Date(due) }).where(eq(tables.gameEvent.type, "season_end"));
  notes.length = 0;
  await processDue(engine, Date.now());
  const [ev] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'season_end' and ${tables.gameEvent.payload}->>'seasonId' = ${String(season.id)}`);
  assert.equal(ev.status, "done", ev.lastError ?? "");
  assert.ok(notes.some(([ids, k]) => ids === null && k === "season"));

  // Endstand und Auszeichnungen
  const results = await db.select().from(tables.seasonResult).where(eq(tables.seasonResult.seasonId, season.id)).orderBy(tables.seasonResult.rank);
  assert.equal(results.length, 2);
  assert.equal(results[0].playerName, "Arne");
  assert.equal(results[0].rank, 1);
  assert.ok((results[0].awards as string[]).includes("gold"));
  assert.ok((results[0].awards as string[]).includes("best_kampf"));
  assert.ok((results[0].awards as string[]).includes("best_beute"));
  assert.ok((results[1].awards as string[]).includes("silber"));

  // Systemnachricht mit Platz
  const msgs = await inbox(engine, B.playerId);
  const end = msgs.find((m) => m.subject === `Saison ${season.number}: Endstand`);
  assert.ok(end && end.other === null);
  assert.match(end.body, /Dein Platz: 2 von 2/);

  // Reset der Welt
  const count = async (table: string) => Number((await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`)))[0].n);
  assert.equal(await count("base"), 0);
  assert.equal(await count("mission"), 0);
  assert.equal(await count("delivery"), 0);
  assert.equal(await count("wreck"), 0);
  assert.equal(await count("battle_report"), 0);
  assert.equal(await count("command_log"), 0);
  assert.equal(await count("nest where defeated_at is not null"), 0);
  assert.equal(await count("player"), 2);
  assert.ok((await count("message")) >= 5);
  const pending = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.status, "pending"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, "season_end");
  const players = await db.select().from(tables.player);
  for (const p of players) assert.equal((p.trader as { credits: number }).credits, 0);
  const markets = await db.select().from(tables.market);
  for (const m of markets) assert.equal((m.state as { price: number }).price, balance.market.refPrice[m.resource]);
  const audit = await auditLedger(engine);
  assert.equal(audit.ok, true, JSON.stringify(audit));
  const ledger = await db.execute<{ n: number }>(sql`select count(*)::int as n from trade_ledger where trade_id like 'season-1-close:%'`);
  assert.ok(Number(ledger[0].n) >= 2);

  // Neue Saison läuft, Ende geplant
  const next = (await runningSeason(db))!;
  assert.equal(next.number, season.number + 1);
  assert.equal(next.startsAt.getTime(), due);
  assert.equal(Number((pending[0].payload as { seasonId: number }).seasonId), next.id);

  // Lesemodelle: Hafenwahl-Hinweis und Ruhmeshalle
  const sv = await seasonView(db, B.playerId);
  assert.equal(sv.season?.number, 2);
  assert.deepEqual({ n: sv.lastResult?.seasonNumber, rank: sv.lastResult?.rank, of: sv.lastResult?.of }, { n: 1, rank: 2, of: 2 });
  const hall = await hallOfFame(db, A.playerId);
  assert.equal(hall.length, 1);
  assert.equal(hall[0].podium[0].name, "Arne");
  assert.equal(hall[0].best.best_kampf?.name, "Arne");
  assert.equal(hall[0].own?.rank, 1);

  // Idempotenz: dasselbe Saisonende erneut (direkt und als Ereignis) ändert nichts.
  const before = { msgs: await count("message"), results: await count("season_result"), seasons: await count("season"), ledger: await count("trade_ledger") };
  const res = await db.transaction((tx) => seasonEnd(tx, { id: 0, type: "season_end", dueAt: new Date(), payload: { seasonId: season.id }, baseId: null }, Date.now()));
  assert.deepEqual(res.notify, []);
  await db.insert(tables.gameEvent).values({ type: "season_end", dueAt: new Date(Date.now() - 500), payload: { seasonId: season.id }, baseId: null });
  await processDue(engine, Date.now());
  assert.deepEqual(
    { msgs: await count("message"), results: await count("season_result"), seasons: await count("season"), ledger: await count("trade_ledger") },
    before,
  );
  assert.equal((await auditLedger(engine)).ok, true);

  // Nach dem Reset kann ein Spieler wieder einen Hafen gründen.
  const f = freeCoast(40);
  const again = await chooseBase(engine, A.playerId, key(), { ...f, name: "Neuer Hafen", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(again.ok, true, JSON.stringify(again));
  clearRankingCache();
  const view = await rankingView(engine, A.playerId);
  assert.equal(view.season?.number, 2);
  assert.equal(view.rows.find((r) => r.playerId === A.playerId)?.kampf, 0);
});
