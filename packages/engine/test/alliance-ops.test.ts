// Integrationstests Allianz-Ops (Sammelangriff, Stationierung) gegen ein echtes PostgreSQL (wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState, Mission } from "@tidefront/game-core";
import {
  allianceRaidsView,
  cancelRaid,
  chooseBase,
  createAlliance,
  joinRaid,
  launchMission,
  leaveAlliance,
  missionPreview,
  openRaid,
  processDue,
  register,
  runningSeason,
  spawnWorldEvent,
  reportGet,
  reportList,
  seed,
  stationRelease,
  withdrawRaid,
  type Engine,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {}, push: () => {} };
let keyN = 0;
const key = () => `ops${++keyN}-${Date.now()}`;
const MIN = 60000;

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
type P = Awaited<ReturnType<typeof newPlayer>>;

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
async function ready(p: P, units: Record<string, number> = { korvette: 4, landungsschiff: 2, schuetzen: 120 }) {
  await patchBase(p.baseId, (s) => {
    s.units = { ...units };
    s.resources = { ...s.resources, stahl: 30000, treibstoff: 60000, elektronik: 8000, proviant: 60000 };
    s.buildings.hafenkommandantur = 4;
    s.protection.createdAtMs = 0;
  });
}
async function ally(allianceId: number, ...ps: P[]) {
  for (const p of ps) await db.insert(tables.allianceMember).values({ playerId: p.playerId, allianceId, role: "mitglied" });
}
async function mission(id: number) {
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  return m;
}
async function code(p: Promise<{ ok: boolean; code?: string } | unknown>): Promise<string> {
  try {
    const r = (await p) as { ok: boolean; code?: string };
    return r.ok ? "ok" : r.code ?? "?";
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
}
const raidUnits = { korvette: 2, landungsschiff: 1, schuetzen: 60 };

let A: P, B: P, C: P, T: P, G: P, Q: P;
let nord = 0, sued = 0;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Nahe beieinander liegende Küstenfelder (65–250 km).
  A = await newPlayer("Anker", 0);
  B = await newPlayer("Boje", 1);
  C = await newPlayer("Kompass", 19);
  T = await newPlayer("Tonne", 2);
  G = await newPlayer("Gaffel", 20);
  Q = await newPlayer("Quast", 21);
  for (const p of [A, B, C, T, G, Q]) await ready(p);
  // Keine Kartell-Überfälle während der Tests (sie würden Schutz nach Niederlage auslösen).
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "raid_launch"));
  nord = (await createAlliance(engine, A.playerId, { name: "Nordbund", tag: "NB" })).allianceId;
  await ally(nord, B, C);
  sued = (await createAlliance(engine, T.playerId, { name: "Südbund", tag: "SB" })).allianceId;
  await ally(sued, G);
});

after(async () => {
  await client.end();
});

