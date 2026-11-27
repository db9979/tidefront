// Welle 2 – Messbarkeit und KI: reine Regeln (Börse nach Stunden Produktion, Tagesbefehle ~60 %, Probekampf
// Mittel/ungünstig, Heimwache inkl. Truppen, Überfälle auf KI, Wächter des Saisonlaufs, Systeme der Nutzungszähler,
// Rohstoffbilanz) und gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Tagesschnappschuss,
// Nutzungszähler, Schrittdauer, Admin-Karten, Börse und Tagesbefehle der KI über einen echten Zug.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestDefenders, type BaseState } from "@tidefront/game-core";
import {
  adminBalance, balance, botTurn, ensureStartBots, homeBaseOf, loadBot, loadBots, recordUsage, seed, setIntelFog, snapshotBases,
  StepStats, stockGroup, systemOf, type Engine,
} from "../src/index.ts";
import { botMarketPlan, HOLD_HOURS, TRADER_HOLD_HOURS, type MarketPlanInput } from "../src/bots-market.ts";
import { DAILY_QUOTE, dailyEngaged } from "../src/bots-daily.ts";
import { botRaidDue, FESTUNG_MIN_GUARD, guardShareOf, nestProbeOk, strikeForce } from "../src/bots-war.ts";
import { eventForce } from "../src/bots-world-events.ts";
import { dayKey } from "../src/challenge-pool.ts";
import { evaluateGuards, exitCode, GUARD_LIMITS, type SeasonMetrics } from "../sim/saison-guards.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const R = ["stahl", "treibstoff", "elektronik", "proviant"];
const all = (v: number) => Object.fromEntries(R.map((r) => [r, v]));

function plan(over: Partial<MarketPlanInput>): ReturnType<typeof botMarketPlan> {
  return botMarketPlan({
    stock: all(0), perHour: all(100), need: {}, room: all(100_000), price: { stahl: 1, treibstoff: 1.8, elektronik: 3, proviant: 0.6 },
    maxLot: all(100_000), credits: 0, trader: false, ...over,
  }, R);
}

// ---------------------------------------------------------------- reine Regeln

test("KI-Börse: Verkauf über 24 h Produktion (Händler 12 h), Bedarf der nächsten Bauten bleibt, Zukauf unter 6 h", () => {
  // 40 h Proviant → Überschuss über 24 h wird verkauft, Rest bleibt.
  const p = plan({ stock: { ...all(1500), proviant: 4000 } });
  assert.deepEqual(p.sell, [{ resource: "proviant", qty: 4000 - HOLD_HOURS * 100 }]);
  // Händler halten nur 12 h.
  assert.equal(plan({ stock: { ...all(1500), proviant: 4000 }, trader: true }).sell[0].qty, 4000 - TRADER_HOLD_HOURS * 100);
  // Bedarf der nächsten Ausbauten wird nicht verkauft.
  assert.deepEqual(plan({ stock: { ...all(1500), proviant: 4000 }, need: { proviant: 3900 } }).sell, []);
  // Knapp (unter 6 h): Zukauf mit dem Erlös des Verkaufs, höchstens bis 12 h.
  const b = plan({ stock: { ...all(1500), stahl: 100, proviant: 6000 } });
  assert.equal(b.sell[0].resource, "proviant");
  assert.equal(b.buy?.resource, "stahl");
  assert.ok(b.buy!.qty <= 12 * 100 - 100 && b.buy!.qty >= 200, JSON.stringify(b));
  // Tageslimit und Preiswirkung begrenzen die Menge.
  assert.equal(plan({ stock: { ...all(1500), proviant: 4000 }, room: { ...all(100_000), proviant: 700 } }).sell[0].qty, 700);
  // Kleinstmengen nicht.
  assert.deepEqual(plan({ stock: { ...all(1500), proviant: 2450 } }).sell, []);
});

test("Tagesbefehle der KI: an etwa 60 % der Tage, fest je Bot und Tag", () => {
  let n = 0;
  const days = 400;
  for (let i = 0; i < days; i++) n += dailyEngaged(7, dayKey(Date.UTC(2026, 0, 1) + i * 86400000)) ? 1 : 0;
  assert.ok(Math.abs(n / days - DAILY_QUOTE) < 0.08, `${n}/${days}`);
  assert.equal(dailyEngaged(7, "2026-12-01"), dailyEngaged(7, "2026-12-01"));
});

