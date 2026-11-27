// Integrationstests Allianzen, Diplomatie und Handel zwischen Spielern gegen ein echtes PostgreSQL (wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS, isTradePortHex } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  acceptOffer,
  acceptPact,
  acceptRequest,
  allianceChatList,
  allianceDirectory,
  allianceView,
  atWar,
  auditLedger,
  cancelPact,
  chooseBase,
  clearRankingCache,
  clearTradeStatsCache,
  createAlliance,
  createOffer,
  declareWar,
  diplomacyView,
  dissolveAlliance,
  GameError,
  invitePlayer,
  kickMember,
  launchMission,
  leaveAlliance,
  makePeace,
  mapView,
  missionPreview,
  playerTradeStats,
  offersView,
  processDue,
  proposePact,
  register,
  requestJoin,
  runningSeason,
  seasonEnd,
  seed,
  sendAllianceChat,
  setAllianceMaxSize,
  setMemberRole,
  trade,
  WAR_LEAD_MS,
  withdrawOffer,
  type Engine,
} from "../src/index.ts";
import { addSecondHarbor } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const notes: [number[] | null, string][] = [];
const engine: Engine = { db, notify: (ids, kind) => notes.push([ids, kind]), log: () => {} };
let keyN = 0;
const key = () => `a${++keyN}-${Date.now()}`;
const HOUR = 3600000;

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

/** Angriffsbereit: Verband daheim, Treibstoff, Börse offen, kein Anfängerschutz. */
async function ready(p: P) {
  await patchBase(p.baseId, (s) => {
    s.units = { korvette: 2, landungsschiff: 1, schuetzen: 50 };
    s.resources = { ...s.resources, stahl: 20000, treibstoff: 50000, elektronik: 5000, proviant: 50000 };
    s.buildings.hafenkommandantur = 4;
    s.protection.createdAtMs = 0;
  });
}

const attack = (from: P, to: P) =>
  launchMission(engine, from.playerId, key(), { type: "ueberfall", units: { korvette: 1, landungsschiff: 1, schuetzen: 50 }, col: to.col, row: to.row });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof GameError) return err.code;
    throw err;
  }
}

let A: P, B: P, C: P, D: P, E: P, F: P;
let allianceId = 0;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  A = await newPlayer("Anker", 6);
  B = await newPlayer("Boje", 8);
  C = await newPlayer("Kompass", 14);
  D = await newPlayer("Dalbe", 16);
  E = await newPlayer("Ebbe", 20);
  F = await newPlayer("Flut", 22);
  for (const p of [A, B, C, D, E, F]) await ready(p);
});

after(async () => {
  await client.end();
});