test("Stationierung: nur bei Verbündeten, kommt an, wird im Hafen angezeigt", async () => {
  // Nicht verbündet: abgelehnt (Vorschau und Auslaufen).
  const prev = await missionPreview(engine, A.playerId, { type: "stationierung", units: { korvette: 1 }, col: T.col, row: T.row });
  assert.equal(prev.ok, false);
  assert.equal((prev as { code: string }).code, "station_not_ally");
  assert.equal(await code(launchMission(engine, A.playerId, key(), { type: "stationierung", units: { korvette: 1 }, col: T.col, row: T.row })), "station_not_ally");
  // Spione dürfen nicht mit.
  await patchBase(G.baseId, (s) => { s.units.spion = 2; });
  assert.equal(await code(launchMission(engine, G.playerId, key(), { type: "stationierung", units: { spion: 1 }, col: T.col, row: T.row })), "covert_unit");
  const r = await launchMission(engine, G.playerId, key(), { type: "stationierung", units: { korvette: 2, schuetzen: 40, landungsschiff: 1 }, col: T.col, row: T.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { missionId: number }).missionId;
  await processDue(engine, (await mission(id)).arriveAt.getTime() + 1);
  const m = await mission(id);
  assert.equal(m.status, "stationed");
  assert.deepEqual(m.returning, { korvette: 2, schuetzen: 40, landungsschiff: 1 });
  // Besitzer: unitsAway (Unterhalt läuft weiter), Missionsplatz belegt.
  const gs = await stateOf(G.baseId);
  assert.equal(gs.unitsAway.korvette, 2);
});

test("Sammelangriff: Schutzregeln beim Eröffnen", async () => {
  // Verbündeter: nein.
  assert.equal(await code(openRaid(engine, A.playerId, key(), { col: B.col, row: B.row, units: raidUnits, joinMinutes: 20, arriveMinutes: 30 })), "ally");
  // Anfängerschutz: nein.
  await patchBase(Q.baseId, (s) => { s.protection.createdAtMs = Date.now(); });
  assert.equal(await code(openRaid(engine, A.playerId, key(), { col: Q.col, row: Q.row, units: raidUnits, joinMinutes: 20, arriveMinutes: 30 })), "target_protected");
  // Frist zu kurz, Ankunft vor der Frist.
  assert.equal(await code(openRaid(engine, A.playerId, key(), { col: T.col, row: T.row, units: raidUnits, joinMinutes: 5, arriveMinutes: 30 })), "bad_time");
  assert.equal(await code(openRaid(engine, A.playerId, key(), { col: T.col, row: T.row, units: raidUnits, joinMinutes: 30, arriveMinutes: 20 })), "bad_time");
  // Ohne Allianz: nein.
  await patchBase(Q.baseId, (s) => { s.protection.createdAtMs = 0; });
  assert.equal(await code(openRaid(engine, Q.playerId, key(), { col: T.col, row: T.row, units: raidUnits, joinMinutes: 20, arriveMinutes: 30 })), "no_alliance");
});

test("Sammelangriff: eröffnen, beitreten, zurückziehen, gleichzeitige Ankunft, gemeinsamer Kampf, Beute nach Beitrag", async () => {
  await patchBase(T.baseId, (s) => { s.units = { korvette: 1, schuetzen: 15 }; });
  const before = { A: await stateOf(A.baseId), C: await stateOf(C.baseId), T: await stateOf(T.baseId) };
  const o = await openRaid(engine, A.playerId, key(), { col: T.col, row: T.row, units: raidUnits, joinMinutes: 20, arriveMinutes: 25 });
  assert.equal(o.ok, true, JSON.stringify(o));
  const raidId = (o as { raidId: number }).raidId;
  // Gebunden: Einheiten weg, Treibstoff abgezogen, Missionsplatz belegt.
  assert.equal((await stateOf(A.baseId)).units.korvette, before.A.units.korvette - 2);
  // Fremde Allianz darf nicht beitreten.
  assert.equal(await code(joinRaid(engine, G.playerId, key(), { raidId, units: { korvette: 1 } })), "raid_other_alliance");
  const jb = await joinRaid(engine, B.playerId, key(), { raidId, units: { korvette: 3, landungsschiff: 1, schuetzen: 80 } });
  assert.equal(jb.ok, true, JSON.stringify(jb));
  assert.equal(await code(joinRaid(engine, B.playerId, key(), { raidId, units: { korvette: 1 } })), "raid_joined");
  const jc = await joinRaid(engine, C.playerId, key(), { raidId, units: { korvette: 1 } });
  assert.equal(jc.ok, true);
  // C zieht vor dem Auslaufen zurück: alles zurück.
  assert.equal(await code(withdrawRaid(engine, C.playerId, key(), raidId)), "ok");
  const cs = await stateOf(C.baseId);
  assert.equal(cs.units.korvette, before.C.units.korvette);
  assert.ok(Math.abs((cs.resources.treibstoff ?? 0) - (before.C.resources.treibstoff ?? 0)) < 50, "Treibstoff erstattet");
  const view = await allianceRaidsView(engine, B.playerId);
  const v = view.raids.find((r) => r.id === raidId)!;
  assert.equal(v.status, "offen");
  assert.equal(v.participants.length, 2);
  assert.equal(v.canCancel, false); // Mitglied, nicht Eröffner

  // Frist: alle laufen aus, gleiche Ankunft, nicht vor Frist + längste Reise.
  const [raid] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  await processDue(engine, raid.joinDeadline.getTime() + 1);
  const ms = await db.select().from(tables.mission).where(sql`${tables.mission.plan}->>'allianceRaidId' = ${String(raidId)}`);
  const out = ms.filter((m) => m.status === "outbound");
  assert.equal(out.length, 2);
  const arrive = out[0].arriveAt.getTime();
  assert.ok(out.every((m) => m.arriveAt.getTime() === arrive));
  for (const m of out) {
    const p = m.plan as Mission;
    assert.equal(p.arriveAtMs, arrive);
    assert.ok(p.departAtMs >= raid.joinDeadline.getTime());
  }
  assert.ok(arrive >= raid.desiredArriveAt.getTime());
  assert.equal(await code(withdrawRaid(engine, B.playerId, key(), raidId)), "raid_launched");

  // Ankunft: ein Kampf, ein Bericht für alle.
  await processDue(engine, arrive + 1);
  const [done] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  assert.equal(done.status, "beendet");
  assert.ok(done.reportId);
  const ra = await reportGet(engine, A.playerId, done.reportId!);
  const rb = await reportGet(engine, B.playerId, done.reportId!);
  const rt = await reportGet(engine, T.playerId, done.reportId!);
  const rc = await reportGet(engine, C.playerId, done.reportId!);
  assert.ok(ra && rb && rt);
  assert.equal(rc, null);
  assert.equal(rb!.role, "attacker");
  assert.equal(rt!.role, "defender");
  assert.ok((await reportList(engine, B.playerId)).some((r) => r.id === done.reportId && r.role === "attacker"));
  const data = ra!.data as { battle: { winner: string; loot: Record<string, number>; attacker: { final: Record<string, number> } }; allianceRaid: { participants: { playerId: number; share: number; loot: Record<string, number>; cargo: number; outcome: { final: Record<string, number> } }[] }; guests?: { playerId: number; losses: Record<string, number> }[] };
  const parts = data.allianceRaid.participants;
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0].share + parts[1].share - 100) < 0.2);
  // Beitrag: B stellt mehr Kampfwert als A.
  const pa = parts.find((p) => p.playerId === A.playerId)!;
  const pb = parts.find((p) => p.playerId === B.playerId)!;
  assert.ok(pb.share > pa.share);
  // Beute: Summe = Gesamtbeute, je Teilnehmer höchstens sein Laderaum.
  for (const r of Object.keys(data.battle.loot)) assert.equal((pa.loot[r] ?? 0) + (pb.loot[r] ?? 0), data.battle.loot[r]);
  for (const p of parts) assert.ok(Object.values(p.loot).reduce((s, x) => s + x, 0) <= p.cargo);
  // Endbestände je Besitzer ergeben den Gesamtbestand.
  for (const [id, n] of Object.entries(data.battle.attacker.final)) assert.equal((pa.outcome.final[id] ?? 0) + (pb.outcome.final[id] ?? 0), n);
  // Stationierte Truppen von G verteidigten mit (Verluste beim Besitzer).
  assert.ok(data.guests && data.guests.some((g) => g.playerId === G.playerId));
  // Heimfahrt je Teilnehmer mit eigenem Anteil.
  for (const m of out) {
    const row = await mission(m.id);
    assert.equal(row.status, "returning");
    const p = parts.find((x) => x.playerId === m.playerId)!;
    for (const [r, n] of Object.entries(p.loot)) assert.ok(((row.cargoHome as Record<string, number>)[r] ?? 0) >= n);
  }
  assert.equal(data.battle.winner, "attacker");
  assert.ok(Object.values(data.battle.loot).reduce((x, y) => x + y, 0) > 0);
  const ts = await stateOf(T.baseId);
  assert.ok((ts.resources.stahl ?? 0) < (before.T.resources.stahl ?? 0));
});

