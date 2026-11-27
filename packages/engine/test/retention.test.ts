// Spielerbindung und Admin-Kennzahlen: neue Benachrichtigungsarten (Tagesbefehle/Serie, Bauschlange leer, Nest wieder
// besetzt), Rückhol-E-Mail einmal je Pause, Morgenbericht für neue Spieler, Tages-Aktivität und Retention, Meilensteine,
// Abschlussquoten, Laufzeitmessung. Gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  addDays, adminKpi, chooseBase, cohorts, dailyReminderJobs, dayKey, dayStartMs, deliverJobs, EMAIL_DEFAULTS, ensureVapid,
  hasNudge, milestoneKeys, milestoneRows, nestRespawnJobs, percentile, processDue, pushSubscribe, recordActivity,
  recordMilestones, recordRpc, register, resetRpcTimings, RPC_RING, rpcTimings, runReminders, runWinback, saveSmtp, seed,
  setMailSender, setPushSender, summarySettings, touchLastSeen, unsubscribeEmail, upgrade, wants, winbackMail,
  type Engine, type NoticeJob, type OutgoingMail,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pushed: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => pushed.push(...jobs) };
let keyN = 0;
const key = () => `r${++keyN}-${Date.now()}`;
const H = 3600000;
const DAY = 24 * H;
const today = dayKey(Date.now());
const at = (hour: number, day = today) => dayStartMs(day) + hour * H;

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
  const r = await chooseBase(engine, p.playerId, key(), { ...freeCoast(field), name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

const seen = (playerId: number, ms: number | null) => db.update(tables.player).set({ lastSeenAt: ms === null ? null : new Date(ms) }).where(eq(tables.player.id, playerId));

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
});

after(async () => {
  setPushSender(null);
  setMailSender(null);
  await client.end();
});

// ---------------------------------------------------------------- rein

test("Laufzeiten: Ringpuffer je Prozedur, p50/p95 nach Nearest-Rank", () => {
  resetRpcTimings();
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  for (let i = 1; i <= 100; i++) recordRpc("base.view", i);
  recordRpc("base.view", 5, false);
  recordRpc("meta", 1);
  recordRpc("meta", Number.NaN);
  const r = rpcTimings();
  const bv = r.rows.find((x) => x.path === "base.view")!;
  assert.equal(bv.count, 101);
  assert.equal(bv.errors, 1);
  assert.equal(bv.samples, 101);
  assert.equal(bv.p50, 50);
  assert.equal(bv.p95, 95);
  assert.equal(bv.max, 100);
  assert.equal(r.rows[0].path, "base.view", "langsamste zuerst");
  assert.equal(r.rows.find((x) => x.path === "meta")!.count, 1, "ungültige Messung verworfen");
  // Überlauf: nur die letzten RPC_RING Messungen zählen für die Perzentile.
  for (let i = 0; i < RPC_RING; i++) recordRpc("base.view", 1000);
  const after = rpcTimings().rows.find((x) => x.path === "base.view")!;
  assert.equal(after.samples, RPC_RING);
  assert.equal(after.p50, 1000);
  assert.equal(after.count, 101 + RPC_RING);
  resetRpcTimings();
  assert.equal(rpcTimings().rows.length, 0);
});

test("Kohorten: Tag 1/7/14 nur, wenn erreicht; Summen über Kohorten", () => {
  const d0 = "2026-11-01";
  const r = cohorts([
    { day: d0, active: new Set([d0, addDays(d0, 1), addDays(d0, 7)]) },
    { day: d0, active: new Set([d0, addDays(d0, 14)]) },
    { day: "2026-11-20", active: new Set(["2026-11-21"]) },
  ], "2026-11-22", [d0, "2026-11-20"]);
  const c0 = r.cohorts.find((c) => c.day === d0)!;
  assert.deepEqual([c0.size, c0.d1, c0.d7, c0.d14], [2, 0.5, 0.5, 0.5]);
  const c1 = r.cohorts.find((c) => c.day === "2026-11-20")!;
  assert.deepEqual([c1.d1, c1.d7, c1.d14], [1, null, null]);
  assert.deepEqual(r.total, { d1: { back: 2, of: 3 }, d7: { back: 1, of: 2 }, d14: { back: 1, of: 2 } });
});

