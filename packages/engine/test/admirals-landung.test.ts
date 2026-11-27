// Integrationstests Admirale „Landungstrupp“ (docs/VORLAGE-ADMIRALE.md) gegen ein echtes PostgreSQL (wird geleert):
// Umschulung genau einmal kostenlos (nur Admirale von vor dem Update), Bezahlbarkeit in der Ansicht, KI-Spieler
// ernennen einen Admiral (Freibeuter Landungstrupp auf Mission, Festung Verteidigung als Hafenkommandant).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, nestSites } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  addBot, admiralView, appointAdmiral, auditLedger, balance, chooseBase, homeBaseOf, loadBot, register, retrainAdmiral, seed,
  setBotsServer, type Engine,
} from "../src/index.ts";
import { admiralTurn } from "../src/bots-admiral.ts";
import { botsConfig } from "../src/bots-core.ts";
import type { TurnCtx } from "../src/bots-war.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `adl${++keyN}-${Date.now()}`;
const cfg = balance.admirals!;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Kredite gutschreiben, mit Gegenbuchung im Journal. */
async function grantCredits(playerId: number, amount: number) {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const t = p.trader as { credits: number };
  await db.update(tables.player).set({ trader: { ...t, credits: t.credits + amount } }).where(eq(tables.player.id, playerId));
  await db.insert(tables.tradeLedger).values([
    { tradeId: `grant-${playerId}-${keyN++}`, tMs: Date.now(), account: `player:${playerId}`, asset: "credits", amount: amount.toFixed(2) },
    { tradeId: `grant-${playerId}-${keyN}`, tMs: Date.now(), account: "test", asset: "credits", amount: (-amount).toFixed(2) },
  ]);
}

async function creditsOf(playerId: number): Promise<number> {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  return (p.trader as { credits: number }).credits;
}