test("Sammelangriff: Abbruch durch den Eröffner gibt alles frei; Rückruf nach dem Auslaufen", async () => {
  await patchBase(T.baseId, (s) => { s.protection.defeatShieldUntilMs = 0; }); // nach dem verlorenen Kampf
  const o = await openRaid(engine, B.playerId, key(), { col: T.col, row: T.row, units: { korvette: 1 }, joinMinutes: 15, arriveMinutes: 15 });
  assert.equal(o.ok, true, JSON.stringify(o));
  const raidId = (o as { raidId: number }).raidId;
  assert.equal(await code(cancelRaid(engine, C.playerId, key(), raidId)), "no_rights");
  assert.equal(await code(cancelRaid(engine, B.playerId, key(), raidId)), "ok");
  const [r] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  assert.equal(r.status, "abgebrochen");
  // Neuer Angriff, nach dem Auslaufen zurückgerufen: kommt nicht an, Angriff ohne Teilnehmer endet ohne Kampf.
  const o2 = await openRaid(engine, C.playerId, key(), { col: T.col, row: T.row, units: { korvette: 1 }, joinMinutes: 15, arriveMinutes: 60 });
  const raid2 = (o2 as { raidId: number; missionId: number });
  const [row2] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raid2.raidId));
  await processDue(engine, row2.joinDeadline.getTime() + 1);
  const { recallOwnMission } = await import("../src/index.ts");
  assert.equal(await code(recallOwnMission(engine, C.playerId, key(), raid2.missionId)), "ok");
  const [after2] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raid2.raidId));
  await processDue(engine, after2.arriveAt!.getTime() + 1);
  const [end2] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raid2.raidId));
  assert.equal(end2.status, "beendet");
  assert.equal(end2.reportId, null);
});

