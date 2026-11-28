// Integrationstests Auftragsbuch gegen ein echtes PostgreSQL (wird geleert): Erfüllung serverseitig, Abholen genau
// einmal (auch gleichzeitig), Abschluss erst nach allen zwölf, Bauzeitverkürzung, Abzeichen und Saisonende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import { upgradeDurationMs, type BaseState } from "@tidefront/game-core";
import {
  balance,
  chooseBase,
  claimGuideFinal,
  claimGuideStep,
  clearRankingCache,
  GUIDE_STEPS,
  guideView,
  processDue,
  rankingView,
  register,
  runningSeason,
  seed,
  shortenQueue,
  upgrade,
  type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
const guide = (balance as unknown as { guide: { steps: Record<string, Record<string, number>>; final: { reward: Record<string, number>; buildBoostSeconds: number } } }).guide;
const BOOST_MS = guide.final.buildBoostSeconds * 1000;
let keyN = 0;
const key = () => `g${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !isTradePortHex(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newBase(playerId: number, field: number, name: string) {
  const r = await chooseBase(engine, playerId, key(), { ...freeCoast(field), name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { baseId: number }).baseId;
}

async function newPlayer(name: string, field: number) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  return { playerId: p.playerId, baseId: await newBase(p.playerId, field, name) };
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

/** Erfüllt alle zwölf Aufträge: Gebäude, Einheiten und ein gewonnener Nest-Überfall (zählt auch als losgeschickt). */
async function fulfilAll(p: { playerId: number; baseId: number }) {
  await patchBase(p.baseId, (s) => {
    Object.assign(s.buildings, {
      kraftwerk: 1, stahlwerk: 1, raffinerie: 1, versorgungshof: 1, kommandozentrale: 1, kaserne: 1, werft: 1,
      hafenkommandantur: 3, radarstation: 1, tiefbunker: 1,
    });
    s.units = { ...s.units, schuetzen: 30, korvette: 2, landungsschiff: 1 };
  });
  await db.insert(tables.battleReport).values({
    kind: "ueberfall", title: "Überfall auf Piratennest", attackerPlayerId: p.playerId, attackerBaseId: p.baseId,
    nestId: 1, winner: "attacker", balanceVersion: balance.version, report: {},
  });
}

async function claimAll(playerId: number) {
  for (const s of GUIDE_STEPS) {
    const r = await claimGuideStep(engine, playerId, key(), s.id);
    assert.equal(r.ok, true, `${s.id}: ${JSON.stringify(r)}`);
  }
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

test("Balance: ein Paket je Auftrag, Summe etwa 1–2 Tage Anfangsproduktion", () => {
  assert.deepEqual(Object.keys(guide.steps).sort(), GUIDE_STEPS.map((s) => s.id).sort());
  const total = [...Object.values(guide.steps), guide.final.reward].reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0);
  assert.ok(total >= 8000 && total <= 20000, String(total));
  assert.equal(guide.final.buildBoostSeconds, 3600);
});

test("Nicht erfüllt: abgelehnt; unbekannter Auftrag: abgelehnt", async () => {
  const p = await newPlayer("Greta", 2);
  const v = await guideView(engine, p.playerId);
  assert.equal(v.hasBase, true);
  assert.equal(v.steps.length, GUIDE_STEPS.length);
  assert.equal(v.steps.length, 12);
  assert.equal(v.claimable, 0);
  assert.deepEqual(await claimGuideStep(engine, p.playerId, key(), "strom"), { ok: false, code: "not_done" });
  assert.deepEqual(await claimGuideStep(engine, p.playerId, key(), "nest"), { ok: false, code: "not_done" });
  assert.deepEqual(await claimGuideStep(engine, p.playerId, key(), "gibtsnicht"), { ok: false, code: "unknown_step" });
  assert.deepEqual(await claimGuideFinal(engine, p.playerId, key()), { ok: false, code: "not_done" });
});

test("Erfüllt: Belohnung genau einmal, gleicher Schlüssel liefert dieselbe Antwort", async () => {
  const p = await newPlayer("Hanno", 3);
  await patchBase(p.baseId, (s) => { s.buildings.kraftwerk = 1; });
  const before = (await stateOf(p.baseId)).resources.stahl;
  let v = await guideView(engine, p.playerId);
  assert.equal(v.claimable, 1);
  assert.equal(v.steps.find((s) => s.id === "strom")?.claimable, true);
  const k = key();
  const r = await claimGuideStep(engine, p.playerId, k, "strom");
  assert.equal(r.ok, true);
  assert.deepEqual(await claimGuideStep(engine, p.playerId, k, "strom"), r);
  assert.deepEqual(await claimGuideStep(engine, p.playerId, key(), "strom"), { ok: false, code: "already_claimed" });
  const after = (await stateOf(p.baseId)).resources.stahl;
  // Grundproduktion der wenigen Millisekunden ist vernachlässigbar.
  assert.ok(after - before >= guide.steps.strom.stahl && after - before < guide.steps.strom.stahl + 5, `${before} -> ${after}`);
  v = await guideView(engine, p.playerId);
  assert.equal(v.claimable, 0);
  assert.deepEqual(v.steps.find((s) => s.id === "strom"), { id: "strom", done: true, claimed: true, claimable: false, reward: guide.steps.strom });
});

test("Gleichzeitige Doppelaufrufe: nur einer wird ausgezahlt", async () => {
  const p = await newPlayer("Ilka", 4);
  await patchBase(p.baseId, (s) => { s.buildings.stahlwerk = 1; });
  const before = (await stateOf(p.baseId)).resources.stahl;
  const res = await Promise.all(Array.from({ length: 6 }, () => claimGuideStep(engine, p.playerId, key(), "stahl")));
  assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
  assert.ok(res.filter((r) => !r.ok).every((r) => (r as { code: string }).code === "already_claimed"));
  const gained = (await stateOf(p.baseId)).resources.stahl - before;
  assert.ok(gained >= guide.steps.stahl.stahl && gained < 2 * guide.steps.stahl.stahl, String(gained));
  const rows = await db.select().from(tables.guideClaim).where(eq(tables.guideClaim.playerId, p.playerId));
  assert.equal(rows.length, 1);
});

test("Abschluss erst nach allen zwölf; −1 Stunde für den laufenden Ausbau; Abzeichen in der Rangliste", async () => {
  const p = await newPlayer("Jost", 5);
  await fulfilAll(p);
  // Alle bis auf den letzten abholen, der letzte fehlt noch.
  for (const s of GUIDE_STEPS.slice(0, -1)) assert.equal((await claimGuideStep(engine, p.playerId, key(), s.id)).ok, true);
  assert.deepEqual(await claimGuideFinal(engine, p.playerId, key()), { ok: false, code: "not_done" });
  assert.equal((await claimGuideStep(engine, p.playerId, key(), "schutz")).ok, true);
  let v = await guideView(engine, p.playerId);
  assert.equal(v.final.claimable, true);
  assert.equal(v.claimable, 1);

  // Ein langer Ausbau läuft, ein zweiter wartet dahinter.
  await patchBase(p.baseId, (s) => {
    Object.assign(s.buildings, { kommandozentrale: 18, stahlwerk: 17 });
    s.resources = { stahl: 9e7, treibstoff: 9e7, elektronik: 9e7, proviant: 9e7 };
  });
  assert.equal((await upgrade(engine, p.playerId, key(), "stahlwerk")).ok, true);
  assert.equal((await upgrade(engine, p.playerId, key(), "raffinerie")).ok, true);
  const q0 = (await stateOf(p.baseId)).buildQueue;
  assert.ok(q0[0].finishesAt - Date.now() > BOOST_MS, "Ausbau muss länger als eine Stunde dauern");

  const r = await claimGuideFinal(engine, p.playerId, key());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((r as { boostApplied: boolean }).boostApplied, true);
  assert.deepEqual(await claimGuideFinal(engine, p.playerId, key()), { ok: false, code: "already_claimed" });
  const q1 = (await stateOf(p.baseId)).buildQueue;
  assert.equal(q0[0].finishesAt - q1[0].finishesAt, BOOST_MS);
  assert.equal(q0[1].startedAt - q1[1].startedAt, BOOST_MS);
  assert.equal(q0[1].finishesAt - q1[1].finishesAt, BOOST_MS);
  const events = await db.select().from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.baseId, p.baseId), eq(tables.gameEvent.type, "build_complete"), eq(tables.gameEvent.status, "pending")));
  for (const o of q1) assert.ok(events.some((e) => e.dueAt.getTime() === o.finishesAt), "build_complete zur neuen Zeit geplant");
  v = await guideView(engine, p.playerId);
  assert.equal(v.final.claimed, true);
  assert.equal(v.final.boostPending, false);
  assert.equal(v.claimable, 0);

  clearRankingCache();
  const rank = await rankingView(engine, p.playerId);
  assert.equal(rank.rows.find((x) => x.playerId === p.playerId)?.hafenmeister, true);
  assert.ok(rank.rows.filter((x) => x.playerId !== p.playerId).every((x) => !x.hafenmeister));
});

test("Ohne laufenden Ausbau: −1 Stunde gilt für den nächsten (einmalig)", async () => {
  const p = await newPlayer("Karla", 6);
  await fulfilAll(p);
  await claimAll(p.playerId);
  const r = await claimGuideFinal(engine, p.playerId, key());
  assert.equal((r as { boostApplied: boolean }).boostApplied, false);
  assert.equal((await guideView(engine, p.playerId)).final.boostPending, true);
  await patchBase(p.baseId, (s) => {
    Object.assign(s.buildings, { kommandozentrale: 18, stahlwerk: 17, raffinerie: 17 });
    s.resources = { stahl: 9e7, treibstoff: 9e7, elektronik: 9e7, proviant: 9e7 };
  });
  assert.equal((await upgrade(engine, p.playerId, key(), "stahlwerk")).ok, true);
  assert.equal((await upgrade(engine, p.playerId, key(), "raffinerie")).ok, true);
  const q = (await stateOf(p.baseId)).buildQueue;
  const dur = (o: { startedAt: number; finishesAt: number }) => o.finishesAt - o.startedAt;
  // Der erste (laufende) ist um eine Stunde kürzer, der zweite nicht.
  assert.equal(dur(q[0]), upgradeDurationMs("stahlwerk", 18, balance) - BOOST_MS);
  assert.equal(dur(q[1]), upgradeDurationMs("raffinerie", 18, balance));
  assert.equal((await guideView(engine, p.playerId)).final.boostPending, false);
});

test("shortenQueue: nie vor jetzt, Folgeaufträge rücken um dieselbe Spanne vor", () => {
  const base = { buildQueue: [{ buildingId: "a", targetLevel: 2, startedAt: 0, finishesAt: 1000 }, { buildingId: "b", targetLevel: 2, startedAt: 1000, finishesAt: 5000 }] } as BaseState;
  const s = shortenQueue(base, 3600000, 400);
  assert.deepEqual(s.buildQueue.map((o) => [o.startedAt, o.finishesAt]), [[0, 400], [400, 4400]]);
  assert.equal(shortenQueue({ buildQueue: [] } as unknown as BaseState, 1000, 0).buildQueue.length, 0);
});

test("Saisonende: alle Aufträge neu verfügbar, Abzeichen gilt nur für die beendete Saison", async () => {
  const p = await newPlayer("Lene", 7);
  await fulfilAll(p);
  await claimAll(p.playerId);
  assert.equal((await claimGuideFinal(engine, p.playerId, key())).ok, true);
  const old = (await runningSeason(db))!;
  await db.update(tables.gameEvent).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(tables.gameEvent.type, "season_end"));
  await processDue(engine, Date.now());
  const s = (await runningSeason(db))!;
  assert.notEqual(s.id, old.id);
  assert.equal((await guideView(engine, p.playerId)).hasBase, false);
  const baseId = await newBase(p.playerId, 7, "Lene2");
  let v = await guideView(engine, p.playerId);
  assert.ok(v.steps.every((x) => !x.claimed));
  assert.equal(v.final.claimed, false);
  clearRankingCache();
  assert.equal((await rankingView(engine, p.playerId)).rows.find((x) => x.playerId === p.playerId)?.hafenmeister, false);
  await patchBase(baseId, (st) => { st.buildings.kraftwerk = 1; });
  assert.equal((await claimGuideStep(engine, p.playerId, key(), "strom")).ok, true);
  v = await guideView(engine, p.playerId);
  assert.equal(v.steps.find((x) => x.id === "strom")?.claimed, true);
  // Die alte Saison bleibt getrennt erhalten.
  const oldRows = await db.select().from(tables.guideClaim).where(and(eq(tables.guideClaim.playerId, p.playerId), eq(tables.guideClaim.seasonId, old.id)));
  assert.equal(oldRows.length, GUIDE_STEPS.length + 1); // alle Aufträge und der Abschluss
});
