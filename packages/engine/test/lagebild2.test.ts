// Lagebild Stufe 2 gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Patrouille (Prüfungen, Station,
// Sicht, Heimfahrt, Abfangen von Drohnen, Meldung „Fremde Patrouille gesichtet“), Aufklärungskampagne mit zwei Zielen,
// Bordsicht eines Verbands unterwegs, U-Boote nur mit Sonar, Desinformation der Größenklasse, Wissen des Verteidigers.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenterXY, hexDistanceKm } from "@tidefront/world";
import type { BaseState, Mission } from "@tidefront/game-core";
import { balance } from "../src/context.ts";
import {
  chooseBase, clearPersistThrottle, clearSightCache, knownFor, launchIntelOp, launchMission, mapViewFor, previewIntelOp,
  processDue, register, seed, sightOf, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `s2-${++keyN}-${realNow()}`;
const HOUR = 3600000;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };
const HOME = { col: 40, row: 30 };
const at = (dc: number, dr = 0) => ({ col: HOME.col + dc, row: HOME.row + dr });

async function newPlayer(name: string, pos: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => { s.site = undefined; s.resources = { ...rich }; s.resUpdatedAt = fake; s.protection.createdAtMs = 0; s.buildings.hafenkommandantur = 10; s.buildings.kommandozentrale = 10; });
  return { playerId: p.playerId, baseId: r.baseId!, name };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function nestAt(pos: { col: number; row: number }, level = 2): Promise<number> {
  await db.delete(tables.nest).where(sql`${tables.nest.col} = ${pos.col} and ${tables.nest.row} = ${pos.row}`);
  const [n] = await db.insert(tables.nest).values({ ...pos, level }).returning({ id: tables.nest.id });
  return n.id;
}

const fresh = () => { clearSightCache(); clearPersistThrottle(); };
const nestOf = async (playerId: number, id: number, t = fake) => (await mapViewFor(db, playerId, t)).nests.find((n) => n.id === id)!;
const missionOf = async (id: number) => (await db.select().from(tables.mission).where(eq(tables.mission.id, id)))[0];
async function advance(to: number) {
  fake = to;
  while ((await processDue(engine, to, 500)) > 0);
  fresh();
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  Date.now = () => fake;
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} = 'raid_launch'`);
  A = await newPlayer("Wache", HOME);
  B = await newPlayer("Fremd", at(0, 9));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch'`);
});

beforeEach(fresh);

after(async () => {
  Date.now = realNow;
  await client.end();
});

test("Patrouille: Prüfungen (Einheiten, Wegpunkte, Dauer, Drohnen, Land)", async () => {
  await patchBase(A.baseId, (s) => { s.units = { ...s.units, korvette: 4, aufklaerungsdrohne: 4, pioniere: 10, landungsschiff: 2 }; });
  const wp = [at(3), at(3, 3)];
  const p = (o: Partial<Parameters<typeof previewIntelOp>[2]>) => previewIntelOp(engine, A.playerId, { op: "patrouille", units: { korvette: 2 }, waypoints: wp, hours: 4, ...o });
  assert.equal((await p({ units: { pioniere: 5, landungsschiff: 1 } })).code, "patrol_units");
  assert.equal((await p({ waypoints: [at(3)] })).code, "patrol_waypoints");
  assert.equal((await p({ hours: 5 })).code, "patrol_hours");
  assert.equal((await p({ units: { aufklaerungsdrohne: 2 }, hours: 8 })).code, "patrol_drone_hours");
  assert.equal((await p({ units: { aufklaerungsdrohne: 2 }, waypoints: [at(9), at(9, 2)] })).code, "patrol_drone_range");
  const ok = await p({});
  assert.equal(ok.ok, true, JSON.stringify(ok));
  if (ok.ok) {
    assert.equal(ok.sightKm, balance.intel!.patrol!.shipSightKm);
    assert.ok(ok.sonarKm! >= 60, "Korvetten haben Sonar");
    assert.ok(ok.fuelCost > 0);
  }
});

