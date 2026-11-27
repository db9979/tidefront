// Integrationstests KI-Spieler (TEST_DATABASE_URL; die Datenbank wird geleert): Anlegen (idempotent, Obergrenze,
// keine Anmeldung, kein Push), ein Zug je Spielweise nur über Befehle, Angriffssperre gegen Menschen, Sperrfrist,
// Schutzregeln, Aktivitätszeiten, Worker-Takt (reihum, begrenzt) und Entfernen.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm, isCoast, nestSites } from "@tidefront/world";
import { protectionStatus, type BaseState } from "@tidefront/game-core";
import {
  addBot, balance, botTurn, chooseBase, createResetCode, ensureStartBots, homeBaseOf, isActiveTime, launchMission, loadBot, loadBots, login,
  nextTurnAt, processDue, pushToPlayer, register, removeBotStep, runBotsDue, seed, setBotsServer, updateBot, type Engine,
} from "../src/index.ts";
import { humanCooldownActive, playerTargets, type TurnCtx } from "../src/bots-war.ts";
import { botsConfig } from "../src/bots-core.ts";
import { fieldProbe, fieldTurn, reservedForField } from "../src/bots-fields.ts";
import { withoutReserve } from "../src/bots-war.ts";
import { ensureFieldPlanner } from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `bt${++keyN}-${Date.now()}`;

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Freies Küstenfeld nahe einem Hafen (für einen Menschen in Reichweite eines Bots). */
async function coastNear(near: { col: number; row: number }, minKm: number, maxKm: number) {
  const taken = new Set((await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)).map((b) => `${b.col},${b.row}`));
  for (const n of nestSites()) taken.add(`${n.col},${n.row}`);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (!isCoast(col, row) || taken.has(`${col},${row}`)) continue;
    const d = hexDistanceKm(near, { col, row });
    if (d >= minKm && d <= maxKm) return { col, row };
  }
  throw new Error("kein Küstenfeld");
}

