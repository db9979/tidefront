// Optischer Satellit als eigene Fähigkeit (Nutzerentscheid, docs/REGELN-LAGEBILD.md 5.6) gegen ein echtes PostgreSQL
// (TEST_DATABASE_URL, wird geleert): Beim Überflug sieht er im Streifen auch getauchte U-Boote (Sichtung: Größe und
// Kurs, ohne Besitzer) – Radar, Ausguck und Radarsatellit sehen sie nicht. Unter Wolken bleibt auch der Satellit blind.
// Das Wetter hängt von der Uhrzeit ab: die Testzeit wird so gewählt, dass im Streifen ein klares Feld liegt.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenter, hexCenterXY } from "@tidefront/world";
import { weatherAt, type BaseState } from "@tidefront/game-core";
import {
  chooseBase, clearPersistThrottle, clearSightCache, intelOverview, knownFor, launchSatellite, mapViewFor, processDue, register, seed, sightOf, type Engine,
} from "../src/index.ts";
import { balance } from "../src/context.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const realNow = Date.now.bind(Date);
let fake = realNow();
let keyN = 0;
const key = () => `ub-${++keyN}-${realNow()}`;
const HOUR = 3600000;
const rich = { stahl: 90000, treibstoff: 90000, elektronik: 90000, proviant: 90000 };
const HOME = { col: 40, row: 20 };
const at = (dc: number, dr = 0) => ({ col: HOME.col + dc, row: HOME.row + dr });
type Pos = { col: number; row: number };

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function newPlayer(name: string, pos: Pos) {
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

/** Spots im künftigen Streifen (±250 km um den Heimathafen), weit genug vom Ausguck entfernt. */
function stripSpots(): Pos[] {
  const x0 = hexCenterXY(HOME.col, HOME.row).x;
  const out: Pos[] = [];
  for (let row = 1; row < ROWS - 1; row++) for (let dc = -4; dc <= 4; dc++) {
    const p = at(dc, row - HOME.row);
    if (Math.abs(row - HOME.row) < 6 || Math.abs(hexCenterXY(p.col, p.row).x - x0) >= 250) continue;
    out.push(p);
  }
  return out;
}
const cloudsAt = (p: Pos, t: number) => weatherAt(hexCenter(p.col, p.row), t, balance.weather!).clouds;

/** Verband nur aus U-Booten von B, der zum Zeitpunkt t (fast) genau auf p liegt (gerade Strecke, ohne Route). */
async function subFleetAt(owner: { playerId: number; baseId: number }, p: Pos, t: number, units: Record<string, number> = { uboot: 3 }): Promise<number> {
  const [m] = await db.insert(tables.mission).values({
    playerId: owner.playerId, baseId: owner.baseId, type: "aufklaerung", targetKind: "hex", targetId: null, targetCol: p.col, targetRow: p.row,
    plan: { units, departAtMs: t - 200 * HOUR }, status: "outbound", arriveAt: new Date(t + 1000),
  }).returning({ id: tables.mission.id });
  return m.id;
}

const fresh = () => { clearSightCache(); clearPersistThrottle(); };
async function advance(to: number) {
  fake = to;
  while ((await processDue(engine, to, 500)) > 0);
  fresh();
}

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  // Startzeit so wählen, dass beim ersten Überflug (Start + 6 h) im Streifen ein klares Feld liegt.
  for (let h = 0; h < 96 && !stripSpots().some((p) => cloudsAt(p, fake + 6 * HOUR) < 0.35); h++) fake = realNow() + (h + 1) * HOUR;
  Date.now = () => fake;
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} = 'raid_launch'`);
  A = await newPlayer("Orbit", HOME);
  B = await newPlayer("Tiefe", at(-6, 4));
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch'`);
});

after(async () => {
  Date.now = realNow;
  await client.end();
});

