// Integrationstests Lücken Felder/See: Geleitabteilung gegen Kartellangriffe aufs Feld und Aufteilung auf
// gleichzeitige Ertragskonvois, Admirale für Feldmissionen und Weltereignisse, Minen auf der Rückfahrt und für
// Handelskonvois, Geleit des Anbieters im Spielerhandel (TEST_DATABASE_URL; die Datenbank wird geleert).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, hexDistanceKm, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  acceptOffer, admiralView, baseView, chooseBase, createOffer, ensureFieldPlanner, fieldAdmiralRecall, fieldRecall, fieldsView, launchMission,
  processDue, register, runningSeason, seed, setFieldEscort, spawnWorldEvent, type Engine,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const { db, client } = createDb(url ?? "postgres://invalid", 20);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `lk${++keyN}-${Date.now()}`;
const used = new Set<string>();
type Counts = Record<string, number>;

function coastNear(near: { col: number; row: number } | null, minKm = 300, maxKm = 700): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  for (let row = 20; row < ROWS; row++) for (let col = 10; col < COLS; col++) {
    const k = `${col},${row}`;
    if (!isCoast(col, row) || nests.has(k) || used.has(k)) continue;
    if (near) {
      const d = hexDistanceKm(near, { col, row });
      if (d < minKm || d > maxKm) continue;
    }
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

async function stateOf(baseId: number): Promise<BaseState> {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  return b.state as BaseState;
}

async function newPlayer(name: string, field: { col: number; row: number }) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const r = await chooseBase(engine, p.playerId, key(), { ...field, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.protection.createdAtMs = Date.now() - 30 * DAY;
    s.resources = { stahl: 500_000, treibstoff: 500_000, elektronik: 500_000, proviant: 500_000 };
    s.buildings.kommandozentrale = 15;
    s.buildings.hafenkommandantur = 10;
    s.buildings.lagerkomplex = 15;
    s.buildings.radarstation = 5;
    s.buildings.kraftwerk = 15;
    s.units = { ...s.units, zerstoerer: 30, korvette: 30 };
  });
  return { playerId: p.playerId, baseId, ...field };
}

async function runUntil(ms: number) {
  while ((await processDue(engine, ms, 500)) > 0);
}

async function missionRow(id: number) {
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  return m;
}

async function freeField(near: { col: number; row: number }) {
  const all = (await db.select().from(tables.resourceField)).filter((x) => x.ownerId === null);
  const f = all.sort((x, y) => hexDistanceKm(x, near) - hexDistanceKm(y, near))[0];
  await db.update(tables.resourceField).set({ guard: {}, guardAt: new Date(Date.now() + 30 * DAY) }).where(eq(tables.resourceField.id, f.id));
  return f;
}

async function capture(p: { playerId: number }, f: { id: number; col: number; row: number }, units: Counts, admiralId?: number) {
  const go = await launchMission(engine, p.playerId, key(), { type: "besetzen", units, col: f.col, row: f.row, fieldId: f.id, stayAll: true, ...(admiralId ? { admiralId } : {}) });
  assert.equal(go.ok, true, JSON.stringify(go));
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const [row] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.id, f.id));
  assert.equal(row.ownerId, p.playerId);
  return (go as { missionId: number }).missionId;
}

let admiralN = 0;
const NAMES = ["Graf Spee", "Hipper", "Scheer", "Lütjens", "Raeder", "Tirpitz"];
async function addAdmiral(playerId: number, baseId: number, spec = "verteidigung") {
  const [a] = await db.insert(tables.admiral).values({ playerId, baseId, name: NAMES[admiralN++ % NAMES.length], spec1: spec }).returning({ id: tables.admiral.id });
  return a.id;
}

async function admiralStatusOf(playerId: number, id: number) {
  return (await admiralView(engine, playerId))!.list.find((a) => a.id === id)!;
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
});

beforeEach(async () => {
  await db.delete(tables.gameEvent).where(sql`${tables.gameEvent.type} = 'raid_launch' or ${tables.gameEvent.type} like 'world_event%' or ${tables.gameEvent.type} = 'field_tick'`);
  await db.delete(tables.minefield);
});

