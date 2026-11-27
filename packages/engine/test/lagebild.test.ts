// Lagebild (Stufe 1) gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert): Ausguck und Radar (Strom,
// Sabotage, Nebel), Allianz teilt Sicht und Wissen, Alter des Wissens, Kartenansicht gefiltert (Nester, Häfen,
// Wracks, Verbände, Felder), Aufklärung schreibt ein Lagebild, Planung verrät kein leeres Nest, intel_fog aus,
// Aufräumen nach 72 h und Dauer der Kartenansicht mit zehn Spielern.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexCenterXY, hexDistanceKm } from "@tidefront/world";
import { headingDeg, type BaseState } from "@tidefront/game-core";
import {
  chooseBase, clearPersistThrottle, clearSightCache, createAlliance, fieldsView, launchMission, mapViewFor,
  missionPreview, processDue, purgeIntel, register, seed, setIntelFog, type Engine,
} from "../src/index.ts";
import { radarCondition, sensorsOfBase } from "../src/intel-sight.ts";
import { withSite } from "../src/store.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `l${++keyN}-${Date.now()}`;
const HOUR = 3600000;
const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
const HOME = { col: 40, row: 30 };
const FAR = { col: 12, row: 12 };
const at = (dc: number) => ({ col: HOME.col + dc, row: HOME.row });

async function newPlayer(name: string, pos: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  // Irgendeine freie Küste wählen, danach den Hafen auf die Testposition setzen.
  let r: { ok: boolean; baseId?: number } = { ok: false };
  for (let row = 5; row < ROWS && !r.ok; row++) for (let col = 0; col < COLS && !r.ok; col += 3) {
    r = await chooseBase(engine, p.playerId, key(), { col, row, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 }) as typeof r;
  }
  assert.ok(r.ok);
  await db.update(tables.base).set({ col: pos.col, row: pos.row }).where(eq(tables.base.id, r.baseId!));
  await patchBase(r.baseId!, (s) => { s.site = undefined; s.resources = { ...rich }; s.protection.createdAtMs = 0; });
  return { playerId: p.playerId, baseId: r.baseId!, name };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Nest an eine Position legen (belegt ein anderes Nest das Feld, wird es entfernt). */
async function nestAt(pos: { col: number; row: number }, level = 2): Promise<number> {
  await db.delete(tables.nest).where(sql`${tables.nest.col} = ${pos.col} and ${tables.nest.row} = ${pos.row}`);
  const [n] = await db.insert(tables.nest).values({ ...pos, level }).returning({ id: tables.nest.id });
  return n.id;
}

const fresh = () => { clearSightCache(); clearPersistThrottle(); };
const nestOf = async (playerId: number, id: number, nowMs = Date.now()) => (await mapViewFor(db, playerId, nowMs)).nests.find((n) => n.id === id)!;

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;
let nNear = 0, nMid = 0, nFar = 0, nAtB = 0;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Ausguck", HOME);
  B = await newPlayer("Fernost", FAR);
  nNear = await nestAt(at(1)); // 100 km: Ausguck
  nMid = await nestAt(at(3)); // 300 km: nur Radar ab Stufe 8 (auch bei dichtem Nebel)
  nFar = await nestAt(at(6)); // 600 km: außerhalb jeder Radarstation
  nAtB = await nestAt({ col: FAR.col + 1, row: FAR.row });
});

beforeEach(fresh);

after(async () => {
  await client.end();
});

test("Ausguck: Nest in 100 km erkannt, fernes Nest nur als Position (keine Stufe)", async () => {
  assert.ok(hexDistanceKm(HOME, at(1)) <= 120 && hexDistanceKm(HOME, at(3)) > 120);
  const near = await nestOf(A.playerId, nNear);
  assert.equal(near.level, 2);
  assert.equal(near.known, true);
  assert.equal(near.intel?.age, "live");
  assert.match(near.intel!.source, /Ausguck/);
  const far = await nestOf(A.playerId, nFar);
  assert.equal(far.level, null);
  assert.equal(far.empty, null);
  assert.equal(far.known, false);
  assert.equal(typeof far.col, "number", "Position bleibt sichtbar");
  const view = await mapViewFor(db, A.playerId, Date.now());
  const other = view.bases.find((b) => b.id === B.baseId)!;
  assert.equal(other.owner, B.name, "Hafen: Name und Besitzer immer sichtbar");
  assert.equal(other.known, false);
  assert.equal(other.protection, null);
  assert.equal(view.intel.fog, true);
  assert.equal(view.intel.sensors.length, 1);
});

