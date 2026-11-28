// Integrationstests Komfort: Verbandsvorlagen, Wiederholen, letzte Aufklärung, Morgenbericht
// gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import {
  chooseBase,
  clearRankingCache,
  deleteTemplate,
  fitTemplate,
  lastScout,
  launchMission,
  listTemplates,
  localClock,
  processDue,
  recentMissions,
  recordSummaryEntry,
  register,
  registerSummarySection,
  repeatFromReport,
  runMorningSummaries,
  saveSmtp,
  saveTemplate,
  seed,
  sendMessage,
  setMailSender,
  setSummarySettings,
  summarySettings,
  TEMPLATE_MAX,
  unsubscribeEmail,
  type Engine,
  type OutgoingMail,
  setNightShield,
} from "../src/index.ts";
import { addSecondHarbor, harborState } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {} };
let keyN = 0;
const key = () => `c${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
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

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
});

after(async () => {
  setMailSender(null);
  await client.end();
});

let emil: Awaited<ReturnType<typeof newPlayer>>;
let frieda: Awaited<ReturnType<typeof newPlayer>>;
let raidReportId = 0;
let raidAtMs = 0;
const SENT = { korvette: 4, landungsschiff: 2, schuetzen: 150 };

test("Vorlagen: speichern, überschreiben, laden, auf Verfügbares kürzen, löschen", async () => {
  emil = await newPlayer("Emil", 9);
  frieda = await newPlayer("Frieda", 30);
  await patchBase(emil.baseId, (s) => { s.units = { korvette: 2, landungsschiff: 2, schuetzen: 80 }; });

  const a = await saveTemplate(db, emil.playerId, { name: "  Nestjäger ", units: { ...SENT, pioniere: 0 }, missionType: "ueberfall" });
  assert.equal(a.ok, true, JSON.stringify(a));
  const b = await saveTemplate(db, emil.playerId, { name: "Späher", units: { korvette: 1 }, missionType: "aufklaerung" });
  assert.equal(b.ok, true);
  // Gleicher Name in anderer Schreibweise überschreibt.
  const a2 = await saveTemplate(db, emil.playerId, { name: "NESTJÄGER", units: SENT, missionType: null });
  assert.deepEqual(a2, { ok: true, id: (a as { id: number }).id });

  const list = await listTemplates(db, emil.playerId);
  assert.deepEqual(list.map((t) => t.name), ["NESTJÄGER", "Späher"]);
  const nj = list[0];
  assert.deepEqual(nj.units, SENT);
  assert.equal(nj.missionType, null);
  assert.deepEqual(nj.fit.units, { korvette: 2, landungsschiff: 2, schuetzen: 80 });
  assert.deepEqual(nj.fit.short, [{ id: "korvette", wanted: 4, available: 2 }, { id: "schuetzen", wanted: 150, available: 80 }]);
  assert.deepEqual(list[1].fit, { units: { korvette: 1 }, short: [] });
  assert.deepEqual(fitTemplate({ zerstoerer: 3 }, {}), { units: {}, short: [{ id: "zerstoerer", wanted: 3, available: 0 }] });

  // Fremde sehen und löschen nichts.
  assert.deepEqual(await listTemplates(db, frieda.playerId), []);
  assert.equal(await deleteTemplate(db, frieda.playerId, nj.id), false);

  // Ablehnungen
  assert.deepEqual(await saveTemplate(db, emil.playerId, { name: "X", units: { schnellboot: 1 } }), { ok: false, code: "unknown_unit" });
  assert.deepEqual(await saveTemplate(db, emil.playerId, { name: "X", units: { korvette: 0 } }), { ok: false, code: "empty_fleet" });
  assert.deepEqual(await saveTemplate(db, emil.playerId, { name: "X", units: { korvette: 1.5 } }), { ok: false, code: "bad_count" });
  assert.deepEqual(await saveTemplate(db, emil.playerId, { name: " ", units: { korvette: 1 } }), { ok: false, code: "bad_name" });
  assert.deepEqual(await saveTemplate(db, emil.playerId, { name: "X", units: { korvette: 1 }, missionType: "kartell" }), { ok: false, code: "bad_type" });

  // Obergrenze je Spieler
  for (let i = 0; i < TEMPLATE_MAX - 1; i++) assert.equal((await saveTemplate(db, frieda.playerId, { name: `V${i}`, units: { korvette: 1 } })).ok, true);
  assert.equal((await saveTemplate(db, frieda.playerId, { name: "Noch eine", units: { korvette: 1 } })).ok, true);
  assert.equal((await saveTemplate(db, frieda.playerId, { name: "Noch eine", units: { korvette: 2 } })).ok, true, "Überschreiben trotz Grenze");
  assert.deepEqual(await saveTemplate(db, frieda.playerId, { name: "Zu viel", units: { korvette: 1 } }), { ok: false, code: "template_limit" });

  assert.equal(await deleteTemplate(db, emil.playerId, b.ok ? b.id : 0), true);
  assert.equal((await listTemplates(db, emil.playerId)).length, 1);
});

test("Wiederholen: Bericht und heimgekehrte Mission liefern Ziel und Zusammensetzung", async () => {
  await patchBase(emil.baseId, (s) => { s.units = { ...SENT }; s.resources.treibstoff = 50000; });
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const near = nests.map((n) => ({ n, d: Math.hypot(n.col - emil.col, n.row - emil.row) })).sort((x, y) => x.d - y.d)[0].n;
  const m = await launchMission(engine, emil.playerId, key(), { type: "ueberfall", units: SENT, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await processDue(engine, mission.arriveAt.getTime() + 1);
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, mission.id));
  raidReportId = arrived.reportId!;
  raidAtMs = mission.arriveAt.getTime();

  const rep = await repeatFromReport(db, emil.playerId, raidReportId);
  assert.ok(rep);
  assert.deepEqual({ type: rep.type, col: rep.col, row: rep.row, units: rep.units }, { type: "ueberfall", col: near.col, row: near.row, units: SENT });
  assert.deepEqual(rep.fit.units, {}, "alles unterwegs: nichts daheim");
  assert.equal(await repeatFromReport(db, frieda.playerId, raidReportId), null, "nur eigene Berichte");

  assert.deepEqual(await recentMissions(db, emil.playerId), [], "noch nicht heimgekehrt");
  await processDue(engine, arrived.returnAt!.getTime() + 1);
  const recent = await recentMissions(db, emil.playerId);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].reportId, raidReportId);
  assert.deepEqual(recent[0].units, SENT);
  assert.equal(recent[0].col, near.col);
  assert.ok(Object.keys(recent[0].fit.units).length > 0, "Überlebende sind wieder daheim");
});

test("Mehrere Häfen: Vorlagen und Wiederholen mit den Einheiten des aktiven Hafens; letzte Missionen je Hafen; Nachtschild für alle", async () => {
  const e2 = await addSecondHarbor(db, emil.playerId, { patch: (s) => { s.units = { korvette: 1, schuetzen: 10 }; } });
  const tpl = (await listTemplates(db, emil.playerId, e2.baseId)).find((t) => t.name === "NESTJÄGER")!;
  assert.deepEqual(tpl.fit.units, { korvette: 1, schuetzen: 10 }, "gekürzt auf den aktiven Hafen");
  await assert.rejects(listTemplates(db, emil.playerId, frieda.baseId), /no_base/);
  assert.equal((await recentMissions(db, emil.playerId)).length, 1, "Heimathafen: die heimgekehrte Mission");
  assert.deepEqual(await recentMissions(db, emil.playerId, 5, e2.baseId), [], "zweiter Hafen: keine eigenen Missionen");
  const rep = await repeatFromReport(db, emil.playerId, raidReportId, e2.baseId);
  assert.deepEqual(rep!.fit.units, { korvette: 1, schuetzen: 10 });
  // Nachtschild: Einstellung im zweiten Hafen gilt für alle eigenen Häfen.
  const r = await setNightShield(engine, emil.playerId, key(), 22, 60, e2.baseId);
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const id of [emil.baseId, e2.baseId]) {
    assert.deepEqual((await harborState(db, id)).protection.nightShieldNext, { startHour: 22, tzOffsetMinutes: 60, fromMs: (r as { fromMs: number }).fromMs });
  }
  assert.equal((await setNightShield(engine, emil.playerId, key(), 21, 60, frieda.baseId)).ok, false, "fremder Hafen");
});

test("Letzte Aufklärung eines Spielerhafens für den Probekampf", async () => {
  assert.equal(await lastScout(db, emil.playerId, frieda.col, frieda.row), null, "ohne Aufklärung nichts");
  await patchBase(frieda.baseId, (s) => { s.units = { schuetzen: 33 }; s.defenses = { kuestenbatterie: 2 }; });
  await patchBase(emil.baseId, (s) => { s.units = { ...s.units, korvette: (s.units.korvette ?? 0) + 1 }; s.resources.treibstoff = 50000; });
  const m = await launchMission(engine, emil.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: frieda.col, row: frieda.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await processDue(engine, mission.arriveAt.getTime() + 1);
  const s = await lastScout(db, emil.playerId, frieda.col, frieda.row);
  assert.ok(s);
  assert.equal(s.units.schuetzen, 33);
  assert.equal(s.defenses.kuestenbatterie, 2);
  assert.ok(s.protectedPerResource > 0);
  assert.equal(await lastScout(db, frieda.playerId, frieda.col, frieda.row), null, "fremde Aufklärung zählt nicht");
});

test("Morgenbericht: genau einmal je Tag, Inhalt korrekt, Abmelden schaltet ab", async () => {
  const mails: OutgoingMail[] = [];
  setMailSender(async (_cfg, mail) => { mails.push(mail); });
  assert.equal((await saveSmtp(db, { enabled: true, provider: "custom", host: "smtp.test", port: 25, security: "none", user: "", password: "", fromName: "TIDEFRONT", fromAddress: "tf@x.test" })).ok, true);
  await db.insert(tables.playerEmail).values({ playerId: emil.playerId, email: "emil@example.org", verifiedAt: new Date(), unsubscribeToken: "ab".repeat(24) });

  const tz = "Europe/Berlin";
  // Berichtszeit: eine Minute nach dem Überfall; als Uhrzeit des Morgenberichts eingestellt.
  const t1 = raidAtMs + 60000;
  const minute = localClock(t1, tz).minute;
  assert.deepEqual(await setSummarySettings(db, emil.playerId, { enabled: true, minuteOfDay: minute, timeZone: "Mond/Basis", push: false }), { ok: false, code: "bad_tz" });
  assert.deepEqual(await setSummarySettings(db, emil.playerId, { enabled: true, minuteOfDay: 1440, timeZone: tz, push: false }), { ok: false, code: "bad_time" });
  assert.deepEqual(await setSummarySettings(db, emil.playerId, { enabled: true, minuteOfDay: minute, timeZone: tz, push: false }), { ok: true });
  assert.equal((await summarySettings(db, emil.playerId)).enabled, true);

  // Mitschrift erledigter Aufträge (seit 0.43 immer: auch die Rückkehrkarte der Lage liest sie); Angriffe nicht.
  await recordSummaryEntry(engine, emil.playerId, { kind: "build", title: "Ausbau fertig", body: "Werft ist jetzt auf Stufe 2." });
  await recordSummaryEntry(engine, emil.playerId, { kind: "delivery", title: "Lieferung angekommen", body: "500 Stahl sind eingetroffen." });
  await recordSummaryEntry(engine, emil.playerId, { kind: "attack", title: "Angriff erkannt", body: "zählt nicht" });
  // Neue Spieler haben den Morgenbericht an (Spielerbindung); Frieda schaltet ihn ab.
  await db.update(tables.morningSummary).set({ enabled: false }).where(eq(tables.morningSummary.playerId, frieda.playerId));
  await recordSummaryEntry(engine, frieda.playerId, { kind: "build", title: "Ausbau fertig", body: "ohne Morgenbericht" });
  const entries = await db.select().from(tables.summaryEntry);
  assert.equal(entries.length, 3);
  assert.equal(entries.filter((e) => e.playerId === emil.playerId).length, 2);
  assert.ok(!entries.some((e) => e.kind === "attack"));
  await db.delete(tables.summaryEntry).where(eq(tables.summaryEntry.playerId, frieda.playerId));
  await db.update(tables.summaryEntry).set({ createdAt: new Date(raidAtMs - 3600000) });
  await sendMessage(engine, frieda.playerId, { toPlayerId: emil.playerId, body: "Guten Morgen!" });
  await db.update(tables.message).set({ createdAt: new Date(raidAtMs - 1800000) });
  await db.update(tables.battleReport).set({ createdAt: new Date(raidAtMs - 600000) }).where(eq(tables.battleReport.kind, "aufklaerung"));
  registerSummarySection(async (_db, playerId) => (playerId === emil.playerId ? { title: "Tagesbefehl", lines: ["Drei Korvetten bauen"] } : null));
  clearRankingCache();

  assert.equal(await runMorningSummaries(engine, t1 - 120000), 0, "vor der Uhrzeit nichts");
  assert.equal(await runMorningSummaries(engine, t1), 1);
  assert.equal(await runMorningSummaries(engine, t1 + 60000), 0, "am selben Tag nur einmal");
  assert.equal(await runMorningSummaries(engine, t1), 0, "auch nicht bei gleichzeitigem Aufruf");
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.to, "emil@example.org");
  assert.match(m.subject, /^TIDEFRONT: Morgenbericht \d\d\.\d\d\.$/);
  const [report] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, raidReportId));
  const loot = (report.report as { battle: { loot: Record<string, number> } }).battle.loot;
  assert.ok(m.text.includes("Guten Morgen, Emil"));
  assert.ok(m.text.includes("Kämpfe: 1 (1 gewonnen, 0 verloren)"), m.text);
  assert.ok(m.text.includes(`Beute: ${loot.stahl.toLocaleString("de-DE")} Stahl`), m.text);
  assert.match(m.text, /Überfall auf Piratennest Stufe 1 +Sieg, Beute/, "Kampf als Tabellenzeile");
  assert.ok(m.text.includes("Fertige Aufträge: 1"));
  assert.ok(m.text.includes("Lieferungen: 1"));
  assert.ok(m.text.includes("Ausbau fertig: Werft ist jetzt auf Stufe 2."));
  assert.ok(m.text.includes("Neue Nachrichten: 1"));
  assert.match(m.text, /Rang in der Saison: \d+ von 2/);
  assert.ok(m.text.includes("Aufklärungsbericht liegt vor"));
  assert.ok(m.text.includes("Tagesbefehl\n----------") && m.text.includes("- Drei Korvetten bauen"), "Zusatzabschnitt mit Titel");
  assert.ok(!m.text.includes("zählt nicht"));
  assert.ok(m.html.includes("Morgenbericht") && m.html.includes("Guten Morgen, Emil"));
  assert.ok(m.headers?.["List-Unsubscribe"]);

  // Nächster Tag zur selben Uhrzeit: wieder genau ein Bericht, nur mit dem, was seitdem geschah.
  let t2 = t1 + 20 * 3600000;
  while (localClock(t2, tz).minute !== minute) t2 += 60000;
  assert.equal(await runMorningSummaries(engine, t2), 1);
  assert.equal(await runMorningSummaries(engine, t2 + 60000), 0);
  assert.equal(mails.length, 2);
  assert.ok(mails[1].text.includes("Kämpfe: keine"), mails[1].text);
  assert.ok(mails[1].text.includes("Eine ruhige Nacht"));

  // Fehlgeschlagener Versand gibt den Tag wieder frei.
  let t3 = t2 + 20 * 3600000;
  while (localClock(t3, tz).minute !== minute) t3 += 60000;
  setMailSender(async () => { throw new Error("421 später"); });
  assert.equal(await runMorningSummaries(engine, t3), 0);
  setMailSender(async (_cfg, mail) => { mails.push(mail); });
  assert.equal(await runMorningSummaries(engine, t3 + 60000), 1, "nächste Minute erneut versucht");
  assert.equal(mails.length, 3);

  // Abmeldelink schaltet auch den Morgenbericht ab.
  assert.equal(await unsubscribeEmail(db, "ab".repeat(24)), true);
  assert.equal((await summarySettings(db, emil.playerId)).enabled, false);
});