function ctxFor(bot: Awaited<ReturnType<typeof loadBot>>): TurnCtx {
  const b = bot!;
  return {
    engine, bot: b, cfg: botsConfig().profiles[b.profile], nowMs: Date.now(), rand: () => 0, log: [],
    key: (w) => `${key()}-${w}`, state: { ...b.state },
  };
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} like 'field%'`);
});

after(async () => {
  await client.end();
});

test("Anlegen: je Spielweise ein Bot mit Hafen, idempotent, keine Anmeldung, kein Push, Obergrenze", async () => {
  const r = await ensureStartBots(engine);
  assert.equal(r.created.length, 3);
  const bots = await loadBots(db);
  assert.deepEqual(bots.map((b) => b.profile).sort(), ["festung", "freibeuter", "haendler"]);
  for (const b of bots) {
    const home = await homeBaseOf(db, b.id);
    assert.ok(home, `${b.name} hat einen Hafen`);
    assert.ok(isCoast(home.col, home.row));
    assert.equal(b.settings.active, true);
    assert.equal(b.settings.attackHumans, false, "Vorgabe: Menschen nicht angreifen");
  }
  assert.ok(bots.some((b) => b.name === "Kapitän Rotbart"));
  // Idempotent.
  assert.equal((await ensureStartBots(engine)).created.length, 0);
  // Keine Anmeldung, kein Rücksetzcode, kein Push.
  await assert.rejects(login(db, { name: bots[0].name, password: "bot$kein-login" }), /bad_login/);
  await assert.rejects(createResetCode(db, bots[0].id, bots[0].id), /bot_player/);
  assert.equal(await pushToPlayer(engine, bots[0].id, { kind: "test", title: "x", body: "y" }), 0);
  // Weitere Bots je Spielweise mit eindeutigen Namen; Obergrenze aus der Server-Einstellung.
  await setBotsServer(db, { max: 4 });
  const extra = await addBot(engine, "freibeuter");
  assert.equal(extra.ok, true);
  assert.equal((extra as { name: string }).name, "Kaperfahrer Grimm");
  assert.deepEqual(await addBot(engine, "haendler"), { ok: false, code: "bot_limit" });
  assert.deepEqual(await addBot(engine, "pirat"), { ok: false, code: "bad_profile" });
  // Entfernen (nichts unterwegs): Spieler und Hafen sind weg.
  const rm = await removeBotStep(engine, (extra as { playerId: number }).playerId);
  assert.equal(rm.removed, true, JSON.stringify(rm));
  assert.equal(await loadBot(db, (extra as { playerId: number }).playerId), null);
  await setBotsServer(db, { max: 8 });
});

test("Ein Zug je Spielweise: Ausbau und Ausbildung über die Befehle (Befehlsprotokoll)", async () => {
  for (const b of await loadBots(db)) {
    const home = (await homeBaseOf(db, b.id))!;
    await patchBase(home.id, (s) => {
      s.resources = { stahl: 20_000, treibstoff: 10_000, elektronik: 8_000, proviant: 10_000 };
      Object.assign(s.buildings, { kommandozentrale: 4, kaserne: 2, werft: 3, flugfeld: 1, hafenkommandantur: 3, kraftwerk: 4, forschungsamt: 1 });
    });
    const actions = await botTurn(engine, (await loadBot(db, b.id))!);
    assert.ok(actions.some((a) => a.includes("Ausbau")), `${b.name}: ${actions.join(" | ")}`);
    assert.ok(actions.some((a) => a.includes("Ausbildung")), `${b.name}: ${actions.join(" | ")}`);
    const st = (await homeBaseOf(db, b.id))!.state;
    assert.ok(st.buildQueue.length >= 1);
    const [logged] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.commandLog).where(eq(tables.commandLog.playerId, b.id));
    assert.ok(logged.n >= 2, "Bots handeln über Befehle (Befehlsprotokoll)");
  }
});

test("Angriffssperre gegen Menschen, Sperrfrist und Schutzregeln", async () => {
  const fb = (await loadBots(db)).find((b) => b.profile === "freibeuter")!;
  const fbHome = (await homeBaseOf(db, fb.id))!;
  const p = await register(db, { inviteCode: "TEST", name: "Mensch", password: "geheim123" });
  const f = await coastNear(fbHome, 150, 600);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: "Menschenhafen", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const humanBase = (r as { baseId: number }).baseId;
  // Bot-Häfen ohne Anfängerschutz, Freibeuter mit Verband.
  for (const b of await loadBots(db)) await patchBase((await homeBaseOf(db, b.id))!.id, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  await patchBase(fbHome.id, (s) => {
    s.units = { korvette: 30, zerstoerer: 10, landungsschiff: 4, schuetzen: 60, aufklaerungsdrohne: 2 };
    s.buildings.hafenkommandantur = 6;
    s.resources.treibstoff = 50_000;
  });

  // 1. Mensch im Anfängerschutz: auch mit Erlaubnis kein Ziel; der Befehl selbst lehnt ab.
  await updateBot(db, fb.id, { attackHumans: true });
  let targets = await playerTargets(ctxFor(await loadBot(db, fb.id)), fbHome);
  assert.ok(!targets.some((t) => t.id === humanBase), "Anfängerschutz");
  const direct = await launchMission(engine, fb.id, key(), { type: "ueberfall", units: { korvette: 5 }, col: f.col, row: f.row });
  assert.deepEqual(direct, { ok: false, code: "target_protected" });

  // 2. Ohne Schutz, aber ohne Erlaubnis: kein Ziel.
  await patchBase(humanBase, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  await updateBot(db, fb.id, { attackHumans: false });
  targets = await playerTargets(ctxFor(await loadBot(db, fb.id)), fbHome);
  assert.ok(!targets.some((t) => t.id === humanBase), "Erlaubnis aus");
  for (let i = 0; i < 3; i++) await botTurn(engine, (await loadBot(db, fb.id))!);
  const [toHuman] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.mission)
    .where(and(eq(tables.mission.playerId, fb.id), eq(tables.mission.targetKind, "base"), eq(tables.mission.targetId, humanBase)));
  assert.equal(toHuman.n, 0, "keine Mission gegen den Menschen");

  // 3. Mit Erlaubnis: Ziel; erst Aufklärung, dann (nach Bericht) Überfall.
  await updateBot(db, fb.id, { attackHumans: true });
  targets = await playerTargets(ctxFor(await loadBot(db, fb.id)), fbHome);
  assert.ok(targets.some((t) => t.id === humanBase && t.human), "Erlaubnis an");
  const turn = await botTurn(engine, (await loadBot(db, fb.id))!);
  const [recon] = await db.select().from(tables.mission)
    .where(and(eq(tables.mission.playerId, fb.id), eq(tables.mission.targetId, humanBase), eq(tables.mission.type, "aufklaerung")));
  assert.ok(recon, `Freibeuter klärt vor dem Angriff auf: ${turn.join(" | ")}`);
  await db.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, recon.id));

  // 4. Sperrfrist: ein Überfall in den letzten 12 Stunden sperrt weitere.
  await db.insert(tables.battleReport).values({
    kind: "ueberfall", title: "Test", attackerPlayerId: fb.id, defenderPlayerId: p.playerId, attackerBaseId: fbHome.id, defenderBaseId: humanBase,
    nestId: null, winner: "attacker", seed: 1, balanceVersion: "test", report: {}, createdAt: new Date(Date.now() - 3600000),
  });
  assert.equal(await humanCooldownActive(ctxFor(await loadBot(db, fb.id)), p.playerId), true);
  targets = await playerTargets(ctxFor(await loadBot(db, fb.id)), fbHome);
  assert.ok(!targets.some((t) => t.id === humanBase), "Sperrfrist");
  await db.update(tables.battleReport).set({ createdAt: new Date(Date.now() - 13 * 3600000) }).where(eq(tables.battleReport.attackerPlayerId, fb.id));
  assert.equal(await humanCooldownActive(ctxFor(await loadBot(db, fb.id)), p.playerId), false);

  // 5. Nachtschild des Menschen (läuft gerade): kein Ziel, der Befehl lehnt ab.
  await patchBase(humanBase, (s) => {
    s.protection.nightShieldStartHour = new Date().getUTCHours();
    s.protection.tzOffsetMinutes = 0;
    s.protection.nightShieldNext = null;
  });
  const night = (await db.select().from(tables.base).where(eq(tables.base.id, humanBase)))[0].state as BaseState;
  assert.equal(protectionStatus(night.protection, Date.now(), balance).reason, "nachtschild");
  targets = await playerTargets(ctxFor(await loadBot(db, fb.id)), fbHome);
  assert.ok(!targets.some((t) => t.id === humanBase), "Nachtschild");
  assert.deepEqual(await launchMission(engine, fb.id, key(), { type: "ueberfall", units: { korvette: 5 }, col: f.col, row: f.row }), { ok: false, code: "target_protected" });
  await updateBot(db, fb.id, { attackHumans: false });
});

test("Aktivitätszeiten: nicht rund um die Uhr, nächster Zug in der aktiven Zeit", () => {
  const start = Date.UTC(2026, 10, 2, 0, 0);
  for (const p of ["haendler", "festung", "freibeuter"] as const) {
    let active = 0;
    for (let h = 0; h < 24 * 7; h++) if (isActiveTime(p, 7, start + h * 3600000)) active++;
    assert.ok(active > 7 * 10 && active < 7 * 22, `${p}: ${active} aktive Stunden je Woche`);
    let t = start;
    for (let i = 0; i < 50; i++) {
      const next = nextTurnAt(p, 7, t, () => 0.5);
      assert.ok(next > t);
      assert.ok(isActiveTime(p, 7, next) || isActiveTime(p, 7, next - 20 * 60000), `${p}: Zug in aktiver Zeit`);
      t = next;
    }
  }
});

test("Worker-Takt: reihum, höchstens turnsPerMinute, abschaltbar; Dauer je Zug", async () => {
  for (const b of await loadBots(db)) await db.update(tables.player).set({ botState: { ...b.state, nextActAt: 0 } }).where(eq(tables.player.id, b.id));
  await setBotsServer(db, { enabled: false });
  assert.equal((await runBotsDue(engine)).turns, 0);
  await setBotsServer(db, { enabled: true });
  const r = await runBotsDue(engine);
  assert.equal(r.turns, botsConfig().turnsPerMinute);
  console.log(`# Dauer je Bot-Zug (ms): ${r.ms.join(", ")}`);
  const r2 = await runBotsDue(engine);
  assert.equal(r2.turns, 1, "der dritte Bot ist danach dran");
  const after = await loadBots(db);
  assert.ok(after.every((b) => (b.state.nextActAt ?? 0) > Date.now()), "alle haben einen neuen Termin");
  assert.ok(after.every((b) => typeof b.state.lastTurnMs === "number"));
  // Inaktive Bots ziehen nicht.
  await updateBot(db, after[0].id, { active: false });
  await db.update(tables.player).set({ botState: { ...after[0].state, nextActAt: 0 } }).where(eq(tables.player.id, after[0].id));
  assert.equal((await runBotsDue(engine)).turns, 0);
  await updateBot(db, after[0].id, { active: true });
  // Ereignisse laufen weiter (keine Abhängigkeit vom Bot-Takt).
  await processDue(engine, Date.now(), 500);
});