test("Patrouille: Station mit Sicht um die Position, Nest unterwegs erkannt, Heimfahrt nach Ablauf", async () => {
  const nest = await nestAt(at(5, 3));
  assert.equal((await nestOf(A.playerId, nest)).level, null, "vorher unbekannt");
  const r = await launchIntelOp(engine, A.playerId, key(), { op: "patrouille", units: { korvette: 2 }, waypoints: [at(4, 3), at(6, 3)], hours: 4 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const m0 = await missionOf(r.missionId);
  await advance(m0.arriveAt.getTime() + HOUR); // eine Stunde auf Station: ~60 km Richtung zweiter Wegpunkt
  const m1 = await missionOf(r.missionId);
  assert.equal(m1.status, "holding");
  const sight = await sightOf(db, A.playerId, fake);
  assert.ok(sight.sensors.some((s) => s.kind === "patrouille" && s.km === balance.intel!.patrol!.shipSightKm));
  const n = await nestOf(A.playerId, nest);
  assert.equal(n.level, 2, "Patrouille erkennt das Nest");
  assert.match(n.intel!.source, /Patrouille/);
  await advance(fake + 3 * HOUR + 1000);
  const m2 = await missionOf(r.missionId);
  assert.equal(m2.status, "returning");
  await advance(m2.returnAt!.getTime() + 1000);
  assert.equal((await missionOf(r.missionId)).status, "done");
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, A.baseId));
  assert.equal((b.state as BaseState).units.korvette, 4, "alle Korvetten wieder daheim");
});

test("Patrouille: Abfangjäger schießen Drohnen in ihrer Radarreichweite ab, Meldung „Fremde Patrouille gesichtet“", async () => {
  await patchBase(B.baseId, (s) => { s.buildings.radarstation = 5; s.buildings.kraftwerk = 6; s.units = { ...s.units, abfangjaeger: 8 }; s.resUpdatedAt = fake; });
  const wp = [at(0, 7), at(1, 7)]; // ~200 km vor B: im Radar, in Drohnensicht
  assert.ok(hexDistanceKm(wp[0], at(0, 9)) < 250);
  const r = await launchIntelOp(engine, A.playerId, key(), { op: "patrouille", units: { aufklaerungsdrohne: 4 }, waypoints: wp, hours: 4 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  await advance((await missionOf(r.missionId)).arriveAt.getTime() + 1000);
  const m = await missionOf(r.missionId);
  const plan = m.plan as Mission & { patrol: { interceptedBy?: number[]; seenBy?: number[]; shot?: number } };
  assert.deepEqual(plan.patrol.interceptedBy, [B.baseId], "einmal je Hafen abgefangen");
  assert.ok(plan.patrol.seenBy?.includes(B.playerId));
  const shot = plan.patrol.shot ?? 0;
  const left = m.status === "returning" ? (m.returning as Record<string, number>).aufklaerungsdrohne ?? 0 : (m.returning as Record<string, number>).aufklaerungsdrohne ?? 0;
  assert.equal(left + shot, 4, "Abschüsse fehlen im Verband");
  const [seen] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "sichtung"), eq(tables.battleReport.defenderPlayerId, B.playerId)));
  assert.match(seen.title, /Fremde Patrouille gesichtet/);
  await advance(fake + 5 * HOUR);
  await advance(fake + 5 * HOUR);
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, A.baseId));
  assert.equal((b.state as BaseState).units.aufklaerungsdrohne, 4 - shot);
  await patchBase(A.baseId, (s) => { s.units.aufklaerungsdrohne = 4; });
});

test("Aufklärungskampagne: zwei Ziele nacheinander, je ein Lagebild, danach heim", async () => {
  const n1 = await nestAt(at(-6, 1), 3);
  const n2 = await nestAt(at(-6, 4), 4);
  const r = await launchIntelOp(engine, A.playerId, key(), { op: "kampagne", units: { korvette: 1 }, targets: [at(-6, 1), at(-6, 4)] });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  await advance((await missionOf(r.missionId)).arriveAt.getTime() + 1000);
  const mid = await missionOf(r.missionId);
  assert.equal(mid.status, "outbound", "weiter zum zweiten Ziel");
  assert.equal(mid.targetId, n2);
  await advance(mid.arriveAt.getTime() + 1000);
  const end = await missionOf(r.missionId);
  assert.equal(end.status, "returning");
  const reps = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "aufklaerung"), eq(tables.battleReport.attackerPlayerId, A.playerId)));
  assert.ok(reps.some((x) => x.nestId === n1) && reps.some((x) => x.nestId === n2), "zwei Lagebilder");
  const known = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["nest"]);
  assert.equal(known.get(`nest:${n1}`)?.level, "lagebild");
  assert.equal(known.get(`nest:${n2}`)?.level, "lagebild");
  await advance(end.returnAt!.getTime() + 1000);
  assert.equal((await missionOf(r.missionId)).status, "done");
  // Kampagnenprüfung: zu viele Ziele.
  const many = await previewIntelOp(engine, A.playerId, { op: "kampagne", units: { korvette: 1 }, targets: [at(-6, 1), at(-6, 4), at(-6, 6), at(-6, 8), at(-6, 10)] });
  assert.equal(many.code, "campaign_targets");
});

