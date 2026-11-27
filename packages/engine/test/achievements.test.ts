// Erfolge und Wochenziele: reine Funktionen (Spielwoche, Stufen, Auswahl) und Integration gegen ein echtes
// PostgreSQL (wird geleert): Zähler, Freischaltung, Belohnung genau einmal, Berichte, Wochenwechsel, Bonus.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  achievementList,
  achievementsView,
  auditLedger,
  chooseBase,
  claimAchievement,
  claimWeekly,
  clearRankingCache,
  drawWeek,
  flushAchievementNotices,
  nextWeekStartMs,
  placementScore,
  poolContext,
  rankingView,
  recordAchievement,
  register,
  runningSeason,
  seed,
  tierFor,
  trackProgress,
  weekKey,
  weekStartMs,
  weeklyView,
  type Engine,
  type NoticeJob,
} from "../src/index.ts";
import { achievementsAfter, achievementSnapshot } from "../src/achievements.ts";
import type { EventRow } from "../src/events.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pushed: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => pushed.push(...jobs) };
let keyN = 0;
const key = () => `a${++keyN}-${Date.now()}`;

// ---------------------------------------------------------------- rein

test("Spielwoche: Montag 0:00 Uhr Europe/Berlin, auch über die Zeitumstellung", () => {
  // Donnerstag 26.11.2026 → Woche ab Montag 23.11.
  assert.equal(weekKey(Date.parse("2026-11-26T12:00:00Z")), "2026-11-23");
  assert.equal(new Date(weekStartMs("2026-11-23")).toISOString(), "2026-11-22T23:00:00.000Z");
  // Sonntag 23:59 Ortszeit gehört noch zur Woche, Montag 0:00 Ortszeit (Sonntag 23:00 UTC) nicht mehr.
  assert.equal(weekKey(Date.parse("2026-11-29T22:59:59Z")), "2026-11-23");
  assert.equal(weekKey(Date.parse("2026-11-29T23:00:00Z")), "2026-11-30");
  assert.equal(nextWeekStartMs(Date.parse("2026-11-26T12:00:00Z")), Date.parse("2026-11-29T23:00:00Z"));
  // Sommerzeit: Woche ab Montag 30.03.2026 beginnt um 22:00 UTC, Winterzeit ab 26.10. um 23:00 UTC.
  assert.equal(new Date(weekStartMs("2026-03-30")).toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(new Date(weekStartMs("2026-10-26")).toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(weekKey(Date.parse("2026-03-29T21:59:59Z")), "2026-03-23");
  assert.equal(weekKey(Date.parse("2027-01-01T10:00:00Z")), "2026-12-28");
});

test("Stufen und Definitionen aus der Balance", () => {
  assert.equal(tierFor(0, [5, 25, 100]), 0);
  assert.equal(tierFor(5, [5, 25, 100]), 1);
  assert.equal(tierFor(99, [5, 25, 100]), 2);
  assert.equal(tierFor(1000, [5, 25, 100]), 3);
  assert.deepEqual([placementScore(1, 50), placementScore(3, 50), placementScore(10, 5), placementScore(11, 5), placementScore(1, 0)], [3, 2, 1, 0, 0]);
  const list = achievementList();
  assert.ok(list.length >= 11);
  for (const a of list) {
    assert.equal(a.thresholds.length, 3, a.id);
    assert.ok(a.thresholds[0] > 0 && a.thresholds[0] < a.thresholds[1] && a.thresholds[1] < a.thresholds[2], a.id);
  }
});

const base = (buildings: Record<string, number>): BaseState => ({
  resources: { stahl: 1000, treibstoff: 1000, elektronik: 500, proviant: 1000 }, resUpdatedAt: 0, buildings, units: {},
  unitsAway: {}, defenses: {}, buildQueue: [], trainingQueue: [], versorgungsmangel: false,
  protection: { createdAtMs: 0, nightShieldStartHour: null, tzOffsetMinutes: 0, nightShieldSuspendedUntilMs: 0, defeatShieldUntilMs: 0 },
});

test("Wochenziele: deterministisch, drei verschiedene, passend zum Ausbaustand", () => {
  const fresh = { ...poolContext(base({}), { others: false, raidsPossible: false }), allied: false };
  for (let i = 0; i < 50; i++) {
    const w = drawWeek(fresh, `p|${i}`);
    assert.deepEqual(w.map((d) => d.slot), [0, 1, 2]);
    assert.equal(new Set(w.map((d) => d.kind)).size, 3);
    for (const d of w) assert.ok(["gebaeudestufen", "anlagen", "tagesbefehle"].includes(d.kind), d.kind);
  }
  const late = { ...poolContext(base({ kommandozentrale: 9, werft: 5, kaserne: 5, hafenkommandantur: 5, forschungsamt: 2, nachrichtendienst: 2 }), { others: true, raidsPossible: true }), allied: true };
  const kinds = new Set<string>();
  for (let i = 0; i < 300; i++) {
    for (const d of drawWeek(late, `q|${i}`)) {
      kinds.add(d.kind);
      if (d.kind === "nester") assert.equal(d.param, "4");
      if (d.kind === "beute") assert.equal(d.target, 60000);
    }
  }
  for (const k of ["nester", "beute", "missionen", "spionage", "allianz_hilfe", "handel", "abwehr", "forschung"]) assert.ok(kinds.has(k), k);
  assert.deepEqual(drawWeek(late, "7|2026-11-23"), drawWeek(late, "7|2026-11-23"));
});

// ---------------------------------------------------------------- Datenbank

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
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

const stateOf = async (baseId: number) => (await db.select().from(tables.base).where(eq(tables.base.id, baseId)))[0].state as BaseState;
const creditsOf = async (playerId: number) =>
  ((await db.select().from(tables.player).where(eq(tables.player.id, playerId)))[0].trader as { credits: number }).credits;
const counter = async (playerId: number, name: string) => {
  const [r] = await db.select().from(tables.achievementCounter)
    .where(and(eq(tables.achievementCounter.playerId, playerId), eq(tables.achievementCounter.counter, name)));
  return Number(r?.value ?? 0);
};
const tiersOf = async (playerId: number, id: string) =>
  (await db.select().from(tables.achievementTier)
    .where(and(eq(tables.achievementTier.playerId, playerId), eq(tables.achievementTier.achievementId, id)))).map((r) => r.tier).sort();

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Erika", 3);
  B = await newPlayer("Fritz", 12);
});

