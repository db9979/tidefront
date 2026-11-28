// UX-0.43 B8/C3 gegen ein echtes PostgreSQL: neue Push-Arten (Lager fast voll, überholt, Seerat-Ergebnis) mit
// Bündelung, Ruhezeit und eigenem Schalter; „Nächster lohnender Besuch“ und „Erinnern“; Neulingspfad bis zum ersten
// Sieg (Auftrag „ausfahrt“, Zeit- und Kostenrahmen 24 h); soziale Lagezeile „Noch ohne Allianz“.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { COLS, ROWS, isCoast, isTradePortHex, nestSites } from "@tidefront/world";
import { fuelCost, gameTimeZone, storageCapacity, trainingCost, travelSeconds, upgradeCost, upgradeSeconds, type Balance, type BaseState, type ResourceMap } from "@tidefront/game-core";
import {
  balance, chooseBase, claimGuideStep, computeStandings, ensurePolitikPlan, ensureVapid, flushPushes, getSetting, GUIDE_GOALS, GUIDE_STEPS, guideView,
  lageRemind, lageReminder, lageView, overtaker, pickVisit, POLITIK_HANDLERS, pushSetPrefs, pushSubscribe, pushToPlayer, queuedPushes, register,
  REMIND_TYPE, runOvertakenPushes, runningSeason, runStoragePushes, seed, setPushSender, setQuietHours, setSetting, START_NEST_KM, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {}, push: () => {} };
const bal = balance as unknown as Balance;
let keyN = 0;
const key = () => `uxw-${++keyN}-${Date.now()}`;
const used = new Set<string>();
const sent: { endpoint: string; payload: { title: string; body: string; kind: string } }[] = [];

function coast(): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 14; row < ROWS - 10; row++) for (let col = 10; col < COLS - 10; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || isTradePortHex(col, row) || nests.has(k) || used.has(k)) continue;
    if ([...used].some((u) => { const [c, r] = u.split(",").map(Number); return Math.abs(c - col) + Math.abs(r - row) < 4; })) continue;
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

async function player(name: string) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...coast(), name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId };
}

async function subscribe(playerId: number): Promise<string> {
  const endpoint = `https://push.test/uxw-${playerId}-${Date.now()}`;
  await pushSubscribe(db, playerId, { endpoint, keys: { p256dh: "p", auth: "a" } });
  await setQuietHours(db, playerId, { on: false, fromMin: 23 * 60, toMin: 7 * 60 }); // Uhrzeit-unabhängig
  return endpoint;
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
  await ensureVapid(db);
  setPushSender(async (s, payload) => { sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }); });
});

after(async () => {
  setPushSender(null);
  await client.end();
});

test("Lager fast voll: gebündelt, je Rohstoff einmal am Tag, eigener Schalter, Ruhezeit", async () => {
  const a = await player("Speicher");
  const ep = await subscribe(a.playerId);
  const now = Date.now();
  let cap = 0;
  await patchBase(a.baseId, (s) => { cap = storageCapacity(s, bal); s.resources.stahl = Math.ceil(cap * 0.95); s.resUpdatedAt = now; });
  assert.ok(await runStoragePushes(engine, now) >= 1);
  let q = (await queuedPushes(db, a.playerId)).filter((x) => x.kind === "storage");
  assert.equal(q.length, 1, "Routinemeldung: gesammelt (15-min-Bündel)");
  assert.match(q[0].body, /Stahl 9\d %/);
  await runStoragePushes(engine, now + 10 * 60_000);
  assert.equal((await queuedPushes(db, a.playerId)).filter((x) => x.kind === "storage").length, 1, "Stahl heute nicht noch einmal");
  // Treibstoff kommt dazu: neue Meldung nur für Treibstoff.
  await patchBase(a.baseId, (s) => { s.resources.treibstoff = Math.ceil(cap * 0.97); s.resUpdatedAt = now; });
  await runStoragePushes(engine, now + 11 * 60_000);
  q = (await queuedPushes(db, a.playerId)).filter((x) => x.kind === "storage");
  assert.equal(q.length, 2);
  assert.doesNotMatch(q[1].body, /Stahl/);
  assert.equal(await flushPushes(engine, now + 30 * 60_000), 1);
  const last = sent.filter((p) => p.endpoint === ep).at(-1)!.payload;
  assert.equal(last.title, "2 Meldungen");
  assert.match(last.body, /Lager fast voll \(2×\)/);
  // Schalter aus: nichts mehr (der Tagesmerker wird trotzdem gesetzt).
  await pushSetPrefs(db, a.playerId, ep, { storage: false });
  await patchBase(a.baseId, (s) => { s.resources.elektronik = Math.ceil(cap * 0.99); s.resUpdatedAt = now; });
  await runStoragePushes(engine, now + 40 * 60_000);
  assert.equal((await queuedPushes(db, a.playerId)).length, 0, "abgeschaltet");
  const mark = JSON.parse((await getSetting(db, `push_storage:${a.playerId}`))!);
  assert.deepEqual([...mark.res].sort(), ["elektronik", "stahl", "treibstoff"]);
});