test("Bordsicht: ein Verband auf Mission erkennt ein Nest unterwegs (Quelle „Verband …“)", async () => {
  const target = await nestAt(at(-12, 0), 1);
  const passing = await nestAt(at(-8, 0), 2);
  assert.equal((await nestOf(A.playerId, passing)).level, null);
  const r = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 1 }, col: at(-12, 0).col, row: at(-12, 0).row });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const m = await missionOf(r.missionId);
  const depart = (m.plan as Mission).departAtMs;
  // Auf Höhe des Nests (gut 2/3 der Strecke).
  const t = depart + (m.arriveAt.getTime() - depart) * 0.68;
  fake = t;
  fresh();
  const n = await nestOf(A.playerId, passing, t);
  assert.equal(n.level, 2, "unterwegs erkannt");
  assert.match(n.intel!.source, /^Verband aus/, "Bordsicht des Überfallverbands (Kriegsschiff 105 km)");
  // Wissen bleibt nach der Vorbeifahrt („bekannt“).
  fresh();
  const later = await nestOf(A.playerId, passing, m.arriveAt.getTime() + 2 * HOUR);
  assert.equal(later.level, 2);
  assert.notEqual(later.intel?.age, "live");
  void target;
  await advance(m.arriveAt.getTime() + 1000);
  await advance((await missionOf(r.missionId)).returnAt!.getTime() + 1000);
});

test("U-Boote nur mit Sonar; Desinformation verfälscht die Größenklasse; Verteidiger kennt den Angreifer", async () => {
  // B schickt U-Boote an A vorbei (Ziel: Nest westlich von A).
  const nest = await nestAt(at(0, -3), 1);
  await patchBase(B.baseId, (s) => { s.units = { ...s.units, uboot: 3, korvette: 30, schuetzen: 50, landungsschiff: 2 }; });
  await patchBase(A.baseId, (s) => { s.units = { ...s.units, korvette: 0 }; });
  const r = await launchMission(engine, B.playerId, key(), { type: "aufklaerung", units: { uboot: 3 }, col: at(0, -3).col, row: at(0, -3).row });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const m = await missionOf(r.missionId);
  const near = (m.plan as Mission).departAtMs + (m.arriveAt.getTime() - (m.plan as Mission).departAtMs) * 0.75; // auf Höhe von A
  fresh();
  assert.ok(!(await mapViewFor(db, A.playerId, near)).fleets.some((f) => f.id === r.missionId), "ohne U-Jagd unsichtbar");
  await patchBase(A.baseId, (s) => { s.units.korvette = 4; });
  fresh();
  const pos = (await mapViewFor(db, A.playerId, near)).fleets.find((f) => f.id === r.missionId);
  const xy = hexCenterXY(pos?.col ?? 0, pos?.row ?? 0);
  assert.ok(pos, `Sonar im Hafen sieht das U-Boot (Abstand ${Math.round(Math.hypot(xy.x - hexCenterXY(HOME.col, HOME.row).x, xy.y - hexCenterXY(HOME.col, HOME.row).y))} km)`);
  void nest;
  // Desinformation: B hat gegen A eine Desinformation hinterlegt → Größenklasse eine Stufe daneben (klein → mittel).
  await patchBase(B.baseId, (s) => { s.intel = { ...(s.intel ?? {}), disinfo: { [String(A.playerId)]: near + HOUR } }; });
  fresh();
  const fooled = (await mapViewFor(db, A.playerId, near)).fleets.find((f) => f.id === r.missionId)!;
  assert.equal(fooled.size, "mittel", "3 U-Boote sind klein, gemeldet mittel");
  await patchBase(B.baseId, (s) => { s.intel = { ...(s.intel ?? {}), disinfo: {} }; });
  // Überfall von B auf A: A kennt danach den Hafen von B als Lagebild.
  await advance(m.arriveAt.getTime() + 1000);
  await advance((await missionOf(r.missionId)).returnAt!.getTime() + 1000);
  const raid = await launchMission(engine, B.playerId, key(), { type: "ueberfall", units: { korvette: 30, schuetzen: 50, landungsschiff: 2 }, col: HOME.col, row: HOME.row });
  assert.equal(raid.ok, true, JSON.stringify(raid));
  if (!raid.ok) return;
  await advance((await missionOf(raid.missionId)).arriveAt.getTime() + 1000);
  const known = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["base"]);
  assert.equal(known.get(`base:${B.baseId}`)?.level, "lagebild");
  assert.match(known.get(`base:${B.baseId}`)!.source, /Verteidigung/);
});
