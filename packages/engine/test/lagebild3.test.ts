// Lagebild Stufe 3 gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Startrampe (Voraussetzungen),
// Satellitenstart (Prüfungen, Kosten, Höchstzahl), Überflug schreibt Wissen (optisch nicht unter Wolken, Radar nur
// Verbände), Streifen 20 min live, Lebensdauer mit Abschlussbericht, Tarnnetz gegen den Ausguck, Störsender gegen Radar.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenter, hexCenterXY } from "@tidefront/world";
import { startUpgrade, weatherAt, type BaseState } from "@tidefront/game-core";
import {
  chooseBase, clearPersistThrottle, clearSightCache, intelOverview, knownFor, launchMission, launchSatellite, mapViewFor,
  processDue, register, seed, sightOf, type Engine,
} from "../src/index.ts";
import { balance } from "../src/context.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `s3-${++keyN}-${realNow()}`;
const HOUR = 3600000;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };
const HOME = { col: 40, row: 20 };
const at = (dc: number, dr = 0) => ({ col: HOME.col + dc, row: HOME.row + dr });

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string, pos: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => {
    s.site = undefined; s.resources = { ...rich }; s.resUpdatedAt = fake; s.protection.createdAtMs = 0;
    s.buildings.hafenkommandantur = 10; s.buildings.kommandozentrale = 10; s.buildings.kraftwerk = 8; s.buildings.radarstation = 0;
  });
  return { playerId: p.playerId, baseId: r.baseId!, name };
}

async function nestAt(pos: { col: number; row: number }, level = 2): Promise<number> {
  await db.delete(tables.nest).where(sql`${tables.nest.col} = ${pos.col} and ${tables.nest.row} = ${pos.row}`);
  const [n] = await db.insert(tables.nest).values({ ...pos, level }).returning({ id: tables.nest.id });
  return n.id;
}

const fresh = () => { clearSightCache(); clearPersistThrottle(); };
async function advance(to: number) {
  fake = to;
  while ((await processDue(engine, to, 500)) > 0);
  fresh();
}
const stateOf = async (id: number) => (await db.select().from(tables.base).where(eq(tables.base.id, id)))[0].state as BaseState;

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;
let C: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  // Wetter hängt von der Uhrzeit ab: Startzeit so wählen, dass beim ersten Überflug (Start + 6 h) im Streifen über dem
  // Heimathafen ein klares Feld liegt (sonst scheitert der Überflug-Test je nach Uhrzeit des Laufs).
  {
    const wb = balance.weather!;
    const x0 = hexCenterXY(HOME.col, HOME.row).x;
    const clearAt = (t: number) => {
      for (let row = 1; row < ROWS - 1; row++) for (let dc = -4; dc <= 4; dc++) {
        const p = at(dc, row - HOME.row);
        if (Math.abs(row - HOME.row) < 4 || Math.abs(hexCenterXY(p.col, p.row).x - x0) >= 250) continue;
        if (weatherAt(hexCenter(p.col, p.row), t + 6 * HOUR, wb).clouds < 0.4) return true;
      }
      return false;
    };
    for (let h = 0; h < 96 && !clearAt(fake); h++) fake = realNow() + (h + 1) * HOUR;
  }
  Date.now = () => fake;
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} = 'raid_launch'`);
  A = await newPlayer("Orbit", HOME);
  B = await newPlayer("Stoer", at(2, 0));
  C = await newPlayer("Tarn", at(-1, 0));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch'`);
});

beforeEach(fresh);

after(async () => {
  Date.now = realNow;
  await client.end();
});

test("Startrampe: Voraussetzungen Kommandozentrale 7 (v1.24, vorher 8), Forschungsamt 5, Radarstation 6", () => {
  const def = balance.buildings.startrampe;
  assert.deepEqual(def.requires, { kommandozentrale: 7, forschungsamt: 5, radarstation: 6 });
  assert.deepEqual(def.cost, { stahl: 3000, treibstoff: 1000, elektronik: 1000 });
  const s = { resources: { ...rich }, resUpdatedAt: fake, buildings: { kommandozentrale: 7, forschungsamt: 5, radarstation: 5 }, units: {}, unitsAway: {}, defenses: {}, buildQueue: [], trainingQueue: [], versorgungsmangel: false, protection: { createdAtMs: 0 } } as unknown as BaseState;
  assert.equal(startUpgrade(s, "startrampe", fake, balance).ok ? "ok" : (startUpgrade(s, "startrampe", fake, balance) as { code: string }).code, "building_requires");
  s.buildings.radarstation = 6;
  assert.equal(startUpgrade(s, "startrampe", fake, balance).ok, true);
});