test("Heimwache gilt auch für Truppen, Festung mindestens die Hälfte; Ereignisverband ohne Truppen", () => {
  const s = { units: { korvette: 10, schuetzen: 40, landungsschiff: 4 } } as unknown as BaseState;
  const f = strikeForce(s, 0.25);
  assert.equal(f.korvette, 7);
  assert.equal(f.landungsschiff, 4, "Landungsschiffe fahren ganz mit (Laderaum)");
  assert.ok((f.schuetzen ?? 0) <= 30, "ein Viertel der Schützen bleibt daheim");
  const cfg = { homeGuardShare: 0.1 } as never;
  assert.equal(guardShareOf({ bot: { profile: "festung" } as never, cfg }), FESTUNG_MIN_GUARD);
  assert.equal(guardShareOf({ bot: { profile: "freibeuter" } as never, cfg }), 0.1);
  assert.deepEqual(Object.keys(eventForce({ korvette: 3, schuetzen: 20, jagdbomber: 2 })).sort(), ["jagdbomber", "korvette"]);
});

test("Probekampf ohne Lagebild: im Mittel ≥ 90 % und ungünstig ≥ 50 % – großer Verband ja, kleiner nein", () => {
  const big = { units: { korvette: 30, zerstoerer: 10, schuetzen: 300, pioniere: 40, kampfpanzer: 12, landungsschiff: 10, jagdbomber: 10 } };
  const small = { units: { korvette: 2, schuetzen: 10, landungsschiff: 1 } };
  assert.equal(nestProbeOk(big, { level: 2 }, 0, 5, 0.7), true);
  assert.equal(nestProbeOk(small, { level: 5 }, 0, 5, 0.7), false);
  assert.ok(nestDefenders(3, balance, "range").length > 1, "Spanne der Würfe");
});

test("Überfälle auf andere KI: nur Freibeuter, höchstens alle 48–72 h", () => {
  const now = Date.UTC(2026, 11, 1);
  const c = (profile: string, last?: number) => ({ bot: { id: 3, profile } as never, state: { botRaidAtMs: last } as never, nowMs: now });
  assert.equal(botRaidDue(c("festung")), false);
  assert.equal(botRaidDue(c("freibeuter")), true);
  assert.equal(botRaidDue(c("freibeuter", now - 40 * 3600000)), false);
  assert.equal(botRaidDue(c("freibeuter", now - 73 * 3600000)), true);
});

test("Nutzungszähler: Befehl → System; Rohstoffbilanz: Median, Füllgrad, Stunden Produktion", () => {
  assert.equal(systemOf("upgrade"), "bau");
  assert.equal(systemOf("trade"), "boerse");
  assert.equal(systemOf("intel:patrol"), "lagebild");
  assert.equal(systemOf("contractPropose"), "vertraege");
  assert.equal(systemOf("dailyClaim"), "befehle");
  assert.equal(systemOf("mission"), "missionen");
  assert.equal(systemOf("irgendwas"), "sonstiges");
  const g = stockGroup([
    { res: { stahl: 1000 }, rate: { stahl: 100 }, cap: 10_000 },
    { res: { stahl: 3000 }, rate: { stahl: 100 }, cap: 10_000 },
    { res: { stahl: 9000 }, rate: { stahl: 100 }, cap: 10_000 },
  ], ["stahl"]);
  assert.deepEqual(g.byResource.stahl, { median: 3000, max: 9000, fillMedian: 0.3, fillMax: 0.9, hoursMedian: 30 });
});

test("Saisonlauf-Wächter: Flut und gescheiterte Ereignisse sind Fehler, Balance-Ziele Warnungen", () => {
  const base: SeasonMetrics = {
    days: 21, perDay: [{ day: 1, worldEvents: 1, newsRows: 5, messagesPerPlayer: 3 }], failedEvents: 0, auditOk: true,
    bots: [{ profile: "freibeuter", cartelShareByDay: [0.05], points: { ausbau: 50, militaer: 30, kampf: 10, beute: 8, befehle: 2, total: 100 }, trades: 30, stockHours: 20, nest4Day: 15, worldEventAttacks: 2 }],
    nest6: [{ offered: 100, taken: 90 }], stepMax: [{ step: "audit", maxMs: 30 }],
  };
  const ok = evaluateGuards(base);
  assert.ok(ok.every((r) => r.ok), JSON.stringify(ok.filter((r) => !r.ok)));
  assert.equal(exitCode(ok), 0);
  const flood = evaluateGuards({ ...base, perDay: [...base.perDay, { day: 34, worldEvents: 91, newsRows: 5, messagesPerPlayer: 3 }] });
  assert.equal(flood.find((r) => r.id === "weltereignisse")?.ok, false);
  assert.equal(exitCode(flood), 1);
  const warn = evaluateGuards({ ...base, bots: [{ ...base.bots[0], cartelShareByDay: [0.3, 0.35] }] });
  assert.equal(warn.find((r) => r.id === "kartellkosten")?.ok, false);
  assert.equal(exitCode(warn), 0, "Warnung lässt den Lauf nicht scheitern");
  assert.equal(exitCode(warn, true), 1, "mit --strict schon");
  assert.equal(evaluateGuards({ ...base, failedEvents: 2 }).find((r) => r.id === "ereignisse")?.ok, false);
  assert.ok(GUARD_LIMITS.worldEventsPerDay < 91);
});