test("Felder: Probekampf zählt die vernichtete Wache, Bot besetzt ein bewachtes Feld, Feldverband bleibt daheim", async () => {
  // Feldkampf: Sieg = Wache vernichtet (ohne Truppen gibt es keinen „Sieg“ im Hafenkampf – alter Fehler).
  assert.equal(fieldProbe({ korvette: 3 }, { schnellboot: 4 }, {}, 8), 1);
  assert.equal(fieldProbe({ korvette: 2 }, { schnellboot: 8 }, {}, 8), 0);
  assert.equal(fieldProbe({ korvette: 1 }, {}, {}, 8), 1, "freies Feld");
  assert.deepEqual(withoutReserve({ korvette: 10, schuetzen: 40, landungsschiff: 2 }, { korvette: 3 }), { korvette: 7, schuetzen: 40, landungsschiff: 2 });
  assert.deepEqual(withoutReserve({ korvette: 1, zerstoerer: 4 }, { korvette: 4 }), { zerstoerer: 2 }, "fehlende Korvetten über Zerstörer");
  const bot = (await loadBots(db)).find((b) => b.profile === "festung")!;
  const home = (await homeBaseOf(db, bot.id))!;
  await db.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.playerId, bot.id));
  await ensureFieldPlanner(db, Date.now());
  // Nur bewachte Felder (Kartell-Wache nach Stufe), damit der Probekampf entscheidet.
  for (const f of await db.select().from(tables.resourceField)) {
    await db.update(tables.resourceField).set({ ownerId: null, missionId: null, guard: (balance as unknown as { fields: { guard: Record<string, number>[] } }).fields.guard[f.tier - 1], guardAt: null }).where(eq(tables.resourceField.id, f.id));
  }
  // Zu wenig Schiffe: kein Auslaufen, aber ein gemerktes Ziel, das Überfälle daheim lassen.
  await patchBase(home.id, (s) => {
    s.units = { korvette: 2 }; s.unitsAway = {};
    Object.assign(s.buildings, { hafenkommandantur: 6, kommandozentrale: 6 });
    s.resources = { stahl: 50_000, treibstoff: 50_000, elektronik: 50_000, proviant: 50_000 };
  });
  const c = { ...ctxFor(await loadBot(db, bot.id)), rand: () => 0.99 };
  const weak = { ...home, state: (await homeBaseOf(db, bot.id))!.state };
  assert.equal(await fieldTurn(c, weak, {}), false);
  assert.ok(c.state.fieldTarget, "Ziel gemerkt");
  assert.ok((reservedForField(c, home.id).korvette ?? 0) >= 3, JSON.stringify(c.state.fieldTarget));
  // Genug Schiffe: Besetzen gegen die Wache über die Befehle, Heimwache bleibt.
  await patchBase(home.id, (s) => { s.units = { korvette: 16, zerstoerer: 4 }; });
  const strong = { ...home, state: (await homeBaseOf(db, bot.id))!.state };
  assert.equal(await fieldTurn(c, strong, {}), true, c.log.join(" | "));
  assert.equal(c.state.fieldTarget, undefined, "Ziel erledigt");
  const [m] = await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, bot.id), eq(tables.mission.type, "besetzen")));
  assert.ok(m && m.status === "outbound", "Besetzen läuft");
  const st = (await homeBaseOf(db, bot.id))!.state;
  assert.ok((st.units.korvette ?? 0) + (st.units.zerstoerer ?? 0) >= 3, "Heimwache bleibt daheim");
});

test("Saisonwechsel: Bot ohne Hafen gründet im nächsten Zug einen neuen", async () => {
  const b = (await loadBots(db))[0];
  const home = (await homeBaseOf(db, b.id))!;
  await db.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.playerId, b.id));
  await db.delete(tables.base).where(eq(tables.base.playerId, b.id));
  assert.equal(await homeBaseOf(db, b.id), null);
  const actions = await botTurn(engine, (await loadBot(db, b.id))!);
  assert.ok(actions[0]?.startsWith("Hafen gegründet"), actions.join(" | "));
  const again = await homeBaseOf(db, b.id);
  assert.ok(again && again.id !== home.id);
});