test("Satellit: Prüfungen, Kosten, Höchstzahl (1, mit Radarsatellit 2)", async () => {
  const launch = (type: "optisch" | "radar") => launchSatellite(engine, A.playerId, key(), { type });
  assert.equal(((await launch("optisch")) as { code?: string }).code, "sat_pad");
  await patchBase(A.baseId, (s) => { s.buildings.startrampe = 1; });
  assert.equal(((await launch("optisch")) as { code?: string }).code, "sat_tech");
  await patchBase(A.baseId, (s) => { s.research = { levels: { optischer_satellit: 1 }, order: null }; });
  assert.equal(((await launch("radar")) as { code?: string }).code, "sat_tech");
  const before = (await stateOf(A.baseId)).resources.elektronik;
  const r = await launch("optisch");
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = await stateOf(A.baseId);
  assert.equal(s.satellites?.length, 1);
  const optCost = balance.intel!.satellite!.types.optisch.cost.elektronik ?? 0; // v1.35: ≈ 7 000 Richtwert
  assert.ok(before - s.resources.elektronik >= optCost - 1, "Elektronik abgezogen");
  assert.equal(((await launch("optisch")) as { code?: string }).code, "sat_limit");
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "satellit"), eq(tables.battleReport.attackerPlayerId, A.playerId)));
  assert.match(rep.title, /Optischer Satellit gestartet/);
  // Lagebild: nächster Überflug angekündigt.
  const ov = await intelOverview(engine, A.playerId);
  assert.ok(ov.enabled);
  if (ov.enabled) {
    assert.equal(ov.satellites.length, 1);
    assert.equal(ov.satellites[0].next?.atMs, s.satellites![0].launchedAtMs + 6 * HOUR);
    assert.match(ov.satellites[0].next!.where, /°/);
    assert.equal(ov.launch?.limit, 1);
  }
});

test("Überflug: optisch Erkennung im Streifen außer unter Wolken, 20 min live, danach bekannt", async () => {
  const sat = (await stateOf(A.baseId)).satellites![0];
  const passAt = sat.launchedAtMs + 6 * HOUR;
  // Streifen 1 liegt über dem Starthafen (±300 km); Nester weit im Süden, außerhalb jedes anderen Sensors.
  const wb = balance.weather!;
  const spots = [];
  // Breiter suchen (ganzer Streifen ±300 km): das Wetter hängt von der Uhrzeit des Testlaufs ab, ein schmaler Streifen
  // ist manchmal ganz bewölkt.
  for (let row = 1; row < ROWS - 1; row++) for (const dc of [-1, 0, 1, -2, 2, -3, 3, -4, 4]) if (Math.abs(row - HOME.row) >= 4) spots.push(at(dc, row - HOME.row));
  const inStrip = (p: { col: number; row: number }) => Math.abs(hexCenterXY(p.col, p.row).x - sat.x0) < 300;
  const clouds = (p: { col: number; row: number }) => weatherAt(hexCenter(p.col, p.row), passAt, wb).clouds;
  const clear = spots.find((p) => inStrip(p) && clouds(p) < 0.5)!;
  const cloudy = spots.find((p) => inStrip(p) && clouds(p) > 0.65);
  assert.ok(clear, "ein klares Feld im Streifen");
  assert.ok(Math.abs(hexCenterXY(clear.col, clear.row).x - sat.x0) < 300);
  const nClear = await nestAt(clear, 3);
  const nCloudy = cloudy ? await nestAt(cloudy, 3) : null;
  await advance(passAt + 10 * 60000);
  const known = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["nest"]);
  const k = known.get(`nest:${nClear}`);
  assert.equal(k?.level, "erkennung", "Überflug schreibt das Wissen");
  assert.match(k!.source, /Optischer Satellit/);
  if (nCloudy !== null) assert.equal(known.get(`nest:${nCloudy}`), undefined, "unter Wolken verdeckt");
  else console.log("  (kein Feld mit Bewölkung > 0,65 im Streifen – Wolkenprüfung übersprungen)");
  const live = (await mapViewFor(db, A.playerId, fake)).nests.find((n) => n.id === nClear)!;
  assert.equal(live.intel?.age, "live");
  assert.equal(live.level, 3);
  const map = await mapViewFor(db, A.playerId, fake);
  assert.ok(map.intel.sensors.some((s) => s.kind === "satellit" && "strip" in s), "Streifen als Sensor");
  await advance(passAt + 30 * 60000);
  const later = (await mapViewFor(db, A.playerId, fake)).nests.find((n) => n.id === nClear)!;
  assert.equal(later.intel?.age, "bekannt", "nach 20 min nicht mehr live");
  const s = await stateOf(A.baseId);
  assert.equal(s.satellites![0].passes, 1);
  assert.ok((s.satellites![0].last?.nests ?? 0) >= 1);
});

