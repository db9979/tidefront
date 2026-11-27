// Integrationstests Tagesbefehle gegen ein echtes PostgreSQL (wird geleert): Vergabe, Fortschritt aus
// Ereignissen und Befehlen, Abholen, neu würfeln, Serie, Rangliste und Saisonende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  addDays,
  CHALLENGE_KINDS,
  chooseBase,
  claimChallenge,
  clearRankingCache,
  computeStandings,
  dailyView,
  dayKey,
  dayStartMs,
  drawDay,
  hallOfFame,
  launchMission,
  marketQuote,
  nextDayStartMs,
  poolContext,
  processDue,
  rankingView,
  register,
  rerollChallenge,
  runningSeason,
  seed,
  streakBonus,
  trade,
  train,
  upgrade,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const dc = tables.dailyChallenge;
let keyN = 0;
const key = () => `d${++keyN}-${Date.now()}`;
const today = () => dayKey(Date.now());

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

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function rowsOf(playerId: number, day = today()) {
  return db.select().from(dc).where(and(eq(dc.playerId, playerId), eq(dc.day, day))).orderBy(asc(dc.slot));
}

/** Legt die Befehle des Tages für den Test fest (Art, Ziel, Zusatz) und setzt sie zurück. */
async function setDaily(playerId: number, specs: { kind: string; target: number; param?: string | null }[]) {
  await dailyView(engine, playerId);
  for (const [slot, s] of specs.entries()) {
    await db.update(dc)
      .set({ kind: s.kind, target: s.target, param: s.param ?? null, progress: 0, completedAt: null, claimedAt: null, rerolled: false })
      .where(and(eq(dc.playerId, playerId), eq(dc.day, today()), eq(dc.slot, slot)));
  }
}

/** Fällige Ereignisse eines Typs auf jetzt vorziehen und verarbeiten. */
async function runNow(type: string, where = sql`true`) {
  await db.update(tables.gameEvent)
    .set({ dueAt: new Date(Date.now() - 1000) })
    .where(sql`${tables.gameEvent.type} = ${type} and ${tables.gameEvent.status} = 'pending' and ${where}`);
  await processDue(engine, Date.now());
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Anke", 4);
  B = await newPlayer("Bodo", 11);
});

after(async () => {
  await client.end();
});

