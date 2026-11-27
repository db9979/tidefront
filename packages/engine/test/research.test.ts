// Integrationstests Forschung und Modifikatoren gegen ein echtes PostgreSQL (wird geleert): Forschungsablauf mit
// Idempotenz, Durchbruch-Wurf und Wahl, Modifikatoren in Produktion, Reise, Kampf und Kartell-Verteidigung,
// weitere Quellen über registerModifierSource und Rücksetzen zum Saisonende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { productionRates, researchModifiers, rollBreakthrough, type BaseState } from "@tidefront/game-core";
import {
  balance,
  baseView,
  chooseBase,
  launchMission,
  missionPreview,
  modifiersFor,
  processDue,
  register,
  registerModifierSource,
  researchCancel,
  researchChoose,
  researchStart,
  seed,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `r${++keyN}-${Date.now()}`;
const HOUR = 3600000;

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

const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

after(async () => {
  await client.end();
});

test("Forschungsablauf: Start idempotent, Ereignis schließt ab, Abbruch erstattet", async () => {
  const p = await newPlayer("Rita", 3);
  const none = await researchStart(engine, p.playerId, key(), "hochofen");
  assert.deepEqual(none, { ok: false, code: "building_required" });
  await patchBase(p.baseId, (s) => { s.buildings.forschungsamt = 1; s.buildings.lagerkomplex = 8; s.resources = { ...rich }; });
  const k = key();
  const r1 = await researchStart(engine, p.playerId, k, "hochofen");
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await researchStart(engine, p.playerId, k, "hochofen");
  assert.deepEqual(r2, r1);
  let s = await stateOf(p.baseId);
  assert.equal(s.research!.order!.techId, "hochofen");
  assert.ok(s.resources.stahl <= rich.stahl - 600 + 1);
  assert.deepEqual(await researchStart(engine, p.playerId, key(), "logistik"), { ok: false, code: "research_busy" });
  const view = await baseView(engine, p.playerId);
  assert.equal(view.base!.research!.order!.techId, "hochofen");
  assert.ok(view.base!.research!.techs.find((t) => t.id === "logistik")!.blocker === "research_busy");

  // Seed so setzen, dass kein Durchbruch fällt (deterministisch).
  await patchBase(p.baseId, (st) => {
    const o = st.research!.order!;
    for (let seedN = 1; ; seedN++) if (!rollBreakthrough({ ...o, seed: seedN }).breakthrough) { o.seed = seedN; break; }
  });
  const finishes = (r1 as { finishesAt: number }).finishesAt;
  await processDue(engine, finishes + 1);
  s = await stateOf(p.baseId);
  assert.equal(s.research!.levels.hochofen, 1);
  assert.equal(s.research!.order, null);
  assert.equal(s.research!.lastRoll!.breakthrough, false);
  assert.ok(s.research!.lastRoll!.roll >= 1 && s.research!.lastRoll!.roll <= 100);

  // Abbruch: zweite Forschung starten und sofort abbrechen.
  const r3 = await researchStart(engine, p.playerId, key(), "logistik");
  assert.equal(r3.ok, true, JSON.stringify(r3));
  const c = await researchCancel(engine, p.playerId, key());
  assert.equal(c.ok, true);
  assert.ok((c as { refund: Record<string, number> }).refund.stahl >= 399);
  assert.equal((await stateOf(p.baseId)).research!.order, null);
  // Das alte Ereignis läuft ins Leere.
  await processDue(engine, (r3 as { finishesAt: number }).finishesAt + 1);
  assert.equal((await stateOf(p.baseId)).research!.levels.logistik, undefined);
});

test("Durchbruch: Wurf im Ereignis, Systemnachricht, Wahl idempotent", async () => {
  const p = await newPlayer("Bert", 5);
  await patchBase(p.baseId, (s) => { s.buildings.forschungsamt = 5; s.buildings.lagerkomplex = 8; s.resources = { ...rich }; });
  const r = await researchStart(engine, p.playerId, key(), "funkmesstechnik");
  assert.equal(r.ok, true, JSON.stringify(r));
  await patchBase(p.baseId, (st) => {
    const o = st.research!.order!;
    assert.ok(Math.abs(o.chance! - 0.2) < 1e-9);
    for (let seedN = 1; ; seedN++) if (rollBreakthrough({ ...o, seed: seedN }).breakthrough) { o.seed = seedN; break; }
  });
  await processDue(engine, (r as { finishesAt: number }).finishesAt + 1);
  let s = await stateOf(p.baseId);
  assert.equal(s.research!.lastRoll!.breakthrough, true);
  assert.equal(s.research!.lastRoll!.choice, null);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, p.playerId));
  assert.ok(msgs.some((m) => m.subject?.startsWith("Durchbruch")));
  assert.deepEqual(await researchStart(engine, p.playerId, key(), "strahltriebwerke"), { ok: false, code: "breakthrough_pending" });
  const k = key();
  const c1 = await researchChoose(engine, p.playerId, k, "level");
  assert.deepEqual(c1, { ok: true, choice: "level" });
  assert.deepEqual(await researchChoose(engine, p.playerId, k, "level"), c1);
  assert.deepEqual(await researchChoose(engine, p.playerId, key(), "level"), { ok: true, choice: "level" });
  assert.deepEqual(await researchChoose(engine, p.playerId, key(), "speed"), { ok: false, code: "already_chosen" });
  s = await stateOf(p.baseId);
  assert.equal(s.research!.levels.funkmesstechnik, 2);
  const view = await baseView(engine, p.playerId);
  assert.equal(view.base!.radarWarningMinutes, 0); // ohne Radarstation keine Vorwarnung
  // v1.6: Radar braucht Strom; Nebel (Quelle „Wetter“) wirkt mit.
  await patchBase(p.baseId, (st) => { st.buildings.radarstation = 2; st.buildings.kraftwerk = 2; });
  const v2 = await baseView(engine, p.playerId);
  const fog = v2.base!.modifierSources.find((x) => x.id === "wetter")?.mods.radarWarning ?? 1;
  assert.ok(Math.abs(v2.base!.radarWarningMinutes - 20 * 1.24 * fog) < 1e-9);
});

