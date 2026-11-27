// Abschlussprüfung 0.38, Welle 1 (Fehler und Technik) gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert):
// TE-08 Wiederholung bei Deadlock, TE-06 Vertragsgrenzen unter Spielersperre, TST-03 eigener Code und Vorschau der
// Vertragsgrenze, TST-02 Geleitstrecken in Buchungsrichtung, M-07 Kaufmann nach Gebühren, TST-09 „Alle abholen“,
// TST-15/TX-08/TST-16 Lage, AN-07 Push bündeln mit Ruhezeit, AN-06 zweite Rückhol-Stufe und Saisonwechsel.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, hexDistanceKm, isCoast, isTradePortHex, nestSites, nearestTradePortBySea, seaRoute } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  acceptPlayerContract, baseView, chooseBase, claimAllRewards, contractBandView, contractsView, createAlliance, dayKey, dayStartMs,
  ensureVapid, flushPushes, guideView, isRetryableDbError, lageView, marketQuote, proposePlayerContract, pushSubscribe, pushToPlayer,
  queuedPushes, register, requestJoin, runCommand, runSeasonNotice, runWinback, seed, setPushSender, trade, type Engine, type PushTarget,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const DAY = 24 * H;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {}, push: () => {} };
let keyN = 0;
const key = () => `w1-${++keyN}-${Date.now()}`;
const used = new Set<string>();
const sentPushes: { endpoint: string; payload: { title: string; body: string; kind: string } }[] = [];

function coast(minPortKm = 0): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 14; row < ROWS - 10; row++) for (let col = 10; col < COLS - 10; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    if ([...used].some((u) => { const [c, r] = u.split(",").map(Number); return Math.abs(c - col) + Math.abs(r - row) < 4; })) continue;
    if (minPortKm > 0 && nearestTradePortBySea({ col, row }).distanceKm < minPortKm) continue;
    used.add(k);
    return { col, row };
  }
  throw new Error("no coast");
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function player(name: string, opts: { minPortKm?: number; patch?: (s: BaseState) => void } = {}) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = coast(opts.minPortKm);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 40_000, treibstoff: 40_000, elektronik: 20_000, proviant: 20_000 };
    s.buildings.kommandozentrale = 10; s.buildings.hafenkommandantur = 6; s.buildings.lagerkomplex = 12;
    opts.patch?.(s);
  });
  await db.execute(sql`update player set trader = jsonb_set(trader, '{credits}', '20000'::jsonb) where id = ${p.playerId}`);
  return { playerId: p.playerId, baseId, ...f };
}

async function subscribe(playerId: number): Promise<string> {
  const endpoint = `https://push.test/${playerId}-${Date.now()}`;
  const sub: PushTarget = { endpoint, keys: { p256dh: "p", auth: "a" } };
  await pushSubscribe(db, playerId, sub);
  return endpoint;
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
  await ensureVapid(db);
  setPushSender(async (s, payload) => { sentPushes.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }); });
});

after(async () => {
  setPushSender(null);
  await client.end();
});

// ---------------------------------------------------------------- TE-08

test("TE-08: runCommand wiederholt bei Deadlock (40P01) und gibt andere Fehler weiter", async () => {
  const a = await player("Retry");
  let n = 0;
  const r = await runCommand(engine, a.playerId, key(), "test", async () => {
    if (n++ === 0) throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
    return { ok: true as const };
  });
  assert.equal(r.ok, true);
  assert.equal(n, 2, "einmal wiederholt");
  await assert.rejects(runCommand(engine, a.playerId, key(), "test", async () => { throw Object.assign(new Error("x"), { code: "23505" }); }));
  assert.equal(isRetryableDbError({ cause: { code: "40001" } }), true, "eingewickelt (Drizzle)");
  assert.equal(isRetryableDbError(new Error("nope")), false);
});

// ---------------------------------------------------------------- TST-03, TE-06