test("Du wurdest überholt: wer vorbeizog, höchstens einmal am Tag, gebündelt", async () => {
  // Rein: nur wer vorher dahinter lag und jetzt davor steht.
  const now3 = [{ playerId: 1, rank: 1, name: "Albers" }, { playerId: 2, rank: 2, name: "Ich" }, { playerId: 3, rank: 3, name: "Cord" }];
  assert.deepEqual(overtaker(2, { 1: 2, 2: 1, 3: 3 }, now3), { name: "Albers", rank: 2, total: 3 });
  assert.equal(overtaker(2, { 1: 1, 2: 2, 3: 3 }, now3), null, "nicht verschlechtert");
  assert.equal(overtaker(3, { 1: 1, 2: 2 }, now3), null, "vorher ohne Rang");

  const x = await player("Vorne");
  const y = await player("Hinten");
  await patchBase(x.baseId, (s) => { Object.assign(s.buildings, { stahlwerk: 12, raffinerie: 12, kraftwerk: 12, kommandozentrale: 10 }); });
  const epX = await subscribe(x.playerId);
  const epY = await subscribe(y.playerId);
  const s = (await runningSeason(db))!;
  const now = Date.now();
  const st = await computeStandings(db, s.startsAt.getTime(), now);
  const rx = st.find((r) => r.playerId === x.playerId)!.rank, ry = st.find((r) => r.playerId === y.playerId)!.rank;
  assert.ok(rx < ry, `${rx} < ${ry}`);
  // Vorher lag „Hinten“ vor „Vorne“: „Hinten“ wurde überholt.
  const ranks = Object.fromEntries(st.map((r) => [String(r.playerId), r.rank]));
  ranks[String(y.playerId)] = rx;
  ranks[String(x.playerId)] = ry;
  await setSetting(db, "push_rank", JSON.stringify({ seasonId: s.id, atMs: now - 2 * H, ranks, told: {} }));
  assert.equal(await runOvertakenPushes(engine, now), 1);
  const q = (await queuedPushes(db, y.playerId)).filter((p) => p.kind === "overtaken");
  assert.equal(q.length, 1);
  assert.match(q[0].body, /Vorne hat dich überholt – du stehst jetzt auf Platz \d+ von \d+/);
  assert.equal((await queuedPushes(db, x.playerId)).length, 0);
  assert.equal(await runOvertakenPushes(engine, now + 5 * 60_000), 0, "höchstens stündlich gerechnet");
  // Gleiches Spiel am selben Tag noch einmal: kein zweiter Push.
  await setSetting(db, "push_rank", JSON.stringify({ seasonId: s.id, atMs: now - 2 * H, ranks, told: JSON.parse((await getSetting(db, "push_rank"))!).told }));
  assert.equal(await runOvertakenPushes(engine, now + 10 * 60_000), 0, "1× am Tag");
  assert.equal(await flushPushes(engine, now + 20 * 60_000) >= 1, true);
  assert.equal(sent.filter((p) => p.endpoint === epY).at(-1)!.payload.title, "Du wurdest überholt");
  assert.equal(sent.some((p) => p.endpoint === epX), false);
});