test("Stationierung: Gastgeber schickt heim; Allianzaustritt schickt automatisch heim", async () => {
  const [st] = await db.select().from(tables.mission).where(and(eq(tables.mission.type, "stationierung"), eq(tables.mission.playerId, G.playerId), eq(tables.mission.status, "stationed")));
  assert.ok(st, "G ist noch stationiert");
  // Fremde dürfen nicht heimschicken.
  assert.equal(await code(stationRelease(engine, A.playerId, key(), st.id)), "no_mission");
  // Austritt von G: Truppen fahren heim.
  await leaveAlliance(engine, G.playerId);
  const m = await mission(st.id);
  assert.equal(m.status, "returning");
  await processDue(engine, m.returnAt!.getTime() + 1);
  assert.equal((await mission(st.id)).status, "done");
  assert.equal((await stateOf(G.baseId)).unitsAway.korvette ?? 0, 0);
  // Neue Stationierung bei T durch ein neues Mitglied, Gastgeber schickt heim.
  await ally(sued, Q);
  const r = await launchMission(engine, Q.playerId, key(), { type: "stationierung", units: { korvette: 1 }, col: T.col, row: T.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { missionId: number }).missionId;
  await processDue(engine, (await mission(id)).arriveAt.getTime() + 1);
  assert.equal((await mission(id)).status, "stationed");
  assert.equal(await code(stationRelease(engine, T.playerId, key(), id)), "ok");
  assert.equal((await mission(id)).status, "returning");
});

test("Sammelangriff auf ein Weltereignis (Belagerung): ein Sieger, Schaden und Beute nach Beitrag", async () => {
  for (const p of [A, B]) {
    await patchBase(p.baseId, (s) => {
      s.units = { zerstoerer: 6, korvette: 10, landungsschiff: 2, schuetzen: 100 };
      s.resources.treibstoff = 1_000_000;
      s.buildings.kommandozentrale = 15;
      s.buildings.hafenkommandantur = 10;
    });
  }
  const season = await runningSeason(db);
  const ev = await db.transaction((tx) => spawnWorldEvent(tx, Date.now(), "belagerung", season!.id, 0, C.baseId));
  if (!ev) return; // kein geeignetes Ziel in dieser Welt
  const [row] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, ev.id));
  // Der Belagerte darf aus dem belagerten Hafen nicht mitmachen, die anderen schon.
  const o = await openRaid(engine, A.playerId, key(), { col: row.col, row: row.row, eventId: ev.id, units: { zerstoerer: 3, korvette: 5 }, joinMinutes: 15, arriveMinutes: 15 });
  assert.equal(o.ok, true, JSON.stringify(o));
  const raidId = (o as { raidId: number }).raidId;
  assert.equal(await code(joinRaid(engine, C.playerId, key(), { raidId, units: { korvette: 1 } })), "own_siege");
  // Mehrere Häfen: aus einem anderen eigenen Hafen darf der Belagerte mitmachen (danach Rückzug, Rest unverändert).
  const C2 = await addSecondHarbor(db, C.playerId, { near: C, minKm: 100, maxKm: 600, patch: (s) => { s.units = { korvette: 3 }; s.resources.treibstoff = 1_000_000; s.protection.createdAtMs = 0; s.buildings.hafenkommandantur = 4; } });
  assert.equal(await code(joinRaid(engine, C.playerId, key(), { raidId, units: { korvette: 1 }, baseId: C2.baseId })), "ok");
  assert.equal(await code(withdrawRaid(engine, C.playerId, key(), raidId)), "ok");
  assert.equal((await joinRaid(engine, B.playerId, key(), { raidId, units: { zerstoerer: 6, korvette: 10 } })).ok, true);
  const [raid] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  await processDue(engine, raid.joinDeadline.getTime() + 1);
  const [launched] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  await processDue(engine, launched.arriveAt!.getTime() + 1);
  const [done] = await db.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, raidId));
  assert.equal(done.status, "beendet");
  const r = await reportGet(engine, B.playerId, done.reportId!);
  assert.ok(r);
  assert.ok(r!.kind.startsWith("weltereignis"));
  if (r!.kind === "weltereignis") {
    const dmg = await db.select().from(tables.worldEventDamage).where(eq(tables.worldEventDamage.eventId, ev.id));
    assert.deepEqual(new Set(dmg.map((d) => d.playerId)), new Set([A.playerId, B.playerId]));
  }
});