test("Spieltag: Tageswechsel 0:00 Uhr Europe/Berlin, auch an Tagen mit Zeitumstellung", () => {
  assert.equal(new Date(dayStartMs("2026-11-26")).toISOString(), "2026-11-25T23:00:00.000Z");
  assert.equal(new Date(dayStartMs("2026-07-01")).toISOString(), "2026-06-30T22:00:00.000Z");
  for (const d of ["2026-03-29", "2026-10-25"]) {
    const start = dayStartMs(d);
    assert.equal(dayKey(start), d);
    assert.equal(dayKey(start - 1), addDays(d, -1));
    assert.equal(nextDayStartMs(start), dayStartMs(addDays(d, 1)));
  }
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("Pool: mindestens 15 Arten, Auswahl passend zum Fortschritt", () => {
  assert.ok(Object.keys(CHALLENGE_KINDS).length >= 15);
  const base = (buildings: Record<string, number>, units: Record<string, number> = {}): BaseState => ({
    resources: { stahl: 1000, treibstoff: 1000, elektronik: 500, proviant: 1000 }, resUpdatedAt: 0, buildings, units,
    unitsAway: {}, defenses: {}, buildQueue: [], trainingQueue: [], versorgungsmangel: false,
    protection: { createdAtMs: 0, nightShieldStartHour: null, tzOffsetMinutes: 0, nightShieldSuspendedUntilMs: 0, defeatShieldUntilMs: 0 },
  });
  // Neuer Hafen: keine Werft, keine Kaserne, Börse zu, Anfängerschutz, allein.
  const fresh = poolContext(base({}), { others: false, raidsPossible: false });
  const forbidden = new Set(["nest", "beute", "sieg_ohne_verluste", "transport", "handel", "kartell_abwehr", "aufklaerung", "wrack",
    "ausbildung_land", "ausbildung_see", "ausbildung_luft", "nachricht"]);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const day = drawDay(fresh, `t|${i}`);
    assert.deepEqual(day.map((d) => d.slot), [0, 1, 2]);
    assert.equal(new Set(day.map((d) => d.kind)).size, 3);
    for (const d of day) {
      assert.ok(!forbidden.has(d.kind), `${d.kind} passt nicht zu einem neuen Hafen`);
      seen.add(d.kind);
    }
  }
  assert.ok(seen.size >= 3);
  // Weit entwickelt: Nester bis zur passenden Stufe, Ausbildung skaliert.
  const late = poolContext(base({ kommandozentrale: 9, werft: 5, kaserne: 5, flugfeld: 3, hafenkommandantur: 5, stahlwerk: 8 }), { others: true, raidsPossible: true });
  const kinds = new Set<string>();
  for (let i = 0; i < 400; i++) {
    for (const d of drawDay(late, `s|${i}`)) {
      kinds.add(d.kind);
      if (d.kind === "nest") assert.ok(Number(d.param) >= 3 && Number(d.param) <= 4, `Nest-Stufe ${d.param}`);
      if (d.kind === "kartell_abwehr" || d.kind === "sieg_ohne_verluste") assert.equal(d.slot, 2);
      if (d.kind === "nachricht") assert.equal(d.slot, 0);
    }
  }
  for (const k of ["nest", "handel", "transport", "ausbildung_luft", "kartell_abwehr", "beute"]) assert.ok(kinds.has(k), k);
  assert.ok(kinds.size >= 15, `nur ${kinds.size} Arten gezogen`);
  // Gleiche Eingabe, gleiche Befehle.
  assert.deepEqual(drawDay(late, "x"), drawDay(late, "x"));
});

test("Vergabe beim ersten Abruf: idempotent, auch bei gleichzeitigen Abrufen", async () => {
  const views = await Promise.all(Array.from({ length: 6 }, () => dailyView(engine, A.playerId)));
  const rows = await rowsOf(A.playerId);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.slot), [0, 1, 2]);
  for (const v of views) assert.deepEqual(v.challenges.map((c) => c.id), rows.map((r) => r.id));
  const v = views[0];
  assert.equal(v.hasBase, true);
  assert.equal(v.day, today());
  assert.ok(v.nextDayAtMs > Date.now() && v.nextDayAtMs - Date.now() <= 86400000 + 3600000);
  assert.deepEqual(v.challenges.map((c) => c.tier), ["leicht", "mittel", "schwer"]);
  assert.deepEqual(v.challenges.map((c) => c.points), [3, 6, 12]);
  for (const c of v.challenges) {
    assert.ok(c.text.length > 5);
    assert.ok(Object.values(c.reward).some((n) => n > 0));
  }
  // Neuer Hafen in Anfängerschutz ohne Werft: kein Nest, kein Kartell.
  assert.ok(!v.challenges.some((c) => ["nest", "kartell_abwehr", "beute", "handel"].includes(c.kind)));
  assert.equal(v.rerollAvailable, true);
});

test("Fortschritt aus Ausbau, Ausbildung und Handel; Bauschlange voll", async () => {
  await setDaily(A.playerId, [
    { kind: "ausbau", target: 1 },
    { kind: "ausbildung_land", target: 5, param: "land" },
    { kind: "handel", target: 150 },
  ]);
  await patchBase(A.baseId, (s) => {
    s.buildings.kaserne = 1;
    s.buildings.hafenkommandantur = 3;
    s.buildings.kommandozentrale = 2;
    s.resources = { stahl: 20000, treibstoff: 20000, elektronik: 20000, proviant: 20000 };
  });
  // Ausbau: Auftrag einreihen, Fertigstellung vorziehen.
  assert.equal((await upgrade(engine, A.playerId, key(), "stahlwerk")).ok, true);
  await patchBase(A.baseId, (s) => { s.buildQueue[0].finishesAt = Date.now() - 2000; s.buildQueue[0].startedAt = Date.now() - 5000; });
  await runNow("build_complete");
  assert.equal((await stateOf(A.baseId)).buildings.stahlwerk, 1);
  // Ausbildung: 5 Schützen.
  assert.equal((await train(engine, A.playerId, key(), "schuetzen", 5)).ok, true);
  await patchBase(A.baseId, (s) => { s.trainingQueue[0].finishesAt = Date.now() - 2000; });
  await runNow("training_complete");
  assert.equal((await stateOf(A.baseId)).units.schuetzen, 5);
  // Handel: Verkauf von 200 Stahl.
  const q = await marketQuote(engine, { side: "sell", resource: "stahl", qty: 200 });
  assert.equal(q.ok, true);
  const t = await trade(engine, A.playerId, key(), { side: "sell", resource: "stahl", qty: 200, expectedPrice: (q as { executionPrice: number }).executionPrice });
  assert.equal(t.ok, true, JSON.stringify(t));
  const rows = await rowsOf(A.playerId);
  assert.deepEqual(rows.map((r) => r.progress), [1, 5, 150]);
  assert.ok(rows.every((r) => r.completedAt !== null));

  // Bauschlange: Höchststand der Schlange zählt.
  await setDaily(A.playerId, [{ kind: "ausbau", target: 2 }, { kind: "bauschlange", target: 3 }, { kind: "anlagen", target: 1 }]);
  for (const id of ["raffinerie", "versorgungshof"]) assert.equal((await upgrade(engine, A.playerId, key(), id)).ok, true);
  assert.equal((await rowsOf(A.playerId))[1].progress, 2);
  assert.equal((await upgrade(engine, A.playerId, key(), "kraftwerk")).ok, true);
  const r2 = await rowsOf(A.playerId);
  assert.equal(r2[1].progress, 3);
  assert.ok(r2[1].completedAt);
  // Anlagen zählen unter "anlagen", nicht unter Ausbildung.
  assert.equal((await train(engine, A.playerId, key(), "minensperre", 1)).ok, true);
  await patchBase(A.baseId, (s) => { for (const o of s.trainingQueue) o.finishesAt = Date.now() - 2000; });
  await runNow("training_complete");
  assert.equal((await rowsOf(A.playerId))[2].progress, 1);
});

