// Integrationstests Nachrichtendienst gegen ein echtes PostgreSQL (wird geleert): Schutzregeln, Erkunden (Ziel merkt
// nichts, unsichtbar fürs Radar), Enttarnung (Verlust, Bericht für beide, Nachricht, Bilanz), Sabotage mit Wirkung,
// Sperrfrist und Ende, Desinformation im Lagebild einer Aufklärung, Kartell-Aufklärung.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { spyRollOf, type BaseState, type SpyMission } from "@tidefront/game-core";
import {
  balance,
  baseView,
  battleStats,
  chooseBase,
  clearBattleStatsCache,
  createAlliance,
  launchMission,
  processDue,
  register,
  reportGet,
  reportList,
  seed,
  spyLaunch,
  spyPreview,
  intelOwnView,
  type Engine,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `s${++keyN}-${Date.now()}`;
const HOUR = 3600000;
const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };

/** Seeds mit Wurf 1 (gelingt immer) und 20 (scheitert immer). */
const SEED_OK = (() => { let s = 1; while (spyRollOf(s, 20) !== 1) s++; return s; })();
const SEED_FAIL = (() => { let s = 1; while (spyRollOf(s, 20) !== 20) s++; return s; })();

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
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, name, ...f };
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

/** Spion mit festem Wurf auf den Weg bringen und bis zur Ankunft verarbeiten. */
async function spyAndArrive(playerId: number, input: { kind: string; col?: number; row?: number; building?: string }, seedValue: number) {
  const r = await spyLaunch(engine, playerId, key(), input);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { missionId: number }).missionId;
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  const plan = m.plan as SpyMission;
  await db.update(tables.mission).set({ plan: { ...plan, spy: { ...plan.spy, seed: seedValue } } }).where(eq(tables.mission.id, id));
  await processDue(engine, plan.arriveAtMs + 1000);
  const [after] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  return { mission: after, plan };
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Agentin", 3);
  B = await newPlayer("Zielmann", 9);
  await patchBase(A.baseId, (s) => {
    s.buildings.nachrichtendienst = 4; s.buildings.hafenkommandantur = 6; s.buildings.lagerkomplex = 8;
    s.units = { spion: 8 }; s.resources = { ...rich }; s.protection.createdAtMs = 0;
  });
  await patchBase(B.baseId, (s) => { s.buildings.kraftwerk = 3; s.buildings.stahlwerk = 3; s.buildings.lagerkomplex = 8; s.resources = { ...rich }; });
});

after(async () => {
  await client.end();
});

test("Schutzregeln: Anfängerschutz, eigener Hafen, Nest, Stufe; Vorschau zeigt Chance", async () => {
  const at = { col: B.col, row: B.row };
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", ...at })).code, "target_beginner");
  await patchBase(B.baseId, (s) => { s.protection.createdAtMs = 0; });
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", col: A.col, row: A.row })).code, "own_base");
  const nest = nestSites()[0];
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", col: nest.col, row: nest.row })).code, "spy_target");
  assert.equal((await spyPreview(engine, B.playerId, { kind: "erkunden", col: A.col, row: A.row })).code, "building_required");
  const p = await spyPreview(engine, A.playerId, { kind: "erkunden", ...at });
  assert.equal(p.ok, true, JSON.stringify(p));
  if (!p.ok) return;
  const E = balance.espionage!;
  assert.equal(p.success.total, E.base + 4 + E.kinds.erkunden.bonus);
  assert.equal(p.defense.total, 0);
  assert.equal(p.threshold, Math.min(19, p.success.total));
  assert.equal(p.chance, p.threshold / 20);
  assert.ok(Math.abs(p.detectChance - (1 - p.chance)) < 1e-9);
});