test("Seerat-Ergebnis: Push an Spieler mit Hafen, eigener Schalter, sofort tagsüber, in der Ruhezeit gesammelt", async () => {
  const c = await player("Ratsherr");
  const ep = await subscribe(c.playerId);
  const now = Date.now();
  await ensurePolitikPlan(db, now);
  const [sz] = await db.select().from(tables.seeratSitzung).limit(1);
  assert.ok(sz, "Sitzung geplant");
  const res = await db.transaction((tx) => POLITIK_HANDLERS.seerat_close(tx, { id: 0, type: "seerat_close", payload: { sitzungId: sz.id }, baseId: null } as never, now));
  const mine = (res.push ?? []).find((j) => j.playerId === c.playerId);
  assert.ok(mine, "Push-Auftrag für den Spieler");
  assert.equal(mine.notice.kind, "council");
  assert.match(mine.notice.title, /^Seerat: /);
  // Tagsüber sofort (kein Bündel), mit Schalter aus gar nicht, in der Ruhezeit gesammelt.
  assert.equal(await pushToPlayer(engine, c.playerId, mine.notice, { nowMs: now }), 1);
  assert.equal(sent.filter((p) => p.endpoint === ep).at(-1)!.payload.kind, "council");
  await pushSetPrefs(db, c.playerId, ep, { council: false });
  assert.equal(await pushToPlayer(engine, c.playerId, mine.notice, { nowMs: now }), 0);
  assert.equal((await queuedPushes(db, c.playerId)).length, 0, "abgeschaltet: auch nicht gesammelt");
  await pushSetPrefs(db, c.playerId, ep, {});
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: gameTimeZone(), hour: "2-digit", hourCycle: "h23" }).format(now));
  await setQuietHours(db, c.playerId, { on: true, fromMin: hour * 60, toMin: ((hour + 2) % 24) * 60 }); // läuft jetzt
  assert.equal(await pushToPlayer(engine, c.playerId, mine.notice, { nowMs: now }), 0);
  assert.equal((await queuedPushes(db, c.playerId)).filter((p) => p.kind === "council").length, 1);
});

test("Nächster lohnender Besuch und Erinnern", async () => {
  const now = Date.now();
  // Rein: frühester Anlass, Anlässe in 20 min zusammen, nichts unter 1 min oder über 36 h.
  const v = pickVisit([{ atMs: now + 30_000, text: "zu früh" }, { atMs: now + 2 * H, text: "Bauhof frei" }, { atMs: now + 2 * H + 10 * 60_000, text: "Verband zurück" }, { atMs: now + 5 * H, text: "Lager voll (Stahl)" }], now);
  assert.deepEqual(v, { atMs: now + 2 * H, reasons: ["Bauhof frei", "Verband zurück"] });
  assert.equal(pickVisit([{ atMs: now + 40 * H, text: "weit" }], now), null);

  const d = await player("Besucher");
  await patchBase(d.baseId, (s) => { s.buildQueue = [{ buildingId: "stahlwerk", targetLevel: 2, startedAt: now, finishesAt: now + H } as never]; });
  const l = await lageView(engine, d.playerId);
  assert.ok(l.visit, "Besuch vorgeschlagen");
  assert.ok(l.visit.atMs <= now + H + 1000);
  assert.ok(l.visit.reasons.includes("Bauhof frei"), JSON.stringify(l.visit));

  assert.deepEqual(await lageRemind(engine, d.playerId, { atMs: now + 10_000, text: "x" }, now), { ok: false, code: "bad_time" });
  assert.deepEqual(await lageRemind(engine, d.playerId, { atMs: now + H, text: "   " }, now), { ok: false, code: "bad_text" });
  assert.equal((await lageRemind(engine, d.playerId, { atMs: now + H, text: "Bauhof frei – 14:00 Uhr" }, now)).ok, true);
  assert.equal((await lageRemind(engine, d.playerId, { atMs: now + 2 * H, text: "Verband zurück" }, now)).ok, true);
  const r = await lageReminder(db, d.playerId);
  assert.deepEqual(r, { atMs: now + 2 * H, text: "Verband zurück" }, "neue Erinnerung ersetzt die alte");
  const evs = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.type, REMIND_TYPE));
  assert.equal(evs.filter((e) => e.status === "pending" && (e.payload as { playerId: number }).playerId === d.playerId).length, 1);
});