test("Fortschritt aus Kampf: Nest, Beute, Wrack, Kartell abgewehrt; Nachricht und Vorrat beim Abruf", async () => {
  await setDaily(B.playerId, [
    { kind: "nachricht", target: 1 },
    { kind: "nest", target: 1, param: "1" },
    { kind: "kartell_abwehr", target: 1 },
  ]);
  await patchBase(B.baseId, (s) => {
    s.units = { korvette: 4, landungsschiff: 2, schuetzen: 150 };
    s.resources.treibstoff = 50000;
  });
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const near = nests.map((n) => ({ n, d: Math.hypot(n.col - B.col, n.row - B.row) })).sort((a, b) => a.d - b.d)[0].n;
  const m = await launchMission(engine, B.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 2, schuetzen: 150 }, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const missionId = (m as { missionId: number }).missionId;
  await runNow("mission_arrive", sql`(${tables.gameEvent.payload}->>'missionId')::int = ${missionId}`);
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, missionId));
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, mission.reportId!));
  assert.equal(report.winner, "attacker");
  let rows = await rowsOf(B.playerId);
  assert.equal(rows[1].progress, 1);
  assert.ok(rows[1].completedAt);

  // Kartell greift an und wird abgewehrt.
  await patchBase(B.baseId, (s) => { s.protection.createdAtMs = 0; s.units.schuetzen = 300; s.defenses = { kuestenbatterie: 3, bunkerlinie: 2 }; });
  const units = { schnellboot: 1, piratenmiliz: 4 };
  const [raid] = await db.insert(tables.mission).values({
    playerId: null, baseId: null, type: "kartell", targetKind: "base", targetId: B.baseId, targetCol: B.col, targetRow: B.row,
    plan: { units, attacker: { units, troopSpaceBonus: { schnellboot: 8 }, unlimitedCargo: true }, departAtMs: Date.now(), arriveAtMs: Date.now() },
    status: "outbound", arriveAt: new Date(),
  }).returning({ id: tables.mission.id });
  await db.insert(tables.gameEvent).values({ type: "raid_arrive", dueAt: new Date(Date.now() - 500), payload: { missionId: raid.id }, baseId: B.baseId });
  await processDue(engine, Date.now());
  rows = await rowsOf(B.playerId);
  assert.equal(rows[2].progress, 1);

  // Nachricht: aus dem Postfach gezählt, beim Abruf fortgeschrieben.
  await db.insert(tables.message).values({ fromPlayerId: B.playerId, toPlayerId: A.playerId, body: "Ahoi" });
  const v = await dailyView(engine, B.playerId);
  assert.equal(v.challenges[0].progress, 1);
  assert.equal(v.claimable, 3);

  // Beute und Wrackgut, Vorrat: eigene Runde.
  await setDaily(B.playerId, [
    { kind: "lager", target: 100, param: "stahl" },
    { kind: "beute", target: 100 },
    { kind: "wrack", target: 1 },
  ]);
  await db.insert(tables.wreck).values({ col: near.col, row: near.row, stahl: 500, elektronik: 100, createdAt: new Date() });
  await db.update(tables.nest).set({ defeatedAt: null }).where(eq(tables.nest.id, near.id));
  await runNow("mission_return");
  await patchBase(B.baseId, (s) => { s.units = { korvette: 4, landungsschiff: 2, schuetzen: 150 }; s.unitsAway = {}; });
  const m2 = await launchMission(engine, B.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 2, schuetzen: 150 }, col: near.col, row: near.row });
  assert.equal(m2.ok, true, JSON.stringify(m2));
  await runNow("mission_arrive", sql`(${tables.gameEvent.payload}->>'missionId')::int = ${(m2 as { missionId: number }).missionId}`);
  const v2 = await dailyView(engine, B.playerId);
  assert.equal(v2.challenges[0].done, true, "Vorrat 100 Stahl liegt längst im Lager");
  assert.equal(v2.challenges[1].progress, 100);
  assert.equal(v2.challenges[2].progress, 1);
});