test("Erkunden gelingt: Dossier, Ziel merkt nichts, Radar sieht nichts, Spion kehrt heim", async () => {
  const r = await spyLaunch(engine, A.playerId, key(), { kind: "erkunden", col: B.col, row: B.row });
  assert.equal(r.ok, true);
  const view = await baseView(engine, B.playerId);
  assert.equal(view.base!.incoming.length, 0, "unsichtbar");
  const [m0] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  await db.update(tables.mission).set({ plan: { ...(m0.plan as SpyMission), spy: { ...(m0.plan as SpyMission).spy, seed: SEED_OK } } }).where(eq(tables.mission.id, m0.id));
  await processDue(engine, (m0.plan as SpyMission).arriveAtMs + 1000);
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, m0.id));
  assert.equal(m.status, "returning");
  const rep = await reportGet(engine, A.playerId, m.reportId!);
  assert.equal(rep!.kind, "spionage");
  const d = rep!.data as { spy: { roll: number; success: boolean }; dossier: { scout: unknown; buildQueue: unknown[]; missions: unknown[] | null } };
  assert.equal(d.spy.roll, 1);
  assert.equal(d.spy.success, true);
  assert.ok(d.dossier.scout);
  assert.ok(Array.isArray(d.dossier.missions), "ab Stufe 4 mit Missionen");
  assert.equal((await reportList(engine, B.playerId)).length, 0, "Ziel merkt nichts");
  await processDue(engine, (m.plan as SpyMission).returnAtMs + 1000);
  const s = await stateOf(A.baseId);
  assert.equal(s.units.spion, 8);
  assert.equal(s.intel?.successes, 1);
});

test("Enttarnt: Spion verloren, Bericht für beide mit Absender, Nachricht, Bilanz", async () => {
  const { mission } = await spyAndArrive(A.playerId, { kind: "erkunden", col: B.col, row: B.row }, SEED_FAIL);
  assert.equal(mission.status, "done");
  const s = await stateOf(A.baseId);
  assert.equal(s.units.spion, 7);
  assert.equal(s.unitsAway.spion ?? 0, 0);
  const list = (await reportList(engine, B.playerId)).filter((r) => r.kind === "spionage");
  assert.equal(list.length, 1, JSON.stringify(await reportList(engine, B.playerId)));
  assert.equal(list[0].title, `Fremder Spion enttarnt – Absender ${A.name}`);
  assert.equal(list[0].won, true);
  const rep = await reportGet(engine, B.playerId, list[0].id);
  assert.equal((rep!.data as { spy: { roll: number } }).spy.roll, 20);
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, B.playerId));
  assert.ok(msgs.some((x) => (x.subject ?? "").includes(A.name)));
  clearBattleStatsCache();
  const sa = await battleStats(engine, A.playerId);
  assert.equal(sa.record.spionage.losses, 1);
  assert.equal(sa.ownLosses.spion, 1);
  assert.equal((await battleStats(engine, B.playerId)).record.spionage.wins, 1);
});

test("Sabotage: Kraftwerk fällt aus, Folgen ohne Absender, Sperrfrist, Ende per Ereignis", async () => {
  const { mission } = await spyAndArrive(A.playerId, { kind: "sabotage", col: B.col, row: B.row, building: "kraftwerk" }, SEED_OK);
  assert.equal(mission.status, "returning");
  const s = await stateOf(B.baseId);
  const sab = s.intel!.sabotage!;
  assert.equal(sab.target, "kraftwerk");
  assert.equal(s.buildings.kraftwerk, 3, "nicht zerstörerisch");
  const list = await reportList(engine, B.playerId);
  const victim = list.find((r) => r.kind === "sabotage")!;
  const rep = await reportGet(engine, B.playerId, victim.id);
  assert.equal(JSON.stringify(rep!.data).includes(A.name), false, "kein Absender");
  assert.equal((await spyPreview(engine, A.playerId, { kind: "sabotage", col: B.col, row: B.row, building: "radarstation" })).code, "sabotage_cooldown");
  await processDue(engine, sab.untilMs + 1000);
  assert.equal((await stateOf(B.baseId)).intel?.sabotage, undefined);
  assert.ok((await stateOf(B.baseId)).intel?.lastSabotageAtMs);
});

