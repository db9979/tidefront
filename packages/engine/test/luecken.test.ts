// Integrationstests für geschlossene Lücken im Regelkern (echtes PostgreSQL, wird geleert): Wetter bei Weltereignissen,
// Radar „einmal erkannt bleibt erkannt“, Meldung „Spione zurück“, Belagerung und Admin-Statistik mit Modifikatoren,
// Tagesbefehle zu Strom, Wetter und Nachrichtendienst, Allianzwertung im Saisonergebnis.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexDistanceKm, COLS, ROWS } from "@tidefront/world";
import {
  productionRates, settle, spyRollOf, worldEventsBalance,
  type BaseState, type Mission, type SpyMission, type WorldEventKind,
} from "@tidefront/game-core";
import {
  adminStats, balance, baseView, CHALLENGE_KINDS, chooseBase, dailyView, dayKey, drawDay, hallOfFame, launchMission,
  missionPreview, modifiersFor, poolContext, processDue, register, registerModifierSource, runningSeason, seasonEnd, seed,
  spawnWorldEvent, spyLaunch, type Engine, type NoticeJob,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pushed: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => pushed.push(...jobs) };
let keyN = 0;
const key = () => `l${++keyN}-${Date.now()}`;
const rich = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
const SEED_OK = (() => { let s = 1; while (spyRollOf(s, 20) !== 1) s++; return s; })();
const dc = tables.dailyChallenge;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

/** Freies Küstenfeld 100–400 km von `near` entfernt. */
function coastNear(near: { col: number; row: number }, skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = Math.max(0, near.row - 5); row <= Math.min(ROWS - 1, near.row + 5); row++) {
    for (let col = Math.max(0, near.col - 5); col <= Math.min(COLS - 1, near.col + 5); col++) {
      const d = hexDistanceKm(near, { col, row });
      if (isCoast(col, row) && !nests.has(`${col},${row}`) && d >= 100 && d <= 400 && k++ === skip) return { col, row };
    }
  }
  throw new Error("no coast near");
}

/** Spieler mit Hafen ohne Anfängerschutz. */
async function newPlayer(name: string, field: number | { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = typeof field === "number" ? freeCoast(field) : field;
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => { s.protection.createdAtMs = Date.now() - 30 * DAY; });
  return { playerId: p.playerId, baseId, ...f };
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

async function missionRow(id: number) {
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  return m;
}

async function spawn(kind: WorldEventKind, focusBaseId: number) {
  const s = await runningSeason(db);
  const r = await db.transaction((tx) => spawnWorldEvent(tx, Date.now(), kind, s!.id, 0, focusBaseId));
  assert.ok(r && r.kind === kind, "kein Ereignis");
  return r.id;
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

/** Keine Kartell-Überfälle und keine fremden Ereignisse im Testlauf. */
async function quiet() {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.status} = 'pending' and (${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%')`);
}

async function setDaily(playerId: number, specs: { kind: string; target: number; param?: string | null }[]) {
  await dailyView(engine, playerId);
  for (const [slot, s] of specs.entries()) {
    await db.update(dc)
      .set({ kind: s.kind, target: s.target, param: s.param ?? null, progress: 0, completedAt: null, claimedAt: null, rerolled: false })
      .where(and(eq(dc.playerId, playerId), eq(dc.day, dayKey(Date.now())), eq(dc.slot, slot)));
  }
}

/** Ankunft einer Mission auf jetzt vorziehen (Tagesbefehle zählen nur am selben Spieltag) und verarbeiten. */
async function arriveNow(missionId: number) {
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) })
    .where(and(eq(tables.gameEvent.status, "pending"), sql`(${tables.gameEvent.payload}->>'missionId')::int = ${missionId}`));
  await processDue(engine, Date.now());
}