test("Meilensteine: Schlüssel aus Hafen-Zuständen und Saisontag", () => {
  const s = { buildings: { kommandozentrale: 2, startrampe: 1 }, satellites: [{ launchedAtMs: 5000 }, { launchedAtMs: 3000 }] } as unknown as BaseState;
  const keys = milestoneKeys([s, { buildings: { kommandozentrale: 3 } } as unknown as BaseState]);
  assert.ok(keys.has("kz:1") && keys.has("kz:3") && !keys.has("kz:4"));
  assert.equal(keys.get("satellit"), 3000);
  assert.ok(keys.has("startrampe"));
  const start = Date.UTC(2026, 10, 1);
  const rows = milestoneRows([
    { key: "nest:2", bot: false, t: start + 2 * DAY + H },
    { key: "nest:2", bot: false, t: start + 5 * DAY },
    { key: "nest:2", bot: false, t: start + 9 * DAY },
    { key: "kz:3", bot: true, t: start + H },
  ], start);
  assert.deepEqual(rows.map((r) => r.id), ["kz:3", "nest:2"], "KZ vor Nestern");
  assert.deepEqual(rows[1].humans, { count: 3, firstDay: 3, medianDay: 6 });
  assert.deepEqual(rows[0].bots, { count: 1, firstDay: 1, medianDay: 1 });
});

test("Rückhol-E-Mail: Inhalt, Art „comeback“ per Vorgabe an, Abmelden schaltet ab", () => {
  assert.equal(wants(undefined, EMAIL_DEFAULTS, "comeback"), true);
  const m = winbackMail({
    name: "Wim", awayDays: 4, season: { number: 3, day: 12, days: 42 }, rank: { rank: 2, of: 9, points: 1234 },
    attacks: { count: 2, held: 1, lost: { stahl: 300 } }, storage: { fill: 1, full: true }, lostStreak: 6, idleQueue: true,
  }, "https://x.test/api/mail/unsubscribe?t=abc");
  assert.equal(m.subject, "Dein Hafen wartet – Saison 3, Tag 12");
  const text = JSON.stringify(m.blocks);
  for (const s of ["Saison 3 · Tag 12 von 42", "2 von 9", "2 (1 abgewehrt)", "300 Stahl", "gerissen (6 Tage)", "Bauschlange ist leer", "Noch 30 Tage"]) assert.ok(text.includes(s), s);
  assert.equal(m.unsubscribeUrl, "https://x.test/api/mail/unsubscribe?t=abc");
});

// ---------------------------------------------------------------- mit Datenbank

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

test("Morgenbericht: neue Spieler mit Bericht und Push, Bestandsspieler ohne Zeile bleiben aus", async () => {
  A = await newPlayer("Anke", 4);
  B = await newPlayer("Bodo", 11);
  const s = await summarySettings(db, A.playerId);
  assert.equal(s.enabled, true);
  assert.equal(s.push, true);
  // Bestandsspieler (vor der Änderung registriert) haben keine Zeile: weiterhin aus.
  await db.delete(tables.morningSummary).where(eq(tables.morningSummary.playerId, B.playerId));
  assert.equal((await summarySettings(db, B.playerId)).enabled, false);
});

test("Tages-Aktivität: idempotent je Tag, touchLastSeen trägt ein", async () => {
  await recordActivity(db, A.playerId, at(10));
  await recordActivity(db, A.playerId, at(11));
  await touchLastSeen(db, B.playerId, at(9));
  const rows = await db.select().from(tables.playerActivityDay).where(eq(tables.playerActivityDay.day, today));
  assert.deepEqual(rows.map((r) => r.playerId).sort((a, b) => a - b), [A.playerId, B.playerId].sort((a, b) => a - b));
  await db.delete(tables.playerActivityDay);
});