test("Allianz: gründen, anfragen, einladen, Rechte, Rollen, Höchstgröße", async () => {
  assert.equal(await code(createAlliance(engine, A.playerId, { name: "Nordbund", tag: "N" })), "bad_tag");
  const r = await createAlliance(engine, A.playerId, { name: "Nordbund", tag: "NB", description: "Wir halten die Nordsee." });
  allianceId = r.allianceId;
  assert.equal(await code(createAlliance(engine, D.playerId, { name: "nordbund", tag: "XY" })), "name_taken");
  assert.equal(await code(createAlliance(engine, D.playerId, { name: "Südbund", tag: "nb" })), "tag_taken");
  assert.equal(await code(createAlliance(engine, A.playerId, { name: "Zweitbund", tag: "ZB" })), "in_alliance");

  // B fragt an; erst die Führung nimmt an.
  assert.deepEqual(await requestJoin(engine, B.playerId, allianceId), { ok: true, joined: false });
  assert.equal(await code(requestJoin(engine, B.playerId, allianceId)), "already_requested");
  const req = (await allianceView(engine, A.playerId)).requests.find((x) => x.player.id === B.playerId)!;
  assert.equal(await code(acceptRequest(engine, C.playerId, req.id)), "no_rights");
  await acceptRequest(engine, A.playerId, req.id);
  // Einfaches Mitglied darf nicht einladen.
  assert.equal(await code(invitePlayer(engine, B.playerId, C.playerId)), "no_rights");
  await setMemberRole(engine, A.playerId, B.playerId, "offizier");
  assert.deepEqual(await invitePlayer(engine, B.playerId, C.playerId), { ok: true, joined: false });
  const inv = (await allianceView(engine, C.playerId)).invitations[0];
  assert.equal(inv.kind, "einladung");
  await acceptRequest(engine, C.playerId, inv.id);
  const v = await allianceView(engine, A.playerId);
  assert.equal(v.alliance?.members.length, 3);
  assert.deepEqual(v.alliance?.members.map((m) => m.role), ["fuehrung", "offizier", "mitglied"]);
  // Offizier schließt Mitglied aus, nicht aber die Führung.
  assert.equal(await code(kickMember(engine, B.playerId, A.playerId)), "no_rights");
  await kickMember(engine, B.playerId, C.playerId);
  // Höchstgröße 2: C kommt nicht mehr hinein.
  await setAllianceMaxSize(engine, 2);
  await invitePlayer(engine, A.playerId, C.playerId);
  const inv2 = (await allianceView(engine, C.playerId)).invitations[0];
  assert.equal(await code(acceptRequest(engine, C.playerId, inv2.id)), "alliance_full");
  await setAllianceMaxSize(engine, 8);
  await acceptRequest(engine, C.playerId, inv2.id);
  // Systemnachrichten gingen an die Betroffenen.
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, C.playerId));
  assert.ok(msgs.some((m) => m.subject === "Allianz: Einladung") && msgs.some((m) => m.subject === "Allianz: ausgeschlossen"));
  // Verzeichnis: Kürzel je Spieler, Allianzwertung = Summe der Mitgliederpunkte.
  clearRankingCache();
  const dir = await allianceDirectory(engine, A.playerId);
  assert.equal(dir.players[B.playerId].tag, "NB");
  assert.equal(dir.relations[B.playerId], "verbuendet");
  assert.equal(dir.alliances[0].members, 3);
  assert.ok(dir.alliances[0].total > 0);
});

test("Allianz-Chat: nur Mitglieder, Echtzeitmeldung alliance an alle Mitglieder", async () => {
  notes.length = 0;
  await sendAllianceChat(engine, B.playerId, "  Ahoi zusammen!  ");
  assert.ok(notes.some(([ids, k]) => k === "alliance" && ids?.includes(A.playerId) && ids.includes(C.playerId)));
  const chat = await allianceChatList(engine, A.playerId);
  assert.equal(chat.at(-1)?.body, "Ahoi zusammen!");
  assert.equal(chat.at(-1)?.name, "Boje");
  assert.equal(await code(sendAllianceChat(engine, D.playerId, "hallo")), "no_alliance");
  assert.equal(await code(sendAllianceChat(engine, A.playerId, "   ")), "empty");
  assert.deepEqual(await allianceChatList(engine, D.playerId), []);
});

async function preview(from: P, to: P, type = "ueberfall"): Promise<string> {
  const r = await missionPreview(engine, from.playerId, { type, units: { korvette: 1, landungsschiff: 1, schuetzen: 50 }, col: to.col, row: to.row });
  return r.ok ? "ok" : r.code;
}

test("Überfall auf Verbündete wird abgelehnt (ally)", async () => {
  assert.deepEqual(await attack(A, B), { ok: false, code: "ally" });
  assert.deepEqual(await attack(C, A), { ok: false, code: "ally" });
  // Schon die Vorschau nennt den Grund; Aufklärung bleibt erlaubt, der eigene Hafen nicht.
  assert.equal(await preview(A, B), "ally");
  assert.equal(await preview(A, B, "aufklaerung"), "ok");
  assert.equal(await preview(A, A, "transport"), "own_base");
});