test("Radarsatellit: zweiter Satellit mit Raumfahrt 2, sieht Verbände (Sichtung), Höchstzahl 2", async () => {
  await patchBase(A.baseId, (s) => { s.research = { levels: { optischer_satellit: 1, radarsatellit: 1 }, order: null }; s.resources = { ...rich }; s.resUpdatedAt = fake; });
  const r = await launchSatellite(engine, A.playerId, key(), { type: "radar" });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(((await launchSatellite(engine, A.playerId, key(), { type: "optisch" })) as { code?: string }).code, "sat_limit");
  // B schickt eine Korvette nach Süden; beim Überflug fährt sie im Streifen.
  await patchBase(B.baseId, (s) => { s.units = { ...s.units, korvette: 3 }; });
  const target = await nestAt(at(2, 30), 1);
  await advance(r.firstPassAtMs - HOUR);
  const m = await launchMission(engine, B.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: at(2, 30).col, row: at(2, 30).row });
  assert.equal(m.ok, true, JSON.stringify(m));
  await advance(r.firstPassAtMs + 60000);
  const fleets = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["fleet", "nest"]);
  const f = [...fleets.values()].find((x) => x.kind === "fleet");
  assert.ok(f, "Verband gesichtet");
  assert.equal(f!.level, "sichtung");
  assert.match(f!.source, /Radarsatellit/);
  assert.doesNotMatch(fleets.get(`nest:${target}`)?.source ?? "", /Radarsatellit/, "Nester schreibt der Radarsatellit nicht (nur Sichtung)");
});

test("Lebensdauer: nach 7 Tagen verglüht, Abschlussbericht, neuer Start möglich", async () => {
  const s0 = await stateOf(A.baseId);
  const last = Math.max(...s0.satellites!.map((s) => s.expiresAtMs));
  await advance(last + 1000);
  assert.equal((await stateOf(A.baseId)).satellites?.length ?? 0, 0);
  const ends = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "satellit"), eq(tables.battleReport.attackerPlayerId, A.playerId)));
  const end = ends.filter((x) => /verglüht/.test(x.title));
  assert.equal(end.length, 2);
  const d = (end[0].report as { satellite: { passes: number; plannedPasses: number } }).satellite;
  assert.equal(d.passes, d.plannedPasses, "alle Überflüge geflogen");
  assert.equal(d.plannedPasses, 27);
  await patchBase(A.baseId, (s) => { s.resources = { ...rich }; s.resUpdatedAt = fake; });
  assert.equal((await launchSatellite(engine, A.playerId, key(), { type: "optisch" })).ok, true);
});

test("Tarnnetz: der Ausguck erkennt den Hafen nur noch als Sichtung (Schutz bleibt verborgen)", async () => {
  const base = async () => (await mapViewFor(db, A.playerId, fake)).bases.find((b) => b.id === C.baseId)!;
  await db.delete(tables.intelSighting);
  assert.equal((await base()).known, true, "ohne Tarnnetz: Ausguck erkennt");
  await db.delete(tables.intelSighting);
  await patchBase(C.baseId, (s) => { s.research = { levels: { tarnnetze: 1 }, order: null }; });
  fresh();
  const b = await base();
  assert.equal(b.known, false, "mit Tarnnetz: nur Sichtung");
  assert.equal(b.protection, null);
});

test("Störsender: fremdes Radar im Umkreis kürzer, der Störsender selbst wird erkannt", async () => {
  await db.delete(tables.intelSighting);
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 5; s.resUpdatedAt = fake; }); // 350 km (Nebel bis −30 %)
  fresh();
  const base = async () => (await mapViewFor(db, A.playerId, fake)).bases.find((b) => b.id === B.baseId)!;
  assert.equal((await base()).known, true, "Radar erkennt B in 200 km");
  assert.equal((await base()).jammer, false);
  await db.delete(tables.intelSighting);
  await patchBase(B.baseId, (s) => { s.buildings.stoersender = 2; s.buildings.radarstation = 5; s.resUpdatedAt = fake; });
  fresh();
  const b = await base();
  assert.equal(b.known, false, "Störsender −50 %: B liegt außerhalb");
  assert.equal(b.jammer, true, "Störsender in 600 km vom eigenen Radar erkannt");
});
