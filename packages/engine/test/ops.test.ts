// Integrationstests für Verwaltung, Betrieb, Push und E-Mail gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, hexCenter, isTradePortHex } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  AlertMemory,
  applyAdminNames,
  backlogHealthy,
  changePassword,
  checkOps,
  chooseBase,
  createInvite,
  createResetCode,
  decryptSecret,
  deliverNotices,
  disableInvite,
  encryptSecret,
  ensureVapid,
  flushMailDigests,
  GameError,
  launchMission,
  weatherModifiers,
  listInvites,
  login,
  mailNotice,
  opsStatus,
  playerForToken,
  processDue,
  pushSubscribe,
  register,
  renderMail,
  resetPassword,
  saveSmtp,
  seed,
  setMailSender,
  setPushSender,
  smtpView,
  verifyEmail,
  unsubscribeEmail,
  type Engine,
  type NoticeJob,
  type OutgoingMail,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pushed: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => pushed.push(...jobs) };
let keyN = 0;
const key = () => `o${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newPlayer(name: string, field: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, token: p.token, baseId: (r as { baseId: number }).baseId, ...f };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  delete process.env.ADMIN_NAMES;
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
});

after(async () => {
  setPushSender(null);
  setMailSender(null);
  await client.end();
});

let admin: Awaited<ReturnType<typeof newPlayer>>;
let other: Awaited<ReturnType<typeof newPlayer>>;

test("Admin: erster Spieler ohne ADMIN_NAMES, sonst genau die Liste", async () => {
  admin = await newPlayer("Ada", 40);
  other = await newPlayer("Otto", 43);
  assert.equal((await playerForToken(db, admin.token))!.isAdmin, true);
  assert.equal((await playerForToken(db, other.token))!.isAdmin, false);
  const r = await applyAdminNames(db, " otto , ada");
  assert.deepEqual(r.admins.sort(), ["Ada", "Otto"]);
  await applyAdminNames(db, "ada");
  assert.equal((await playerForToken(db, other.token))!.isAdmin, false);
  await applyAdminNames(db, "");
  assert.equal((await playerForToken(db, admin.token))!.isAdmin, true);
});

test("Einladungscodes: anlegen, zufällig, deaktivieren; migrate aktiviert nicht wieder", async () => {
  const free = await createInvite(db, { code: "KLUB", maxUses: 2 });
  assert.equal(free.code, "KLUB");
  await assert.rejects(createInvite(db, { code: "KLUB", maxUses: 1 }), (e: unknown) => e instanceof GameError && e.code === "invite_exists");
  const rnd = await createInvite(db, { maxUses: 1 });
  assert.match(rnd.code, /^[A-Z0-9]{8}$/);
  await register(db, { inviteCode: "KLUB", name: "Klubber", password: "geheim123" });
  const list = await listInvites(db);
  assert.equal(list.find((i) => i.code === "KLUB")!.uses, 1);
  assert.equal(await disableInvite(db, "KLUB"), true);
  await assert.rejects(register(db, { inviteCode: "KLUB", name: "Klubber2", password: "geheim123" }), /invite_invalid/);
  await seed(db, "KLUB:5");
  await assert.rejects(register(db, { inviteCode: "KLUB", name: "Klubber3", password: "geheim123" }), /invite_invalid/);
});

test("Rücksetzcode: einmalig, Name muss passen, beendet Sitzungen", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Vergess", password: "altesPasswort" });
  const { code } = await createResetCode(db, admin.playerId, p.playerId);
  await assert.rejects(resetPassword(db, { name: "Otto", code, password: "neuesPasswort" }), /bad_reset/);
  const r = await resetPassword(db, { name: "vergess", code: code.toLowerCase(), password: "neuesPasswort" });
  assert.equal(r.playerId, p.playerId);
  assert.equal(await playerForToken(db, p.token), null);
  assert.ok(await playerForToken(db, r.token));
  await assert.rejects(resetPassword(db, { name: "Vergess", code, password: "nochmalNeu1" }), /bad_reset/);
  await assert.rejects(login(db, { name: "Vergess", password: "altesPasswort" }), /bad_login/);
  await login(db, { name: "Vergess", password: "neuesPasswort" });
  // Abgelaufene Codes gelten nicht.
  const c2 = await createResetCode(db, admin.playerId, p.playerId);
  await db.update(tables.passwordReset).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(tables.passwordReset.playerId, p.playerId));
  await assert.rejects(resetPassword(db, { code: c2.code, password: "nochmalNeu1" }), /bad_reset/);
});

test("Passwort ändern: altes Passwort nötig, andere Sitzungen enden", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Wechsel", password: "erstesPass" });
  const second = await login(db, { name: "Wechsel", password: "erstesPass" });
  await assert.rejects(changePassword(db, p.playerId, p.token, "falsch!!", "zweitesPass"), /bad_password/);
  await changePassword(db, p.playerId, p.token, "erstesPass", "zweitesPass");
  assert.ok(await playerForToken(db, p.token));
  assert.equal(await playerForToken(db, second.token), null);
  await login(db, { name: "Wechsel", password: "zweitesPass" });
});

test("Angriff auf Spielerhafen plant attack_warning nach Radar-Vorwarnzeit; Push mit gemocktem Sender", async () => {
  await ensureVapid(db);
  const sentPush: { endpoint: string; payload: string }[] = [];
  setPushSender(async (sub, payload) => {
    if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sentPush.push({ endpoint: sub.endpoint, payload });
  });
  await pushSubscribe(db, other.playerId, { endpoint: "https://push.example/ok", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
  await pushSubscribe(db, other.playerId, { endpoint: "https://push.example/gone", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
  await patchBase(admin.baseId, (s) => { s.units = { korvette: 2, landungsschiff: 1, schuetzen: 50 }; s.resources.treibstoff = 50000; s.buildings.hafenkommandantur = 4; });
  // v1.6: Das Radar braucht Strom (Kraftwerk); Nebel am Hafen kürzt die Vorwarnzeit.
  await patchBase(other.baseId, (s) => { s.protection.createdAtMs = 0; s.buildings.radarstation = 2; s.buildings.kraftwerk = 1; });
  const m = await launchMission(engine, admin.playerId, key(), { type: "ueberfall", units: { korvette: 1, landungsschiff: 1, schuetzen: 50 }, col: other.col, row: other.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const missionId = (m as { missionId: number }).missionId;
  const arriveAtMs = (m as { arriveAtMs: number }).arriveAtMs;
  const [ev] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "attack_warning"), sql`(payload->>'missionId')::int = ${missionId}`));
  assert.ok(ev, "attack_warning geplant");
  assert.equal(ev.baseId, other.baseId);
  const fog = weatherModifiers({ site: hexCenter(other.col, other.row), buildings: { radarstation: 2 } } as unknown as BaseState, Date.now()).radarWarning ?? 1;
  const warnMin = (10 + 5 * 2) * fog; // warningMinutesBase + perLevel * 2, mal Nebel
  assert.ok(Math.abs(ev.dueAt.getTime() - Math.max(Date.now(), arriveAtMs - warnMin * 60000)) < 5000);

  pushed.length = 0;
  await processDue(engine, ev.dueAt.getTime() + 1, 10);
  const warn = pushed.find((j) => j.notice.kind === "attack");
  assert.ok(warn, "Angriff erkannt gemeldet");
  assert.equal(warn.playerId, other.playerId);
  await deliverNotices(engine, [warn]);
  assert.equal(sentPush.length, 1);
  assert.equal(JSON.parse(sentPush[0].payload).title, "Angriff erkannt");
  const subs = await db.select().from(tables.pushSubscription).where(eq(tables.pushSubscription.playerId, other.playerId));
  assert.deepEqual(subs.map((s) => s.endpoint), ["https://push.example/ok"], "410 entfernt das Abo");

  // Art abgeschaltet: nichts versandt.
  await db.update(tables.pushSubscription).set({ prefs: { report: false } }).where(eq(tables.pushSubscription.playerId, other.playerId));
  pushed.length = 0;
  await processDue(engine, arriveAtMs + 1, 1000);
  const reports = pushed.filter((j) => j.notice.kind === "report");
  // Unterwegs (mehrere Tage) greift auch das Kartell an; hier zählt der Bericht dieses Überfalls.
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, missionId));
  const own = reports.filter((j) => j.notice.tag === `report-${arrived.reportId}`);
  assert.deepEqual(own.map((j) => j.playerId).sort(), [admin.playerId, other.playerId].sort());
  assert.ok(reports.some((j) => j.playerId === other.playerId && j.notice.body.includes("Freibeuter-Kartell")), "Kartell-Bericht gemeldet");
  sentPush.length = 0;
  await deliverNotices(engine, reports.filter((j) => j.playerId === other.playerId));
  assert.equal(sentPush.length, 0);

  // Verband zurück
  const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, missionId));
  pushed.length = 0;
  await processDue(engine, row.returnAt!.getTime() + 1, 1000);
  assert.ok(pushed.some((j) => j.notice.kind === "fleet" && j.playerId === admin.playerId));
});

test("Alarm-Kennzahlen: Rückstau, Fehler, Prüflauf, Sicherung; Meldung höchstens einmal je Stunde", async () => {
  const now = Date.now();
  let s = await opsStatus(db, now);
  await db.insert(tables.gameEvent).values({ type: "noop_test", dueAt: new Date(now - 15 * 60000), payload: {}, status: "pending" });
  await db.insert(tables.gameEvent).values({ type: "kaputt", dueAt: new Date(now), payload: {}, status: "failed", lastError: "Error: kaputt\n at x" });
  await db.insert(tables.auditRun).values({ ok: 0, details: {} });
  await db.insert(tables.backupRun).values({ file: "alt.dump", createdAt: new Date(now - 30 * 3600000) });
  s = await opsStatus(db, now);
  assert.equal(s.backlog.count, 1);
  assert.ok(s.backlog.oldestOverdueSec >= 14 * 60);
  assert.equal(backlogHealthy(s), false);
  assert.equal(s.failed.count, 1);
  assert.equal(s.failed.lastError, "Error: kaputt");
  assert.equal(s.audit?.ok, false);
  assert.ok(s.backup && s.backup.ageHours > 29);
  assert.deepEqual(s.problems.map((p) => p.key.split(":")[0]).sort(), ["audit", "backlog", "backup", "failed"]);

  const sent: string[] = [];
  setPushSender(async (_sub, payload) => { sent.push(JSON.parse(payload).title); });
  await pushSubscribe(db, admin.playerId, { endpoint: "https://push.example/admin", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } });
  const mem = new AlertMemory();
  await checkOps(engine, mem, now);
  assert.equal(sent.length, 1, "eine Meldung an den einen Admin");
  await checkOps(engine, mem, now + 10 * 60000);
  assert.equal(sent.length, 1, "kein zweiter Alarm innerhalb der Stunde");
  await checkOps(engine, mem, now + 61 * 60000);
  assert.equal(sent.length, 2);
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "noop_test"));
  await db.insert(tables.backupRun).values({ file: "neu.dump" });
  s = await opsStatus(db);
  assert.equal(backlogHealthy(s), true);
  assert.ok(!s.problems.some((p) => p.key === "backup"));
});

test("Verschlüsselung: AES-256-GCM rund, falscher Schlüssel scheitert; SMTP-Passwort nie im Klartext", async () => {
  const blob = encryptSecret("app-passwort", "schluessel-1234567890");
  assert.notEqual(blob, encryptSecret("app-passwort", "schluessel-1234567890"), "zufälliger IV");
  assert.equal(decryptSecret(blob, "schluessel-1234567890"), "app-passwort");
  assert.throws(() => decryptSecret(blob, "anderer-schluessel-123"));
  assert.throws(() => encryptSecret("x", ""));
  const r = await saveSmtp(db, { enabled: true, provider: "icloud", host: "", port: 1, security: "none", user: "ich@icloud.com", password: "abcd-efgh", fromName: "TIDEFRONT", fromAddress: "ich@icloud.com" });
  assert.deepEqual(r, { ok: true });
  const view = await smtpView(db);
  assert.equal(view.passwordSet, true);
  assert.equal(view.config.host, "smtp.mail.me.com");
  assert.equal(view.config.port, 587);
  assert.equal(JSON.stringify(view).includes("abcd-efgh"), false);
  const [raw] = await db.select().from(tables.serverSetting).where(eq(tables.serverSetting.key, "smtp"));
  assert.equal(raw.value.includes("abcd-efgh"), false);
  const secret = process.env.APP_SECRET;
  delete process.env.APP_SECRET;
  assert.deepEqual(await saveSmtp(db, { ...view.config, password: "x" }), { ok: false, code: "no_secret" });
  assert.equal((await smtpView(db)).secretAvailable, false);
  process.env.APP_SECRET = secret;
});

test("Mail-Vorlage: Kopf, Kennzahlen, Knopf, Abmeldelink, Textversion, HTML maskiert", () => {
  const m = renderMail({
    subject: "Angriff erkannt", heading: "Angriff <erkannt>", paragraphs: ["Otto greift an & mehr"],
    facts: [["Ankunft in", "12 Min."]], button: { label: "Im Spiel öffnen", url: "https://x.test/?tab=basis" },
    unsubscribeUrl: "https://x.test/api/mail/unsubscribe?t=abc",
  });
  assert.equal(m.subject, "TIDEFRONT: Angriff erkannt");
  assert.ok(m.html.includes("Angriff &lt;erkannt&gt;"));
  assert.ok(m.html.includes("Otto greift an &amp; mehr"));
  assert.ok(m.html.includes("prefers-color-scheme: dark"));
  assert.ok(m.html.includes("12 Min."));
  assert.ok(m.html.includes("https://x.test/api/mail/unsubscribe?t=abc"));
  assert.ok(m.text.includes("Ankunft in: 12 Min."));
  assert.ok(m.text.includes("Im Spiel öffnen: https://x.test/?tab=basis"));
  assert.ok(m.text.includes("Abbestellen: https://x.test/api/mail/unsubscribe?t=abc"));
});

test("E-Mail: Bestätigung, sofortiger Versand, Bündelung höchstens alle 30 Minuten, Abmelden", async () => {
  const mails: OutgoingMail[] = [];
  setMailSender(async (_cfg, mail) => { mails.push(mail); });
  const { setEmail } = await import("../src/index.ts");
  const r = await setEmail(engine, other.playerId, "otto@example.org");
  assert.deepEqual(r, { ok: true, sent: true });
  const link = mails[0].text.match(/verify\?t=([0-9a-f]{64})/);
  assert.ok(link);
  const n = { kind: "build" as const, title: "Ausbau fertig", body: "Werft ist jetzt auf Stufe 2." };
  assert.equal(await mailNotice(engine, other.playerId, n), "skipped", "unbestätigt: nichts");
  assert.equal(await verifyEmail(db, link[1]), true);
  assert.equal(await verifyEmail(db, link[1]), false, "Link nur einmal");
  await db.update(tables.playerEmail).set({ prefs: { build: true, training: true } }).where(eq(tables.playerEmail.playerId, other.playerId));

  mails.length = 0;
  assert.equal(await mailNotice(engine, other.playerId, { kind: "attack", title: "Angriff erkannt", body: "Ada greift an." }), "sent");
  assert.equal(mails.length, 1);
  assert.ok(mails[0].headers?.["List-Unsubscribe"]);
  mails.length = 0;
  const t0 = Date.now();
  assert.equal(await mailNotice(engine, other.playerId, n), "queued");
  assert.equal(await mailNotice(engine, other.playerId, { ...n, kind: "training", title: "Ausbildung fertig", body: "Bereit: 5 Schützen." }), "queued");
  assert.equal(await flushMailDigests(engine, t0), 1);
  assert.equal(mails.length, 1);
  assert.ok(mails[0].subject.includes("2 Meldungen"));
  assert.ok(mails[0].text.includes("Bereit: 5 Schützen."));
  await mailNotice(engine, other.playerId, n);
  assert.equal(await flushMailDigests(engine, t0 + 10 * 60000), 0, "innerhalb von 30 Minuten gesammelt");
  assert.equal(await flushMailDigests(engine, t0 + 31 * 60000), 1);
  assert.equal(mails.length, 2);

  const token = mails[1].text.match(/unsubscribe\?t=([0-9a-f]{48})/)![1];
  assert.equal(await unsubscribeEmail(db, token), true);
  assert.equal(await mailNotice(engine, other.playerId, { kind: "attack", title: "x", body: "y" }), "skipped");

  // Fehler beim Versand werden als Zustand gespeichert.
  setMailSender(async () => { throw new Error("535 Auth failed"); });
  const { sendMail } = await import("../src/index.ts");
  const f = await sendMail(engine, "x@example.org", { subject: "s", heading: "h", paragraphs: [] });
  assert.equal(f.ok, false);
  assert.equal((await smtpView(db)).lastError?.message, "535 Auth failed");
  assert.equal((await opsStatus(db)).mail.lastError?.message, "535 Auth failed");
});