test("Nichtangriffspakt: beide bestätigen, Überfälle abgelehnt (pact), Kündigung mit 24 h Frist", async () => {
  // Mitglied darf nicht für die Allianz handeln.
  assert.equal(await code(proposePact(engine, C.playerId, `p:${D.playerId}`)), "no_rights");
  assert.deepEqual(await proposePact(engine, D.playerId, `a:${allianceId}`), { ok: true, active: false });
  // Angebot gilt noch nicht als Pakt.
  const dir0 = await allianceDirectory(engine, A.playerId);
  assert.equal(dir0.relations[D.playerId], "pakt_angeboten");
  assert.equal(await code(proposePact(engine, D.playerId, `a:${allianceId}`)), "already_offered");
  const offer = (await diplomacyView(engine, A.playerId)).treaties.find((t) => t.kind === "pakt")!;
  assert.equal(offer.byUs, false);
  await acceptPact(engine, B.playerId, offer.id);
  assert.deepEqual(await attack(D, A), { ok: false, code: "pact" });
  assert.deepEqual(await attack(B, D), { ok: false, code: "pact" });
  assert.equal(await preview(D, A), "pact");
  assert.equal(await code(declareWar(engine, A.playerId, `p:${D.playerId}`)), "pact_active");
  // Kündigung: gilt noch 24 h.
  const c = await cancelPact(engine, D.playerId, offer.id);
  assert.ok(c.endsAtMs > Date.now() + 23 * HOUR);
  assert.equal(await code(cancelPact(engine, D.playerId, offer.id)), "already_cancelled");
  assert.deepEqual(await attack(D, A), { ok: false, code: "pact" });
  assert.equal((await allianceDirectory(engine, D.playerId)).relations[A.playerId], "pakt_gekuendigt");
  const msgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, A.playerId));
  assert.ok(msgs.some((m) => m.subject === "Diplomatie: Pakt gekündigt"));
  // Frist abgelaufen: der Pakt ist weg, der Überfall wird nicht mehr wegen pact abgelehnt.
  await db.update(tables.diplomacy).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(tables.diplomacy.id, offer.id));
  assert.equal((await diplomacyView(engine, D.playerId)).treaties.length, 0);
  // Erlöschen wird beiden Seiten genau einmal gemeldet (auch bei weiteren Zugriffen und dem geplanten Ereignis).
  const [ev] = await db.select().from(tables.gameEvent).where(eq(tables.gameEvent.type, "pact_expire"));
  assert.ok(ev, "Ablauf ist als Ereignis geplant");
  await diplomacyView(engine, A.playerId);
  await allianceDirectory(engine, B.playerId);
  const { HANDLERS } = await import("../src/handlers.ts");
  await db.transaction((tx) => HANDLERS.pact_expire(tx, { ...ev, payload: ev.payload as Record<string, unknown> }, ev.dueAt.getTime() + 1));
  for (const pid of [A.playerId, B.playerId, D.playerId]) {
    const gone = (await db.select().from(tables.message).where(eq(tables.message.toPlayerId, pid))).filter((m) => m.subject === "Diplomatie: Pakt erloschen");
    assert.equal(gone.length, 1, `Nachricht an ${pid}`);
    assert.match(gone[0].body, /erloschen/);
  }
  const r = await attack(D, A);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("Krieg mit 12 h Vorlauf; im Krieg entfällt die Schwachziel-Kürzung", async () => {
  const w = await declareWar(engine, E.playerId, `p:${F.playerId}`);
  assert.ok(Math.abs(w.activeFromMs - (Date.now() + WAR_LEAD_MS)) < 5000);
  assert.equal(await code(declareWar(engine, F.playerId, `p:${E.playerId}`)), "already_war");
  assert.equal(await code(proposePact(engine, F.playerId, `p:${E.playerId}`)), "at_war");
  assert.equal(await atWar(db, E.playerId, F.playerId, Date.now()), false);
  assert.equal(await atWar(db, F.playerId, E.playerId, w.activeFromMs + 1), true);
  assert.equal((await allianceDirectory(engine, F.playerId)).relations[E.playerId], "krieg_angekuendigt");
  const fMsgs = await db.select().from(tables.message).where(eq(tables.message.toPlayerId, F.playerId));
  assert.ok(fMsgs.some((m) => m.subject === "Diplomatie: Kriegserklärung"));

  // E ist viel stärker als F (Schwachziel). Vor Kriegsbeginn: weakTarget true; im Krieg: false.
  await patchBase(E.baseId, (s) => { s.buildings = { ...s.buildings, kommandozentrale: 20, stahlwerk: 20, raffinerie: 20, kraftwerk: 20 }; });
  await patchBase(F.baseId, (s) => { s.units = {}; s.defenses = {}; });
  const runAttack = async () => {
    const m = await attack(E, F);
    assert.equal(m.ok, true, JSON.stringify(m));
    const [row] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
    await processDue(engine, row.arriveAt.getTime() + 1);
    const [done] = await db.select().from(tables.mission).where(eq(tables.mission.id, row.id));
    const [rep] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, done.reportId!));
    await processDue(engine, done.returnAt!.getTime() + 1);
    await patchBase(F.baseId, (s) => { s.protection.defeatShieldUntilMs = 0; s.protection.nightShieldStartHour = null; });
    await patchBase(E.baseId, (s) => { s.units = { korvette: 2, landungsschiff: 1, schuetzen: 50 }; s.protection.nightShieldStartHour = null; });
    return (rep.report as { attacker: { weakTarget?: boolean } }).attacker.weakTarget;
  };
  assert.equal(await runAttack(), true, "vor Kriegsbeginn gilt die Schwachziel-Regel");
  await db.update(tables.diplomacy).set({ activeFrom: new Date(Date.now() - 1000) }).where(eq(tables.diplomacy.kind, "krieg"));
  assert.equal(await runAttack(), false, "im Krieg entfällt die Schwachziel-Kürzung");

  // Frieden: F bietet an, E nimmt an.
  const war = (await diplomacyView(engine, F.playerId)).treaties[0];
  assert.deepEqual(await makePeace(engine, F.playerId, war.id), { ok: true, ended: false });
  assert.equal(await code(makePeace(engine, F.playerId, war.id)), "already_offered");
  assert.deepEqual(await makePeace(engine, E.playerId, war.id), { ok: true, ended: true });
  assert.equal(await atWar(db, E.playerId, F.playerId, Date.now() + 2 * WAR_LEAD_MS), false);
});