test("Modifikatoren: Produktion, Lager und Reise aus der Forschung; weitere Quelle multiplikativ", async () => {
  const p = await newPlayer("Hans", 7);
  await patchBase(p.baseId, (s) => {
    s.buildings = { ...s.buildings, stahlwerk: 4, kraftwerk: 4, lagerkomplex: 2, hafenkommandantur: 1 };
    s.units = { korvette: 2, landungsschiff: 1 };
    s.resources = { ...rich };
  });
  const before = await baseView(engine, p.playerId);
  const nest = (await db.select().from(tables.nest))[0];
  const prevBefore = await missionPreview(engine, p.playerId, { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.equal(prevBefore.ok, true, JSON.stringify(prevBefore));
  await patchBase(p.baseId, (s) => { s.research = { levels: { hochofen: 3, lagertechnik: 2, dampfturbinen: 3, logistik: 3 }, order: null }; });
  const mods = await modifiersFor(db, p.playerId);
  assert.deepEqual(mods, researchModifiers({ hochofen: 3, lagertechnik: 2, dampfturbinen: 3, logistik: 3 }, balance));
  const after1 = await baseView(engine, p.playerId);
  const s = await stateOf(p.baseId);
  const plain = productionRates(s, balance).buildingPerHour.stahl;
  assert.ok(Math.abs(after1.base!.rates.stahl - before.base!.rates.stahl - plain * 0.24) < 1e-6);
  assert.ok(Math.abs(after1.base!.capacity - before.base!.capacity * 1.2) < 1e-6);
  assert.ok(Math.abs(after1.base!.modifiers.production!.stahl! - 1.24) < 1e-9);
  const prevAfter = await missionPreview(engine, p.playerId, { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.ok(prevAfter.ok && prevBefore.ok);
  assert.ok(Math.abs(prevAfter.travelSeconds - prevBefore.travelSeconds / 1.24) < 1e-6);
  assert.ok(prevAfter.fuelCost < prevBefore.fuelCost);

  // Weitere Quelle (z. B. Wetter): wird multiplikativ kombiniert und lässt sich wieder abmelden.
  const off = registerModifierSource((_db, playerId) => (playerId === p.playerId ? { production: { stahl: 2 } } : null));
  try {
    const m2 = await modifiersFor(db, p.playerId);
    assert.ok(Math.abs(m2.production!.stahl! - 2.48) < 1e-9);
  } finally {
    off();
  }
  assert.ok(Math.abs((await modifiersFor(db, p.playerId)).production!.stahl! - 1.24) < 1e-9);
});

test("Modifikatoren im Kampf: Angreifer im Bericht, Kartell-Verteidigung mit Forschung", async () => {
  const p = await newPlayer("Ines", 9);
  await patchBase(p.baseId, (s) => {
    s.units = { korvette: 4, landungsschiff: 2, schuetzen: 150 };
    s.resources = { ...rich };
    s.research = { levels: { verbundpanzerung: 3, infanteriewaffen: 2 }, order: null };
  });
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const here = await baseView(engine, p.playerId);
  const near = nests.map((n) => ({ n, d: Math.hypot(n.col - here.base!.col, n.row - here.base!.row) })).sort((a, b) => a.d - b.d)[0].n;
  const m = await launchMission(engine, p.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 2, schuetzen: 150 }, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await processDue(engine, mission.arriveAt.getTime() + 1);
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, mission.id));
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, arrived.reportId!));
  const data = report.report as { attacker: { modifiers?: { hp?: { land?: number }; attack?: { land?: number } } } };
  assert.ok(Math.abs(data.attacker.modifiers!.hp!.land! - 1.15) < 1e-9);
  assert.ok(Math.abs(data.attacker.modifiers!.attack!.land! - 1.1) < 1e-9);

  // Kartell gegen einen Hafen, dessen Truppen über eine Quelle fast unverwundbar sind.
  const q = await newPlayer("Jost", 13);
  await patchBase(q.baseId, (s) => { s.protection.createdAtMs = 0; s.units = { schuetzen: 25 }; s.resources = { ...rich }; });
  const off = registerModifierSource((_db, playerId) => (playerId === q.playerId ? { hp: { land: 1000 } } : null));
  try {
    const [next] = await db.select().from(tables.gameEvent).where(sql`${tables.gameEvent.baseId} = ${q.baseId} and ${tables.gameEvent.type} = 'raid_launch' and ${tables.gameEvent.status} = 'pending'`);
    await processDue(engine, next.dueAt.getTime() + 1);
    const [raid] = await db.select().from(tables.mission).where(sql`${tables.mission.type} = 'kartell' and ${tables.mission.targetId} = ${q.baseId}`);
    await processDue(engine, raid.arriveAt.getTime() + 1);
    const [r] = await db.select().from(tables.battleReport).where(sql`${tables.battleReport.kind} = 'kartell' and ${tables.battleReport.defenderBaseId} = ${q.baseId}`);
    assert.equal(r.winner, "defender");
    const battle = (r.report as { battle: { defender: { losses: Record<string, number> } } }).battle;
    // Das Kartell zählt die Hälfte der Forschungs-Lebenspunkte mit (pirates.raidResearchWeight, v1.7), verliert aber klar.
    assert.ok((battle.defender.losses.schuetzen ?? 0) < 25, JSON.stringify(battle.defender.losses));
  } finally {
    off();
  }
});

test("Saisonende: Forschung wird mit dem Stützpunkt zurückgesetzt", async () => {
  const p = await newPlayer("Karl", 15);
  await patchBase(p.baseId, (s) => { s.buildings.forschungsamt = 2; s.research = { levels: { hochofen: 2 }, order: null, halfNext: true }; });
  assert.ok(Math.abs((await modifiersFor(db, p.playerId)).production!.stahl! - 1.16) < 1e-9);
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await processDue(engine, Date.now());
  assert.equal((await baseView(engine, p.playerId)).base, null);
  assert.deepEqual(await modifiersFor(db, p.playerId), {});
  const f = freeCoast(15);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: "Neuer Hafen", nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const view = await baseView(engine, p.playerId);
  assert.deepEqual(view.base!.research!.levels, {});
  assert.equal(view.base!.research!.halfNext, false);
  assert.deepEqual(view.base!.modifiers, {});
  void HOUR;
});