test("Neulingspfad: „Überfall losschicken“ vor „Nest überfallen“, jeder Schritt belohnt, erster Sieg in 24 h machbar", async () => {
  const ids = GUIDE_STEPS.map((s) => s.id);
  assert.ok(ids.indexOf("ausfahrt") === ids.indexOf("nest") - 1, ids.join(","));
  const steps = (balance as unknown as { guide: { steps: Record<string, ResourceMap> } }).guide.steps;
  for (const id of ids) assert.ok(Object.values(steps[id] ?? {}).some((v) => v > 0), `${id}: Belohnung`);

  const n = await player("Neuling");
  let g = await guideView(engine, n.playerId);
  assert.equal(g.steps.find((s) => s.id === "ausfahrt")?.done, false);
  assert.ok(g.nestTarget, "Start-Nest bekannt");
  await db.insert(tables.mission).values({
    playerId: n.playerId, baseId: n.baseId, type: "ueberfall", status: "outbound", targetKind: "nest", targetId: g.nestTarget.id,
    targetCol: g.nestTarget.col, targetRow: g.nestTarget.row, arriveAt: new Date(Date.now() + H), plan: {},
  } as never);
  g = await guideView(engine, n.playerId);
  assert.equal(g.steps.find((s) => s.id === "ausfahrt")?.claimable, true);
  assert.equal(g.steps.find((s) => s.id === "nest")?.done, false, "erst der Sieg erfüllt den Nest-Auftrag");
  assert.equal((await claimGuideStep(engine, n.playerId, key(), "ausfahrt")).ok, true);

  // Zeitrahmen bis zum ersten Sieg: Gebäude Stufe 1 nacheinander, Kaserne und Werft parallel, Fahrt zum Start-Nest.
  const path = ["kraftwerk", "stahlwerk", "raffinerie", "versorgungshof", "kommandozentrale", "kaserne", "werft"];
  const buildS = path.reduce((s, id) => s + upgradeSeconds(id, 1, bal), 0);
  const fleet = { schuetzen: GUIDE_GOALS.schuetzen, korvette: GUIDE_GOALS.korvette, landungsschiff: GUIDE_GOALS.landungsschiff };
  const trainS = Math.max(GUIDE_GOALS.schuetzen * (bal.units.schuetzen.seconds ?? 0), GUIDE_GOALS.korvette * (bal.units.korvette.seconds ?? 0) + (bal.units.landungsschiff.seconds ?? 0));
  const travelS = travelSeconds(fleet, START_NEST_KM, bal)!;
  assert.ok(buildS + trainS + travelS < 12 * 3600, `${Math.round((buildS + trainS + travelS) / 60)} min – weit unter 24 h`);
  // Kosten bis zum Sieg: Start + Belohnungen der Aufträge davor + 12 h Grundproduktion decken alles (auch Treibstoff hin und zurück).
  const need: ResourceMap = {};
  const add = (m: ResourceMap) => { for (const [r, v] of Object.entries(m)) need[r] = (need[r] ?? 0) + (v ?? 0); };
  for (const id of path) add(upgradeCost(id, 1, bal));
  for (const [id, c] of Object.entries(fleet)) add(trainingCost(id, c, bal));
  add({ treibstoff: fuelCost(fleet, START_NEST_KM, bal) });
  const have: ResourceMap = { ...(bal as unknown as { start: ResourceMap }).start };
  for (const id of ids.slice(0, ids.indexOf("nest"))) for (const [r, v] of Object.entries(steps[id])) have[r] = (have[r] ?? 0) + v;
  const basePerHour = (bal as unknown as { baseTricklePerHour?: ResourceMap }).baseTricklePerHour ?? {};
  for (const [r, v] of Object.entries(need)) {
    const got = (have[r] ?? 0) + 12 * (basePerHour[r] ?? 0);
    assert.ok(got >= v, `${r}: braucht ${Math.round(v)}, hat ${Math.round(got)}`);
  }
});

test("Soziale Lagezeile: ohne Allianz ein ruhiger Hinweis, nicht dringend", async () => {
  const p = await player("Einzelgaenger");
  const l = await lageView(engine, p.playerId);
  const row = l.waiting.find((r) => r.kind === "allianz-hinweis");
  assert.ok(row, JSON.stringify(l.waiting.map((r) => r.kind)));
  assert.equal(row.urgent, false);
  assert.deepEqual(row.jump, { to: "alliance" });
  assert.ok(!(await lageView(engine, p.playerId, { brief: true })).urgent.keys.includes("ohne-allianz"));
});