test("Sabotage nicht gegen Verbündete; Erkunden bei Verbündeten erlaubt", async () => {
  const C = await newPlayer("Freund", 15);
  await patchBase(C.baseId, (s) => { s.protection.createdAtMs = 0; });
  const r = await createAlliance(engine, A.playerId, { name: "Schattenbund", tag: "SB" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [mem] = await db.select().from(tables.allianceMember).where(eq(tables.allianceMember.playerId, A.playerId));
  await db.insert(tables.allianceMember).values({ playerId: C.playerId, allianceId: mem.allianceId, role: "mitglied" });
  assert.equal((await spyPreview(engine, A.playerId, { kind: "sabotage", col: C.col, row: C.row, building: "kraftwerk" })).code, "ally");
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", col: C.col, row: C.row })).ok, true);
});

test("Desinformation: Ziel sieht im nächsten Lagebild über den Absender falsche Zahlen", async () => {
  await patchBase(A.baseId, (s) => { s.units = { ...s.units, korvette: 10 }; s.protection.createdAtMs = 0; });
  const { mission } = await spyAndArrive(A.playerId, { kind: "desinformation", col: B.col, row: B.row }, SEED_OK);
  assert.equal(mission.status, "returning", JSON.stringify(mission));
  assert.ok((await stateOf(A.baseId)).intel!.disinfo![String(B.playerId)] > Date.now(), JSON.stringify((await stateOf(A.baseId)).intel));
  await patchBase(B.baseId, (s) => { s.units = { zerstoerer: 1 }; });
  const sent = await launchMission(engine, B.playerId, key(), { type: "aufklaerung", units: { zerstoerer: 1 }, col: A.col, row: A.row });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const [m] = await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, B.playerId), eq(tables.mission.type, "aufklaerung")));
  // Sturm kann die Fahrt verlängern (Wetter, v1.6): Frist für diesen Test hinter die Ankunft legen.
  await patchBase(A.baseId, (s) => { s.intel!.disinfo![String(B.playerId)] = m.arriveAt.getTime() + HOUR; });
  await processDue(engine, m.arriveAt.getTime() + 1000);
  const [done] = await db.select().from(tables.mission).where(eq(tables.mission.id, m.id));
  const rep = await reportGet(engine, B.playerId, done.reportId!);
  const scout = (rep!.data as { scout: { units: Record<string, number> } }).scout;
  assert.equal(scout.units.korvette, Math.round(10 * balance.espionage!.disinfo.forceFactor));
  assert.equal((await stateOf(A.baseId)).intel?.disinfo, undefined, "verbraucht");
});

test("Kartell-Aufklärung: feste Dauer, Dossier der Weltereignisse", async () => {
  const { mission, plan } = await spyAndArrive(A.playerId, { kind: "kartell" }, SEED_OK);
  assert.equal(plan.arriveAtMs - plan.departAtMs, balance.espionage!.kinds.kartell.hours! * HOUR);
  assert.equal(mission.targetKind, "kartell");
  const rep = await reportGet(engine, A.playerId, mission.reportId!);
  const d = rep!.data as { cartel: { events: unknown[]; next: unknown } };
  assert.ok(Array.isArray(d.cartel.events));
});

test("Mehrere Häfen: Spionage aus dem zweiten Hafen, Lagebild je Hafen, fremde baseId abgelehnt", async () => {
  const second = await addSecondHarbor(db, A.playerId, { patch: (s) => { s.buildings.nachrichtendienst = 2; s.units = { spion: 3 }; } });
  const at = { col: B.col, row: B.row };
  // Eigener zweiter Hafen ist kein Ziel.
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", col: second.col, row: second.row })).code, "own_base");
  // Fremde baseId: no_base (Vorschau, Start, Lagebild).
  assert.equal((await spyPreview(engine, A.playerId, { kind: "erkunden", ...at, baseId: B.baseId })).code, "no_base");
  const bad = await spyLaunch(engine, A.playerId, key(), { kind: "erkunden", ...at, baseId: B.baseId });
  assert.equal((bad as { code?: string }).code, "no_base");
  await assert.rejects(intelOwnView(engine, A.playerId, B.baseId), /no_base/);
  // Lagebild je Hafen.
  assert.equal((await intelOwnView(engine, A.playerId, second.baseId))!.level, 2);
  assert.equal((await intelOwnView(engine, A.playerId))!.level, 4);
  const before = (await stateOf(A.baseId)).units.spion ?? 0;
  const r = await spyLaunch(engine, A.playerId, key(), { kind: "erkunden", ...at, baseId: second.baseId });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  assert.equal(m.baseId, second.baseId, "Mission läuft aus dem zweiten Hafen");
  assert.ok(((await stateOf(second.baseId)).units.spion ?? 0) < 3, "Spione aus dem zweiten Hafen");
  assert.equal((await stateOf(A.baseId)).units.spion ?? 0, before, "Heimathafen unberührt");
});