// ---------------------------------------------------------------- gegen PostgreSQL

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:10");
  await setIntelFog(db, false);
  await ensureStartBots(engine);
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} like 'field%'`);
});

after(async () => {
  await client.end();
});

test("Tagesschnappschuss: eine Zeile je Hafen und Tag, Taler im Heimathafen; Nutzungszähler je abgeschlossenem Tag", async () => {
  const now = Date.now();
  const n = await snapshotBases(db, now);
  const bases = await db.select({ id: tables.base.id }).from(tables.base);
  assert.equal(n, bases.length);
  assert.equal(await snapshotBases(db, now + 60000), 0, "höchstens einmal je Tag");
  const rows = await db.select().from(tables.baseDay).where(eq(tables.baseDay.day, dayKey(now)));
  assert.equal(rows.length, bases.length);
  assert.ok(rows.every((r) => r.bot && r.capacity > 0 && (r.resources as Record<string, number>).stahl >= 0 && r.credits !== null));
  // Nutzungszähler: Befehle von gestern verdichten (nur erfolgreiche), dann nicht noch einmal.
  const [bot] = await loadBots(db);
  const y = now - 86400000;
  await db.insert(tables.commandLog).values([
    { key: `w2-a-${now}`, playerId: bot.id, command: "trade", response: { ok: true }, createdAt: new Date(y) },
    { key: `w2-b-${now}`, playerId: bot.id, command: "trade", response: { ok: true }, createdAt: new Date(y) },
    { key: `w2-c-${now}`, playerId: bot.id, command: "upgrade", response: { ok: false, code: "x" }, createdAt: new Date(y) },
  ]);
  assert.ok((await recordUsage(db, now)) >= 1);
  assert.equal(await recordUsage(db, now), 0);
  const usage = await db.select().from(tables.usageDay).where(eq(tables.usageDay.day, dayKey(y)));
  const boerse = usage.find((u) => u.system === "boerse");
  assert.deepEqual([boerse?.bots, boerse?.botUses], [1, 2]);
  assert.equal(usage.find((u) => u.system === "bau"), undefined, "abgelehnte Befehle zählen nicht");
});

test("Schrittdauer: aufaddiert je Tag und Schritt; Admin-Karten Rohstoffbilanz, Zuflüsse, Welt & Worker, Nutzung", async () => {
  const now = Date.now();
  const st = new StepStats();
  st.record(dayKey(now), "audit", 10);
  st.record(dayKey(now), "audit", 3000);
  await st.flush(db);
  st.record(dayKey(now), "audit", 20, true);
  await st.flush(db);
  const [row] = await db.select().from(tables.workerStepDay).where(eq(tables.workerStepDay.step, "audit"));
  assert.deepEqual([row.runs, row.totalMs, row.maxMs, row.slow, row.errors], [3, 3030, 3000, 1, 1]);
  const b = await adminBalance(db, 7, now);
  assert.equal(b.stock.day, dayKey(now));
  assert.equal(b.stock.bots.players, 3);
  assert.equal(b.stock.humans.players, 0);
  assert.ok(b.stock.bots.byResource.stahl.median > 0);
  assert.ok(Object.values(b.inflow.total.production).some((v) => v > 0), "Produktion aus dem Schnappschuss");
  assert.equal(b.world.steps.find((s) => s.step === "audit")?.slow, 1);
  assert.ok(b.usage.rows.some((u) => u.system === "gesamt"));
  assert.equal(b.world.events.length, 7);
});

test("KI-Zug: Überschuss an der Börse verkauft, Tagesbefehle an Tagen mit Blick hinein vergeben", async () => {
  const bot = (await loadBots(db)).find((b) => b.profile === "festung")!;
  const home = (await homeBaseOf(db, bot.id))!;
  const s = home.state as BaseState;
  s.buildings = { ...s.buildings, hafenkommandantur: 3 };
  s.resources = { ...s.resources, proviant: 60_000 };
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, home.id));
  const now = Date.now();
  const actions = await botTurn(engine, (await loadBot(db, bot.id))!, now);
  assert.ok(actions.some((a) => /Börse: .* Proviant verkauft/.test(a)), actions.join(" | "));
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.dailyChallenge)
    .where(sql`${tables.dailyChallenge.playerId} = ${bot.id} and ${tables.dailyChallenge.day} = ${dayKey(now)}`);
  assert.equal(d.n > 0, dailyEngaged(bot.id, dayKey(now)), "Tagesbefehle genau an den Tagen mit Blick hinein");
});