test("Abholen genau einmal, Belohnung nur bis zur Lagerkapazität", async () => {
  const rows = await rowsOf(A.playerId);
  const done = rows.find((r) => r.completedAt && !r.claimedAt)!;
  const open = rows.find((r) => !r.completedAt);
  await patchBase(A.baseId, (s) => { s.resources.stahl = 1_000_000; });
  const before = (await stateOf(A.baseId)).resources.stahl;
  const k = key();
  const r1 = await claimChallenge(engine, A.playerId, k, done.id);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const after = (await stateOf(A.baseId)).resources.stahl;
  // Seit 27.11.2026 wie das Auftragsbuch: Lager voll → nichts kommt dazu, Bestand darüber bleibt.
  assert.ok(Math.abs(after - before) < 1, `${after} - ${before}`);
  // Gleicher Schlüssel: gleiche Antwort, keine zweite Gutschrift. Neuer Schlüssel: abgelehnt.
  assert.deepEqual(await claimChallenge(engine, A.playerId, k, done.id), r1);
  assert.deepEqual(await claimChallenge(engine, A.playerId, key(), done.id), { ok: false, code: "already_claimed" });
  assert.ok(Math.abs((await stateOf(A.baseId)).resources.stahl - after) < 1);
  if (open) assert.deepEqual(await claimChallenge(engine, A.playerId, key(), open.id), { ok: false, code: "not_done" });
  // Fremder Befehl
  const other = (await rowsOf(B.playerId))[0];
  assert.deepEqual(await claimChallenge(engine, A.playerId, key(), other.id), { ok: false, code: "no_challenge" });
  // Gleichzeitig mit verschiedenen Schlüsseln: genau einer gewinnt.
  const next = rows.find((r) => r.completedAt && r.id !== done.id)!;
  const both = await Promise.all([claimChallenge(engine, A.playerId, key(), next.id), claimChallenge(engine, A.playerId, key(), next.id)]);
  assert.equal(both.filter((r) => r.ok).length, 1);
});

test("Neu würfeln: einmal am Tag, nur offene Befehle, andere Art", async () => {
  const p = await newPlayer("Cora", 17);
  await dailyView(engine, p.playerId);
  await db.update(dc).set({ completedAt: new Date(), progress: sql`${dc.target}` }).where(and(eq(dc.playerId, p.playerId), eq(dc.slot, 1)));
  assert.deepEqual(await rerollChallenge(engine, p.playerId, key(), 1), { ok: false, code: "already_done" });
  const before = await rowsOf(p.playerId);
  const k = key();
  const r = await rerollChallenge(engine, p.playerId, k, 0);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await rowsOf(p.playerId);
  assert.notEqual(after[0].kind, before[0].kind);
  assert.ok(!before.some((b) => b.kind === after[0].kind));
  assert.equal(after[0].rerolled, true);
  assert.equal(after[0].id, before[0].id);
  assert.deepEqual(await rerollChallenge(engine, p.playerId, k, 0), r);
  assert.deepEqual(await rerollChallenge(engine, p.playerId, key(), 2), { ok: false, code: "reroll_used" });
  assert.equal((await dailyView(engine, p.playerId)).rerollAvailable, false);
  assert.equal((await rowsOf(p.playerId)).length, 3);
});