async function setCredits(playerId: number, credits: number) {
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  await db.update(tables.player).set({ trader: { ...(p.trader as object), credits } }).where(eq(tables.player.id, playerId));
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

test("Umschulung: genau einmal kostenlos, nur für Admirale von vor dem Update, nicht auf dieselbe Spezialisierung", async () => {
  const p = await register(db, { inviteCode: "TEST", name: "Umschulerin", password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...freeCoast(3), name: "Hafen Umschulung", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => { s.buildings.hafenkommandantur = 5; s.buildings.lagerkomplex = 8; s.resources = { stahl: 9000, treibstoff: 9000, elektronik: 9000, proviant: 9000 }; });
  // Bezahlbarkeit in der Ansicht: ohne Kredite fehlt genau der Preis.
  const v0 = (await admiralView(engine, p.playerId))!;
  assert.deepEqual(v0.missing, { credits: cfg.cost.credits - Math.ceil(v0.have.credits) });
  await grantCredits(p.playerId, 10000);
  assert.deepEqual((await admiralView(engine, p.playerId))!.missing, {});

  // Admiral von vor dem Update: Zeile ohne retrainFree (Vorgabewert der Spalte wie nach der Migration).
  await db.execute(sql`insert into admiral (player_id, base_id, name, spec1, xp) values (${p.playerId}, ${baseId}, 'Henrik Albers', 'angriff', 320)`);
  const fresh = await appointAdmiral(engine, p.playerId, key(), { name: null, spec: "logistik" });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  const v = (await admiralView(engine, p.playerId))!;
  const old = v.list.find((a) => a.name === "Henrik Albers")!;
  const neu = v.list.find((a) => a.name !== "Henrik Albers")!;
  assert.equal(old.canRetrain, true);
  assert.equal(neu.canRetrain, false, "neu ernannt: keine Umschulung");
  assert.ok(v.specs.some((s) => s.id === "landung" && s.name === "Landungstrupp"));

  const credits = await creditsOf(p.playerId);
  const [b0] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  assert.deepEqual(await retrainAdmiral(engine, p.playerId, key(), { admiralId: old.id, spec: "angriff" }), { ok: false, code: "admiral_spec" });
  assert.deepEqual(await retrainAdmiral(engine, p.playerId, key(), { admiralId: old.id, spec: "schwimmen" }), { ok: false, code: "admiral_spec" });
  assert.deepEqual(await retrainAdmiral(engine, p.playerId, key(), { admiralId: old.id, spec: "landung" }), { ok: true });
  assert.equal(await creditsOf(p.playerId), credits, "kostenlos");
  const [b1] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  assert.equal((b1.state as BaseState).resources.elektronik, (b0.state as BaseState).resources.elektronik, "keine Elektronik");
  const after1 = (await admiralView(engine, p.playerId))!.list.find((a) => a.id === old.id)!;
  assert.deepEqual(after1.specs, ["landung"]);
  assert.equal(after1.xp, 320, "Erfahrung bleibt");
  assert.equal(after1.canRetrain, false);
  assert.deepEqual(after1.mission.map((l) => l.path).sort(), ["attack.land", "hp.land", "mineDamage"]);
  assert.deepEqual(after1.defense.map((l) => l.path), ["hp.land"]);
  // Genau einmal: zweiter Versuch und neu ernannter Admiral abgelehnt.
  assert.deepEqual(await retrainAdmiral(engine, p.playerId, key(), { admiralId: old.id, spec: "angriff" }), { ok: false, code: "admiral_retrain_used" });
  assert.deepEqual(await retrainAdmiral(engine, p.playerId, key(), { admiralId: neu.id, spec: "landung" }), { ok: false, code: "admiral_retrain_used" });
  assert.equal((await auditLedger(engine)).creditMismatches.length, 0, "Journal stimmt");
});

function ctxFor(bot: NonNullable<Awaited<ReturnType<typeof loadBot>>>): TurnCtx {
  return { engine, bot, cfg: botsConfig().profiles[bot.profile], nowMs: Date.now(), rand: () => 0, log: [], key: (w) => `${key()}-${w}`, state: { ...bot.state } };
}

test("KI-Spieler ernennen einen Admiral: Freibeuter Landungstrupp auf Mission, Festung Verteidigung daheim; Händler keinen", async () => {
  await setBotsServer(db, { max: 8 });
  const ids: Record<string, number> = {};
  for (const profile of ["freibeuter", "festung", "haendler"]) {
    const r = await addBot(engine, profile);
    assert.equal(r.ok, true, JSON.stringify(r));
    ids[profile] = (r as { playerId: number }).playerId;
  }
  const homes: Record<string, NonNullable<Awaited<ReturnType<typeof homeBaseOf>>>> = {};
  for (const [profile, id] of Object.entries(ids)) {
    const h = (await homeBaseOf(db, id))!;
    homes[profile] = h;
    await patchBase(h.id, (s) => { s.buildings.hafenkommandantur = 0; s.resources = { ...s.resources, elektronik: 3000 }; });
    await setCredits(id, 0);
  }
  const home = async (profile: string) => ({ ...(await homeBaseOf(db, ids[profile]))!, state: (await homeBaseOf(db, ids[profile]))!.state as BaseState });
  const count = async (id: number) => (await db.select().from(tables.admiral).where(eq(tables.admiral.playerId, id))).length;

  // Ohne Hafenkommandantur: nichts.
  let c = ctxFor((await loadBot(db, ids.freibeuter))!);
  await admiralTurn(c, await home("freibeuter"));
  assert.equal(await count(ids.freibeuter), 0);
  assert.equal(c.creditReserve, undefined);
  // Hafenkommandantur 1, aber keine Kredite: Rücklage an der Börse, noch kein Admiral.
  for (const h of Object.values(homes)) await patchBase(h.id, (s) => { s.buildings.hafenkommandantur = 1; });
  c = ctxFor((await loadBot(db, ids.freibeuter))!);
  await admiralTurn(c, await home("freibeuter"));
  assert.equal(await count(ids.freibeuter), 0);
  assert.equal(c.creditReserve, cfg.cost.credits);

  // Mit Krediten: Ernennung zu denselben Kosten wie für Menschen.
  for (const id of Object.values(ids)) await setCredits(id, 2500);
  c = ctxFor((await loadBot(db, ids.freibeuter))!);
  await admiralTurn(c, await home("freibeuter"));
  const [fa] = await db.select().from(tables.admiral).where(eq(tables.admiral.playerId, ids.freibeuter));
  assert.equal(fa?.spec1, "landung", c.log.join(" | "));
  assert.equal(await creditsOf(ids.freibeuter), 2500 - cfg.cost.credits);
  assert.equal((await home("freibeuter")).state.resources.elektronik! < 3000 - cfg.cost.elektronik + 50, true, "Elektronik bezahlt");
  assert.ok(c.log.some((l) => l.includes("Admiral") && l.includes("Landungstrupp")), c.log.join(" | "));

  const cf = ctxFor((await loadBot(db, ids.festung))!);
  await admiralTurn(cf, await home("festung"));
  const [ga] = await db.select().from(tables.admiral).where(eq(tables.admiral.playerId, ids.festung));
  assert.equal(ga?.spec1, "verteidigung");
  assert.equal(ga.stationed, true, "Festung: Hafenkommandant");
  // Festung: abberufen → nächster Zug setzt ihn wieder als Hafenkommandant ein.
  await db.update(tables.admiral).set({ stationed: false }).where(eq(tables.admiral.id, ga.id));
  await admiralTurn(ctxFor((await loadBot(db, ids.festung))!), await home("festung"));
  assert.equal((await db.select().from(tables.admiral).where(eq(tables.admiral.id, ga.id)))[0].stationed, true);

  await admiralTurn(ctxFor((await loadBot(db, ids.haendler))!), await home("haendler"));
  assert.equal(await count(ids.haendler), 0, "Händler ernennt keinen");

  // Freibeuter: nächster Zug stellt den bereiten Admiral für Überfälle bereit (Missionswirkung Landungstrupp).
  c = ctxFor((await loadBot(db, ids.freibeuter))!);
  await admiralTurn(c, await home("freibeuter"));
  assert.equal(await count(ids.freibeuter), 1, "nur einer");
  assert.equal(c.admiral?.id, fa.id);
  assert.equal(c.admiral?.mods.attack?.land, 1.05, "Kapitän zur See: halbe Wirkung");
  // Verwundet: kein Admiral bereit.
  await db.update(tables.admiral).set({ woundedUntil: new Date(Date.now() + 3600000) }).where(eq(tables.admiral.id, fa.id));
  c = ctxFor((await loadBot(db, ids.freibeuter))!);
  await admiralTurn(c, await home("freibeuter"));
  assert.equal(c.admiral, undefined);
});
