// Integrationstests Verwaltung: Sicherungen (Liste, Download-Token, Route, Aufträge) und Statistik
// gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { TRPCError } from "@trpc/server";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { productionRates, settle, type BaseState } from "@tidefront/game-core";
import {
  adminStats,
  adminStatsCached,
  backupFile,
  backupRequests,
  balance,
  chooseBase,
  clearAdminStatsCache,
  consumeDownloadToken,
  createDownloadToken,
  dayList,
  isBackupName,
  listBackups,
  register,
  pendingBackupDeletes,
  requestBackup,
  requestBackupDelete,
  seed,
  type Engine,
} from "../src/index.ts";
import { registerBackupDownload } from "../../../apps/api/src/routers/backup-download.ts";
import { adminStatsRouter } from "../../../apps/api/src/routers/adminstats.ts";
import { t, type Ctx } from "../../../apps/api/src/trpc.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const COOKIE = "tf_session";
const dir = mkdtempSync(join(tmpdir(), "tf-backups-"));
const outside = mkdtempSync(join(tmpdir(), "tf-outside-"));
const app = Fastify();
let keyN = 0;
const key = () => `a${++keyN}-${Date.now()}`;

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
  return { id: p.playerId, token: p.token, baseId: (r as { baseId: number }).baseId };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

let admin: Awaited<ReturnType<typeof newPlayer>>;
let p2: Awaited<ReturnType<typeof newPlayer>>;
let p3: Awaited<ReturnType<typeof newPlayer>>;
let p4: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  delete process.env.ADMIN_NAMES;
  admin = await newPlayer("Ada", 40);
  p2 = await newPlayer("Bert", 43);
  p3 = await newPlayer("Cleo", 46);
  p4 = await newPlayer("Dora", 49);
  writeFileSync(join(dir, "tidefront-20261120-040000.dump"), "taeglich-inhalt");
  writeFileSync(join(dir, "tidefront-20261121-101500-manuell.dump"), "manuell-inhalt-123");
  writeFileSync(join(dir, "notizen.txt"), "x");
  writeFileSync(join(dir, ".tidefront-20261122-040000.dump.part"), "halb");
  mkdirSync(join(dir, "tidefront-ordner.dump"));
  writeFileSync(join(outside, "geheim.txt"), "nicht herausgeben");
  symlinkSync(join(outside, "geheim.txt"), join(dir, "tidefront-link.dump"));
  await app.register(cookie);
  registerBackupDownload(app, engine, { cookieName: COOKIE, rateLimit: async () => true, dir });
  await app.ready();
});