test("Kartenansicht: Freund/Feind aus Sicht des Betrachters (Allianz, Pakt, Krieg, neutral)", async () => {
  const ally = `a:${allianceId}`;
  const rows = await db.insert(tables.diplomacy).values([
    { partyA: ally, partyB: `p:${E.playerId}`, kind: "pakt", status: "aktiv", proposedBy: ally },
    { partyA: ally, partyB: `p:${F.playerId}`, kind: "krieg", status: "aktiv", proposedBy: ally, activeFrom: new Date(Date.now() + WAR_LEAD_MS) },
    // Nur angeboten: zählt nicht als Pakt.
    { partyA: ally, partyB: `p:${D.playerId}`, kind: "pakt", status: "angeboten", proposedBy: ally },
  ]).returning({ id: tables.diplomacy.id });
  const rel = async (viewer: P) =>
    Object.fromEntries((await mapView(engine, viewer.playerId)).bases.map((b) => [b.id, b.relation]));
  const a = await rel(A);
  assert.equal(a[A.baseId], "own");
  assert.equal(a[B.baseId], "allianz");
  assert.equal(a[C.baseId], "allianz");
  assert.equal(a[D.baseId], "neutral");
  assert.equal(a[E.baseId], "pakt");
  assert.equal(a[F.baseId], "krieg", "erklärter Krieg zählt schon im Vorlauf");
  // Gegenseite sieht die ganze Allianz; Dritte sehen nur ihre eigenen Verträge.
  const f = await rel(F);
  assert.deepEqual([f[A.baseId], f[B.baseId], f[C.baseId], f[E.baseId]], ["krieg", "krieg", "krieg", "neutral"]);
  const d = await rel(D);
  assert.deepEqual([d[A.baseId], d[E.baseId], d[F.baseId]], ["neutral", "neutral", "neutral"]);
  for (const r of rows) await db.delete(tables.diplomacy).where(eq(tables.diplomacy.id, r.id));
});