test("Serie: drei Tage nacheinander alles abgeholt ergibt Serienbonus, Lücke setzt zurück", async () => {
  assert.equal(streakBonus(2, 0), null);
  assert.equal(streakBonus(3, 0)?.points, 10);
  assert.equal(streakBonus(7, 0)?.points, 25);
  assert.equal(streakBonus(14, 0)?.points, 35);
  const p = await newPlayer("Dirk", 23);
  const reward = { stahl: 100, treibstoff: 0, elektronik: 0, proviant: 0 };
  const now = new Date();
  for (const d of [-2, -1]) {
    await db.insert(dc).values([0, 1, 2].map((slot) => ({
      playerId: p.playerId, day: addDays(today(), d), slot, kind: "ausbau", target: 1, progress: 1, reward, points: 3, completedAt: now,
    })));
  }
  const claimDay = async (day: string) => {
    let last: Awaited<ReturnType<typeof claimChallenge>> | null = null;
    for (const r of await rowsOf(p.playerId, day)) last = await claimChallenge(engine, p.playerId, key(), r.id);
    return last as { ok: true; streak: number | null; bonus: { points: number } | null };
  };
  const view0 = await dailyView(engine, p.playerId);
  assert.equal(view0.older.length, 6);
  assert.equal(view0.claimable, 6);
  assert.equal((await claimDay(addDays(today(), -2))).streak, 1);
  assert.equal((await claimDay(addDays(today(), -1))).streak, 2);
  await db.update(dc).set({ completedAt: now, progress: sql`${dc.target}` }).where(and(eq(dc.playerId, p.playerId), eq(dc.day, today())));
  const third = await claimDay(today());
  assert.equal(third.streak, 3);
  assert.equal(third.bonus?.points, 10);
  const v = await dailyView(engine, p.playerId);
  assert.equal(v.streak.length, 3);
  assert.equal(v.streak.todayDone, true);
  assert.equal(v.streak.nextMilestone, 7);
  assert.equal(v.seasonPoints, 3 * 6 + 3 + 6 + 12 + 10);
  // Lücke: letzter Abschluss vor drei Tagen, Serie beginnt neu.
  await db.update(tables.dailyStreak).set({ lastDay: addDays(today(), -3), length: 5 }).where(eq(tables.dailyStreak.playerId, p.playerId));
  assert.equal((await dailyView(engine, p.playerId)).streak.length, 0);
});

test("Punkte in der Rangliste (Kategorie Befehle) und Saisonende setzt zurück", async () => {
  const season = (await runningSeason(db))!;
  const rows = await computeStandings(db, season.startsAt.getTime(), Date.now());
  const [d] = await db.execute<{ id: number }>(sql`select id from player where name = 'Dirk'`);
  const dirk = rows.find((r) => r.playerId === d.id)!;
  assert.equal(dirk.befehle, 49);
  assert.equal(dirk.total, dirk.ausbau + dirk.militaer + dirk.kampf + dirk.beute + dirk.befehle);
  const anke = rows.find((r) => r.playerId === A.playerId)!;
  assert.ok(anke.befehle >= 3);
  clearRankingCache();
  const view = await rankingView(engine, A.playerId);
  assert.equal(view.rows.find((r) => r.playerId === d.id)?.befehle, 49);

  const due = Date.now() - 1000;
  await db.update(tables.gameEvent).set({ dueAt: new Date(due) }).where(eq(tables.gameEvent.type, "season_end"));
  await processDue(engine, Date.now());
  const results = await db.select().from(tables.seasonResult).where(eq(tables.seasonResult.seasonId, season.id));
  const res = results.find((r) => r.playerId === d.id)!;
  assert.equal(res.befehle, 49);
  const best = results.reduce((a, b) => (b.befehle > a.befehle ? b : a));
  assert.ok((best.awards as string[]).includes("best_befehle"));
  const hall = await hallOfFame(db, d.id);
  assert.equal(hall[0].own?.befehle, 49);
  assert.ok(hall[0].best.best_befehle);
  const count = async (table: string) => Number((await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`)))[0].n);
  assert.equal(await count("daily_challenge"), 0);
  assert.equal(await count("daily_streak"), 0);
  // Ohne Hafen keine Befehle; die neue Saison beginnt bei 0.
  const v = await dailyView(engine, A.playerId);
  assert.equal(v.hasBase, false);
  assert.equal(v.challenges.length, 0);
  assert.equal(v.seasonPoints, 0);
  assert.equal(v.streak.length, 0);
});