after(async () => {
  await client.end();
});

test("Felder: Geleitabteilung teilt sich nach Warenwert auf gleichzeitige Ertragskonvois auf, Verluste zurückgebucht", async () => {
  const a = await newPlayer("Teiler", coastNear(null));
  assert.ok((await ensureFieldPlanner(db, Date.now())) !== undefined);
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "field_tick"));
  const f = await freeField(a);
  const gid = await capture(a, f, { zerstoerer: 2, korvette: 4 });
  assert.equal((await setFieldEscort(engine, a.playerId, key(), f.id, { korvette: 4 })).ok, true);
  const now = Date.now();
  const mk = async (stahl: number) => {
    const [c] = await db.insert(tables.convoy).values({
      kind: "feld", missionId: gid, senderId: null, recipientId: a.playerId, recipientBaseId: a.baseId, fromCol: f.col, fromRow: f.row,
      toCol: a.col, toRow: a.row, cargo: { stahl }, escort: { korvette: 4 }, departAt: new Date(now - 60000), arriveAt: new Date(now + 5 * HOUR),
    }).returning({ id: tables.convoy.id });
    return c.id;
  };
  const big = await mk(3000);
  const small = await mk(1000);
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(now), payload: { convoyId: small }, baseId: null });
  await runUntil(now + 10);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "konvoi"), eq(tables.battleReport.defenderPlayerId, a.playerId)));
  const r = rep.report as { convoy: { escort: Counts }; battle: { defender: { before: Counts; final: Counts } } };
  assert.deepEqual(r.convoy.escort, { korvette: 1 }, "kleiner Konvoi: ein Viertel der Abteilung");
  const lost = 1 - (r.battle.defender.final.korvette ?? 0);
  const g = (await missionRow(gid)).returning as Counts;
  assert.equal(g.korvette ?? 0, 4 - lost, "Verluste fehlen der Besatzung");
  const [fr] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.id, f.id));
  assert.equal((fr.escort as Counts).korvette ?? 0, 4 - lost, "und der Abteilung");
  // Der große Konvoi kämpft mit drei Vierteln (der Bestand nach den Verlusten verteilt sich neu).
  await db.insert(tables.gameEvent).values({ type: "convoy_raid", dueAt: new Date(now + 20), payload: { convoyId: big }, baseId: null });
  await runUntil(now + 30);
  const reps = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "konvoi"), eq(tables.battleReport.defenderPlayerId, a.playerId))).orderBy(desc(tables.battleReport.id));
  const esc = (reps[0].report as { convoy: { escort: Counts } }).convoy.escort.korvette ?? 0;
  assert.ok(esc >= 2 && esc <= 3, `großer Konvoi: ${esc}`);
});