test("Handel: Treuhand, Annahme, Lieferung mit Reisezeit, Rückzug, Prüflauf ok", async () => {
  const stahl0 = (await stateOf(E.baseId)).resources.stahl;
  const o = await createOffer(engine, E.playerId, key(), { give: "stahl", giveQty: 1000, want: "elektronik", wantQty: 200, visibility: "public" });
  assert.equal(o.ok, true, JSON.stringify(o));
  const offerId = (o as { offerId: number }).offerId;
  assert.ok((await stateOf(E.baseId)).resources.stahl <= stahl0 - 1000 + 5);
  assert.equal((await auditLedger(engine)).ok, true);
  assert.deepEqual(await createOffer(engine, E.playerId, key(), { give: "stahl", giveQty: 10_000_000, want: "proviant", wantQty: 1, visibility: "public" }), { ok: false, code: "funds" });
  assert.deepEqual(await acceptOffer(engine, E.playerId, key(), offerId), { ok: false, code: "own_offer" });

  const elek0 = (await stateOf(F.baseId)).resources.elektronik;
  const acc = await acceptOffer(engine, F.playerId, key(), offerId);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  assert.ok((await stateOf(F.baseId)).resources.elektronik <= elek0 - 200 + 5);
  const dels = await db.select().from(tables.delivery).where(sql`${tables.delivery.id} like ${`po-${offerId}-%`}`);
  assert.equal(dels.length, 2);
  const toF = dels.find((d) => d.playerId === F.playerId)!;
  const toE = dels.find((d) => d.playerId === E.playerId)!;
  assert.deepEqual([toF.resource, toF.qty, toE.resource, toE.qty], ["stahl", 980, "elektronik", 196]);
  assert.ok(toF.arriveAt.getTime() > Date.now() + 60000);
  assert.equal((await auditLedger(engine)).ok, true);
  assert.deepEqual(await acceptOffer(engine, F.playerId, key(), offerId), { ok: false, code: "offer_gone" });
  const stahlF = (await stateOf(F.baseId)).resources.stahl;
  await processDue(engine, toF.arriveAt.getTime() + 1);
  assert.ok((await stateOf(F.baseId)).resources.stahl >= stahlF + 980);
  assert.equal((await auditLedger(engine)).ok, true);

  // Taler: erst an der Börse verkaufen, dann Taler anbieten und zurückziehen.
  const sold = await trade(engine, E.playerId, key(), { side: "sell", resource: "stahl", qty: 500, expectedPrice: 0.99875 });
  assert.equal(sold.ok, true, JSON.stringify(sold));
  const credits = async () => ((await db.select().from(tables.player).where(eq(tables.player.id, E.playerId)))[0].trader as { credits: number }).credits;
  const c0 = await credits();
  const co = await createOffer(engine, E.playerId, key(), { give: "credits", giveQty: 100, want: "proviant", wantQty: 50, visibility: "public" });
  assert.equal(co.ok, true, JSON.stringify(co));
  assert.equal(await credits(), Math.round((c0 - 100) * 100) / 100);
  assert.equal((await auditLedger(engine)).ok, true);
  assert.deepEqual(await withdrawOffer(engine, F.playerId, key(), (co as { offerId: number }).offerId), { ok: false, code: "no_rights" });
  assert.deepEqual(await withdrawOffer(engine, E.playerId, key(), (co as { offerId: number }).offerId), { ok: true });
  assert.equal(await credits(), c0);
  assert.equal((await auditLedger(engine)).ok, true);

  // Ware gegen Taler: E zahlt sofort, F erhält 98 Taler sofort.
  const sell = await createOffer(engine, F.playerId, key(), { give: "proviant", giveQty: 500, want: "credits", wantQty: 100, visibility: "public" });
  assert.equal(sell.ok, true, JSON.stringify(sell));
  const before = await credits();
  const acc2 = await acceptOffer(engine, E.playerId, key(), (sell as { offerId: number }).offerId);
  assert.equal(acc2.ok, true, JSON.stringify(acc2));
  assert.equal(await credits(), Math.round((before - 100) * 100) / 100);
  assert.equal((await auditLedger(engine)).ok, true);

  // Nur für die Allianz: Außenstehende sehen und nehmen es nicht.
  const ally = await createOffer(engine, A.playerId, key(), { give: "stahl", giveQty: 100, want: "proviant", wantQty: 100, visibility: "alliance" });
  assert.equal(ally.ok, true, JSON.stringify(ally));
  const allyId = (ally as { offerId: number }).offerId;
  assert.ok(!(await offersView(engine, F.playerId)).open.some((x) => x.id === allyId));
  assert.ok((await offersView(engine, B.playerId)).open.some((x) => x.id === allyId));
  assert.deepEqual(await acceptOffer(engine, F.playerId, key(), allyId), { ok: false, code: "not_ally" });
  assert.deepEqual(await createOffer(engine, F.playerId, key(), { give: "stahl", giveQty: 1, want: "proviant", wantQty: 1, visibility: "alliance" }), { ok: false, code: "no_alliance" });
});