async function dailyOf(playerId: number, kind: string) {
  const [r] = await db.select().from(dc).where(and(eq(dc.playerId, playerId), eq(dc.day, dayKey(Date.now())), eq(dc.kind, kind)));
  return r;
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

test("Weltereignisse: Vorschau und Plan mit Wetter der Route, Kämpfe mit Wetter am Kampfort", async () => {
  const a = await newPlayer("Ziel", 90);
  const c = await newPlayer("Jaeger", coastNear(a, 3));
  await quiet();
  const id = await spawn("grossflotte", a.baseId);
  await patchBase(c.baseId, (s) => {
    s.units = { korvette: 6, landungsschiff: 1 }; s.resources.treibstoff = 1_000_000;
    s.buildings.kommandozentrale = 15; s.buildings.hafenkommandantur = 10;
  });
  const input = { type: "ueberfall", units: { korvette: 6, landungsschiff: 1 }, col: 0, row: 0, eventId: id };
  const pv = await missionPreview(engine, c.playerId, input) as { ok: boolean; weather?: { shipFactor: number }; weatherFactor?: number };
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.ok(pv.weather, "Vorschau trägt das Wetter");
  assert.ok(pv.weatherFactor! >= 1 && pv.weatherFactor! <= 1 + balance.weather!.shipSlowMax);
  const m = await launchMission(engine, c.playerId, key(), input);
  assert.equal(m.ok, true, JSON.stringify(m));
  const row = await missionRow((m as { missionId: number }).missionId);
  assert.ok((row.plan as Mission).weather, "Plan trägt das Wetter");
  await runUntil((m as { arriveAtMs: number }).arriveAtMs + 1000);
  const [rep] = await db.select().from(tables.battleReport)
    .where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.attackerPlayerId, c.playerId)));
  assert.ok((rep.report as { battle: { weather?: unknown } }).battle.weather, "Kampf auf See mit Wetter");
  // Hafenangriff der Großflotte: ebenfalls mit Wetter.
  const [e] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, id));
  const targets = (e.data as { targets: unknown[] }).targets.length;
  await runUntil(e.activeAt!.getTime() + targets * worldEventsBalance(balance).grossflotte.attackIntervalHours * HOUR + 1000);
  const [onA] = await db.select().from(tables.battleReport)
    .where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.defenderBaseId, a.baseId)));
  assert.ok(onA, "Hafenangriff fand statt");
  assert.ok((onA.report as { battle: { weather?: unknown } }).battle.weather, "Hafenangriff mit Wetter");
});