test("Felder: Admiral führt den Besetzen-Verband, bleibt bei der Besatzung, verteidigt mit Geleit gegen das Kartell, kehrt heim", async () => {
  const a = await newPlayer("Feldadmiral", coastNear(null));
  await ensureFieldPlanner(db, Date.now());
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "field_tick"));
  const adm = await addAdmiral(a.playerId, a.baseId);
  const f = await freeField(a);
  const gid = await capture(a, f, { zerstoerer: 3, korvette: 3 }, adm);
  assert.equal(((await missionRow(gid)).plan as { admiralId?: number }).admiralId, adm);
  let st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "unterwegs", "bei der Besatzung gebunden");
  assert.match(st.post ?? "", /Besatzung/);
  // Ein zweiter Admiral kann die Besatzung nicht verstärken (sie hat schon einen).
  const adm2 = await addAdmiral(a.playerId, a.baseId);
  const re = await launchMission(engine, a.playerId, key(), { type: "besetzen", units: { korvette: 1 }, col: f.col, row: f.row, fieldId: f.id, admiralId: adm2 });
  assert.equal(re.ok ? "ok" : (re as { code: string }).code, "field_has_admiral");
  // Kartellangriff: ganze Besatzung inkl. Geleit kämpft, mit Admiral.
  assert.equal((await setFieldEscort(engine, a.playerId, key(), f.id, { korvette: 2 })).ok, true);
  await db.insert(tables.gameEvent).values({ type: "field_raid", dueAt: new Date(), payload: { fieldId: f.id, ownerId: a.playerId, units: { schnellboot: 2 } }, baseId: null });
  await runUntil(Date.now() + 1000);
  const [raid] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "feld"), eq(tables.battleReport.defenderPlayerId, a.playerId), sql`${tables.battleReport.attackerPlayerId} is null`));
  const rr = raid.report as { battle: { defender: { before: Counts } }; admirals?: { defender?: { name: string } } };
  assert.equal(rr.battle.defender.before.korvette, 3, "Geleit kämpft mit");
  assert.ok(rr.admirals?.defender, "Admiral der Besatzung im Bericht");
  // Rückruf: Admiral kehrt mit der Besatzung heim.
  const rc = await fieldRecall(engine, a.playerId, key(), f.id);
  assert.equal(rc.ok, true);
  st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "unterwegs");
  assert.equal(st.post, null);
  await runUntil((rc as { returnAtMs: number }).returnAtMs + 1000);
  st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "bereit");
});

test("Felder: Verstärkung bringt ihren Admiral zur Besatzung ohne Admiral", async () => {
  const a = await newPlayer("Verstaerker", coastNear(null));
  await ensureFieldPlanner(db, Date.now());
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "field_tick"));
  const f = await freeField(a);
  const gid = await capture(a, f, { zerstoerer: 2 });
  const adm = await addAdmiral(a.playerId, a.baseId, "angriff");
  const go = await launchMission(engine, a.playerId, key(), { type: "besetzen", units: { korvette: 2 }, col: f.col, row: f.row, fieldId: f.id, admiralId: adm });
  assert.equal(go.ok, true, JSON.stringify(go));
  await runUntil((go as { arriveAtMs: number }).arriveAtMs + 1000);
  const g = await missionRow(gid);
  assert.equal((g.plan as { admiralId?: number }).admiralId, adm);
  assert.equal((g.returning as Counts).korvette, 2);
  const st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "unterwegs");
  assert.match(st.post ?? "", /Besatzung/);
});