test("Tagesbefehle bereit: nur wer heute noch nicht da war; einmal je Tag; Morgenbericht-Push ersetzt sie", async () => {
  await seen(A.playerId, at(-4)); // gestern Abend
  await seen(B.playerId, at(-4));
  await db.insert(tables.morningSummary).values({ playerId: B.playerId, enabled: true, push: true, lastSentDay: today }).onConflictDoNothing();
  assert.equal((await dailyReminderJobs(engine, at(8))).length, 0, "vor 9 Uhr nichts");
  let jobs = await dailyReminderJobs(engine, at(10));
  assert.deepEqual(jobs.map((j) => j.playerId), [A.playerId], "B hatte heute den Morgenbericht als Push");
  assert.equal(jobs[0].notice.kind, "daily");
  assert.equal(jobs[0].key, `daily:${today}`);
  // Serie läuft: Text nennt sie.
  await db.insert(tables.dailyStreak).values({ playerId: A.playerId, lastDay: addDays(today, -1), length: 4 });
  jobs = await dailyReminderJobs(engine, at(10));
  assert.match(jobs[0].notice.body, /Serie von 4 Tagen/);
  // Versand über Push (gemockt), danach entprellt.
  await ensureVapid(db);
  const sent: string[] = [];
  setPushSender(async (_sub, payload) => { sent.push(JSON.parse(payload).title); });
  await pushSubscribe(db, A.playerId, { endpoint: "https://push.example/anke", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
  assert.equal(await runReminders(engine, at(10)), 1);
  assert.equal(await runReminders(engine, at(11)), 0, "einmal je Tag");
  assert.deepEqual(sent, ["Tagesbefehle bereit"]);
  // Wer heute schon da war, bekommt nichts.
  await seen(A.playerId, at(9));
  await db.delete(tables.playerNudge);
  assert.equal((await dailyReminderJobs(engine, at(10))).length, 0);
});

test("Serie in Gefahr: ab 18 Uhr, Serie ab 2 Tagen, nicht wenn gerade online; einmal je Tag", async () => {
  await seen(A.playerId, at(12));
  const jobs = await dailyReminderJobs(engine, at(19));
  const warn = jobs.find((j) => j.playerId === A.playerId)!;
  assert.equal(warn.notice.title, "Serie in Gefahr");
  assert.match(warn.notice.body, /Serie von 4 Tagen reißt um Mitternacht\. Noch 3 von 3/);
  assert.equal((await dailyReminderJobs(engine, at(17))).filter((j) => j.key.startsWith("streak")).length, 0, "vor 18 Uhr nicht");
  await seen(A.playerId, at(19) - 10 * 60000);
  assert.equal((await dailyReminderJobs(engine, at(19))).length, 0, "gerade online");
  await seen(A.playerId, at(12));
  assert.equal(await deliverJobs(engine, jobs), 1);
  assert.equal(await deliverJobs(engine, await dailyReminderJobs(engine, at(20))), 0);
  assert.ok(await hasNudge(db, A.playerId, `streak:${today}`));
});

test("Nest wieder besetzt: nur an den letzten Sieger, nach Ablauf der Wiederkehr, einmal", async () => {
  const [n] = await db.select().from(tables.nest).limit(1);
  const defeated = at(10) - 30 * DAY; // weit zurück: Fenster verpasst
  await db.update(tables.nest).set({ defeatedAt: new Date(defeated) }).where(eq(tables.nest.id, n.id));
  const report = (attacker: number) => ({ kind: "ueberfall", title: "Überfall", attackerPlayerId: attacker, nestId: n.id, winner: "attacker", balanceVersion: "t", report: {} });
  await db.insert(tables.battleReport).values(report(B.playerId));
  await db.insert(tables.battleReport).values(report(A.playerId)); // A zuletzt
  await seen(B.playerId, at(9));
  assert.equal((await nestRespawnJobs(engine, at(10))).length, 0, "Wiederbesetzung zu lange her");
  // Frisch besiegt: erst nach respawnHours melden.
  const { nestRespawnHours } = await import("@tidefront/game-core");
  const { balance } = await import("../src/index.ts");
  const hours = nestRespawnHours(balance, n.level);
  const t = at(10) - hours * H - 10 * 60000;
  await db.update(tables.nest).set({ defeatedAt: new Date(t) }).where(eq(tables.nest.id, n.id));
  assert.equal((await nestRespawnJobs(engine, t + hours * H - 60000)).length, 0, "noch leer");
  const jobs = await nestRespawnJobs(engine, at(10));
  assert.deepEqual(jobs.map((j) => j.playerId), [A.playerId], "nur der letzte Sieger");
  assert.equal(jobs[0].notice.kind, "nest");
  assert.equal(await deliverJobs(engine, jobs), 1);
  assert.equal(await deliverJobs(engine, await nestRespawnJobs(engine, at(10) + 60000)), 0, "entprellt");
});

test("Bauschlange leer: Meldung, wenn der letzte Auftrag fertig ist", async () => {
  await patchBase(A.baseId, (s) => { s.resources = { stahl: 20000, treibstoff: 20000, elektronik: 20000, proviant: 20000 }; });
  assert.equal((await upgrade(engine, A.playerId, key(), "stahlwerk")).ok, true);
  await patchBase(A.baseId, (s) => { s.buildQueue[0].finishesAt = Date.now() - 2000; s.buildQueue[0].startedAt = Date.now() - 5000; });
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) })
    .where(and(eq(tables.gameEvent.type, "build_complete"), eq(tables.gameEvent.status, "pending"), eq(tables.gameEvent.baseId, A.baseId)));
  pushed.length = 0;
  await processDue(engine, Date.now());
  const kinds = pushed.filter((j) => j.playerId === A.playerId).map((j) => j.notice.kind);
  assert.deepEqual(kinds, ["build", "idle"]);
  const idle = pushed.find((j) => j.notice.kind === "idle")!;
  assert.match(idle.notice.body, /Bauschlange ist leer/);
  assert.equal(idle.notice.tag, pushed.find((j) => j.notice.kind === "build")!.notice.tag, "ersetzt die Meldung auf dem Gerät");
});

