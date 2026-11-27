// Prüfbericht-Korrekturen: Nachtschild-Regel, Bericht-Rolle bei Transporten, Einladungscodes ohne Groß-/Kleinschreibung,
// Eingabefehler als deutsche Kurztexte. TEST_DATABASE_URL muss gesetzt sein; die Datenbank wird geleert.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { isNightShieldActive, type BaseState } from "@tidefront/game-core";
import {
  balance as gameBalance,
  baseView,
  chooseBase,
  createInvite,
  dailySummarySection,
  disableInvite,
  enableInvite,
  inputErrorText,
  launchMission,
  processDue,
  register,
  reportGet,
  reportList,
  seed,
  setNightShield,
  type Engine,
} from "../src/index.ts";
import { t } from "../../../apps/api/src/trpc.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `fx${++keyN}-${Date.now()}`;

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

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

test("Nachtschild: Änderung wirkt erst nach der Frist und ist höchstens einmal je Frist möglich", async () => {
  const p = await newPlayer("Nora", 3);
  await patchBase(p.baseId, (s) => { s.protection.createdAtMs = 0; });
  const hour = new Date().getUTCHours();
  // Startstunde jetzt: ohne die Regel wäre der Schild sofort aktiv.
  const r = await setNightShield(engine, p.playerId, key(), hour, 0);
  assert.equal(r.ok, true, JSON.stringify(r));
  const fromMs = (r as { fromMs: number }).fromMs;
  const h = gameBalance.protection.nightShieldChangeHours;
  assert.ok(Math.abs(fromMs - (Date.now() + h * HOUR)) < 60000);
  const s = await stateOf(p.baseId);
  assert.equal(isNightShieldActive(s.protection, Date.now(), gameBalance), false);
  assert.equal(s.protection.nightShieldStartHour, null);
  assert.equal(s.protection.nightShieldNext?.startHour, hour);
  const view = await baseView(engine, p.playerId);
  assert.equal(view.base?.protection.status, null);
  // Zweite Änderung innerhalb der Frist: abgelehnt.
  const again = await setNightShield(engine, p.playerId, key(), (hour + 3) % 24, 0);
  assert.deepEqual(again, { ok: false, code: "shield_cooldown" });
});

test("Transport: Empfänger sieht „Lieferung von …“ statt „Angriff auf dich“", async () => {
  const a = await newPlayer("Paul", 8);
  const b = await newPlayer("Rita", 11);
  await patchBase(a.baseId, (s) => { s.units = { landungsschiff: 1 }; s.resources.treibstoff = 50000; s.resources.stahl = 3000; });
  const m = await launchMission(engine, a.playerId, key(), { type: "transport", units: { landungsschiff: 1 }, col: b.col, row: b.row, cargo: { stahl: 500 } });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await processDue(engine, row.arriveAt.getTime() + 1);
  const forB = (await reportList(engine, b.playerId)).find((r) => r.kind === "transport");
  assert.ok(forB);
  assert.equal(forB!.role, "recipient");
  assert.equal(forB!.title, "Lieferung von Paul");
  const detail = await reportGet(engine, b.playerId, forB!.id);
  assert.equal(detail?.role, "recipient");
  const forA = (await reportList(engine, a.playerId)).find((r) => r.kind === "transport");
  assert.equal(forA?.role, "attacker");
  assert.equal(forA?.title, "Transport an Hafen Rita angekommen");
});

test("Einladungscodes: gespeichert in Großbuchstaben, Registrierung ohne Rücksicht auf Groß-/Kleinschreibung", async () => {
  const c = await createInvite(db, { code: "seefahrt", maxUses: 2 });
  assert.equal(c.code, "SEEFAHRT");
  await assert.rejects(createInvite(db, { code: "SeeFahrt", maxUses: 1 }), /invite_exists/);
  // Älterer Code in Kleinbuchstaben (vor der Normalisierung angelegt) gilt ebenfalls.
  await db.insert(tables.inviteCode).values({ code: "altcode", maxUses: 1 });
  await register(db, { inviteCode: "  seeFAHRT ", name: "Sven", password: "geheim123" });
  await register(db, { inviteCode: "ALTCODE", name: "Tina", password: "geheim123" });
  const [used] = await db.select().from(tables.inviteCode).where(eq(tables.inviteCode.code, "SEEFAHRT"));
  assert.equal(used.uses, 1);
  // Deaktivieren und wieder aktivieren.
  assert.equal(await disableInvite(db, "SEEFAHRT"), true);
  await assert.rejects(register(db, { inviteCode: "seefahrt", name: "Uwe", password: "geheim123" }), /invite_invalid/);
  assert.equal(await enableInvite(db, "SEEFAHRT"), true);
  assert.equal(await enableInvite(db, "SEEFAHRT"), false);
  await register(db, { inviteCode: "seefahrt", name: "Uwe", password: "geheim123" });
});

