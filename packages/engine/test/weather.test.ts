// Wetter und Strom auf dem Server (v1.6): Lage im Stützpunkt, Versorgung in der Basis-Ansicht, Wetter in der
// Missionsvorschau, Ausbildung mit Stromprognose, Nebel als Modifikator-Quelle nur mit Radar.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, hexCenter, isTradePortHex } from "@tidefront/world";
import type { BaseState, Mission } from "@tidefront/game-core";
import {
  balance,
  baseView,
  chooseBase,
  launchMission,
  missionPreview,
  register,
  seed,
  train,
  weatherModifiers,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `w${++keyN}-${Date.now()}`;

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

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const s = await stateOf(baseId);
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
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

test("Neuer Hafen kennt seine Lage; alte Stände erhalten sie beim Lesen", async () => {
  const p = await newPlayer("Wilma", 3);
  const s = await stateOf(p.baseId);
  assert.deepEqual(s.site, hexCenter(p.col, p.row));
  // Älterer Stand ohne Lage: Ansicht rechnet trotzdem mit dem Wetter am Hafen.
  await patchBase(p.baseId, (st) => { delete st.site; });
  const v = (await baseView(engine, p.playerId)).base!;
  assert.ok(v.grid.now.weather);
  assert.equal(v.grid.curve.length, balance.power!.forecastHours);
});

test("Versorgung: Strom nach Quelle und Rang, Kurve über 24 h, Warnung bei Mangel", async () => {
  const p = await newPlayer("Wanda", 5);
  await patchBase(p.baseId, (s) => {
    s.buildings = { ...s.buildings, kraftwerk: 1, stahlwerk: 4, radarstation: 4, windpark: 1, speicherwerk: 1 };
    s.resources = { ...rich };
  });
  const g = (await baseView(engine, p.playerId)).base!.grid;
  assert.equal(g.now.demand.radar, 20);
  assert.equal(g.now.demand.production, 40);
  assert.equal(g.now.supply.kraftwerk, 60);
  assert.equal(g.now.served.radar, 1);
  for (const h of g.curve) assert.ok(h.wind >= 0 && h.wind <= 1 && h.daylight >= 0 && h.daylight <= 1);
  // Kurve beginnt zur nächsten vollen Stunde (Beschriftung je Stunde stimmt); Sturmwarnung auf 5 Minuten genau.
  assert.equal(g.curve[0].atMs % 3600000, 0);
  assert.ok(g.curve[0].atMs - Date.now() <= 3600000 + 60000);
  assert.ok(g.stormWarning === null || g.stormWarning % 300000 === 0 || g.stormWarning <= Date.now() + 60000);
  // Zu wenig Strom: Radar 20 (Bedarf 100) > Kraftwerk 60.
  await patchBase(p.baseId, (s) => { s.buildings = { ...s.buildings, windpark: 0, speicherwerk: 0, radarstation: 20, stahlwerk: 0 }; s.powerStored = 0; });
  const v = (await baseView(engine, p.playerId)).base!;
  assert.ok(v.grid.warning);
  assert.equal(v.grid.warning!.rank, "radar");
  assert.equal(v.grid.warning!.missing, 40);
  assert.match(v.grid.warning!.text, /Radar eingeschränkt/);
  const fog = v.modifierSources.find((x) => x.id === "wetter")?.mods.radarWarning ?? 1;
  assert.ok(Math.abs(v.radarWarningMinutes - (10 + 5 * 20) * 0.6 * fog) < 1e-6);
});

test("Ausbildung ohne Strom dauert länger, mit Kraftwerk normal", async () => {
  const p = await newPlayer("Walter", 7);
  await patchBase(p.baseId, (s) => { s.buildings = { ...s.buildings, kaserne: 1 }; s.resources = { ...rich }; });
  const dark = await train(engine, p.playerId, key(), "schuetzen", 10);
  assert.equal(dark.ok, true, JSON.stringify(dark));
  const o1 = (await stateOf(p.baseId)).trainingQueue[0];
  assert.equal(o1.finishesAt - o1.startedAt, (300 * 1000) / balance.power!.minSpeed);
  const q = await newPlayer("Wiebke", 9);
  await patchBase(q.baseId, (s) => { s.buildings = { ...s.buildings, kaserne: 1, kraftwerk: 1 }; s.resources = { ...rich }; });
  assert.equal((await train(engine, q.playerId, key(), "schuetzen", 10)).ok, true);
  const o2 = (await stateOf(q.baseId)).trainingQueue[0];
  assert.equal(o2.finishesAt - o2.startedAt, 300 * 1000);
});

test("Missionsvorschau und Plan tragen das Wetter der Route", async () => {
  const p = await newPlayer("Wotan", 11);
  await patchBase(p.baseId, (s) => { s.units = { korvette: 2 }; s.resources = { ...rich }; });
  const nest = (await db.select().from(tables.nest))[0];
  const prev = await missionPreview(engine, p.playerId, { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.equal(prev.ok, true, JSON.stringify(prev));
  const pv = prev as { weather?: { shipFactor: number; avgWind: number; atTarget?: { atMs: number; fog: number } }; weatherFactor: number; arriveAtMs: number };
  assert.ok(pv.weather && pv.weather.avgWind >= 0 && pv.weather.avgWind <= 1);
  // Wetter am Ziel zur Ankunft (nur Anzeige): deterministisch aus Ziel und Ankunftszeit.
  assert.equal(pv.weather.atTarget?.atMs, pv.arriveAtMs);
  assert.ok(pv.weather.atTarget!.fog >= 0 && pv.weather.atTarget!.fog <= 1);
  assert.ok(pv.weatherFactor >= 1 && pv.weatherFactor <= 1 + balance.weather!.shipSlowMax);
  const m = await launchMission(engine, p.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  const plan = row.plan as Mission;
  assert.ok(plan.weather && plan.weather.shipFactor >= 1);
  assert.equal((plan.weather as { atTarget?: unknown }).atTarget, undefined);
});

test("Nebel kürzt das Radar nur mit Radarstation (Quelle Wetter)", () => {
  // Neufundland-Bänke: viel Nebel. Ohne Radar keine Quelle, mit Radar Faktor in [0,7; 1].
  const site = { lat: 46, lon: -52 };
  let sawFog = false;
  for (let h = 0; h < 14 * 24; h++) {
    const t = Date.UTC(2026, 3, 1) + h * 3600000;
    assert.deepEqual(weatherModifiers({ site, buildings: {} } as unknown as BaseState, t), {});
    const f = weatherModifiers({ site, buildings: { radarstation: 1 } } as unknown as BaseState, t).radarWarning ?? 1;
    assert.ok(f >= 1 - balance.weather!.fogRadarMax - 1e-9 && f <= 1);
    if (f < 0.95) sawFog = true;
  }
  assert.ok(sawFog);
});