after(async () => {
  await app.close();
  await client.end();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------- Zugriffsschutz tRPC

const caller = t.createCallerFactory(adminStatsRouter);
function ctxFor(player: Ctx["player"]): Ctx {
  return { engine, player, token: undefined, setSession: () => {}, rateLimit: async () => true, ip: "127.0.0.1" };
}

test("Zugriffsschutz: alle Prozeduren nur für Admins (ohne Anmeldung 401, Spieler 403)", async () => {
  const calls = [
    (c: ReturnType<typeof caller>) => c.stats({ days: 7 }),
    (c: ReturnType<typeof caller>) => c.backups(),
    (c: ReturnType<typeof caller>) => c.backupNow(),
    (c: ReturnType<typeof caller>) => c.backupToken({ name: "tidefront-20261120-040000.dump" }),
    (c: ReturnType<typeof caller>) => c.backupDelete({ name: "tidefront-20261120-040000.dump" }),
  ];
  for (const call of calls) {
    await assert.rejects(call(caller(ctxFor(null))), (e: unknown) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
    await assert.rejects(call(caller(ctxFor({ id: p2.id, name: "Bert", isAdmin: false }))), (e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
  }
  const r = await caller(ctxFor({ id: admin.id, name: "Ada", isAdmin: true })).stats({ days: 28 });
  assert.equal(r.days, 28);
  await assert.rejects(caller(ctxFor({ id: admin.id, name: "Ada", isAdmin: true })).stats({ days: 9 as 7 }));
});

// ---------------------------------------------------------------- Sicherungen: Liste und Pfade

test("Liste: nur reguläre Dateien nach Muster tidefront-*.dump, Quelle aus dem Namen, fehlendes Verzeichnis", async () => {
  const l = await listBackups(dir);
  assert.equal(l.mounted, true);
  assert.deepEqual(l.files.map((f) => [f.name, f.source, f.bytes]).sort(), [
    ["tidefront-20261120-040000.dump", "taeglich", 15],
    ["tidefront-20261121-101500-manuell.dump", "manuell", 18],
  ]);
  assert.deepEqual(await listBackups(join(dir, "fehlt")), { mounted: false, files: [] });
});

test("Pfad-Traversal und fremde Namen werden abgelehnt", async () => {
  for (const bad of ["../geheim.txt", "..%2Fgeheim.txt", "tidefront-../../etc/passwd.dump", "/etc/passwd", "tidefront-a.dump/..",
    "tidefront-.dump", "tidefront-x.dump\0", "tidefront-x.tar", "tidefront-a.b.dump", "notizen.txt"]) {
    assert.equal(isBackupName(bad), false, bad);
    assert.equal(await backupFile(dir, bad), null, bad);
  }
  // Symbolischer Link und Ordner mit passendem Namen sind keine Sicherungen.
  assert.equal(await backupFile(dir, "tidefront-link.dump"), null);
  assert.equal(await backupFile(dir, "tidefront-ordner.dump"), null);
  assert.ok(await backupFile(dir, "tidefront-20261120-040000.dump"));
  assert.deepEqual(await createDownloadToken(db, admin.id, "../geheim.txt", dir), { ok: false, code: "no_file" });
  assert.deepEqual(await createDownloadToken(db, admin.id, "tidefront-link.dump", dir), { ok: false, code: "no_file" });
});

// ---------------------------------------------------------------- Download-Route

const A = "tidefront-20261120-040000.dump";
const B = "tidefront-20261121-101500-manuell.dump";
const get = (path: string, token?: string) =>
  app.inject({ method: "GET", url: path, cookies: token ? { [COOKIE]: token } : {} });

async function tokenFor(playerId: number, name: string, nowMs = Date.now()): Promise<string> {
  const r = await createDownloadToken(db, playerId, name, dir, nowMs);
  assert.equal(r.ok, true);
  return (r as { token: string }).token;
}

test("Download: Sitzung, Admin und Token nötig; Token einmalig, an Datei gebunden, nach 60 s abgelaufen", async () => {
  const tk = await tokenFor(admin.id, A);
  assert.equal((await get(`/api/admin/backups/${A}?t=${tk}`)).statusCode, 401, "ohne Cookie");
  assert.equal((await get(`/api/admin/backups/${A}?t=${tk}`, p2.token)).statusCode, 403, "kein Admin");
  assert.equal((await get(`/api/admin/backups/${A}`, admin.token)).statusCode, 403, "ohne Token");

  const ok = await get(`/api/admin/backups/${A}?t=${tk}`, admin.token);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, "taeglich-inhalt");
  assert.equal(ok.headers["content-disposition"], `attachment; filename="${A}"`);
  assert.equal(ok.headers["content-type"], "application/octet-stream");
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal((await get(`/api/admin/backups/${A}?t=${tk}`, admin.token)).statusCode, 403, "zweites Mal");

  // Token für A gilt nicht für B und ist danach verbraucht.
  const tkA = await tokenFor(admin.id, A);
  assert.equal((await get(`/api/admin/backups/${B}?t=${tkA}`, admin.token)).statusCode, 403);
  assert.equal((await get(`/api/admin/backups/${A}?t=${tkA}`, admin.token)).statusCode, 403);

  // Abgelaufen (vor 61 s ausgestellt).
  const old = await tokenFor(admin.id, B, Date.now() - 61_000);
  assert.equal((await get(`/api/admin/backups/${B}?t=${old}`, admin.token)).statusCode, 403);
  // Token eines anderen Admins (später entzogen) wirkt nicht für diesen Admin.
  const foreign = await tokenFor(p3.id, B);
  assert.equal(await consumeDownloadToken(db, foreign, admin.id, B), false);

  const tkB = await tokenFor(admin.id, B);
  const okB = await get(`/api/admin/backups/${B}?t=${tkB}`, admin.token);
  assert.equal(okB.statusCode, 200);
  assert.equal(okB.body, "manuell-inhalt-123");
  // Token liegt nur als Hash in der Datenbank.
  const rows = await db.select().from(tables.backupDownloadToken);
  assert.ok(rows.every((r) => r.tokenHash !== tkB && r.tokenHash.length === 64));
});

test("Download: Pfad-Traversal über die Route wird abgelehnt", async () => {
  const tk = await tokenFor(admin.id, A);
  for (const p of ["..%2Fgeheim.txt", "..%2F..%2F..%2Fetc%2Fpasswd", "tidefront-..%2F..%2Fx.dump", "%2Fetc%2Fpasswd", "tidefront-a.b.dump"]) {
    const r = await get(`/api/admin/backups/${p}?t=${tk}`, admin.token);
    assert.equal(r.statusCode, 400, p);
    assert.ok(!r.body.includes("nicht herausgeben"), p);
  }
  assert.ok([400, 404].includes((await get(`/api/admin/backups/../../etc/passwd?t=${tk}`, admin.token)).statusCode));
  // Das Token wurde durch die abgelehnten Namen nicht verbraucht (Name wird vor dem Token geprüft).
  assert.equal((await get(`/api/admin/backups/${A}?t=${tk}`, admin.token)).statusCode, 200);
  // Symbolischer Link mit passendem Namen: Token für ihn gibt es nicht, und die Route liefert ihn nie aus.
  const tkL = await tokenFor(admin.id, A);
  const link = await get(`/api/admin/backups/tidefront-link.dump?t=${tkL}`, admin.token);
  assert.equal(link.statusCode, 403);
  assert.ok(!link.body.includes("nicht herausgeben"));
});

// ---------------------------------------------------------------- Sicherungsauftrag

test("Sicherungsauftrag: höchstens einer offen, Fortschritt sichtbar, verwaiste Aufträge laufen ab", async () => {
  const now = Date.now();
  const a = await requestBackup(db, admin.id, now);
  assert.equal(a.created, true);
  const b = await requestBackup(db, admin.id, now + 1000);
  assert.deepEqual(b, { id: a.id, created: false });
  let list = await backupRequests(db);
  assert.equal(list[0].status, "pending");
  assert.equal(list[0].requestedBy, "Ada");

  // So arbeitet scripts/backup.sh den Auftrag ab (dieselben Anweisungen).
  const [run] = await db.execute<{ id: number }>(sql`update backup_request set status = 'running', started_at = now()
    where id = (select id from backup_request where status = 'pending' order by id limit 1 for update skip locked) returning id`);
  assert.equal(run.id, a.id);
  assert.equal((await backupRequests(db))[0].status, "running");
  await db.execute(sql`update backup_request set status = 'done', file = 'tidefront-20261126-120000-manuell.dump', finished_at = now() where id = ${a.id}`);
  list = await backupRequests(db);
  assert.equal(list[0].status, "done");
  assert.equal(list[0].file, "tidefront-20261126-120000-manuell.dump");

  const c = await requestBackup(db, admin.id, now + 2000);
  assert.equal(c.created, true);
  // Sicherungsdienst läuft nicht: nach 15 Minuten wird der Auftrag als fehlgeschlagen abgeschlossen und ein neuer angelegt.
  const d = await requestBackup(db, admin.id, now + 16 * 60_000);
  assert.equal(d.created, true);
  const [stale] = await db.select().from(tables.backupRequest).where(eq(tables.backupRequest.id, c.id));
  assert.equal(stale.status, "failed");
  assert.match(stale.error ?? "", /Zeitüberschreitung/);
  await db.execute(sql`update backup_request set status = 'failed' where status = 'pending'`);
});

test("Löschauftrag: nur vorhandene Sicherungen, je Datei einer, stört „Jetzt sichern“ nicht", async () => {
  const name = "tidefront-20261120-040000.dump";
  assert.deepEqual(await requestBackupDelete(db, admin.id, "../etc/passwd", dir), { ok: false, code: "no_file" });
  assert.deepEqual(await requestBackupDelete(db, admin.id, "tidefront-20990101-000000.dump", dir), { ok: false, code: "no_file" });
  const a = await requestBackupDelete(db, admin.id, name, dir);
  assert.equal(a.ok, true);
  assert.deepEqual(await requestBackupDelete(db, admin.id, name, dir), a, "offener Auftrag wird wiederverwendet");
  assert.deepEqual(await pendingBackupDeletes(db), [name]);
  // Löschaufträge erscheinen nicht unter „Jetzt sichern“ und blockieren keinen neuen Sicherungsauftrag.
  assert.ok((await backupRequests(db)).every((r) => r.file !== name || r.status !== "pending"));
  const b = await requestBackup(db, admin.id);
  assert.equal(b.created, true);
  // So arbeitet scripts/backup.sh den ältesten Auftrag ab: id, kind und file in einer Zeile.
  const [row] = await db.execute<{ id: number; kind: string; file: string }>(sql`update backup_request set status = 'running', started_at = now()
    where id = (select id from backup_request where status = 'pending' order by id limit 1 for update skip locked)
    returning id, kind, coalesce(file, '') as file`);
  assert.deepEqual([row.kind, row.file], ["delete", name]);
  await db.execute(sql`update backup_request set status = 'done', finished_at = now() where id = ${row.id}`);
  assert.deepEqual(await pendingBackupDeletes(db), []);
  await db.execute(sql`update backup_request set status = 'failed' where status = 'pending'`);
});

// ---------------------------------------------------------------- Statistik

const DAY = 86400000;

async function report(v: {
  kind: string; attacker: number | null; defender: number | null; nestId?: number | null; winner: string | null;
  loot?: Record<string, number>; agoMs: number; battle?: boolean;
}, nowMs: number) {
  await db.insert(tables.battleReport).values({
    kind: v.kind, title: "t", attackerPlayerId: v.attacker, defenderPlayerId: v.defender, nestId: v.nestId ?? null,
    winner: v.winner, seed: 1, balanceVersion: "test",
    report: v.battle === false ? { nestLevel: 1 } : { battle: { winner: v.winner, loot: v.loot ?? {} } },
    createdAt: new Date(nowMs - v.agoMs),
  });
}

test("Statistik: Aktivität, Registrierungen, Fluss, Kampf, Nester, Wirtschaft, Auffälligkeiten", async () => {
  const now = Date.now();
  await db.delete(tables.battleReport);
  await db.delete(tables.tradeLedger);
  await db.execute(sql`update season set starts_at = ${new Date(now - 30 * DAY).toISOString()}::timestamptz where status = 'running'`);
  // Aktivität: Ada vor 1 h, Bert vor 3 Tagen, Cleo vor 20 Tagen, Dora nie.
  await db.update(tables.player).set({ lastSeenAt: new Date(now - 3600_000) }).where(eq(tables.player.id, admin.id));
  await db.update(tables.player).set({ lastSeenAt: new Date(now - 3 * DAY) }).where(eq(tables.player.id, p2.id));
  await db.update(tables.player).set({ lastSeenAt: new Date(now - 20 * DAY) }).where(eq(tables.player.id, p3.id));
  await db.update(tables.player).set({ lastSeenAt: null, createdAt: new Date(now - 10 * DAY) }).where(eq(tables.player.id, p4.id));

  // Wirtschaft: Kommandozentrale 1, 2, 3, 6; Dora hortet Ressourcen.
  const kz = [1, 2, 3, 6];
  const ids = [admin.baseId, p2.baseId, p3.baseId, p4.baseId];
  for (let i = 0; i < 4; i++) {
    await patchBase(ids[i], (s) => {
      s.buildings.kommandozentrale = kz[i];
      if (i === 3) for (const r of balance.resources) s.resources[r] = 2_000_000;
    });
  }

  // Kampf: 5 Überfälle Ada -> Bert am selben Zeitpunkt (3 Siege), 2 Nester Cleo (Stufe 2 gewonnen, Stufe 4 verloren),
  // 1 Nest Dora vor 20 Tagen (Stufe 1 gewonnen), 4 Kartell-Überfälle (3 Kartell-Siege), dazu leer und Aufklärung.
  const nests = await db.select().from(tables.nest);
  const nestOf = (level: number) => nests.find((n) => n.level === level)!.id;
  for (let i = 0; i < 5; i++) {
    await report({ kind: "ueberfall", attacker: admin.id, defender: p2.id, winner: i < 3 ? "attacker" : "defender", loot: { stahl: 100, treibstoff: 10 }, agoMs: 1000 }, now);
  }
  await report({ kind: "ueberfall", attacker: p3.id, defender: null, nestId: nestOf(2), winner: "attacker", loot: { stahl: 40 }, agoMs: 2 * DAY }, now);
  await report({ kind: "ueberfall", attacker: p3.id, defender: null, nestId: nestOf(4), winner: "defender", agoMs: 2 * DAY }, now);
  await report({ kind: "ueberfall", attacker: p4.id, defender: null, nestId: nestOf(1), winner: "attacker", loot: { elektronik: 7 }, agoMs: 20 * DAY }, now);
  for (let i = 0; i < 4; i++) {
    await report({ kind: "kartell", attacker: null, defender: i % 2 ? p2.id : p3.id, winner: i < 3 ? "attacker" : "defender", loot: { stahl: 30 }, agoMs: DAY }, now);
  }
  await report({ kind: "leer", attacker: p3.id, defender: null, nestId: nestOf(3), winner: null, agoMs: DAY, battle: false }, now);
  await report({ kind: "aufklaerung", attacker: p3.id, defender: null, winner: null, agoMs: DAY, battle: false }, now);

  // Börse: Kauf vor 1 Tag, Verkauf vor 10 Tagen (Spielerzeilen zählen nicht zum Umsatz).
  const line = (tradeId: string, agoMs: number, account: string, asset: string, amount: string) =>
    ({ tradeId, tMs: now - agoMs, account, asset, amount });
  await db.insert(tables.tradeLedger).values([
    line("t1", DAY, `player:${admin.id}`, "credits", "-510.00"),
    line("t1", DAY, "market", "credits", "500.00"),
    line("t1", DAY, "fees", "credits", "10.00"),
    line("t1", DAY, "market", "stahl", "-50.00"),
    line("t1", DAY, "delivery:x", "stahl", "50.00"),
    line("t2", 10 * DAY, "market", "credits", "-200.00"),
    line("t2", 10 * DAY, `player:${p2.id}`, "credits", "196.00"),
    line("t2", 10 * DAY, "fees", "credits", "4.00"),
    line("t2", 10 * DAY, `player:${p2.id}`, "stahl", "-20.00"),
    line("t2", 10 * DAY, "market", "stahl", "20.00"),
  ]);
  await db.insert(tables.gameEvent).values({ dueAt: new Date(now), type: "build_complete", payload: {}, status: "failed", lastError: "boom\n  at stack" });

  const s7 = await adminStats(db, 7, now, "Europe/Berlin");
  const s28 = await adminStats(db, 28, now, "Europe/Berlin");

  assert.deepEqual(s7.players, { total: 4, withBase: 4, active24h: 1, active7d: 2, activeSeason: 3 });
  assert.equal(s7.season?.number, 1);
  assert.equal(s7.registrations.inRange, 3);
  assert.equal(s28.registrations.inRange, 4);
  assert.equal(s7.registrations.perDay.length, 7);
  assert.equal(s28.registrations.perDay.length, 28);
  assert.equal(s7.registrations.perDay.at(-1)!.v, 3);
  assert.deepEqual(s7.registrations.perDay.map((d) => d.d), dayList(now, 7, "Europe/Berlin"));

  assert.deepEqual(s7.combat.pvp, { count: 5, attackerWins: 3 });
  assert.deepEqual(s7.combat.nests, { count: 2, attackerWins: 1 });
  assert.deepEqual(s28.combat.nests, { count: 3, attackerWins: 2 });
  assert.deepEqual(s7.combat.kartell, { count: 4, kartellWins: 3 });
  assert.equal(s7.combat.perDay.reduce((a, d) => a + d.pvp + d.nests + d.kartell, 0), 11);
  assert.equal(s7.combat.perDay.at(-1)!.pvp, 5);

  assert.deepEqual(s7.flow.loot.players, { stahl: 540, treibstoff: 50 });
  assert.deepEqual(s7.flow.loot.kartell, { stahl: 120 });
  assert.deepEqual(s28.flow.loot.players, { stahl: 540, treibstoff: 50, elektronik: 7 });
  assert.equal(s7.flow.loot.perDay.reduce((a, d) => a + d.v, 0), 540 + 50 + 120);

  assert.deepEqual(s7.flow.market, { trades: 1, creditVolume: 500, fees: 10, byResource: { stahl: 50 }, perDay: s7.flow.market.perDay });
  assert.equal(s28.flow.market.trades, 2);
  assert.equal(s28.flow.market.creditVolume, 700);
  assert.equal(s28.flow.market.fees, 14);
  assert.deepEqual(s28.flow.market.byResource, { stahl: 70 });

  // Produktion: Summe der Netto-Raten aller Stützpunkte (wie game-core sie rechnet).
  const expected: Record<string, number> = {};
  for (const b of await db.select().from(tables.base)) {
    for (const [r, v] of Object.entries(productionRates(settle(b.state as BaseState, now, balance), balance).perHour)) expected[r] = (expected[r] ?? 0) + v;
  }
  for (const r of balance.resources) assert.ok(Math.abs(s7.flow.productionPerHour[r] - expected[r]) < 0.11, r);

  assert.deepEqual(s7.nests.map((n) => [n.name, n.maxLevel, n.wins, n.attempts]), [["Cleo", 2, 1, 2], ["Dora", 1, 1, 1]]);

  assert.equal(s7.economy.bases, 4);
  assert.equal(s7.economy.avgKommandozentrale, 3);
  assert.deepEqual(s7.economy.buildings.find((b) => b.id === "kommandozentrale")!.levels, [0, 1, 1, 1, 0, 0, 1]);

  assert.deepEqual(s7.anomalies.richPlayers.map((r) => r.name), ["Dora"]);
  assert.ok(s7.anomalies.richPlayers[0].ratio > 3);
  assert.deepEqual(s7.anomalies.repeatedAttacks, [{ attacker: "Ada", defender: "Bert", maxPerDay: 5, total: 5 }]);
  assert.equal(s7.anomalies.failedEvents.count, 1);
  assert.equal(s7.anomalies.failedEvents.recent[0].error, "boom");

  // Zwischenspeicher: innerhalb von 60 s dasselbe Ergebnis, danach neu.
  clearAdminStatsCache();
  const c1 = adminStatsCached(db, 7, now);
  assert.equal(adminStatsCached(db, 7, now + 30_000), c1);
  assert.notEqual(adminStatsCached(db, 7, now + 61_000), c1);
  assert.notEqual(adminStatsCached(db, 28, now), c1);
  await Promise.all([c1, adminStatsCached(db, 28, now)]);
  clearAdminStatsCache();
});