test("Radar: einmal erkannt bleibt erkannt; Push-Warnung prüft das Radar zum Warnzeitpunkt", async () => {
  const r = await newPlayer("Radar", 30);
  const x = await newPlayer("Angreifer", 34);
  await patchBase(r.baseId, (s) => { s.buildings.radarstation = 4; s.buildings.kraftwerk = 3; s.resources = { ...rich }; });
  const insert = async (minutes: number) => {
    const arrive = Date.now() + minutes * 60000;
    const [m] = await db.insert(tables.mission).values({
      playerId: x.playerId, baseId: x.baseId, type: "ueberfall", targetKind: "base", targetId: r.baseId, targetCol: r.col,
      targetRow: r.row, plan: { type: "ueberfall", units: { korvette: 1 }, arriveAtMs: arrive }, status: "outbound", arriveAt: new Date(arrive),
    }).returning({ id: tables.mission.id });
    return m.id;
  };
  const first = await insert(5);
  let v = (await baseView(engine, r.playerId)).base!;
  assert.ok(v.radarWarningMinutes > 5, `Vorwarnzeit ${v.radarWarningMinutes}`);
  assert.ok(v.incoming.some((i) => i.id === first), "erkannt");
  assert.ok(typeof (await missionRow(first)).plan === "object" && ((await missionRow(first)).plan as Mission).detectedAtMs, "Erkennung gemerkt");
  // Radar fällt aus (Strommangel/Sabotage): der erkannte Angriff bleibt sichtbar, ein neuer wird nicht erkannt.
  await patchBase(r.baseId, (s) => { s.buildings.radarstation = 0; });
  const second = await insert(5);
  v = (await baseView(engine, r.playerId)).base!;
  assert.equal(v.radarWarningMinutes, 0);
  assert.ok(v.incoming.some((i) => i.id === first), "bleibt erkannt");
  assert.ok(!v.incoming.some((i) => i.id === second), "ohne Radar nicht erkannt");
  // Push: für den erkannten Angriff ja, für den unerkannten nicht (Radar zum Warnzeitpunkt).
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.status} = 'pending' and ${tables.gameEvent.type} <> 'season_end'`);
  for (const id of [first, second]) {
    await db.insert(tables.gameEvent).values({ type: "attack_warning", dueAt: new Date(Date.now() - 1000), payload: { missionId: id }, baseId: r.baseId, status: "pending" });
  }
  pushed.length = 0;
  await processDue(engine, Date.now());
  const warns = pushed.filter((j) => j.notice.title === "Angriff erkannt");
  assert.deepEqual(warns.map((j) => j.notice.tag), [`attack-${first}`]);
  assert.equal(((await missionRow(second)).plan as Mission).detectedAtMs, undefined);
  // Mit Radar, aber außerhalb der Vorwarnzeit: Warnung wird neu geplant statt verschickt.
  await patchBase(r.baseId, (s) => { s.buildings.radarstation = 4; });
  const far = await insert(600);
  await db.insert(tables.gameEvent).values({ type: "attack_warning", dueAt: new Date(Date.now() - 1000), payload: { missionId: far }, baseId: r.baseId, status: "pending" });
  pushed.length = 0;
  await processDue(engine, Date.now());
  assert.equal(pushed.filter((j) => j.notice.tag === `attack-${far}`).length, 0);
  const [again] = await db.select().from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.type, "attack_warning"), eq(tables.gameEvent.status, "pending"), sql`(${tables.gameEvent.payload}->>'missionId')::int = ${far}`));
  assert.ok(again && again.dueAt.getTime() > Date.now(), "neu geplant");
  await db.delete(tables.mission).where(eq(tables.mission.targetId, r.baseId));
});

test("Spione zurück: eigene Meldung mit Art und Ergebnis; Erkundung zählt für den Tagesbefehl", async () => {
  const s = await newPlayer("Agentin", 50);
  const t = await newPlayer("Zielhafen", 54);
  await patchBase(s.baseId, (st) => {
    st.buildings.nachrichtendienst = 4; st.buildings.hafenkommandantur = 6; st.buildings.lagerkomplex = 8;
    st.units = { spion: 4 }; st.resources = { ...rich };
  });
  await setDaily(s.playerId, [{ kind: "erkundung", target: 1 }]);
  const r = await spyLaunch(engine, s.playerId, key(), { kind: "erkunden", col: t.col, row: t.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = (r as { missionId: number }).missionId;
  const plan = (await missionRow(id)).plan as SpyMission;
  await db.update(tables.mission).set({ plan: { ...plan, spy: { ...plan.spy, seed: SEED_OK } } }).where(eq(tables.mission.id, id));
  await arriveNow(id);
  assert.ok((await dailyOf(s.playerId, "erkundung")).completedAt, "Erkundung erfüllt");
  pushed.length = 0;
  await processDue(engine, plan.returnAtMs + 1000);
  const back = pushed.filter((j) => j.playerId === s.playerId && j.notice.kind === "fleet");
  assert.equal(back.length, 1);
  assert.equal(back[0].notice.title, "Spione zurück");
  assert.match(back[0].notice.body, /Erkunden gegen Hafen Zielhafen: gelungen/);
});

test("Tagesbefehle: Strom, Wetter und Nachrichtendienst nur mit Gebäude; Sturmfahrt und Speicher zählen", async () => {
  for (const k of ["speicherwerk", "stromspeicher", "sturmfahrt", "erkundung"]) assert.ok(CHALLENGE_KINDS[k], k);
  const base = (buildings: Record<string, number>): BaseState => ({
    resources: { stahl: 1000, treibstoff: 1000, elektronik: 500, proviant: 1000 }, resUpdatedAt: 0, buildings, units: {},
    unitsAway: {}, defenses: {}, buildQueue: [], trainingQueue: [], versorgungsmangel: false, powerStored: 0,
    protection: { createdAtMs: 0, nightShieldStartHour: null, tzOffsetMinutes: 0, nightShieldSuspendedUntilMs: 0, defeatShieldUntilMs: 0 },
  } as BaseState);
  const kindsOf = (b: BaseState, others: boolean) => {
    const c = poolContext(b, { others, raidsPossible: true });
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const d of drawDay(c, `p|${i}`)) seen.add(d.kind);
    return seen;
  };
  const none = kindsOf(base({ kommandozentrale: 3 }), true);
  for (const k of ["speicherwerk", "stromspeicher", "sturmfahrt", "erkundung"]) assert.ok(!none.has(k), `${k} ohne Gebäude`);
  const all = kindsOf(base({ kommandozentrale: 3, speicherwerk: 2, kraftwerk: 2, werft: 2, nachrichtendienst: 1 }), true);
  for (const k of ["speicherwerk", "stromspeicher", "sturmfahrt", "erkundung"]) assert.ok(all.has(k), `${k} mit Gebäude`);
  assert.ok(!kindsOf(base({ nachrichtendienst: 1 }), false).has("erkundung"), "ohne Ziel keine Erkundung");

  // Sturmfahrt: Aufklärung mit Sturm auf der Route; Speicherwerk-Ausbau aus dem Zustand.
  const p = await newPlayer("Kapitaen", 70);
  await patchBase(p.baseId, (s) => { s.units = { korvette: 2 }; s.resources = { ...rich }; s.buildings.speicherwerk = 1; });
  await quiet();
  await setDaily(p.playerId, [{ kind: "speicherwerk", target: 2 }, { kind: "sturmfahrt", target: 1 }]);
  const nest = (await db.select().from(tables.nest))[0];
  const m = await launchMission(engine, p.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: nest.col, row: nest.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const id = (m as { missionId: number }).missionId;
  const plan = (await missionRow(id)).plan as Mission;
  await db.update(tables.mission).set({ plan: { ...plan, weather: { avgWind: 0.9, storminess: 0.5, shipFactor: 1.15 } } }).where(eq(tables.mission.id, id));
  await arriveNow(id);
  assert.ok((await dailyOf(p.playerId, "sturmfahrt")).completedAt, "Mission trotz Sturm");
  await patchBase(p.baseId, (s) => { s.buildings.speicherwerk = 2; });
  const v = await dailyView(engine, p.playerId);
  assert.ok(v.challenges.find((c) => c.kind === "speicherwerk")!.progress >= 2, "Speicherwerk aus dem Zustand");
});

test("Belagerung und Admin-Statistik rechnen die Produktion mit Modifikatoren", async () => {
  const a = await newPlayer("Belagert", 120);
  await patchBase(a.baseId, (s) => {
    s.buildings.stahlwerk = 8; s.buildings.kraftwerk = 10; s.buildings.lagerkomplex = 10; s.buildings.hafenkommandantur = 6;
    s.resources = { stahl: 100, treibstoff: 50000, elektronik: 100, proviant: 50000 };
  });
  await quiet();
  const plain = (await adminStats(db, 7)).flow.productionPerHour.stahl ?? 0;
  const off = registerModifierSource((_db, playerId) => (playerId === a.playerId ? { production: { stahl: 2 } } : {}), "test", "Test");
  try {
    const boosted = (await adminStats(db, 7)).flow.productionPerHour.stahl ?? 0;
    const own = productionRates(settle(await stateOf(a.baseId), Date.now(), balance), balance).buildingPerHour.stahl ?? 0;
    assert.ok(own > 0);
    assert.ok(Math.abs(boosted - plain - own) < 2, `Admin-Statistik mit Modifikator: ${plain} → ${boosted} (+${own})`);

    const id = await spawn("belagerung", a.baseId);
    const [e] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, id));
    const before = await stateOf(a.baseId);
    const tick = e.startsAt.getTime() + worldEventsBalance(balance).belagerung.tickMinutes * 60000;
    const mods = await modifiersFor(db, a.playerId, { state: before, nowMs: tick });
    assert.equal(mods.production?.stahl, 2);
    await processDue(engine, tick + 10);
    const after = await stateOf(a.baseId);
    const expected = settle(before, tick, balance, mods);
    const perHour = productionRates(expected, balance, mods).buildingPerHour.stahl!;
    const want = expected.resources.stahl - perHour * 0.3 * ((tick - e.startsAt.getTime()) / HOUR);
    assert.ok(Math.abs(after.resources.stahl - want) < 0.01, `${after.resources.stahl} ≈ ${want}`);
    await db.update(tables.worldEvent).set({ status: "ended", outcome: "test" }).where(eq(tables.worldEvent.id, id));
  } finally {
    off();
  }
});

test("Saisonende: Allianzwertung gespeichert, in der Ruhmeshalle und in der Nachricht", async () => {
  const p1 = await newPlayer("Ally1", 140);
  const p2 = await newPlayer("Ally2", 144);
  const p3 = await newPlayer("Solo", 148);
  await patchBase(p1.baseId, (s) => { s.buildings.stahlwerk = 6; });
  const [al] = await db.insert(tables.alliance).values({ name: "Nordbund", tag: "NB" }).returning();
  const [al2] = await db.insert(tables.alliance).values({ name: "Südwacht", tag: "SW" }).returning();
  await db.insert(tables.allianceMember).values([
    { playerId: p1.playerId, allianceId: al.id, role: "fuehrung" },
    { playerId: p2.playerId, allianceId: al.id, role: "mitglied" },
    { playerId: p3.playerId, allianceId: al2.id, role: "fuehrung" },
  ]);
  const season = (await runningSeason(db))!;
  await db.transaction((tx) => seasonEnd(tx, { id: 0, type: "season_end", dueAt: new Date(), payload: { seasonId: season.id }, baseId: null }, Date.now()));
  const res = await db.select().from(tables.seasonResult).where(eq(tables.seasonResult.seasonId, season.id));
  const total = (id: number) => res.find((r) => r.playerId === id)?.total ?? 0;
  const rows = await db.select().from(tables.seasonAllianceResult).where(eq(tables.seasonAllianceResult.seasonId, season.id));
  assert.equal(rows.length, 2);
  const nb = rows.find((r) => r.tag === "NB")!;
  assert.equal(nb.total, total(p1.playerId) + total(p2.playerId));
  assert.equal(nb.members, 2);
  assert.equal(nb.rank, 1, "Nordbund vorn");
  assert.equal(rows.find((r) => r.tag === "SW")!.total, total(p3.playerId));
  const hall = await hallOfFame(db, p2.playerId);
  const h = hall.find((x) => x.number === season.number)!;
  assert.deepEqual(h.alliances.map((x) => x.tag), ["NB", "SW"]);
  assert.equal(h.alliances[0].own, true);
  assert.equal(h.alliances[1].own, false);
  const [msg] = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, p2.playerId), sql`${tables.message.subject} like ${`Saison ${season.number}:%`}`));
  assert.match(msg.body, /Deine Allianz \[NB\] Nordbund: Platz 1 von 2/);
});