test("Radarstation: Reichweite 150 + 40 je Stufe, Nebel kürzt, Sabotage und Strommangel wirken", async () => {
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 8; s.buildings.kraftwerk = 5; s.resUpdatedAt = Date.now(); });
  fresh();
  const [row] = await db.select().from(tables.base).where(eq(tables.base.id, A.baseId));
  const state = row.state as BaseState;
  const cond = radarCondition(withSite(state, row.col, row.row), Date.now());
  const radar = sensorsOfBase({ ...row, state }, Date.now(), (await import("../src/context.ts")).balance.intel!).find((s) => s.kind === "radar")!;
  assert.equal(cond.powerServed, 1);
  assert.equal(radar.km, Math.round(470 * cond.fogFactor), "Stufe 8: 470 km mal Nebel");
  assert.ok(cond.fogFactor >= 0.7 && cond.fogFactor <= 1);
  assert.equal((await nestOf(A.playerId, nMid)).level, 2, "300 km im Radar");
  assert.equal((await nestOf(A.playerId, nFar)).level, null, "600 km außerhalb");
  // Sabotage der Radarstation: keine Reichweite, nur noch Ausguck.
  await patchBase(A.baseId, (s) => { s.intel = { ...(s.intel ?? {}), sabotage: { target: "radarstation", fromMs: Date.now() - 1000, untilMs: Date.now() + HOUR } }; });
  fresh();
  assert.equal((await nestOf(A.playerId, nMid)).intel?.age, "bekannt", "Sabotage: Radar aus, nur noch gespeichertes Wissen");
  // Strommangel: halbe Reichweite (235 km × Nebel < 300 km).
  await patchBase(A.baseId, (s) => { s.intel = {}; s.buildings.kraftwerk = 0; s.buildings.solarpark = 0; s.buildings.windpark = 0; s.powerStored = 0; });
  fresh();
  const [r2] = await db.select().from(tables.base).where(eq(tables.base.id, A.baseId));
  const c2 = radarCondition(withSite(r2.state as BaseState, r2.col, r2.row), Date.now());
  assert.ok(c2.powerServed < 1, `Strommangel erwartet, versorgt ${c2.powerServed}`);
  assert.equal((await nestOf(A.playerId, nMid)).intel?.age, "bekannt", "Strommangel: halbe Reichweite");
  await patchBase(A.baseId, (s) => { s.buildings.kraftwerk = 5; s.buildings.radarstation = 0; });
});

