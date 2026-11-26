// Integrationstests Kriegsglück, Veteranen und Kampfbilanz gegen ein echtes PostgreSQL (wird geleert):
// gespeicherte Würfe im Bericht, Erfahrung nach Kampf (Angreifer bei Rückkehr, Verteidiger sofort), Veteranen als
// Modifikator-Quelle mit Aufschlüsselung, Kampfbilanz der Saison mit Zwischenspeicher und alten Berichten ohne Würfe.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState, BattleReport } from "@tidefront/game-core";
import {
  balance,
  baseView,
  battleStats,
  chooseBase,
  clearBattleStatsCache,
  launchMission,
  modifiersFor,
  processDue,
  register,
  reportGet,
  seed,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `b${++keyN}-${Date.now()}`;

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

const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
const fleet = { korvette: 6, landungsschiff: 2, schuetzen: 150, kampfpanzer: 2 };

/** Überfall auf das nächste Nest der Stufe 1 bis zur Rückkehr; gibt Bericht und Mission zurück. */
async function raidNest(p: { playerId: number; baseId: number }) {
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const here = await baseView(engine, p.playerId);
  const near = nests.map((n) => ({ n, d: Math.hypot(n.col - here.base!.col, n.row - here.base!.row) })).sort((a, b) => a.d - b.d)[0].n;
  const m = await launchMission(engine, p.playerId, key(), { type: "ueberfall", units: fleet, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const id = (m as { missionId: number }).missionId;
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  await processDue(engine, mission.arriveAt.getTime() + 1);
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, arrived.reportId!));
  return { report, arrived };
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

test("Kriegsglück: Würfe je Phase und Seite im gespeicherten Bericht; Veteranen nach der Rückkehr", async () => {
  const p = await newPlayer("Wanda", 4);
  await patchBase(p.baseId, (s) => { s.units = { ...fleet }; s.resources = { ...rich }; });
  const { report, arrived } = await raidNest(p);
  assert.equal(report.balanceVersion, "v1.4");
  const battle = (report.report as { battle: BattleReport }).battle;
  assert.equal(battle.winner, "attacker");
  for (const ph of battle.phases) {
    assert.ok(ph.luck, `Würfe in ${ph.phase}`);
    for (const v of [ph.luck.attacker, ph.luck.defender]) assert.ok(Number.isInteger(v) && v >= 1 && v <= balance.combat.luck!.die);
  }
  // Ansicht des Berichts liefert die Würfe mit
  const view = await reportGet(engine, p.playerId, report.id);
  assert.deepEqual((view!.data.battle as BattleReport).phases[0].luck, battle.phases[0].luck);
  // … und den Faktor je Wurf für die Anzeige (Regel bleibt im Kern)
  const f0 = ((view!.data.battle as BattleReport).phases[0] as { luckFactor?: { attacker: number } }).luckFactor;
  assert.ok(f0 && f0.attacker >= balance.combat.luck!.min && f0.attacker <= balance.combat.luck!.max);

  // Vor der Rückkehr noch keine Erfahrung, danach für überlebende Typen
  assert.equal((await stateOf(p.baseId)).veterancy, undefined);
  await processDue(engine, arrived.returnAt!.getTime() + 1);
  const s = await stateOf(p.baseId);
  assert.ok((s.veterancy?.korvette ?? 0) > 0, JSON.stringify(s.veterancy));
  assert.ok((s.veterancy?.korvette ?? 0) <= balance.veterans!.xpWin * balance.veterans!.ratioMax);
  assert.ok((s.veterancy?.landungsschiff ?? 0) > 0);
  const vets = (await baseView(engine, p.playerId)).base!.veterans;
  assert.ok(vets.some((v) => v.id === "korvette" && v.xp > 0));
});

test("Veteranen als Modifikator-Quelle: Angriff je Typ, Aufschlüsselung getrennt, Verwässerung bei Ausbildung", async () => {
  const p = await newPlayer("Xaver", 7);
  await patchBase(p.baseId, (s) => {
    s.units = { korvette: 10 };
    s.veterancy = { korvette: 45, schuetzen: 5 };
    s.research = { levels: { infanteriewaffen: 2 }, order: null };
  });
  const mods = await modifiersFor(db, p.playerId);
  assert.ok(Math.abs(mods.attackUnit!.korvette - 1.1) < 1e-9);
  assert.equal(mods.attackUnit!.schuetzen, undefined, "Rekruten ohne Bonus");
  const view = (await baseView(engine, p.playerId)).base!;
  const ids = view.modifierSources.map((x) => x.id);
  assert.deepEqual(ids, ["forschung", "veteranen"]);
  assert.equal(view.modifierSources[1].label, "Veteranen");
  assert.ok(Math.abs(view.modifierSources[0].mods.attack!.land! - 1.1) < 1e-9);
  assert.equal(view.veterans.find((v) => v.id === "korvette")?.rank, "veteran");
  // Kartell-Abwehr: Verteidiger sammelt Erfahrung sofort (Schützen kämpfen und überleben)
  await patchBase(p.baseId, (s) => { s.protection.createdAtMs = 0; s.units = { korvette: 10, schuetzen: 80 }; s.defenses = { bunkerlinie: 1 }; s.resources = { ...rich }; });
  const [next] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${p.baseId} and ${tables.gameEvent.type} = 'raid_launch' and ${tables.gameEvent.status} = 'pending'`);
  await processDue(engine, next.dueAt.getTime() + 1);
  const [raid] = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${p.baseId}`);
  await processDue(engine, raid.arriveAt.getTime() + 1);
  const [r] = await db.select().from(tables.battleReport).where(sql`${tables.battleReport.kind} = 'kartell' and ${tables.battleReport.defenderBaseId} = ${p.baseId}`);
  assert.equal(r.winner, "defender");
  const after = await stateOf(p.baseId);
  assert.ok((after.veterancy?.schuetzen ?? 0) > 5, JSON.stringify(after.veterancy));
  // Kartell-Angreifer trägt keine Modifikatoren
  assert.equal((r.report as { attacker: { modifiers?: unknown } }).attacker.modifiers, undefined);
});

test("Kampfbilanz: Siege, Würfelglück, beste Einheit, Nest; Zwischenspeicher; alter Bericht ohne Würfe lesbar", async () => {
  const p = await newPlayer("Yvonne", 10);
  await patchBase(p.baseId, (s) => { s.units = { ...fleet }; s.resources = { ...rich }; });
  clearBattleStatsCache();
  const empty = await battleStats(engine, p.playerId);
  assert.equal(empty.battles, 0);
  assert.equal(empty.luck.average, null);
  await raidNest(p);
  // Zwischengespeichert: ohne Leeren noch der alte Stand
  assert.equal((await battleStats(engine, p.playerId)).battles, 0);
  clearBattleStatsCache(p.playerId);
  const s = await battleStats(engine, p.playerId);
  assert.equal(s.battles, 1);
  assert.deepEqual(s.record.nest, { wins: 1, losses: 0 });
  assert.equal(s.wins, 1);
  assert.equal(s.strongestNest, 1);
  assert.ok(s.sunkShips > 0 && s.sunkValue > 0, "Schnellboote versenkt");
  assert.ok(s.destroyedValue >= s.sunkValue);
  assert.ok(s.bestUnit !== null && balance.units[s.bestUnit.id] !== undefined);
  assert.ok(s.luck.rolls > 0 && s.luck.average! >= 1 && s.luck.average! <= 20);
  assert.equal(s.luck.expected, 10.5);

  // Alter Bericht (v1.3, ohne Würfe und ohne Schaden je Phase) bleibt lesbar und zählt ohne Würfe mit
  const old = (await db.select().from(tables.battleReport).where(eq(tables.battleReport.attackerPlayerId, p.playerId)))[0];
  const battle = structuredClone((old.report as { battle: BattleReport }).battle) as unknown as { phases: Record<string, unknown>[] };
  for (const ph of battle.phases) { delete ph.luck; delete ph.damage; }
  const [ins] = await db.insert(tables.battleReport).values({
    kind: "ueberfall", title: "Alter Bericht", attackerPlayerId: p.playerId, defenderPlayerId: null, attackerBaseId: p.baseId,
    defenderBaseId: null, nestId: old.nestId, winner: "attacker", seed: 1, balanceVersion: "v1.3",
    report: { ...(old.report as object), battle },
  }).returning({ id: tables.battleReport.id });
  const got = await reportGet(engine, p.playerId, ins.id);
  assert.equal(got!.balanceVersion, "v1.3");
  assert.equal(((got!.data.battle as BattleReport).phases[0] as { luck?: unknown }).luck, undefined);
  clearBattleStatsCache();
  const s2 = await battleStats(engine, p.playerId);
  assert.equal(s2.battles, 2);
  assert.equal(s2.record.nest.wins, 2);
  assert.equal(s2.luck.rolls, s.luck.rolls, "alte Berichte ohne Würfe zählen nicht zum Würfelglück");
  assert.ok(s2.veterans.length > 0);
});