test("Felder: Admiral ohne Rückruf abziehen – fährt allein heim, Besatzung hält das Feld, kein Missionsplatz", async () => {
  const a = await newPlayer("Abzieher", coastNear(null));
  await ensureFieldPlanner(db, Date.now());
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "field_tick"));
  const adm = await addAdmiral(a.playerId, a.baseId);
  const f = await freeField(a);
  const gid = await capture(a, f, { zerstoerer: 2, korvette: 2 }, adm);
  const mine = (await fieldsView(engine, a.playerId))!.mine.find((m) => m.id === f.id)!;
  assert.equal(mine.admiral?.id, adm, "Feldansicht nennt den Admiral");
  assert.equal((await admiralStatusOf(a.playerId, adm)).postFieldId, f.id, "Admiralsansicht: abziehbar");
  const slotsBefore = (await baseView(engine, a.playerId)).base!.activeMissions;
  const unitsBefore = { ...(await stateOf(a.baseId)).units };
  const t0 = Date.now();
  const r = await fieldAdmiralRecall(engine, a.playerId, key(), f.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  const back = (r as { returnAtMs: number }).returnAtMs;
  // Seewege: das Boot fährt die Route der Besatzung zurück (schnellstes Schiff, Korvette 60 km/h).
  const route = ((await missionRow(gid)).plan as { route?: { km: number } }).route;
  const hours = Math.max(hexDistanceKm(f, a), route?.km ?? 0) / 60;
  assert.ok(Math.abs((back - t0) / HOUR - hours) < 0.05, `Fahrzeit ${(back - t0) / HOUR} h statt ${hours} h`);
  // Besatzung bleibt, ohne Admiral; das Feld gehört weiter dem Spieler.
  const g = await missionRow(gid);
  assert.equal(g.status, "stationed");
  assert.equal((g.plan as { admiralId?: number }).admiralId, undefined);
  const [fr] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.id, f.id));
  assert.equal(fr.ownerId, a.playerId);
  let st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "unterwegs");
  assert.match(st.post ?? "", /allein/);
  assert.equal(st.postFieldId, null);
  assert.equal((await baseView(engine, a.playerId)).base!.activeMissions, slotsBefore, "Heimfahrt belegt keinen Missionsplatz");
  // Zweimal geht nicht; ein anderer Admiral kann die Besatzung jetzt übernehmen.
  const again = await fieldAdmiralRecall(engine, a.playerId, key(), f.id);
  assert.equal(again.ok ? "ok" : (again as { code: string }).code, "field_no_admiral");
  const adm2 = await addAdmiral(a.playerId, a.baseId, "angriff");
  const re = await launchMission(engine, a.playerId, key(), { type: "besetzen", units: { korvette: 1 }, col: f.col, row: f.row, fieldId: f.id, admiralId: adm2 });
  assert.equal(re.ok, true, JSON.stringify(re));
  await runUntil(back + 1000);
  st = await admiralStatusOf(a.playerId, adm);
  assert.equal(st.status, "bereit", "nach der Heimfahrt bereit");
  assert.equal(st.post, null);
  const units = (await stateOf(a.baseId)).units;
  assert.equal(units.zerstoerer ?? 0, unitsBefore.zerstoerer ?? 0, "keine Schiffe mitgekommen");
  // Unbekannte Felder werden abgelehnt.
  const other = await fieldAdmiralRecall(engine, a.playerId, key(), 999999);
  assert.equal(other.ok ? "ok" : (other as { code: string }).code, "no_field");
});

test("Weltereignis: Admiral führt den Verband gegen die Großflotte (Bericht, Erfahrung, Status)", async () => {
  const a = await newPlayer("Zielhafen", coastNear(null));
  const c = await newPlayer("Jaegerin", coastNear(a, 50, 400));
  await patchBase(c.baseId, (s) => { s.units = { korvette: 4, landungsschiff: 1 }; });
  const season = await runningSeason(db);
  const ev = await db.transaction((tx) => spawnWorldEvent(tx, Date.now(), "grossflotte", season!.id, 0, a.baseId));
  assert.ok(ev, "Ereignis");
  const adm = await addAdmiral(c.playerId, c.baseId, "angriff");
  const m = await launchMission(engine, c.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 1 }, col: 0, row: 0, eventId: ev!.id, admiralId: adm });
  assert.equal(m.ok, true, JSON.stringify(m));
  const mid = (m as { missionId: number }).missionId;
  assert.equal(((await missionRow(mid)).plan as { admiralId?: number }).admiralId, adm);
  assert.equal((await admiralStatusOf(c.playerId, adm)).status, "unterwegs");
  await runUntil((m as { arriveAtMs: number }).arriveAtMs + 1000);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "weltereignis"), eq(tables.battleReport.attackerPlayerId, c.playerId)));
  assert.ok((rep.report as { admirals?: { attacker?: unknown } }).admirals?.attacker, "Admiral im Bericht");
  const [row] = await db.select().from(tables.admiral).where(eq(tables.admiral.id, adm));
  if (row) assert.equal(row.battles, 1);
});