test("Allianz teilt Sicht und Wissen: Nest beim Verbündeten wird sichtbar", async () => {
  assert.equal((await nestOf(A.playerId, nAtB)).level, null);
  const r = await createAlliance(engine, A.playerId, { name: "Lagebund", tag: "LGB" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m] = await db.select().from(tables.allianceMember).where(eq(tables.allianceMember.playerId, A.playerId));
  await db.insert(tables.allianceMember).values({ playerId: B.playerId, allianceId: m.allianceId, role: "mitglied" });
  fresh();
  const shared = await nestOf(A.playerId, nAtB);
  assert.equal(shared.level, 2);
  assert.match(shared.intel!.source, /Fernost/);
  const view = await mapViewFor(db, A.playerId, Date.now());
  assert.equal(view.intel.sensors.length, 2, "Sensoren beider Häfen");
  assert.equal(view.bases.find((b) => b.id === B.baseId)!.known, true);
  await db.delete(tables.allianceMember);
  await db.delete(tables.alliance);
});

test("Alter: bekannt (< 24 h), veraltet (24–72 h), vergessen (> 72 h); Aufräumen löscht Vergessenes", async () => {
  await db.delete(tables.intelSighting);
  const now = Date.now();
  const ids = [await nestAt(at(7), 3), await nestAt(at(8), 4), await nestAt(at(9), 5)];
  const ages = [5, 30, 80];
  for (let i = 0; i < 3; i++) {
    await db.insert(tables.intelSighting).values({ owner: `p:${A.playerId}`, kind: "nest", objectId: ids[i], level: "erkennung", source: "Radar Hafen Test", seenAt: new Date(now - ages[i] * HOUR), data: { level: 3 + i, empty: false, respawnAtMs: null } });
  }
  const view = await mapViewFor(db, A.playerId, now);
  const got = ids.map((id) => view.nests.find((n) => n.id === id)!);
  assert.equal(got[0].intel?.age, "bekannt");
  assert.equal(got[0].level, 3);
  assert.equal(got[1].intel?.age, "veraltet");
  assert.equal(got[1].level, 4);
  assert.equal(got[2].level, null, "nach 72 h vergessen");
  assert.equal(await purgeIntel(db, now), 1);
});

test("Live-Sichtung wird gespeichert und bleibt nach dem Verlassen der Sicht bekannt", async () => {
  await db.delete(tables.intelSighting);
  await mapViewFor(db, A.playerId, Date.now());
  const [s] = await db.select().from(tables.intelSighting).where(eq(tables.intelSighting.objectId, nNear));
  assert.equal(s.kind, "nest");
  assert.equal(s.owner, `p:${A.playerId}`);
  // Nest „wandert“ aus der Sicht (Test): das Wissen bleibt mit Stand und Quelle.
  await db.update(tables.nest).set({ col: at(5).col }).where(eq(tables.nest.id, nNear));
  fresh();
  const n = await nestOf(A.playerId, nNear);
  assert.equal(n.level, 2);
  assert.equal(n.intel?.age, "bekannt");
  await db.update(tables.nest).set({ col: at(1).col }).where(eq(tables.nest.id, nNear));
});

test("Aufklärung schreibt ein Lagebild; Planung verrät ein leeres unbekanntes Nest nicht", async () => {
  await patchBase(A.baseId, (s) => { s.units = { korvette: 5 }; s.buildings.werft = 3; });
  await db.update(tables.nest).set({ defeatedAt: new Date(Date.now() - 60000) }).where(eq(tables.nest.id, nFar));
  fresh();
  const target = at(6);
  const p = await missionPreview(engine, A.playerId, { type: "ueberfall", units: { korvette: 1 }, ...target });
  assert.equal(p.ok, true, `kein nest_empty ohne Erkennung: ${JSON.stringify(p)}`);
  const r = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, ...target });
  assert.equal(r.ok, true, JSON.stringify(r));
  const arrive = (r as { arriveAtMs: number }).arriveAtMs;
  await processDue(engine, arrive + 1000);
  fresh();
  const n = await nestOf(A.playerId, nFar, arrive + 2000);
  assert.equal(n.level, 2);
  assert.equal(n.empty, true);
  // Stufe 2 (Bordsicht): der Aufklärer steht noch am Ziel und sieht es live; sonst gilt das Lagebild der Aufklärung.
  assert.match(n.intel?.source ?? "", /^(Aufklärung|Verband aus)/);
  assert.ok(n.intel?.level === "lagebild" || n.intel?.level === "erkennung");
  await db.update(tables.nest).set({ defeatedAt: null }).where(eq(tables.nest.id, nFar));
});

test("Fremde Verbände: Radar sichtet (Größe, Kurs), Ausguck erkennt (Besitzer), U-Boote bleiben unsichtbar", async () => {
  await db.delete(tables.mission);
  // Stufe 2: ohne U-Jagd im Hafen (sonst sähe das Sonar die U-Boote).
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 8; s.buildings.kraftwerk = 5; s.resUpdatedAt = Date.now(); s.units = {}; s.unitsAway = {}; });
  const now = Date.now();
  const mk = async (target: { col: number; row: number }, units: Record<string, number>, frac: number) => {
    const T = 10 * HOUR;
    const [m] = await db.insert(tables.mission).values({
      playerId: B.playerId, baseId: B.baseId, type: "ueberfall", targetKind: "none", targetId: null, targetCol: target.col, targetRow: target.row,
      plan: { units, departAtMs: now - frac * T, arriveAtMs: now + (1 - frac) * T, travelSeconds: T / 1000 }, status: "outbound", arriveAt: new Date(now + (1 - frac) * T),
    }).returning({ id: tables.mission.id });
    return m.id;
  };
  const radarOnly = await mk(at(3), { korvette: 12 }, 0.995);
  const lookout = await mk(HOME, { korvette: 3, schuetzen: 50 }, 0.999);
  const subs = await mk(HOME, { uboot: 20 }, 0.999);
  const far = await mk(at(6), { korvette: 2 }, 0.999);
  fresh();
  const view = await mapViewFor(db, A.playerId, now);
  const f1 = view.fleets.find((f) => f.id === radarOnly)!;
  assert.ok(f1, JSON.stringify({ fleets: view.fleets, sensors: view.intel.sensors }));
  assert.equal(f1.size, "mittel");
  assert.equal(f1.owner, null, "Sichtung: Besitzer unbekannt");
  assert.equal(f1.intel.level, "sichtung");
  assert.equal(f1.heading, headingDeg(hexCenterXY(FAR.col, FAR.row), hexCenterXY(at(3).col, at(3).row)), "Kurs vom Ausgangshafen zum Ziel");
  const f2 = view.fleets.find((f) => f.id === lookout)!;
  assert.equal(f2.owner, B.name);
  assert.equal(f2.size, "gross");
  assert.ok(!view.fleets.some((f) => f.id === subs), "nur U-Boote: unsichtbar");
  assert.ok(!view.fleets.some((f) => f.id === far), "außerhalb der Sicht");
  // Letzte Sichtung bleibt höchstens 2 h.
  await db.delete(tables.mission);
  fresh();
  const later = await mapViewFor(db, A.playerId, now + HOUR);
  assert.equal(later.fleets.find((f) => f.id === radarOnly)?.intel.age, "bekannt");
  const gone = await mapViewFor(db, A.playerId, now + 3 * HOUR);
  assert.ok(!gone.fleets.some((f) => f.id === radarOnly));
  await patchBase(A.baseId, (s) => { s.buildings.radarstation = 0; });
});