test("Gleichzeitigkeit: zwei Annahmen desselben Angebots, nur eine gelingt", async () => {
  const o = await createOffer(engine, D.playerId, key(), { give: "treibstoff", giveQty: 300, want: "stahl", wantQty: 300, visibility: "public" });
  assert.equal(o.ok, true, JSON.stringify(o));
  const id = (o as { offerId: number }).offerId;
  const res = await Promise.all([acceptOffer(engine, E.playerId, key(), id), acceptOffer(engine, F.playerId, key(), id), acceptOffer(engine, C.playerId, key(), id)]);
  assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
  assert.ok(res.filter((r) => !r.ok).every((r) => (r as { code: string }).code === "offer_gone"));
  const dels = await db.select().from(tables.delivery).where(sql`${tables.delivery.id} like ${`po-${id}-%`}`);
  assert.equal(dels.length, 2);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Handelsstatistik: angenommene Angebote der letzten 7 Tage je Paar, zwischengespeichert", async () => {
  clearTradeStatsCache();
  const st = await playerTradeStats(engine);
  const pair = (a: string, b: string) => st.pairs.find((p) => p.a === a && p.b === b);
  // Aus den Tests oben: Stahl 1000 gegen Elektronik 200, Proviant 500 gegen 100 Taler, Treibstoff 300 gegen Stahl 300.
  assert.deepEqual(pair("stahl", "elektronik"), { a: "stahl", b: "elektronik", count: 1, qtyA: 1000, qtyB: 200 });
  assert.deepEqual(pair("proviant", "credits"), { a: "proviant", b: "credits", count: 1, qtyA: 500, qtyB: 100 });
  // Gleiche Paare in umgekehrter Richtung werden zusammengefasst (Reihenfolge wie die Ressourcenliste).
  assert.deepEqual(pair("stahl", "treibstoff"), { a: "stahl", b: "treibstoff", count: 1, qtyA: 300, qtyB: 300 });
  assert.equal(st.pairs.length, 3);
  // Zurückgezogene und offene Angebote zählen nicht; ältere als 7 Tage auch nicht.
  const o = await createOffer(engine, C.playerId, key(), { give: "credits", giveQty: 1, want: "stahl", wantQty: 1, visibility: "public" });
  const mk = await createOffer(engine, E.playerId, key(), { give: "elektronik", giveQty: 10, want: "stahl", wantQty: 70, visibility: "public" });
  assert.equal(mk.ok, true, JSON.stringify(mk));
  const acc = await acceptOffer(engine, F.playerId, key(), (mk as { offerId: number }).offerId);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  // Noch zwischengespeichert: unverändert.
  assert.equal((await playerTradeStats(engine)).pairs.find((p) => p.a === "stahl" && p.b === "elektronik")!.count, 1);
  clearTradeStatsCache();
  assert.deepEqual((await playerTradeStats(engine)).pairs.find((p) => p.a === "stahl" && p.b === "elektronik"),
    { a: "stahl", b: "elektronik", count: 2, qtyA: 1070, qtyB: 210 });
  await db.update(tables.playerOffer).set({ closedAt: new Date(Date.now() - 8 * 24 * 3600000) })
    .where(eq(tables.playerOffer.id, (mk as { offerId: number }).offerId));
  clearTradeStatsCache();
  assert.equal((await playerTradeStats(engine)).pairs.find((p) => p.a === "stahl" && p.b === "elektronik")!.count, 1);
  if (o.ok) await withdrawOffer(engine, C.playerId, key(), (o as { offerId: number }).offerId);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Mehrere Häfen: Angebot aus dem zweiten Hafen, Annahme in den aktiven Hafen, Rückzug in den Angebotshafen", async () => {
  const market = (s: BaseState) => { s.buildings.hafenkommandantur = 4; };
  const E2 = await addSecondHarbor(db, E.playerId, { patch: market });
  const F2 = await addSecondHarbor(db, F.playerId, { patch: market });
  const eHome = (await stateOf(E.baseId)).resources.stahl;
  const o = await createOffer(engine, E.playerId, key(), { give: "stahl", giveQty: 1000, want: "proviant", wantQty: 100, visibility: "public", baseId: E2.baseId });
  assert.equal(o.ok, true, JSON.stringify(o));
  const offerId = (o as { offerId: number }).offerId;
  const [row] = await db.select().from(tables.playerOffer).where(eq(tables.playerOffer.id, offerId));
  assert.equal(row.sellerBaseId, E2.baseId);
  assert.ok((await stateOf(E2.baseId)).resources.stahl <= 50000 - 1000 + 5, "Treuhand aus dem zweiten Hafen");
  assert.ok(Math.abs((await stateOf(E.baseId)).resources.stahl - eHome) < 50, "Heimathafen unberührt");
  assert.deepEqual(await createOffer(engine, E.playerId, key(), { give: "stahl", giveQty: 1, want: "proviant", wantQty: 1, visibility: "public", baseId: F2.baseId }), { ok: false, code: "no_base" });
  assert.deepEqual(await acceptOffer(engine, F.playerId, key(), offerId, undefined, E2.baseId), { ok: false, code: "no_base" });
  const list = await offersView(engine, F.playerId, F2.baseId);
  assert.ok(list.open.find((x) => x.id === offerId)?.travelMs, "Reisezeit ab dem aktiven Hafen");
  const acc = await acceptOffer(engine, F.playerId, key(), offerId, undefined, F2.baseId);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  assert.ok((await stateOf(F2.baseId)).resources.proviant <= 50000 - 100 + 5, "Käufer zahlt aus dem aktiven Hafen");
  const dels = await db.select().from(tables.delivery).where(sql`${tables.delivery.id} like ${`po-${offerId}-%`}`);
  assert.equal(dels.find((d) => d.playerId === F.playerId)!.baseId, F2.baseId, "Ware an den Käuferhafen");
  assert.equal(dels.find((d) => d.playerId === E.playerId)!.baseId, E2.baseId, "Gegenleistung an den Angebotshafen");
  // Rückzug: Ware zurück in den Angebotshafen, auch wenn ein anderer Hafen aktiv ist.
  const w = await createOffer(engine, E.playerId, key(), { give: "treibstoff", giveQty: 500, want: "stahl", wantQty: 1, visibility: "public", baseId: E2.baseId });
  const t0 = (await stateOf(E2.baseId)).resources.treibstoff;
  assert.deepEqual(await withdrawOffer(engine, E.playerId, key(), (w as { offerId: number }).offerId), { ok: true });
  assert.ok((await stateOf(E2.baseId)).resources.treibstoff >= t0 + 500 - 5);
  assert.equal((await auditLedger(engine)).ok, true);
});