test("Minen: Rückfahrt einer Besatzung durch ein feindliches Feld kostet Schiffe", async () => {
  const a = await newPlayer("Heimkehrer", coastNear(null));
  const b = await newPlayer("Minenleger", coastNear(a, 300, 900));
  await ensureFieldPlanner(db, Date.now());
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "field_tick"));
  const f = await freeField(a);
  await capture(a, f, { korvette: 30 });
  await db.insert(tables.minefield).values({ ownerId: b.playerId, baseId: b.baseId, col: f.col, row: f.row, strength: 150, maxStrength: 150, createdAt: new Date(), expiresAt: new Date(Date.now() + DAY) });
  const before = (await stateOf(a.baseId)).units.korvette ?? 0;
  const rc = await fieldRecall(engine, a.playerId, key(), f.id);
  assert.equal(rc.ok, true);
  await runUntil((rc as { returnAtMs: number }).returnAtMs + 1000);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "minen"), eq(tables.battleReport.attackerPlayerId, a.playerId)));
  assert.ok(rep, "Minenbericht");
  const mr = (rep.report as { mines: { leg: string; before: Counts; after: Counts } }).mines;
  assert.equal(mr.leg, "rueckfahrt");
  const lost = (mr.before.korvette ?? 0) - (mr.after.korvette ?? 0);
  assert.ok(lost > 0, "30 Korvetten verlieren in einem vollen Feld Schiffe");
  assert.equal((await stateOf(a.baseId)).units.korvette ?? 0, before + 30 - lost, "Verluste fehlen bei der Rückkehr");
  const [mf] = await db.select().from(tables.minefield).where(eq(tables.minefield.ownerId, b.playerId));
  assert.ok(!mf || mf.strength < 150, "Feld verbraucht Stärke");
});

test("Minen: Handelskonvoi verliert Ladung in einem feindlichen Feld; Lieferung und Journal stimmen", async () => {
  const a = await newPlayer("Kaeuferin", coastNear(null));
  const b = await newPlayer("Verkaeufer", coastNear(a, 150, 500));
  const c = await newPlayer("Dritter", coastNear(b, 150, 600));
  await db.insert(tables.minefield).values({ ownerId: c.playerId, baseId: c.baseId, col: b.col, row: b.row, strength: 150, maxStrength: 150, createdAt: new Date(), expiresAt: new Date(Date.now() + 3 * DAY) });
  const offer = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 10000, want: "proviant", wantQty: 10, visibility: "public" });
  assert.equal(offer.ok, true, JSON.stringify(offer));
  const acc = await acceptOffer(engine, a.playerId, key(), (offer as { offerId: number }).offerId);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  const [cv] = await db.select().from(tables.convoy).where(and(eq(tables.convoy.recipientId, a.playerId), eq(tables.convoy.kind, "handel")));
  await db.update(tables.convoy).set({ cartelAt: null }).where(eq(tables.convoy.id, cv.id));
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "convoy_raid"));
  const sent = (cv.cargo as Counts).stahl;
  await runUntil((acc as { arriveAtMs: number }).arriveAtMs + 1000);
  const [del] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, cv.deliveryId!));
  assert.equal(del.status, "delivered");
  assert.ok(del.qty < sent, `Ladung verloren: ${sent} → ${del.qty}`);
  const [rep] = await db.select().from(tables.battleReport).where(and(eq(tables.battleReport.kind, "minen"), eq(tables.battleReport.defenderPlayerId, a.playerId)));
  assert.equal((rep.report as { mines: { action: string } }).mines.action, "konvoi");
  const [sum] = await db.select({ s: sql<string>`coalesce(sum(amount), 0)` }).from(tables.tradeLedger).where(eq(tables.tradeLedger.account, `delivery:${cv.deliveryId}`));
  assert.equal(Number(sum.s), 0, "Lieferkonto ausgeglichen");
  // Ohne Minen (Felder des Absenders/Empfängers) kein Verlust: eigene Felder des Verkäufers wirken nicht.
  await db.update(tables.minefield).set({ ownerId: b.playerId });
  const o2 = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 1000, want: "proviant", wantQty: 10, visibility: "public" });
  const a2 = await acceptOffer(engine, a.playerId, key(), (o2 as { offerId: number }).offerId);
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "convoy_raid"));
  const did = `po-${(o2 as { offerId: number }).offerId}-k`;
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, did));
  await runUntil((a2 as { arriveAtMs: number }).arriveAtMs + 1000);
  const [d2] = await db.select().from(tables.delivery).where(eq(tables.delivery.id, did));
  assert.equal(d2.qty, (cv2.cargo as Counts).stahl, "kein Minenverlust");
});

