// Integrationstests „Fehler melden“ gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Speichern ohne
// SMTP, Ratenlimit je Spieler, Screenshot-Prüfung, E-Mail mit Anhängen an die Admins, Verwaltung, Größengrenze des Wegs.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createDb, migrateDb, tables } from "@tidefront/db";
import {
  BUG_REPORT_LIMIT_PER_HOUR,
  decodeScreenshot,
  register,
  saveSmtp,
  seed,
  setMailSender,
  type Engine,
  type OutgoingMail,
} from "../src/index.ts";
import { bugReportRouter, registerBugReportBodyLimit } from "../../../apps/api/src/routers/bug-report.ts";
import { t, type Ctx } from "../../../apps/api/src/trpc.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const caller = t.createCallerFactory(bugReportRouter);
const ctxFor = (player: Ctx["player"]): Ctx => ({ engine, player, token: undefined, setSession: () => {}, rateLimit: async () => true, ip: "127.0.0.1" });

// Kleinstes gültiges JPEG-Gerüst (Signatur FF D8 FF) und ein falsches Bild.
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString("base64")}`;
const FAKE = `data:image/jpeg;base64,${Buffer.from("kein bild").toString("base64")}`;
const input = (over: Partial<{ subject: string; text: string; screenshot: string | null; log: string }> = {}) => ({
  subject: "Fehler: Karte (v0.10.1)",
  text: "Karte bleibt leer.",
  meta: { version: "0.10.1", bildschirm: "Karte", spielername: "gefälscht" },
  log: "2026-11-26T10:00:00.000Z [error] boom",
  screenshot: JPEG,
  ...over,
});

let admin: { id: number; name: string; isAdmin: boolean };
let player: { id: number; name: string; isAdmin: boolean };

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  delete process.env.ADMIN_NAMES;
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
  const a = await register(db, { inviteCode: "TEST", name: "Ada", password: "geheim123" });
  const p = await register(db, { inviteCode: "TEST", name: "Otto", password: "geheim123" });
  admin = { id: a.playerId, name: "Ada", isAdmin: true };
  player = { id: p.playerId, name: "Otto", isAdmin: false };
});

after(async () => {
  setMailSender(null);
  await client.end();
});

test("Screenshot: nur echte JPEG/PNG/WebP-Daten, Größe begrenzt", () => {
  assert.equal(decodeScreenshot(JPEG)?.type, "image/jpeg");
  assert.equal(decodeScreenshot(FAKE), null);
  assert.equal(decodeScreenshot("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(decodeScreenshot(`data:image/jpeg;base64,${Buffer.alloc(1_300_000, 0xff).toString("base64")}`), null);
});

test("Ohne SMTP: Meldung wird gespeichert, nicht gemailt; Spielername kommt vom Server", async () => {
  const sent: OutgoingMail[] = [];
  setMailSender(async (_c, m) => { sent.push(m); });
  const r = await caller(ctxFor(player)).send(input());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((r as { mailed: boolean }).mailed, false);
  assert.equal(sent.length, 0);
  const [row] = await db.select().from(tables.bugReport).where(eq(tables.bugReport.id, (r as { id: number }).id));
  assert.equal(row.playerId, player.id);
  assert.equal(row.status, "offen");
  assert.equal(row.screenshotType, "image/jpeg");
  assert.ok(Buffer.isBuffer(row.screenshot) && row.screenshot[0] === 0xff);
  assert.equal(row.mailedAt, null);
  assert.equal((row.meta as Record<string, unknown>).spieler, "Otto");
  assert.ok(row.log.includes("boom"));
});

test("Falscher Screenshot wird abgelehnt, ohne Screenshot geht es", async () => {
  assert.deepEqual(await caller(ctxFor(player)).send(input({ screenshot: FAKE })), { ok: false, code: "bad_screenshot" });
  const r = await caller(ctxFor(player)).send(input({ screenshot: null }));
  assert.equal(r.ok, true);
});

test("Ratenlimit: höchstens fünf Meldungen je Spieler und Stunde, dazu kurze Drossel", async () => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.bugReport).where(eq(tables.bugReport.playerId, player.id));
  for (let i = n; i < BUG_REPORT_LIMIT_PER_HOUR; i++) assert.equal((await caller(ctxFor(player)).send(input())).ok, true);
  assert.deepEqual(await caller(ctxFor(player)).send(input()), { ok: false, code: "rate" });
  // Ältere Meldungen zählen nicht mehr.
  await db.execute(sql`update bug_report set created_at = now() - interval '2 hours' where player_id = ${player.id}`);
  assert.equal((await caller(ctxFor(player)).send(input())).ok, true);
  // Kurzzeitdrossel des Wegs (Valkey) greift ebenfalls.
  const limited = { ...ctxFor(admin), rateLimit: async (bucket: string) => !bucket.startsWith("bug:") };
  assert.deepEqual(await caller(limited).send(input()), { ok: false, code: "rate" });
});

test("Mit SMTP: E-Mail an Admins mit Log und Screenshot als Anhang; eingestellte Adresse hat Vorrang", async () => {
  const sent: OutgoingMail[] = [];
  setMailSender(async (_c, m) => { sent.push(m); });
  await saveSmtp(db, { enabled: true, provider: "custom", host: "smtp.test", port: 25, security: "none", user: "", password: "", fromName: "TF", fromAddress: "tf@example.org" });
  await db.insert(tables.playerEmail).values({ playerId: admin.id, email: "ada@example.org", verifiedAt: new Date(), unsubscribeToken: "a".repeat(48) });
  const r = await caller(ctxFor(admin)).send(input({ text: "Mit <b>HTML</b>" }));
  assert.equal(r.ok, true);
  assert.equal((r as { mailed: boolean }).mailed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ada@example.org");
  assert.ok(sent[0].subject.includes("Fehlermeldung #"));
  assert.ok(sent[0].html.includes("Mit &lt;b&gt;HTML&lt;/b&gt;"));
  assert.deepEqual(sent[0].attachments?.map((a) => a.filename), ["bug-log.txt", "screenshot.jpg"]);
  const [row] = await db.select().from(tables.bugReport).where(eq(tables.bugReport.id, (r as { id: number }).id));
  assert.ok(row.mailedAt);

  const adminCaller = caller(ctxFor(admin));
  assert.deepEqual(await adminCaller.setRecipients({ to: "kein-adresse" }), { ok: false, code: "bad_email" });
  assert.deepEqual(await adminCaller.setRecipients({ to: "bugs@example.org, zwei@example.org" }), { ok: true });
  sent.length = 0;
  await adminCaller.send(input({ screenshot: null }));
  assert.deepEqual(sent.map((m) => m.to), ["bugs@example.org", "zwei@example.org"]);
  assert.deepEqual(sent[0].attachments?.map((a) => a.filename), ["bug-log.txt"]);
});

test("Verwaltung: Liste ohne Bilddaten, Einzelansicht mit Screenshot, Status umschalten; nur Admins", async () => {
  await assert.rejects(caller(ctxFor(player)).list(), /FORBIDDEN/);
  await assert.rejects(caller(ctxFor(null)).send(input()), /UNAUTHORIZED/);
  const c = caller(ctxFor(admin));
  const list = await c.list();
  assert.ok(list.reports.length >= 3);
  assert.equal(JSON.stringify(list).includes("base64"), false);
  const withShot = list.reports.find((r) => r.hasScreenshot)!;
  const d = await c.get({ id: withShot.id });
  assert.ok(d?.screenshot?.startsWith("data:image/jpeg;base64,"));
  assert.deepEqual(await c.setStatus({ id: withShot.id, status: "erledigt" }), { ok: true });
  assert.equal((await c.list()).reports.find((r) => r.id === withShot.id)?.status, "erledigt");
  assert.deepEqual(await c.setStatus({ id: 999999, status: "offen" }), { ok: false });
});

test("Größengrenze: nur bugReport.send darf mehr als die allgemeine Grenze senden", async () => {
  const app = Fastify({ bodyLimit: 1024 });
  registerBugReportBodyLimit(app, 1024);
  const router = t.router({ bugReport: bugReportRouter, ping: t.procedure.mutation(() => "pong") });
  await app.register(fastifyTRPCPlugin, { prefix: "/trpc", trpcOptions: { router, createContext: () => ctxFor(null) } });
  const big = JSON.stringify(input({ log: "x".repeat(50_000) }));
  const other = await app.inject({ method: "POST", url: "/trpc/ping", payload: big, headers: { "content-type": "application/json" } });
  assert.equal(other.statusCode, 413);
  const bug = await app.inject({ method: "POST", url: "/trpc/bugReport.send", payload: big, headers: { "content-type": "application/json" } });
  // Nicht an der Größe gescheitert, sondern an der fehlenden Anmeldung.
  assert.equal(bug.statusCode, 401);
  await app.close();
});