test("Verlassen, Führungswechsel und Auflösen; Saisonende: Allianz bleibt, offene Angebote verfallen", async () => {
  await leaveAlliance(engine, A.playerId);
  let v = await allianceView(engine, B.playerId);
  assert.equal(v.alliance?.members.find((m) => m.playerId === B.playerId)?.role, "fuehrung");
  assert.equal((await allianceView(engine, A.playerId)).alliance, null);
  const o = await createOffer(engine, C.playerId, key(), { give: "stahl", giveQty: 50, want: "proviant", wantQty: 50, visibility: "public" });
  assert.equal(o.ok, true, JSON.stringify(o));
  const season = (await runningSeason(db))!;
  await db.transaction((tx) => seasonEnd(tx, { id: 0, type: "season_end", dueAt: new Date(), payload: { seasonId: season.id }, baseId: null }, Date.now()));
  const [row] = await db.select().from(tables.playerOffer).where(eq(tables.playerOffer.id, (o as { offerId: number }).offerId));
  assert.equal(row.status, "expired");
  assert.equal((await auditLedger(engine)).ok, true);
  v = await allianceView(engine, B.playerId);
  assert.equal(v.alliance?.tag, "NB");
  assert.equal(await code(dissolveAlliance(engine, C.playerId)), "no_rights");
  await dissolveAlliance(engine, B.playerId);
  assert.equal((await allianceView(engine, C.playerId)).alliance, null);
  assert.equal((await db.select().from(tables.alliance)).length, 0);
});