test("Optischer Satellit: getauchte U-Boote im Streifen als Sichtung (Größe, Kurs), sonst sieht sie niemand; unter Wolken nicht", async () => {
  await patchBase(A.baseId, (s) => { s.buildings.startrampe = 1; s.research = { levels: { optischer_satellit: 1 }, order: null }; });
  const r = await launchSatellite(engine, A.playerId, key(), { type: "optisch" });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const passAt = r.firstPassAtMs;
  const sat = ((await db.select().from(tables.base).where(eq(tables.base.id, A.baseId)))[0].state as BaseState).satellites![0];
  const inStrip = (p: Pos) => Math.abs(hexCenterXY(p.col, p.row).x - sat.x0) < 260;
  const spots = stripSpots().filter(inStrip);
  const clear = spots.find((p) => cloudsAt(p, passAt) < 0.35);
  assert.ok(clear, "ein klares Feld im Streifen");
  const cloudy = spots.find((p) => cloudsAt(p, passAt) > 0.7 && (Math.abs(p.row - clear!.row) > 2 || Math.abs(p.col - clear!.col) > 2));
  const seen = await subFleetAt(B, clear!, passAt);
  const hidden = cloudy ? await subFleetAt(B, cloudy, passAt) : null;

  // Vor dem Überflug: nichts (U-Boote sind für Ausguck und Radar unsichtbar).
  await advance(passAt - HOUR);
  const before = await mapViewFor(db, A.playerId, fake);
  assert.equal(before.fleets.some((f) => f.id === seen), false, "ohne Satellit unsichtbar");

  // Überflug: Wissen geschrieben, 20 min live auf der Karte.
  await advance(passAt + 5 * 60000);
  const known = await knownFor(db, await sightOf(db, A.playerId, fake), fake, ["fleet"]);
  const k = known.get(`fleet:${seen}`);
  assert.ok(k, "U-Boot-Verband gesichtet");
  assert.equal(k!.level, "sichtung");
  assert.match(k!.source, /Optischer Satellit/);
  assert.equal((k!.data as { submerged?: boolean }).submerged, true);
  assert.equal((k!.data as { owner?: string | null }).owner, null, "Sichtung: ohne Besitzer");
  assert.equal((k!.data as { size?: string }).size, "klein");
  if (hidden !== null) assert.equal(known.get(`fleet:${hidden}`), undefined, "unter Wolken verdeckt");
  else console.log("  (kein Feld mit Bewölkung > 0,7 im Streifen – Wolkenprüfung übersprungen)");
  const map = await mapViewFor(db, A.playerId, fake);
  const f = map.fleets.find((x) => x.id === seen);
  assert.ok(f, "live auf der Karte");
  assert.equal(f!.submerged, true);
  assert.equal(f!.intel.age, "live");
  assert.equal(f!.owner, null);
  assert.equal(typeof f!.heading, "number");
  const ov = await intelOverview(engine, A.playerId);
  assert.ok(ov.enabled && ov.sightings.some((s) => s.kind === "fleet" && s.id === seen && /U-Boot-Verband/.test(s.name)), "Karte → Sichtungen nennt den U-Boot-Verband");

  // Gemischter Verband: die Größe zählt die getauchten Boote mit (3 Korvetten + 6 U-Boote = mittel statt klein).
  const ib = balance.intel!;
  const mixed = await subFleetAt(B, clear!, fake + 2 * 60000, { korvette: 3, uboot: Math.max(6, ib.sizeSmallMax) });
  fresh();
  const m2 = (await mapViewFor(db, A.playerId, fake)).fleets.find((x) => x.id === mixed);
  assert.ok(m2, "gemischter Verband live");
  assert.notEqual(m2!.size, "klein");
  assert.equal(m2!.submerged, undefined);

  // Nach 20 min: nicht mehr live, nur noch bekannt.
  await advance(passAt + 30 * 60000);
  const later = (await mapViewFor(db, A.playerId, fake)).fleets.find((x) => x.id === seen);
  assert.equal(later?.intel.age, "bekannt");
});