test("TST-03: Vertragsgrenze vorab in der Ansicht, eigener Code contract_limit", async () => {
  const s = await player("Lieferant");
  const b = await player("Kleinlager", { patch: (st) => { st.buildings.lagerkomplex = 1; } });
  const band = await contractBandView(engine, "stahl", 2);
  const v0 = await contractsView(engine, b.playerId);
  assert.ok(v0.enabled);
  const limit = v0.contractLimit;
  const qty = limit + 500;
  const p = await proposePlayerContract(engine, s.playerId, key(), { side: "sell", resource: "stahl", qty, days: 2, price: band.course });
  assert.equal(p.ok, true, JSON.stringify(p));
  const v = await contractsView(engine, b.playerId);
  assert.ok(v.enabled);
  const offer = v.proposals.find((x) => x.id === (p as { contractId: number }).contractId)!;
  assert.equal(offer.overLimit, true);
  assert.ok(offer.room <= limit && offer.room >= limit - 1, `room ${offer.room} ≈ ${limit}`);
  // TST-02: Partner bekannt – Strecken wie gebucht (Geleit vom Hafen des Käufers zum Verkäufer).
  assert.ok(offer.route);
  assert.equal(offer.route!.escortKm, Math.round(Math.max(hexDistanceKm(b, s), seaRoute(b, s).km)));
  assert.ok(v.partnerKm !== null && v.partnerKm! > 0);
  const acc = await acceptPlayerContract(engine, b.playerId, key(), offer.id);
  assert.deepEqual(acc, { ok: false, code: "contract_limit" });
});

test("TE-06: zwei Angebote aus zwei Häfen gleichzeitig überschreiten die Abschlüsse je Stunde nicht", async () => {
  const s = await player("Zweihafen");
  const second = await addSecondHarbor(db, s.playerId, { patch: (st) => { st.buildings.hafenkommandantur = 6; st.buildings.kommandozentrale = 8; } });
  const band = await contractBandView(engine, "stahl", 2);
  const offer = (baseId?: number) => proposePlayerContract(engine, s.playerId, key(), { side: "sell", resource: "stahl", qty: 600, days: 2, price: band.course, ...(baseId ? { baseId } : {}) });
  for (let i = 0; i < 2; i++) assert.equal((await offer()).ok, true);
  const both = await Promise.all([offer(), offer(second.baseId)]);
  const ok = both.filter((r) => r.ok).length;
  assert.equal(ok, 1, JSON.stringify(both));
  assert.deepEqual(both.find((r) => !r.ok), { ok: false, code: "rate" });
});

// ---------------------------------------------------------------- TST-02, M-07

test("TST-02: Geleitstrecke der Börse = gebuchte Mission; M-07: Kaufmann zählt die gezahlte Gebühr", async () => {
  const a = await player("Hamburger", { minPortKm: 150, patch: (st) => { st.units.korvette = 4; st.buildings.werft = 3; } });
  const v = await baseView(engine, a.playerId);
  const port = v.base!.market.port;
  assert.equal(port.escortKm, Math.round(Math.max(hexDistanceKm(a, port), seaRoute(a, port).km)));
  const qty = 2000;
  const q = await marketQuote(engine, { side: "buy", resource: "stahl", qty });
  assert.ok(q.ok);
  const r = await trade(engine, a.playerId, key(), { side: "buy", resource: "stahl", qty, expectedPrice: q.executionPrice, escort: { korvette: 2 } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m] = await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, a.playerId), eq(tables.mission.type, "geleit")));
  const plan = m.plan as { distanceKm: number; route?: { km: number } | null };
  assert.equal(Math.round(Math.max(plan.distanceKm, plan.route?.km ?? 0)), port.escortKm, "Anzeige = gebuchte Strecke");
  const [c] = await db.select().from(tables.achievementCounter)
    .where(and(eq(tables.achievementCounter.playerId, a.playerId), eq(tables.achievementCounter.counter, "handel_gebuehr")));
  assert.equal(Number(c?.value), Math.floor((r as unknown as { quote: { feeCredits: number } }).quote.feeCredits));
});

// ---------------------------------------------------------------- TST-09