test("Rückhol-E-Mail: 3–7 Tage inaktiv, einmal je Pause, neue Pause neue Mail, abbestellbar", async () => {
  const mails: OutgoingMail[] = [];
  setMailSender(async (_cfg, mail) => { mails.push(mail); });
  assert.equal((await saveSmtp(db, { enabled: true, provider: "custom", host: "smtp.test", port: 25, security: "none", user: "", password: "", fromName: "TIDEFRONT", fromAddress: "tf@x.test" })).ok, true);
  const W = await newPlayer("Wim", 30);
  await db.insert(tables.playerEmail).values({ playerId: W.playerId, email: "wim@example.org", verifiedAt: new Date(), unsubscribeToken: "cd".repeat(24) });
  const now = at(12);
  await seen(W.playerId, now - 2 * DAY);
  assert.equal(await runWinback(engine, now), 0, "erst ab 3 Tagen");
  await seen(W.playerId, now - 4 * DAY);
  assert.equal(await runWinback(engine, at(7)), 0, "nachts nicht");
  assert.equal(await runWinback(engine, now), 1);
  assert.equal(await runWinback(engine, now + H), 0, "einmal je Pause");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "wim@example.org");
  assert.match(mails[0].subject, /Dein Hafen wartet/);
  assert.ok(mails[0].headers?.["List-Unsubscribe"]);
  // Zu lange weg: keine Mail mehr.
  await seen(W.playerId, now - 8 * DAY);
  assert.equal(await runWinback(engine, now), 0);
  // Wim kommt zurück und pausiert erneut: neue Phase, neue Mail.
  await seen(W.playerId, now - 3 * DAY - H);
  assert.equal(await runWinback(engine, now), 1);
  assert.equal(mails.length, 2);
  // Abbestellt: auch die Rückhol-E-Mail ist aus.
  assert.equal(await unsubscribeEmail(db, "cd".repeat(24)), true);
  await seen(W.playerId, now - 5 * DAY);
  assert.equal(await runWinback(engine, now), 0);
});

test("Admin-Kennzahlen: Menschen/KI getrennt, Retention, Meilensteine, Abschlussquoten", async () => {
  const K = await newPlayer("Kim", 17);
  const bot = await newPlayer("Robo", 23);
  await db.update(tables.player).set({ botProfile: "haendler" }).where(eq(tables.player.id, bot.playerId));
  // Kim: vor 8 Tagen registriert, am Tag 1 und 7 wieder da.
  const reg = addDays(today, -8);
  await db.update(tables.player).set({ createdAt: new Date(at(12, reg)), lastSeenAt: new Date() }).where(eq(tables.player.id, K.playerId));
  for (const d of [reg, addDays(reg, 1), addDays(reg, 7)]) await db.insert(tables.playerActivityDay).values({ playerId: K.playerId, day: d });
  // Meilensteine: KZ 3, Satellit; zweiter Lauf trägt nichts nach.
  await patchBase(K.baseId, (s) => {
    s.buildings.kommandozentrale = 3;
    s.satellites = [{ id: 1, type: "optisch", launchedAtMs: Date.now() - H } as unknown as NonNullable<BaseState["satellites"]>[number]];
  });
  assert.ok((await recordMilestones(db, Date.now())) > 0);
  assert.equal(await recordMilestones(db, Date.now()), 0);
  // Tagesbefehle: drei vergeben, zwei erledigt, einer abgeholt.
  for (const slot of [0, 1, 2]) {
    await db.insert(tables.dailyChallenge).values({
      playerId: K.playerId, day: today, slot, kind: "test", target: 1, reward: {}, points: 1,
      completedAt: slot < 2 ? new Date() : null, claimedAt: slot === 0 ? new Date() : null,
    });
  }
  const k = await adminKpi(db, 28);
  assert.ok(k.players.bots.total >= 1 && k.players.bots.withBase >= 1);
  assert.ok(k.players.humans.total >= 4);
  const cohort = k.retention.cohorts.find((c) => c.day === reg)!;
  assert.deepEqual([cohort.size, cohort.d1, cohort.d7, cohort.d14], [1, 1, 1, null]);
  assert.ok(k.activity.some((x) => x.d === addDays(reg, 7) && x.v >= 1));
  const kz3 = k.milestones.find((m) => m.id === "kz:3")!;
  assert.ok(kz3.humans.count >= 1 && kz3.humans.firstDay! >= 1);
  assert.ok(k.milestones.some((m) => m.id === "satellit"));
  assert.ok(k.milestones.some((m) => m.id === "nest:1" || m.id.startsWith("nest:")), "Nestsiege aus Berichten");
  const slot0 = k.completion.daily.bySlot.find((s) => s.slot === 0)!;
  assert.ok(slot0.assigned >= 1 && slot0.claimed >= 1);
  assert.ok(k.completion.daily.assigned >= 3 && k.completion.daily.completed >= 2);
  assert.ok(k.completion.daily.playerDays >= 1);
});