test("Wracks und Felder nur mit Sicht; fremdes Feld ohne Sicht ist „unbekannt“", async () => {
  const now = Date.now();
  await db.insert(tables.wreck).values([{ ...at(1), stahl: 1000, elektronik: 100, createdAt: new Date(now) }, { ...at(6), stahl: 1000, elektronik: 100, createdAt: new Date(now) }]);
  fresh();
  const view = await mapViewFor(db, A.playerId, now);
  assert.ok(view.wrecks.some((w) => w.col === at(1).col));
  assert.ok(!view.wrecks.some((w) => w.col === at(6).col), "fernes Wrack verborgen");
  await db.insert(tables.resourceField).values([
    { siteIndex: 9001, ...at(1), kind: "erz", tier: 1, ownerId: B.playerId, guard: {} },
    { siteIndex: 9002, ...at(6), kind: "erz", tier: 2, ownerId: B.playerId, guard: {} },
  ]);
  fresh();
  const fv = await fieldsView(engine, A.playerId);
  const near = fv!.fields.find((f) => f.col === at(1).col && f.row === HOME.row)!;
  const far = fv!.fields.find((f) => f.col === at(6).col && f.row === HOME.row)!;
  assert.equal(near.relation, "neutral");
  assert.equal(near.owner, B.name);
  assert.equal(near.seen?.age, "live");
  assert.equal(far.relation, "unbekannt");
  assert.equal(far.owner, null);
  assert.equal(far.tier, 2, "Position, Art und Stufe bleiben");
});

test("intel_fog aus: alle sehen alles wie bisher (Stufen, Schutz), keine fremden Verbände", async () => {
  await setIntelFog(db, false);
  const view = await mapViewFor(db, A.playerId, Date.now());
  assert.equal(view.intel.fog, false);
  assert.equal(view.nests.find((n) => n.id === nFar)!.level, 2);
  assert.ok(view.nests.every((n) => n.known));
  assert.equal(view.fleets.length, 0);
  assert.ok(view.bases.every((b) => b.known));
  const fv = await fieldsView(engine, A.playerId);
  assert.ok(fv!.fields.every((f) => f.relation !== "unbekannt"));
  await setIntelFog(db, true);
});

test("Dauer der Kartenansicht mit zehn Spielern (Pi-Richtwert)", async () => {
  const players = [A];
  for (let i = 0; i < 9; i++) players.push(await newPlayer(`Last${i}`, { col: 8 + i * 8, row: 8 + (i % 5) * 10 }));
  for (const p of players) await patchBase(p.baseId, (s) => { s.buildings.radarstation = 6; s.buildings.kraftwerk = 5; });
  fresh();
  const cold: number[] = [];
  const warm: number[] = [];
  for (const p of players) { const t = performance.now(); await mapViewFor(db, p.playerId, Date.now()); cold.push(performance.now() - t); }
  for (const p of players) { const t = performance.now(); await mapViewFor(db, p.playerId, Date.now()); warm.push(performance.now() - t); }
  const avg = (x: number[]) => Math.round((x.reduce((a, b) => a + b, 0) / x.length) * 10) / 10;
  console.log(`mapView mit 10 Spielern: erster Abruf Ø ${avg(cold)} ms, zwischengespeichert Ø ${avg(warm)} ms`);
  assert.ok(avg(warm) < 500);
});