test("TST-09: Alle abholen – eine Transaktion, Lagergrenze: volle Lager lassen Ressourcen liegen", async () => {
  const a = await player("Abholer", { patch: (st) => {
    for (const b of ["kraftwerk", "stahlwerk", "raffinerie", "versorgungshof", "kaserne", "werft"]) st.buildings[b] = 2;
  } });
  const g0 = await guideView(engine, a.playerId);
  assert.ok(g0.claimable >= 5, `claimable ${g0.claimable}`);
  // Erfolg mit Taler-Belohnung (keine Lagergrenze).
  await db.insert(tables.achievementTier).values({ playerId: a.playerId, achievementId: "kaufmann", tier: 1, reward: { credits: 100 }, unlockedAt: new Date() });
  // Lager randvoll: Ressourcen-Belohnungen würden verfallen → liegen lassen.
  await patchBase(a.baseId, (s) => { s.resources = { stahl: 1e9, treibstoff: 1e9, elektronik: 1e9, proviant: 1e9 }; });
  const r1 = await claimAllRewards(engine, a.playerId, key());
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const ok1 = r1 as Extract<typeof r1, { ok: true }>;
  assert.equal(ok1.claimed.achievements, 1);
  assert.equal(ok1.rewards.credits, 100);
  assert.ok(ok1.skipped.guide >= 5, JSON.stringify(ok1.skipped));
  assert.deepEqual(ok1.lost, {});
  // Platz im Lager: jetzt alles.
  await patchBase(a.baseId, (s) => { s.resources = { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 }; });
  const r2 = await claimAllRewards(engine, a.playerId, key());
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal((r2 as Extract<typeof r2, { ok: true }>).claimed.guide, g0.claimable);
  assert.equal((await guideView(engine, a.playerId)).claimable, 0);
  assert.deepEqual(await claimAllRewards(engine, a.playerId, key()), { ok: false, code: "nothing" });
});

// ---------------------------------------------------------------- TST-15, TX-08, TST-16

test("Lage: Beitrittsanfrage für die Führung, Anfängerschutz endet, Belohnungsquellen mit Anzahl", async () => {
  const lead = await player("Admiralin");
  const al = await createAlliance(engine, lead.playerId, { name: "Nordflotte", tag: "NRD" });
  assert.equal(al.ok, true, JSON.stringify(al));
  const [row] = await db.select({ id: tables.alliance.id }).from(tables.alliance).where(eq(tables.alliance.tag, "NRD"));
  const newbie = await player("Neuling", { patch: (s) => { s.protection.createdAtMs = Date.now() - 7 * DAY + 2 * H; } });
  assert.equal((await requestJoin(engine, newbie.playerId, row.id)).ok, true);
  const l = await lageView(engine, lead.playerId);
  const req = l.waiting.find((x) => x.kind === "beitritt");
  assert.ok(req, JSON.stringify(l.waiting.map((x) => x.kind)));
  assert.equal(req!.text, "1 Beitrittsanfrage");
  assert.match(req!.sub ?? "", /Neuling/);
  assert.ok(l.urgent.keys.includes(req!.key));
  assert.ok((await lageView(engine, lead.playerId, { brief: true })).urgent.keys.includes(req!.key), "auch im Navigationszeichen");
  assert.ok(!(await lageView(engine, newbie.playerId)).waiting.some((x) => x.kind === "beitritt"), "nur Führung/Offiziere");

  const n = await lageView(engine, newbie.playerId);
  const ende = n.soon.find((x) => x.kind === "anfaengerschutz");
  assert.ok(ende, JSON.stringify(n.soon.map((x) => x.kind)));
  assert.equal(ende!.tone, "alarm");
  assert.match(ende!.text, /Anfängerschutz endet in 1 h 5\d min|Anfängerschutz endet in 2 h 00 min/);
  assert.ok(!(await lageView(engine, lead.playerId)).soon.some((x) => x.kind === "anfaengerschutz"), "längst vorbei");

  await db.insert(tables.achievementTier).values([
    { playerId: lead.playerId, achievementId: "kaufmann", tier: 1, reward: { credits: 1 }, unlockedAt: new Date() },
    { playerId: lead.playerId, achievementId: "kaufmann", tier: 2, reward: { credits: 1 }, unlockedAt: new Date() },
  ]);
  const l2 = await lageView(engine, lead.playerId);
  const bel = l2.waiting.find((x) => x.kind === "belohnung")!;
  assert.equal(bel.text, "2 Belohnungen abholbereit (2 Erfolge)");
  assert.deepEqual(l2.urgent.rewardSources, { achievements: 2, weekly: 0 });
});

// ---------------------------------------------------------------- AN-07