test("Spielerhandel: Anbieter stellt Geleit beim Einstellen; läuft bei Annahme aus, begleitet und kehrt heim", async () => {
  const a = await newPlayer("Abnehmer", coastNear(null));
  const b = await newPlayer("Anbieterin", coastNear(a, 150, 500));
  await patchBase(b.baseId, (s) => { s.units = { korvette: 2, minenraeumer: 1 }; });
  const credits = await createOffer(engine, b.playerId, key(), { give: "credits", giveQty: 1, want: "stahl", wantQty: 10, visibility: "public", escort: { korvette: 1 } });
  assert.equal(credits.ok ? "ok" : (credits as { code: string }).code, "escort_no_cargo");
  const tooMany = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 100, want: "proviant", wantQty: 10, visibility: "public", escort: { korvette: 5 } });
  assert.equal(tooMany.ok ? "ok" : (tooMany as { code: string }).code, "escort_units");
  const offer = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 3000, want: "proviant", wantQty: 10, visibility: "public", escort: { korvette: 2 } });
  assert.equal(offer.ok, true, JSON.stringify(offer));
  const id = (offer as { offerId: number }).offerId;
  assert.deepEqual((await stateOf(b.baseId)).units.korvette, 2, "Schiffe bleiben bis zur Annahme im Hafen");
  const both = await acceptOffer(engine, a.playerId, key(), id, { korvette: 1 });
  assert.equal(both.ok ? "ok" : (both as { code: string }).code, "offer_escorted");
  const acc = await acceptOffer(engine, a.playerId, key(), id);
  assert.equal(acc.ok, true, JSON.stringify(acc));
  const [cv] = await db.select().from(tables.convoy).where(and(eq(tables.convoy.recipientId, a.playerId), eq(tables.convoy.kind, "handel")));
  assert.deepEqual(cv.escort, { korvette: 2 });
  const em = await missionRow(cv.escortMissionId!);
  assert.equal(em.playerId, b.playerId);
  assert.equal((em.plan as { sellerEscort?: boolean }).sellerEscort, true);
  assert.equal((await stateOf(b.baseId)).units.korvette ?? 0, 0, "Geleit ausgelaufen");
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "convoy_raid"));
  const arrive = (acc as { arriveAtMs: number }).arriveAtMs;
  await runUntil(arrive + 1000);
  const back = await missionRow(em.id);
  assert.equal(back.status, "returning");
  assert.ok(back.returnAt!.getTime() > arrive + 1000, "fährt vom Käufer heim");
  await runUntil(back.returnAt!.getTime() + 1000);
  assert.equal((await missionRow(em.id)).status, "done");
  assert.equal((await stateOf(b.baseId)).units.korvette, 2, "Geleit wieder daheim");
  const msgs = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, b.playerId), sql`${tables.message.body} like '%Dein Geleit begleitet%'`));
  assert.equal(msgs.length, 1);
  // Fehlen die Schiffe bei Annahme, fährt die Ware ohne Geleit (Hinweis an den Anbieter).
  const o2 = await createOffer(engine, b.playerId, key(), { give: "stahl", giveQty: 500, want: "proviant", wantQty: 10, visibility: "public", escort: { korvette: 1 } });
  await patchBase(b.baseId, (s) => { s.units = { minenraeumer: 1 }; });
  const acc2 = await acceptOffer(engine, a.playerId, key(), (o2 as { offerId: number }).offerId);
  assert.equal(acc2.ok, true, JSON.stringify(acc2));
  const [cv2] = await db.select().from(tables.convoy).where(eq(tables.convoy.deliveryId, `po-${(o2 as { offerId: number }).offerId}-k`));
  assert.equal(cv2.escortMissionId, null);
  const warn = await db.select().from(tables.message).where(and(eq(tables.message.toPlayerId, b.playerId), sql`${tables.message.body} like '%konnte nicht auslaufen%'`));
  assert.equal(warn.length, 1);
});