after(async () => {
  await client.end();
});

test("Zähler und Freischaltung: Stufen genau einmal, mit Meldung; Bestwerte sinken nicht", async () => {
  await recordAchievement(db, A.playerId, "nester", 4);
  assert.deepEqual(await tiersOf(A.playerId, "nestjaeger"), []);
  await recordAchievement(db, A.playerId, "nester", 1);
  assert.equal(await counter(A.playerId, "nester"), 5);
  assert.deepEqual(await tiersOf(A.playerId, "nestjaeger"), [1]);
  await recordAchievement(db, A.playerId, "nester", 1);
  assert.deepEqual(await tiersOf(A.playerId, "nestjaeger"), [1]);
  const msgs = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, A.playerId), sql`${tables.message.subject} like 'Erfolg: Nestjäger%'`));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].subject ?? "", /Bronze/);
  // Ein großer Sprung schaltet alle Stufen auf einmal frei.
  await recordAchievement(db, A.playerId, "beute", 2_500_000);
  assert.deepEqual(await tiersOf(A.playerId, "prisenmeister"), [1, 2, 3]);
  // Bestwert: max übernimmt nur Höheres.
  await recordAchievement(db, A.playerId, "serie", 8, { mode: "max" });
  await recordAchievement(db, A.playerId, "serie", 2, { mode: "max" });
  assert.equal(await counter(A.playerId, "serie"), 8);
  assert.deepEqual(await tiersOf(A.playerId, "pflichttreu"), [1, 2]);
  // Unsinnige Mengen und unbekannte Zähler schaden nicht.
  await recordAchievement(db, A.playerId, "nester", -3);
  await recordAchievement(db, A.playerId, "nester", Number.NaN);
  await recordAchievement(db, A.playerId, "neu_vom_admiral", 2);
  assert.equal(await counter(A.playerId, "nester"), 6);
  assert.equal(await counter(A.playerId, "neu_vom_admiral"), 2);
});