test("Mehrere Häfen: Stationierung im eigenen Hafen ohne Allianz; Sammelangriff aus dem zweiten Hafen", async () => {
  const S = await newPlayer("Spiere", 23);
  await ready(S);
  const fill = (s: BaseState) => {
    s.units = { korvette: 4, landungsschiff: 2, schuetzen: 120 };
    s.buildings.hafenkommandantur = 4;
    s.protection.createdAtMs = 0;
  };
  const S2 = await addSecondHarbor(db, S.playerId, { near: S, minKm: 60, maxKm: 300, patch: fill });
  // Ausgangshafen selbst bleibt ausgeschlossen, der andere eigene Hafen ist erlaubt (ohne Allianz).
  assert.equal(await code(launchMission(engine, S.playerId, key(), { type: "stationierung", units: { korvette: 1 }, col: S.col, row: S.row })), "own_base");
  const prev = await missionPreview(engine, S.playerId, { type: "stationierung", units: { korvette: 1 }, col: S2.col, row: S2.row });
  assert.equal(prev.ok, true, JSON.stringify(prev));
  const r = await launchMission(engine, S.playerId, key(), { type: "stationierung", units: { korvette: 2 }, col: S2.col, row: S2.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { missionId: number }).missionId;
  await processDue(engine, (await mission(id)).arriveAt.getTime() + 1);
  assert.equal((await mission(id)).status, "stationed", "eigener Hafen nimmt immer auf");
  // Allianzaustritt-Regel greift nicht (kein Bündnis nötig); Rückruf durch den Besitzer.
  assert.equal(await code(stationRelease(engine, S.playerId, key(), id)), "ok");
  assert.equal((await mission(id)).status, "returning");

  // Sammelangriff: A tritt aus seinem zweiten Hafen an; Abbruch bringt die Einheiten dorthin zurück.
  const P = await newPlayer("Pricke", 22);
  await ready(P);
  const A2 = await addSecondHarbor(db, A.playerId, { near: P, minKm: 60, maxKm: 300, patch: fill });
  const homeBefore = { ...(await stateOf(A.baseId)).units };
  const o = await openRaid(engine, A.playerId, key(), { col: P.col, row: P.row, units: { korvette: 1 }, joinMinutes: 15, arriveMinutes: 15, baseId: A2.baseId });
  assert.equal(o.ok, true, JSON.stringify(o));
  const raid = o as { raidId: number; missionId: number };
  assert.equal((await mission(raid.missionId)).baseId, A2.baseId);
  assert.equal((await stateOf(A2.baseId)).units.korvette, 3);
  assert.deepEqual((await stateOf(A.baseId)).units, homeBefore, "Heimathafen unberührt");
  const view = await allianceRaidsView(engine, A.playerId);
  assert.equal(view.raids.find((x) => x.id === raid.raidId)?.joinedBaseId, A2.baseId);
  assert.equal(await code(joinRaid(engine, B.playerId, key(), { raidId: raid.raidId, units: { korvette: 1 }, baseId: A2.baseId })), "no_base");
  assert.equal(await code(cancelRaid(engine, A.playerId, key(), raid.raidId)), "ok");
  assert.equal((await stateOf(A2.baseId)).units.korvette, 4, "zurück in den zweiten Hafen");
});