test("AN-07: Routine-Pushes gebündelt (15 min), Ruhezeit im Nachtschild, Angriff sofort", async () => {
  const a = await player("Schlaefer");
  const ep = await subscribe(a.playerId);
  const now = Date.now();
  const mine = () => sentPushes.filter((p) => p.endpoint === ep);
  // Tagsüber (kein Nachtschild): Bau wird gesammelt, Bericht geht sofort.
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "build", title: "Ausbau fertig", body: "Stahlwerk 3" }, { nowMs: now }), 0);
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "build", title: "Ausbau fertig", body: "Raffinerie 2" }, { nowMs: now }), 0);
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "idle", title: "Bauschlange leer", body: "…" }, { nowMs: now }), 0);
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "report", title: "Bericht", body: "x" }, { nowMs: now }), 1);
  assert.equal((await queuedPushes(db, a.playerId)).length, 3);
  assert.equal(await flushPushes(engine, now + 5 * 60_000), 0, "noch keine 15 min");
  assert.equal(await flushPushes(engine, now + 16 * 60_000), 1);
  const bundle = mine().at(-1)!.payload;
  assert.equal(bundle.title, "3 Meldungen");
  assert.equal(bundle.body, "Ausbau fertig (2×) · Bauschlange leer");
  assert.equal((await queuedPushes(db, a.playerId)).length, 0);

  // Nachtschild läuft jetzt: Bericht wird zurückgehalten, Angriff nicht.
  const hour = new Date(now).getUTCHours();
  await patchBase(a.baseId, (s) => { s.protection.nightShieldStartHour = hour; s.protection.tzOffsetMinutes = 0; delete s.protection.timeZone; s.protection.nightShieldNext = null; });
  const before = mine().length;
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "report", title: "Nachtbericht", body: "y" }, { nowMs: now }), 0);
  assert.equal(await pushToPlayer(engine, a.playerId, { kind: "attack", title: "Angriff!", body: "z" }, { nowMs: now }), 1);
  assert.equal(await flushPushes(engine, now + 20 * 60_000), 0, "Ruhezeit");
  assert.equal(mine().length, before + 1);
  assert.equal(await flushPushes(engine, now + 9 * H), 1, "nach der Ruhezeit");
  assert.equal(mine().at(-1)!.payload.title, "Nachtbericht");
});

// ---------------------------------------------------------------- AN-06

test("AN-06: zweite Rückhol-Stufe (10–14 Tage) als Push ohne Adresse; Saisonwechsel-Nachricht einmal", async () => {
  const today = dayKey(Date.now());
  const noon = dayStartMs(today) + 12 * H;
  const w = await player("Weggeher");
  const ep = await subscribe(w.playerId);
  const mine = () => sentPushes.filter((p) => p.endpoint === ep);
  await db.update(tables.player).set({ lastSeenAt: new Date(noon - 4 * DAY) }).where(eq(tables.player.id, w.playerId));
  assert.equal(await runWinback(engine, noon), 1, "Stufe 1 als Push");
  assert.equal(await runWinback(engine, noon + H), 0, "einmal");
  await db.update(tables.player).set({ lastSeenAt: new Date(noon - 11 * DAY) }).where(eq(tables.player.id, w.playerId));
  assert.equal(await runWinback(engine, noon), 1, "Stufe 2 (10–14 Tage)");
  assert.match(mine().at(-1)!.payload.title, /Noch da, Kapitän/);
  assert.equal(mine().at(-1)!.payload.kind, "comeback");

  // Saisonwechsel: Saison hat vor einer Stunde begonnen, Spieler war seitdem nicht da.
  const [s] = await db.select().from(tables.season).where(eq(tables.season.status, "running"));
  const oldStart = s.startsAt;
  await db.update(tables.season).set({ startsAt: new Date(noon - H) }).where(eq(tables.season.id, s.id));
  try {
    const n = await runSeasonNotice(engine, noon);
    assert.ok(n >= 1);
    assert.match(mine().at(-1)!.payload.title, new RegExp(`Saison ${s.number} hat begonnen`));
    assert.equal(await runSeasonNotice(engine, noon + H), 0, "einmal je Saison");
    assert.equal(await runSeasonNotice(engine, noon - 13 * H), 0, "nachts nicht");
  } finally {
    await db.update(tables.season).set({ startsAt: oldStart }).where(eq(tables.season.id, s.id));
  }
});