test("Abholen: Belohnung genau einmal, Kredite im Journal, Push über den Worker", async () => {
  const before = await stateOf(A.baseId);
  const credits = await creditsOf(A.playerId);
  const k = key();
  const r = await claimAchievement(engine, A.playerId, k, "nestjaeger", 1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const reward = (r as { reward: Record<string, number> }).reward;
  assert.ok(reward.credits > 0 && reward.stahl > 0);
  assert.equal(await creditsOf(A.playerId), credits + reward.credits);
  const after = await stateOf(A.baseId);
  assert.ok(after.resources.stahl >= before.resources.stahl + reward.stahl - 1);
  // Gleicher Schlüssel: gespeicherte Antwort, nichts doppelt.
  assert.deepEqual(await claimAchievement(engine, A.playerId, k, "nestjaeger", 1), r);
  assert.deepEqual(await claimAchievement(engine, A.playerId, key(), "nestjaeger", 1), { ok: false, code: "already_claimed" });
  assert.deepEqual(await claimAchievement(engine, A.playerId, key(), "nestjaeger", 2), { ok: false, code: "not_unlocked" });
  assert.deepEqual(await claimAchievement(engine, B.playerId, key(), "nestjaeger", 1), { ok: false, code: "not_unlocked" });
  assert.equal(await creditsOf(A.playerId), credits + reward.credits);
  assert.equal((await auditLedger(engine)).ok, true);

  const v = await achievementsView(engine, A.playerId);
  const nest = v.achievements.find((a) => a.id === "nestjaeger")!;
  assert.equal(nest.tier, 1);
  assert.equal(nest.next, 25);
  assert.deepEqual(nest.tiers.map((t) => [t.unlocked, t.claimed]), [[true, true], [false, false], [false, false]]);
  assert.ok(v.claimable >= 4); // Prisenmeister 3, Pflichttreu 2
  assert.equal(v.badges[0].id, "prisenmeister");
  assert.equal(v.badges[0].tier, 3);

  pushed.length = 0;
  const n = await flushAchievementNotices(engine);
  assert.ok(n >= 6);
  assert.ok(pushed.every((j) => j.notice.title.startsWith("Erfolg:")));
  assert.equal(await flushAchievementNotices(engine), 0);
});

test("Volles Lager: Erfolg und Wochenziel melden den verfallenen Rest (`lost`), Ansichten liefern das Lager", async () => {
  const C = await newPlayer("Lagervoll", 7);
  await patchBase(C.baseId, (s) => { for (const r of Object.keys(s.resources)) s.resources[r] = 1_000_000; });
  await recordAchievement(db, C.playerId, "nester", 5);
  const v = await achievementsView(engine, C.playerId);
  assert.ok(v.storage && v.storage.capacity > 0 && v.storage.resources.stahl === 1_000_000, JSON.stringify(v.storage));
  const r = await claimAchievement(engine, C.playerId, key(), "nestjaeger", 1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const ok = r as { reward: Record<string, number>; lost: Record<string, number> };
  const res = Object.fromEntries(Object.entries(ok.reward).filter(([k, n]) => k !== "credits" && n > 0));
  assert.ok(Object.keys(res).length > 0);
  assert.deepEqual(ok.lost, res); // Kredite verfallen nie
  assert.equal((await stateOf(C.baseId)).resources.stahl, 1_000_000);

  // Wochenziel: ein Ziel erfüllt abholen, alles verfällt.
  const w = await weeklyView(engine, C.playerId);
  assert.ok(w.storage && w.storage.capacity > 0);
  const wg = tables.weeklyGoal;
  await db.update(wg).set({ kind: "gebaeudestufen", param: null, target: 1, progress: 0, completedAt: null, claimedAt: null, bonus: null })
    .where(and(eq(wg.id, w.goals[0].id)));
  await recordAchievement(db, C.playerId, "gebaeudestufen", 1);
  const rw = await claimWeekly(engine, C.playerId, key(), w.goals[0].id);
  assert.equal(rw.ok, true, JSON.stringify(rw));
  const okw = rw as { reward: Record<string, number>; lost: Record<string, number> };
  assert.deepEqual(okw.lost, Object.fromEntries(Object.entries(okw.reward).filter(([k, n]) => k !== "credits" && n > 0)));
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Berichte aus Ereignissen: Nest, Abwehr ohne Verluste, Spionage – jeder Bericht genau einmal", async () => {
  const [nest] = await db.select().from(tables.nest).limit(1);
  const ev = { id: 0, type: "mission_arrive", dueAt: new Date(), payload: {}, baseId: null } as EventRow;
  const due = Date.now();
  const report = (v: Partial<typeof tables.battleReport.$inferInsert>) => ({
    kind: "ueberfall", title: "Test", attackerPlayerId: null, defenderPlayerId: null, attackerBaseId: null, defenderBaseId: null,
    nestId: null, winner: "attacker", seed: 1, balanceVersion: "test", report: {}, ...v,
  });
  const nestersBefore = await counter(B.playerId, "nester");
  let snap: Awaited<ReturnType<typeof achievementSnapshot>> = null;
  await db.transaction(async (tx) => {
    snap = await achievementSnapshot(tx, ev);
    await tx.insert(tables.battleReport).values([
      report({ attackerPlayerId: B.playerId, nestId: nest.id, report: { battle: { loot: { stahl: 700, proviant: 300 }, attacker: { losses: {} } } } }),
      report({ kind: "kartell", defenderPlayerId: B.playerId, winner: "defender", report: { battle: { loot: {}, defender: { losses: {} } } } }),
      report({ kind: "kartell", defenderPlayerId: B.playerId, winner: "defender", report: { battle: { loot: {}, defender: { losses: { schuetzen: 3 } } } } }),
      report({ kind: "spionage", attackerPlayerId: B.playerId, winner: "attacker", report: { spy: {} } }),
      report({ kind: "spionage", attackerPlayerId: B.playerId, winner: null, report: { spy: { aborted: "x" } } }),
    ]);
    await achievementsAfter(tx, due, snap);
  });
  assert.equal(await counter(B.playerId, "nester"), nestersBefore + 1);
  assert.equal(await counter(B.playerId, "beute"), 1000);
  assert.equal(await counter(B.playerId, "abwehr"), 2);
  assert.equal(await counter(B.playerId, "abwehr_ohne_verluste"), 1);
  assert.equal(await counter(B.playerId, "spionage"), 1);
  assert.equal(await counter(B.playerId, "missionen"), 2);
  assert.deepEqual(await tiersOf(B.playerId, "bollwerk"), [1]);
  // Zweite Auswertung mit demselben Stand: schon markiert, nichts doppelt.
  await db.transaction((tx) => achievementsAfter(tx, due, snap));
  assert.equal(await counter(B.playerId, "abwehr"), 2);
  assert.equal(await counter(B.playerId, "missionen"), 2);
});

test("Tagesbefehle-Fortschritt zählt mit (Handel, Ausbau); Zustand: Prachtbau, Serie, Saisonplatzierung", async () => {
  await db.transaction(async (tx) => {
    await trackProgress(tx, B.playerId, "handel", 800, { atMs: Date.now() });
    await trackProgress(tx, B.playerId, "ausbau", 2, { atMs: Date.now() });
  });
  assert.equal(await counter(B.playerId, "handel"), 1);
  assert.equal(await counter(B.playerId, "gebaeudestufen"), 2);

  await patchBase(B.baseId, (s) => { s.buildings.stahlwerk = 18; s.buildings.raffinerie = 19; });
  await db.insert(tables.dailyStreak).values({ playerId: B.playerId, lastDay: "2026-01-01", length: 1, best: 3 });
  const season = (await runningSeason(db))!;
  await db.insert(tables.seasonResult).values({
    seasonId: season.id, playerId: B.playerId, playerName: "Fritz", rank: 2, ausbau: 1, militaer: 1, kampf: 1, beute: 1, total: 100, awards: [],
  });
  const v = await achievementsView(engine, B.playerId);
  const get = (id: string) => v.achievements.find((a) => a.id === id)!;
  assert.equal(get("baumeister").value, 2);
  assert.equal(get("baumeister").tier, 1);
  assert.equal(get("pflichttreu").tier, 1);
  assert.equal(get("ruhmreich").tier, 2);
  assert.equal(get("ruhmreich").tiers[1].text, "Platz 1 bis 3");

  clearRankingCache();
  const rk = await rankingView(engine, A.playerId);
  const row = rk.rows.find((r) => r.playerId === B.playerId)!;
  assert.ok(row.badges.length > 0 && row.badges.length <= 3);
  assert.equal(row.badges[0].tier, 2);
});

test("Wochenziele: Vergabe idempotent, Fortschritt, Mindeststufe, Abholen genau einmal, Bonus einmal je Woche", async () => {
  const views = await Promise.all(Array.from({ length: 5 }, () => weeklyView(engine, A.playerId)));
  const v = views[0];
  assert.equal(v.goals.length, 3);
  for (const x of views) assert.deepEqual(x.goals.map((g) => g.id), v.goals.map((g) => g.id));
  assert.equal(v.week, weekKey(Date.now()));
  assert.ok(v.nextWeekAtMs > Date.now() && v.nextWeekAtMs - Date.now() <= 7 * 86400000 + 3600000);
  for (const g of v.goals) assert.ok(g.reward.credits > 0 && g.text.length > 5);

  // Feste Ziele für den Test: Nester ab Stufe 3, Beute, Gebäudestufen.
  const wg = tables.weeklyGoal;
  const specs = [{ kind: "nester", param: "3", target: 2 }, { kind: "beute", param: null, target: 1000 }, { kind: "gebaeudestufen", param: null, target: 2 }];
  for (const [slot, s] of specs.entries()) {
    await db.update(wg).set({ ...s, progress: 0, completedAt: null, claimedAt: null, bonus: null })
      .where(and(eq(wg.playerId, A.playerId), eq(wg.week, v.week), eq(wg.slot, slot)));
  }
  await recordAchievement(db, A.playerId, "nester", 1, { level: 2 }); // zu niedrige Stufe
  await recordAchievement(db, A.playerId, "nester", 1, { level: 4 });
  await recordAchievement(db, A.playerId, "beute", 600);
  await recordAchievement(db, A.playerId, "gebaeudestufen", 5);
  let w = await weeklyView(engine, A.playerId);
  assert.deepEqual(w.goals.map((g) => [g.progress, g.done]), [[1, false], [600, false], [2, true]]);
  assert.deepEqual(await claimWeekly(engine, A.playerId, key(), w.goals[0].id), { ok: false, code: "not_done" });
  await recordAchievement(db, A.playerId, "nester", 1, { level: 3 });
  await recordAchievement(db, A.playerId, "beute", 600);
  w = await weeklyView(engine, A.playerId);
  assert.equal(w.claimable, 3);

  const credits = await creditsOf(A.playerId);
  const wz = await counter(A.playerId, "wochenziele");
  const r1 = await claimWeekly(engine, A.playerId, key(), w.goals[0].id);
  const r2 = await claimWeekly(engine, A.playerId, key(), w.goals[1].id);
  assert.equal((r1 as { bonus: unknown }).bonus, null);
  assert.equal((r2 as { bonus: unknown }).bonus, null);
  assert.deepEqual(await claimWeekly(engine, A.playerId, key(), w.goals[1].id), { ok: false, code: "already_claimed" });
  const r3 = await claimWeekly(engine, A.playerId, key(), w.goals[2].id);
  assert.equal(r3.ok, true);
  const bonus = (r3 as { bonus: Record<string, number> }).bonus;
  assert.ok(bonus && bonus.credits > 0);
  const paid = [r1, r2, r3].reduce((a, r) => a + (r as { reward: Record<string, number> }).reward.credits, 0) + bonus.credits;
  assert.equal(Math.round((await creditsOf(A.playerId)) * 100), Math.round((credits + paid) * 100));
  assert.equal(await counter(A.playerId, "wochenziele"), wz + 3);
  w = await weeklyView(engine, A.playerId);
  assert.equal(w.bonus.paid, true);
  assert.equal(w.claimable, 0);
  // Bonus nur einmal: auch wenn ein Ziel erneut abgeholt würde.
  const bonusRows = await db.select().from(wg).where(and(eq(wg.playerId, A.playerId), eq(wg.week, v.week), sql`${wg.bonus} is not null`));
  assert.equal(bonusRows.length, 1);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Wochenwechsel: Fortschritt zählt in der Woche des Geschehens, alte Woche bleibt abholbar", async () => {
  const wg = tables.weeklyGoal;
  const lastWeekMs = weekStartMs(weekKey(Date.now())) - 3600000; // Sonntag 23:00 Ortszeit der Vorwoche
  const lastWeek = weekKey(lastWeekMs);
  assert.notEqual(lastWeek, weekKey(Date.now()));
  await db.insert(wg).values({ playerId: B.playerId, week: lastWeek, slot: 0, kind: "spionage", target: 2, reward: { credits: 50, stahl: 100 } });
  const cur = await weeklyView(engine, B.playerId);
  await db.update(wg).set({ kind: "spionage", target: 5, progress: 0, completedAt: null }).where(eq(wg.id, cur.goals[0].id));
  await recordAchievement(db, B.playerId, "spionage", 2, { atMs: lastWeekMs });
  const [old] = await db.select().from(wg).where(and(eq(wg.playerId, B.playerId), eq(wg.week, lastWeek)));
  assert.equal(old.progress, 2);
  assert.ok(old.completedAt);
  const now = await weeklyView(engine, B.playerId);
  assert.equal(now.goals[0].progress, 0);
  assert.equal(now.older.length, 1);
  assert.equal(now.older[0].week, lastWeek);
  const r = await claimWeekly(engine, B.playerId, key(), old.id);
  assert.equal(r.ok, true);
  assert.equal((r as { bonus: unknown }).bonus, null);
});
