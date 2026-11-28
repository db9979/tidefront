// Integrationstests Saisonfinale „Leviathan“ gegen ein echtes PostgreSQL (TEST_DATABASE_URL; die Datenbank wird geleert).
// Ablauf Ankündigung → Erscheinen → Abzug bzw. Versenkung, Beute-Gutschrift bei der Heimkehr, Ruhmeshalle nur Menschen.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm, isCoast, nestSites, terrainAt } from "@tidefront/world";
import { finaleBalance, finaleSchedule, type BaseState } from "@tidefront/game-core";
import {
  balance, chooseBase, createAlliance, ensureWorldEventPlanner, joinRaid, openRaid, finaleCenter, finaleVanguards, hallOfFame, launchMission, missionPreview, processDue,
  register, reportScore, runningSeason, seed, startFinaleNow, worldEventsView, type Engine,
} from "../src/index.ts";
import { raidFinale } from "../src/bots-finale.ts";
import { botsConfig } from "../src/bots-core.ts";
import type { TurnCtx } from "../src/bots-war.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `fin${++keyN}-${Date.now()}`;
const FLEET = { korvette: 40, zerstoerer: 8 };

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

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

/** Spieler mit Hafen ohne Anfängerschutz, gerüstet mit FLEET; bot: als KI-Spieler markiert. */
async function newPlayer(name: string, field: number, bot = false) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.units = { ...FLEET };
    s.resources.treibstoff = 1_000_000;
    s.buildings.kommandozentrale = 15;
    s.buildings.hafenkommandantur = 10;
    s.buildings.lagerkomplex = 15; // Platz für die Beute (das Lager begrenzt wie immer)
  });
  if (bot) await db.update(tables.player).set({ botProfile: "freibeuter" }).where(eq(tables.player.id, p.playerId));
  return { playerId: p.playerId, baseId, ...f };
}

async function finaleRow() {
  const [e] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.kind, "finale")).orderBy(sql`id desc`).limit(1);
  return e;
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

/** Überfall auf das Finale; Rückgabe Ankunft. */
async function attack(p: { playerId: number }, eventId: number) {
  const m = await launchMission(engine, p.playerId, key(), { type: "ueberfall", units: FLEET, col: 0, row: 0, eventId });
  assert.equal(m.ok, true, JSON.stringify(m));
  return m as { ok: true; missionId: number; arriveAtMs: number };
}