test("Eingabefehler: Zod-Befunde als deutsche Kurztexte", () => {
  const schema = z.object({
    name: z.string().trim().min(2).max(32),
    qty: z.number().int().min(1).max(10_000_000),
    password: z.string().min(8),
    email: z.email(),
  });
  const text = (v: unknown) => {
    const r = schema.safeParse(v);
    assert.equal(r.success, false);
    return inputErrorText(r.error!.issues as never);
  };
  const ok = { name: "Hafen", qty: 5, password: "geheim123", email: "a@b.de" };
  assert.equal(text({ ...ok, name: "x".repeat(40) }), "Name zu lang (höchstens 32 Zeichen).");
  assert.equal(text({ ...ok, name: "x" }), "Name zu kurz (mindestens 2 Zeichen).");
  assert.equal(text({ ...ok, qty: 1.5 }), "Menge: bitte eine ganze Zahl eingeben.");
  assert.equal(text({ ...ok, qty: 20_000_000 }), "Menge zu groß (höchstens 10.000.000).");
  assert.equal(text({ ...ok, password: "kurz" }), "Passwort zu kurz (mindestens 8 Zeichen).");
  assert.equal(text({ ...ok, email: "keine" }), "Bitte eine gültige E-Mail-Adresse eingeben.");
  assert.equal(inputErrorText([]), null);
});

test("Eingabefehler: der API-Fehlerformatierer liefert data.inputError bei HTTP 400", async () => {
  const router = t.router({
    rename: t.procedure.input(z.object({ name: z.string().max(32) })).mutation(() => ({ ok: true })),
  });
  const res = await fetchRequestHandler({
    endpoint: "/trpc",
    router,
    createContext: () => ({}) as never,
    req: new Request("http://x/trpc/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(40) }),
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { data: { code: string; inputError: string | null } } };
  assert.equal(body.error.data.code, "BAD_REQUEST");
  assert.equal(body.error.data.inputError, "Name zu lang (höchstens 32 Zeichen).");
});

test("Kartell: Bericht nennt den Bunkerschutz; am Schutz abgewiesener Überfall erzeugt einen Hinweis", async () => {
  const p = await newPlayer("Vera", 14);
  await patchBase(p.baseId, (s) => { s.protection.createdAtMs = 0; s.resources.stahl = 20000; s.buildings.tiefbunker = 2; });
  const raidOnce = async () => {
    const [ev] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${p.baseId} and ${tables.gameEvent.type} = 'raid_launch' and ${tables.gameEvent.status} = 'pending'`);
    await processDue(engine, ev.dueAt.getTime() + 1);
    const [m] = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${p.baseId} and ${tables.mission.status} = 'outbound'`);
    return m;
  };
  const first = await raidOnce();
  await processDue(engine, first.arriveAt.getTime() + 1);
  const [report] = await db.select().from(tables.battleReport).where(sql`${tables.battleReport.kind} = 'kartell' and ${tables.battleReport.defenderBaseId} = ${p.baseId}`);
  assert.ok(Number((report.report as { protectedPerResource?: number }).protectedPerResource) > 0);
  // Nächster Verband läuft aus; vor seiner Ankunft greift ein Schutz (hier: Schutz nach Niederlage).
  await patchBase(p.baseId, (s) => { s.protection.defeatShieldUntilMs = 0; });
  const second = await raidOnce();
  assert.ok(second, "zweiter Verband");
  await patchBase(p.baseId, (s) => { s.protection.defeatShieldUntilMs = second.arriveAt.getTime() + HOUR; });
  await processDue(engine, second.arriveAt.getTime() + 1);
  const list = await reportList(engine, p.playerId);
  const blocked = list.find((r) => r.kind === "abgewiesen");
  assert.ok(blocked, JSON.stringify(list));
  assert.equal(blocked!.role, "defender");
});

test("Morgenbericht: Abschnitt Tagesbefehle", async () => {
  const p = await newPlayer("Willi", 17);
  const now = Date.now();
  const s = await dailySummarySection(db, p.playerId, now - 24 * HOUR, now);
  assert.equal(s?.title, "Tagesbefehle");
  assert.ok(s!.lines.length > 0);
});