/** Rückfahrten aller Missionen gegen Ereignisse abwarten. */
async function allHome() {
  const ms = await db.select().from(tables.mission).where(and(eq(tables.mission.targetKind, "event"), inArray(tables.mission.status, ["outbound", "returning"])));
  const last = Math.max(0, ...ms.map((m) => (m.returnAt ?? m.arriveAt).getTime()));
  if (last > 0) await runUntil(last + 1000);
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} like 'finale%'`);
  await db.update(tables.worldEvent).set({ status: "ended", outcome: "test" });
  await db.update(tables.base).set({ state: sql`jsonb_set(state, '{protection,createdAtMs}', to_jsonb(${Date.now()}::bigint))` });
});

after(async () => {
  await client.end();
});

test("Wertung: Kampfpunkte aus Armada-Kämpfen × 0,5, Beute voll; Flaggschiff-Sektionen haben einen Wert", () => {
  const dl = { schnellboot: 10, piratenmiliz: 80, flaggschiff: 2 };
  const loot = { stahl: 1000 };
  const full = reportScore({ kind: "weltereignis", weKind: "schatzschiff", attackerPlayerId: 1, defenderPlayerId: null, al: {}, dl, loot });
  const armada = reportScore({ kind: "weltereignis", weKind: "finale", attackerPlayerId: 1, defenderPlayerId: null, al: {}, dl, loot });
  assert.ok(full.attacker!.kampf > 2 * 2375);
  assert.equal(armada.attacker!.kampf, full.attacker!.kampf * 0.5);
  assert.equal(armada.attacker!.beute, full.attacker!.beute);
  assert.equal(balance.scoring?.armadaFactor, 0.5);
});

test("Ort: Sammelpunkt auf See mit kleinster größter Entfernung; Vorhuten nur bei weit verteilten Häfen", () => {
  const a = { col: 20, row: 30, name: "A" };
  const b = { col: 24, row: 31, name: "B" };
  const c = finaleCenter([a, b])!;
  assert.equal(terrainAt(c.col, c.row), "sea");
  assert.deepEqual(finaleVanguards(c, [a, b]), [], "nahe Häfen: keine Vorhut");
  // Weit verteilt: Vorhut höchstens vanguardKm (v1.35: 500 km, vorher 400) vor dem fernen Hafen.
  const vk = finaleBalance(balance)!.vanguardKm;
  const first = freeCoast(10);
  let second = first;
  for (let k = 11; k < 3000; k += 37) {
    try { const h = freeCoast(k); if (hexDistanceKm(first, h) > hexDistanceKm(first, second)) second = h; } catch { break; }
  }
  const far = [first, second].map((h, i) => ({ ...h, name: `F${i}` }));
  assert.ok(hexDistanceKm(far[0], far[1]) > finaleBalance(balance)!.vanguardSpreadKm);
  const center = finaleCenter(far)!;
  const v = finaleVanguards(center, far);
  assert.ok(v.length >= 1);
  for (const x of v) {
    assert.equal(terrainAt(x.col, x.row), "sea");
    assert.ok(far.some((p) => hexDistanceKm(p, x) <= vk), `${x.name} höchstens ${vk} km vor einem Hafen`);
  }
});

test("Ablauf: Ankündigung (keine gewöhnlichen Ereignisse mehr), Erscheinen mit fester Stärke, Abschnitte, Beute bei Heimkehr, Abzug „entkommen“, Ruhmeshalle nur Menschen", async (t) => {
  // v1.35: gewöhnliche Ereignisse laufen bis ordinaryEventsUntilDays (37,5); dieser Ablauf prüft das Finale ohne sie
  // (Regel der Ankündigung wie bis v1.34), die neue Grenze prüfen balance135 (game-core) und world-events-season.
  const fin0 = finaleBalance(balance)!;
  const until0 = fin0.ordinaryEventsUntilDays;
  delete fin0.ordinaryEventsUntilDays;
  t.after(() => { fin0.ordinaryEventsUntilDays = until0; });
  const season = (await runningSeason(db))!;
  // Saison so verschieben, dass jetzt Tag 37 ist (Ankündigung fällig, Erscheinen in ~12 h).
  const start = Date.now() - 36 * DAY;
  await db.update(tables.season).set({ startsAt: new Date(start), endsAt: new Date(start + 42 * DAY) }).where(eq(tables.season.id, season.id));
  const a = await newPlayer("Kapitaen", 300);
  const b = await newPlayer("Maschine", 302, true);
  const c = await newPlayer("Matrose", 304);
  const s = finaleSchedule(start, start + 42 * DAY, balance);
  assert.equal(await ensureWorldEventPlanner(db, Date.now()), null, "nach der Ankündigung kein gewöhnliches Ereignis");
  const [ann] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "finale_announce"), eq(tables.gameEvent.status, "pending")));
  assert.ok(ann, "Ankündigung geplant");
  await runUntil(Date.now() + 1000);
  let e = await finaleRow();
  assert.equal(e.status, "announced");
  assert.equal(e.activeAt.getTime(), s.appearMs);
  assert.equal(terrainAt(e.col, e.row), "sea");
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, a.playerId));
  assert.ok(msgs.some((m) => (m.subject ?? "").includes("Saisonfinale")), "Ankündigung als Systemnachricht");
  const view = await worldEventsView(engine, a.playerId);
  assert.ok(view.nearby.includes(e.id), "Banner für alle");
  // Vor dem Erscheinen: Mission käme zu früh an.
  const early = await launchMission(engine, a.playerId, key(), { type: "ueberfall", units: FLEET, col: 0, row: 0, eventId: e.id });
  assert.deepEqual(early, { ok: false, code: "finale_not_yet" });

  // Erscheinen jetzt (Zeit vorziehen): Stärke = max(40 000, 4 × Σ K) mal Regler 100 %.
  const now = Date.now();
  await db.update(tables.worldEvent).set({ activeAt: new Date(now) }).where(eq(tables.worldEvent.id, e.id));
  await db.update(tables.gameEvent).set({ dueAt: new Date(now) }).where(eq(tables.gameEvent.type, "finale_appear"));
  await runUntil(now + 1000);
  e = await finaleRow();
  assert.equal(e.status, "active");
  const k = 40 * 200 + 8 * 450;
  const fd = (e.data as { finale: { totalHp: number; participants: number } }).finale;
  assert.equal(fd.participants, 3);
  // v1.35: die KI („Maschine“) zählt nur × botKFactor.
  assert.equal(fd.totalHp, Math.max(40000, 4 * (2 + (fin0.botKFactor ?? 1)) * k));
  const units = e.units as Record<string, number>;
  assert.equal(units.flaggschiff, Math.round((0.1 * fd.totalHp) / 1000));

  // Vorschau: Abschnitt 0,5 × K, Siegchance, Beute.
  const pv = await missionPreview(engine, a.playerId, { type: "ueberfall", units: FLEET, col: 0, row: 0, eventId: e.id });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  const fin = (pv as { finale: { sector: Record<string, number>; winRate: number; loot: Record<string, number> } }).finale;
  assert.equal(fin.sector.schnellboot, Math.round((0.5 * k) / 80));
  assert.equal(fin.winRate, 1);
  assert.ok(fin.loot.stahl > 0);

  // Mensch und KI greifen an; Verluste der Armada bleiben, Beute kommt bei der Heimkehr ohne Laderaumgrenze.
  const before = (await stateOf(a.baseId)).resources.stahl;
  const ma = await attack(a, e.id);
  const mb = await attack(b, e.id);
  await runUntil(Math.max(ma.arriveAtMs, mb.arriveAtMs) + 1000);
  e = await finaleRow();
  assert.ok((e.units as Record<string, number>).schnellboot < units.schnellboot, "Geschwader geschwächt");
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.attackerPlayerId, a.playerId)));
  const r = rep.report as { worldEvent: { kind: string; destroyedHp: number }; battle: { loot: Record<string, number> } };
  assert.equal(r.worldEvent.kind, "finale");
  assert.ok(r.worldEvent.destroyedHp > 0);
  const lootSum = Object.values(r.battle.loot).reduce((x, y) => x + y, 0);
  assert.ok(lootSum > 1000, `Beute ${lootSum} (Kriegsschiffe ohne Laderaum)`);
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, ma.missionId));
  assert.deepEqual(mission.cargoHome, r.battle.loot, "Beute fährt mit heim");
  await allHome();
  const afterHome = (await stateOf(a.baseId)).resources.stahl;
  // Gutschrift (Produktion und Verbrauch der Fahrtzeit verschieben den Bestand nur wenig).
  assert.ok(afterHome - before > 0.9 * r.battle.loot.stahl, `Gutschrift: ${before} + ${r.battle.loot.stahl} ≈ ${afterHome}`);

  // Abzug: nicht versenkt → entkommen; Ruhmeshalle nur Menschen, Erfolg Armada-Jäger.
  await runUntil(e.endsAt.getTime() + 1000);
  e = await finaleRow();
  assert.equal(e.status, "ended");
  assert.equal(e.outcome, "escaped");
  const [res] = await db.select().from(tables.seasonFinaleResult).where(eq(tables.seasonFinaleResult.seasonId, season.id));
  assert.equal(res.outcome, "escaped");
  const players = res.players as { playerId: number; share: number }[];
  assert.deepEqual(players.map((p) => p.playerId), [a.playerId], "nur Menschen mit Schaden (KI trägt bei, steht aber nicht in der Ruhmeshalle)");
  assert.equal(res.championPlayerId, a.playerId);
  const dmgB = await db.select().from(tables.worldEventDamage).where(and(eq(tables.worldEventDamage.eventId, e.id), eq(tables.worldEventDamage.playerId, b.playerId)));
  assert.ok(dmgB[0].hp > 0, "KI hat Schaden gemacht");
  assert.ok(res.destroyedHp > (players[0] as { hp?: number }).hp!, "Gesamtschaden enthält die KI");
  const tiers = await db.select().from(tables.achievementTier).where(and(eq(tables.achievementTier.playerId, a.playerId), eq(tables.achievementTier.achievementId, "armadajaeger")));
  assert.ok(tiers.length >= 1, "Erfolg Armada-Jäger");
  assert.equal(c.playerId > 0, true);
});

test("Versenkung (Finale vorgezogen per Verwaltung): Geschwader, dann Flaggschiff, Schatz, Ruhmeshalle nach Saisonende", async () => {
  const p = await newPlayer("Bezwinger", 320);
  const r = await startFinaleNow(engine, 0);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await startFinaleNow(engine, 0), { ok: false, code: "finale_running" });
  await runUntil(Date.now() + 1000);
  let e = await finaleRow();
  assert.equal(e.status, "active");
  // Kleine Armada für den Test: 4 Boote, 2 Sektionen.
  await db.update(tables.worldEvent).set({ units: { schnellboot: 4, piratenmiliz: 32, flaggschiff: 2 } }).where(eq(tables.worldEvent.id, e.id));
  const m1 = await attack(p, e.id);
  await runUntil(m1.arriveAtMs + 1000);
  e = await finaleRow();
  assert.deepEqual(e.units, { flaggschiff: 2 }, "Geschwader versenkt, Flaggschiff bleibt");
  assert.ok((await worldEventsView(engine, p.playerId)).events.find((x) => x.id === e.id)!.finale!.flagshipOpen);
  await allHome();
  const m2 = await attack(p, e.id);
  await runUntil(m2.arriveAtMs + 1000);
  e = await finaleRow();
  assert.equal(e.status, "ended");
  assert.equal(e.outcome, "defeated");
  assert.equal(e.winnerPlayerId, p.playerId);
  const [rep] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.title, "Leviathan versenkt"));
  assert.ok((rep.report as { worldEvent: { treasure?: Record<string, number> } }).worldEvent.treasure, "Schatz für das Versenken");
  // Saisonende: Ruhmeshalle zeigt das Finale.
  await allHome();
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await processDue(engine, Date.now());
  const hall = await hallOfFame(db, p.playerId);
  assert.equal(hall[0].finale?.outcome, "sunk");
  assert.equal(hall[0].finale?.champion, "Bezwinger");
  assert.equal(hall[0].finale?.own?.rank, 1);
});

test("Sammelangriff aufs Flaggschiff: ein Kampf aus dem gemeinsamen K, Schatz und Beute nach Beitrag ohne Laderaum, Allianz in der Ruhmeshalle", async () => {
  const x = await newPlayer("Erster", 340);
  const y = await newPlayer("Zweiter", 342);
  const al = (await createAlliance(engine, x.playerId, { name: "Leviathanjaeger", tag: "LJ" })).allianceId;
  await db.insert(tables.allianceMember).values({ playerId: y.playerId, allianceId: al, role: "mitglied" });
  const r = await startFinaleNow(engine, 0);
  assert.equal(r.ok, true, JSON.stringify(r));
  await runUntil(Date.now() + 1000);
  let e = await finaleRow();
  assert.equal(e.status, "active");
  await db.update(tables.worldEvent).set({ units: { flaggschiff: 3 } }).where(eq(tables.worldEvent.id, e.id));
  const o = await openRaid(engine, x.playerId, key(), { col: e.col, row: e.row, eventId: e.id, units: FLEET, joinMinutes: 15, arriveMinutes: 15 });
  assert.equal(o.ok, true, JSON.stringify(o));
  const raidId = (o as { raidId: number }).raidId;
  assert.equal((await joinRaid(engine, y.playerId, key(), { raidId, units: FLEET })).ok, true);
  const [raid] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  await runUntil(raid.joinDeadline.getTime() + 1);
  const [launched] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  await runUntil(launched.arriveAt!.getTime() + 1);
  e = await finaleRow();
  assert.equal(e.outcome, "defeated", "Flaggschiff versenkt");
  const dmg = await db.select().from(tables.worldEventDamage).where(eq(tables.worldEventDamage.eventId, e.id));
  assert.deepEqual(new Set(dmg.map((d) => d.playerId)), new Set([x.playerId, y.playerId]));
  const ms = await db.select().from(tables.mission).where(inArray(tables.mission.playerId, [x.playerId, y.playerId]));
  for (const m of ms) {
    const got = Object.values((m.cargoHome ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
    assert.ok(got > 1000, `Beuteanteil ohne Laderaumgrenze (${got})`);
  }
  const [res] = await db.select().from(tables.seasonFinaleResult).where(eq(tables.seasonFinaleResult.outcome, "sunk")).orderBy(sql`id desc`).limit(1);
  assert.equal(res.fleetTag, "LJ", "Titel „Leviathan-Flotte“");
  assert.equal((res.players as unknown[]).length, 2);
});

test("KI-Spieler: Freibeuter greift einen Abschnitt an, wenn der Probekampf sicher gewinnt; höchstens alle 12 h; Händler nicht", async () => {
  const k = await newPlayer("Kaperkapitaen", 360, true);
  const r = await startFinaleNow(engine, 0);
  assert.equal(r.ok, true, JSON.stringify(r));
  await runUntil(Date.now() + 1000);
  const e = await finaleRow();
  assert.equal(e.status, "active");
  const [base] = await db.select().from(tables.base).where(eq(tables.base.id, k.baseId));
  const turn = (profile: "freibeuter" | "haendler"): TurnCtx => ({
    engine, nowMs: Date.now(), rand: () => 0.5, log: [], key: () => key(), state: {},
    bot: { id: k.playerId, name: "Kaperkapitaen", profile, settings: { active: true, attackHumans: false }, state: {} },
    cfg: botsConfig().profiles[profile],
  });
  const b = { ...base, state: base.state as BaseState };
  assert.equal(await raidFinale(turn("haendler"), b, {}), false, "Händler nehmen nicht teil");
  const c = turn("freibeuter");
  assert.equal(await raidFinale(c, b, {}), true, c.log.join(" "));
  const [m] = await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, k.playerId), eq(tables.mission.targetKind, "event")));
  assert.equal(m.targetId, e.id);
  assert.equal((m.plan as { units: Record<string, number> }).units.landungsschiff, undefined);
  const [b2] = await db.select().from(tables.base).where(eq(tables.base.id, k.baseId));
  assert.equal(await raidFinale(turn("freibeuter"), { ...b2, state: b2.state as BaseState }, {}), false, "nicht zweimal in 12 h");
});
