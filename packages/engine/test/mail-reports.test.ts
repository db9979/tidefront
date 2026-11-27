// Ausführliche E-Mails aus echten Berichten gegen ein echtes PostgreSQL (TEST_DATABASE_URL, wird geleert):
// Kampf (Nest, Spielerhafen aus beiden Sichten), Aufklärung (Hafen, Nest, Feld), Spionage, Angriffswarnung,
// Bündelung, Erfolg und der Standard für unbekannte Berichtsarten. Mit MAIL_PREVIEW_DIR werden die Mails als
// .html/.txt abgelegt (für Bildschirmfotos).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { spyRollOf, type BaseState, type SpyMission } from "@tidefront/game-core";
import {
  chooseBase, deliverNotices, ensureFieldPlanner, fieldsView, flushMailDigests, launchMission, mailNotice, processDue, register,
  renderMail, reportMailParts, reportViewFor, saveSmtp, seed, setMailSender, spyLaunch, type Engine, type NoticeJob, type OutgoingMail,
} from "../src/index.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const pending: NoticeJob[] = [];
const engine: Engine = { db, notify: () => {}, log: () => {}, push: (jobs) => { pending.push(...jobs); } };
const mails: OutgoingMail[] = [];
const PREVIEW = process.env.MAIL_PREVIEW_DIR;
let keyN = 0;
const key = () => `m${++keyN}-${Date.now()}`;
const SEED_OK = (() => { let s = 1; while (spyRollOf(s, 20) !== 1) s++; return s; })();

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
  const email = `${name.toLowerCase()}@example.org`;
  await db.insert(tables.playerEmail).values({ playerId: p.playerId, email, verifiedAt: new Date(), unsubscribeToken: (name.slice(0, 2).toLowerCase().replace(/[^a-f]/g, "a") + "0".repeat(46)).slice(0, 48) });
  return { playerId: p.playerId, baseId: (r as { baseId: number }).baseId, email, ...f };
}

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

/** Ereignisse bis `ms` abarbeiten und die Benachrichtigungen (Push, E-Mail) zustellen. */
async function runTo(ms: number) {
  await processDue(engine, ms);
  await deliverNotices(engine, pending.splice(0));
}

/** Prüft eine Mail auf saubere Werte und legt sie für Bildschirmfotos ab. */
function check(name: string, m: OutgoingMail | undefined, must: (string | RegExp)[]): OutgoingMail {
  assert.ok(m, `Mail ${name} fehlt`);
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) {
    assert.ok(!m.html.includes(bad), `${name}: HTML enthält ${bad}`);
    assert.ok(!m.text.includes(bad), `${name}: Text enthält ${bad}`);
    assert.ok(!m.subject.includes(bad), `${name}: Betreff enthält ${bad}`);
  }
  assert.ok(m.text.length > 200, `${name}: Textversion vorhanden`);
  assert.ok(m.html.includes("prefers-color-scheme: dark") && m.html.includes("Im Spiel öffnen"));
  assert.ok(m.text.includes("abbestellen") || m.text.includes("Abbestellen"), `${name}: Abmeldelink im Text`);
  for (const x of must) {
    if (typeof x === "string") assert.ok(m.text.includes(x) && m.html.includes(x.replace(/&/g, "&amp;")), `${name}: „${x}“ fehlt\n${m.text}`);
    else assert.match(m.text, x, name);
  }
  if (PREVIEW) {
    mkdirSync(PREVIEW, { recursive: true });
    writeFileSync(join(PREVIEW, `${name}.html`), m.html);
    writeFileSync(join(PREVIEW, `${name}.txt`), `Betreff: ${m.subject}\n\n${m.text}`);
  }
  return m;
}

const lastTo = (to: string) => mails.filter((m) => m.to === to).at(-1);

let A: Awaited<ReturnType<typeof newPlayer>>;
let B: Awaited<ReturnType<typeof newPlayer>>;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  process.env.APP_SECRET = "test-geheimnis-0123456789abcdef";
  setMailSender(async (_cfg, mail) => { mails.push(mail); });
  assert.equal((await saveSmtp(db, { enabled: true, provider: "custom", host: "smtp.test", port: 25, security: "none", user: "", password: "", fromName: "TIDEFRONT", fromAddress: "tf@x.test" })).ok, true);
  A = await newPlayer("Anna", 5);
  B = await newPlayer("Bert", 14);
  await patchBase(A.baseId, (s) => {
    s.units = { korvette: 8, zerstoerer: 4, landungsschiff: 6, schuetzen: 400, kampfpanzer: 30, jagdbomber: 6, spion: 4 };
    s.resources.treibstoff = 200000; s.resources.proviant = 200000;
    s.buildings.kommandozentrale = 10; s.buildings.nachrichtendienst = 4; s.buildings.hafenkommandantur = 6; s.buildings.lagerkomplex = 8;
    s.veterancy = { korvette: 500, schuetzen: 80 };
  });
  await patchBase(B.baseId, (s) => {
    s.protection.createdAtMs = 0;
    s.units = { schuetzen: 40, korvette: 2 };
    s.defenses = { kuestenbatterie: 2, flakstellung: 1 };
    s.resources.stahl = 20000; s.resources.proviant = 50000;
    s.buildings.kraftwerk = 3; s.buildings.stahlwerk = 3; s.buildings.lagerkomplex = 8; s.buildings.radarstation = 4;
  });
  // Keine Kartell-Überfälle zwischendurch (sie würden Schutz nach Niederlage auslösen).
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "raid_launch"));
});

after(async () => {
  setMailSender(null);
  await client.end();
});

test("Kampfbericht Nest: Sieg, Verbände als Tabelle, Beute, Kurzfazit, Betreff mit Beute, Direktlink", async () => {
  const nests = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  const near = nests.map((n) => ({ n, d: Math.hypot(n.col - A.col, n.row - A.row) })).sort((x, y) => x.d - y.d)[0].n;
  const m = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 4, landungsschiff: 4, schuetzen: 200 }, col: near.col, row: near.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, (m as { missionId: number }).missionId));
  await runTo(mission.arriveAt.getTime() + 1);
  const [arrived] = await db.select().from(tables.mission).where(eq(tables.mission.id, mission.id));
  const mail = check("kampf-nest-sieg", lastTo(A.email), ["Kampfbericht", "Einheit", "Start", "Verlust", "Übrig", "Beute", "Gewonnen mit"]);
  assert.match(mail.subject, /^TIDEFRONT: Sieg bei Piratennest Stufe 1 – Beute [\d.]+ /, mail.subject);
  assert.ok(mail.html.includes(`?tab=berichte&amp;bericht=${arrived.reportId}`), "Knopf öffnet den Bericht");
  assert.ok(mail.text.includes("Korvette · "), "Veteranenrang der eigenen Einheit");
  // Kampfsimulator: zusätzlicher Link mit sim=1 (HTML und Text).
  assert.ok(mail.html.includes(`?tab=berichte&amp;bericht=${arrived.reportId}&amp;sim=1`) && mail.html.includes("Im Kampfsimulator öffnen"), "Simulator-Link");
  assert.ok(mail.text.includes(`Im Kampfsimulator öffnen: `) && mail.text.includes(`bericht=${arrived.reportId}&sim=1`));
  // App: report.get liefert dieselben Bausteine und die Kampfbedingungen (setup) mit.
  const v = await reportViewFor(engine, A.playerId, arrived.reportId!);
  assert.ok(v && v.simulable && v.covered && v.blocks[0].type === "banner");
  const battle = (v.data as { battle: { setup?: { attacker: object; defender: { fixedLoot?: object } } } }).battle;
  assert.ok(battle.setup?.defender.fixedLoot, "Nestbeute als Kampfbedingung gespeichert");
  assert.equal(await reportViewFor(engine, B.playerId, arrived.reportId!), null, "fremder Bericht: nicht sichtbar");
  assert.ok(mail.text.includes("Piratenmiliz") || mail.text.includes("Schnellboot"), "Gegner mit Namen");
  await runTo(arrived.returnAt!.getTime() + 1);
});

test("Aufklärung: Spielerhafen mit Lagebild, Piratennest Stufe 2, Rohstofffeld", async () => {
  const scout = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: B.col, row: B.row });
  assert.equal(scout.ok, true, JSON.stringify(scout));
  await runTo((scout as { arriveAtMs: number }).arriveAtMs + 1);
  const m = check("aufklaerung-hafen", lastTo(A.email), ["Lagebild von Hafen Bert", "Bestände", "Schützen", "Küstenbatterie", "Gebäude", "Bunkerschutz"]);
  assert.match(m.subject, /Aufklärung: Hafen Bert – \d+ Einheiten, 3 Anlagen/, m.subject);
  assert.ok(!m.html.includes("sim=1"), "kein Simulator-Link ohne Kampf");

  const nest2 = (await db.select().from(tables.nest).where(eq(tables.nest.level, 2)))
    .map((n) => ({ n, d: Math.hypot(n.col - A.col, n.row - A.row) })).sort((x, y) => x.d - y.d)[0].n;
  const ns = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: nest2.col, row: nest2.row });
  assert.equal(ns.ok, true, JSON.stringify(ns));
  await runTo((ns as { arriveAtMs: number }).arriveAtMs + 1);
  const nm = check("aufklaerung-nest", lastTo(A.email), ["Piratennest Stufe 2", "Besatzung", "Mögliche Beute"]);
  assert.match(nm.subject, /Aufklärung: Piratennest Stufe 2/);

  await ensureFieldPlanner(db, Date.now());
  const view = (await fieldsView(engine, A.playerId))!;
  const target = [...view.fields].sort((x, y) => Math.hypot(x.col - A.col, x.row - A.row) - Math.hypot(y.col - A.col, y.row - A.row))[0];
  const fs = await launchMission(engine, A.playerId, key(), { type: "aufklaerung", units: { korvette: 1 }, col: target.col, row: target.row, fieldId: target.id });
  assert.equal(fs.ok, true, JSON.stringify(fs));
  await runTo((fs as { arriveAtMs: number }).arriveAtMs + 1);
  const fm = check("aufklaerung-feld", lastTo(A.email), ["Feld-Aufklärung", "Kartell-Wache", "Stufe"]);
  assert.match(fm.subject, /Aufklärung: .+ \(Stufe \d\) – Wache \d+ Einheit/, fm.subject);
});

test("Angriff auf Spielerhafen: Warnung mit Schritten, Kampfbericht für beide Seiten", async () => {
  const m = await launchMission(engine, A.playerId, key(), { type: "ueberfall", units: { korvette: 3, zerstoerer: 4, landungsschiff: 4, schuetzen: 150, kampfpanzer: 20 }, col: B.col, row: B.row });
  assert.equal(m.ok, true, JSON.stringify(m));
  const id = (m as { missionId: number }).missionId;
  const [warn] = await db.select().from(tables.gameEvent).where(and(eq(tables.gameEvent.type, "attack_warning"), sql`${tables.gameEvent.payload}->>'missionId' = ${String(id)}`));
  assert.ok(warn, "Warnung geplant");
  const [mission] = await db.select().from(tables.mission).where(eq(tables.mission.id, id));
  assert.ok(warn.dueAt.getTime() < mission.arriveAt.getTime() - 60000, "Radar warnt vor der Ankunft");
  await runTo(warn.dueAt.getTime() + 1);
  const w = check("angriffswarnung", lastTo(B.email), ["Ankunft in", "Empfohlene Schritte", "Truppen daheim lassen", "Bunkerschutz", "Größenklasse"]);
  assert.match(w.subject, /^TIDEFRONT: ⚠︎ Angriff auf Hafen Bert in /, w.subject);
  await runTo(mission.arriveAt.getTime() + 1);
  const att = check("kampf-hafen-angreifer", lastTo(A.email), ["Verband Anna (du)", "Gegner Bert", "Bunkerschutz Bert"]);
  assert.match(att.subject, /(Sieg|Niederlage) bei Hafen Bert/);
  const def = check("kampf-hafen-verteidiger", lastTo(B.email), ["Verteidigung Bert (du)", "Plünderung"]);
  assert.match(def.subject, /Hafen Bert (gehalten|überwunden)/, def.subject);
  // Spieler gegen Spieler: Modifikatoren des Gegners liefert report.get nicht aus.
  const [br] = await db.select({ id: tables.battleReport.id }).from(tables.battleReport).where(and(eq(tables.battleReport.kind, "ueberfall"), eq(tables.battleReport.defenderPlayerId, B.playerId))).orderBy(sql`${tables.battleReport.id} desc`).limit(1);
  const forB = await reportViewFor(engine, B.playerId, br.id);
  const setupB = (forB!.data as { battle: { setup: { attacker: { modifiers?: object; modifiersHidden?: boolean } } } }).battle.setup;
  assert.equal(setupB.attacker.modifiers, undefined);
  assert.equal(forB!.opponentIsPlayer, true);
  // Boni beidseitig geheim (F5): auch die Eingaben des Angreifers (data.attacker) ohne seine Modifikatoren; der
  // Angreifer sieht seine eigenen, aber nicht die des Verteidigers.
  const inputB = (forB!.data as { attacker?: { units?: object; modifiers?: object } }).attacker;
  assert.ok(inputB?.units, "Einheiten des Angreifers bleiben");
  assert.equal(inputB && "modifiers" in inputB, false);
  const forA = await reportViewFor(engine, A.playerId, br.id);
  const dataA = forA!.data as { attacker?: { modifiers?: object }; battle: { setup: { defender: { modifiers?: object } } } };
  assert.ok(dataA.attacker && "modifiers" in dataA.attacker, "eigene Modifikatoren bleiben");
  assert.equal(dataA.battle.setup.defender.modifiers, undefined);
});

test("Spionage: Dossier für den Absender", async () => {
  const r = await spyLaunch(engine, A.playerId, key(), { kind: "erkunden", col: B.col, row: B.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m0] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  const plan = m0.plan as SpyMission;
  await db.update(tables.mission).set({ plan: { ...plan, spy: { ...plan.spy, seed: SEED_OK } } }).where(eq(tables.mission.id, m0.id));
  await runTo(plan.arriveAtMs + 1000);
  const s = check("spionage", lastTo(A.email), ["Gelungen", "Dossier", "Wurf"]);
  assert.match(s.subject, /Spionage: Erkunden gegen Hafen Bert – gelungen/, s.subject);
});

test("Bündelung und Erfolg: Tabelle mit Zeiten, Kennzahlen als Kacheln", async () => {
  await db.update(tables.playerEmail).set({ prefs: { build: true, training: true } }).where(eq(tables.playerEmail.playerId, B.playerId));
  assert.equal(await mailNotice(engine, B.playerId, { kind: "build", title: "Ausbau fertig", body: "Werft ist jetzt auf Stufe 3.", facts: [["Gebäude", "Werft"], ["Stufe", "3"]] }), "queued");
  assert.equal(await mailNotice(engine, B.playerId, { kind: "build", title: "Ausbau fertig", body: "Kaserne ist jetzt auf Stufe 4." }), "queued");
  assert.equal(await mailNotice(engine, B.playerId, { kind: "training", title: "Ausbildung fertig", body: "Bereit: 25 Schützen." }), "queued");
  assert.equal(await flushMailDigests(engine, Date.now()), 1);
  const d = check("buendelung", lastTo(B.email), ["Werft ist jetzt auf Stufe 3.", "Bereit: 25 Schützen.", "Meldung"]);
  assert.match(d.subject, /3 Meldungen aus deinem Hafen: Ausbau fertig \(2\), Ausbildung fertig/, d.subject);

  assert.equal(await mailNotice(engine, B.playerId, {
    kind: "report", title: "Erfolg: Seebär (Silber)", body: "10 Kämpfe gewonnen. Belohnung abholen unter Meldungen → Erfolge.",
    facts: [["Erfolg", "Seebär"], ["Stufe", "Silber"], ["Erreicht", "10 Siege"]], mail: { subject: "Erfolg freigeschaltet: Seebär (Silber)" },
  }), "sent");
  const e = check("erfolg", lastTo(B.email), ["Seebär", "Silber"]);
  assert.equal(e.subject, "TIDEFRONT: Erfolg freigeschaltet: Seebär (Silber)");
});

test("Standard für unbekannte Berichtsarten, Kürzung langer Tabellen, HTML maskiert", () => {
  const units: Record<string, number> = {};
  for (let i = 0; i < 26; i++) units[`einheit${i}`] = 26 - i;
  const parts = reportMailParts({
    id: 1, kind: "patrouille", title: "Patrouille <Nordmeer> & Co", atMs: Date.UTC(2026, 10, 27, 13, 5), role: "attacker", winner: null,
    data: { sector: "Nordmeer", sichtungen: 3, gesichtet: units, sicht: { radius: 120, fremd: { korvette: 2 } } },
  });
  assert.equal(parts.blocks[0].type, "banner");
  const m = renderMail({ subject: parts.subject, heading: parts.heading, paragraphs: [], preheader: parts.lead, blocks: parts.blocks, button: { label: "Im Spiel öffnen", url: "https://x.test/?tab=berichte&bericht=1" }, unsubscribeUrl: "https://x.test/u" });
  check("unbekannte-art", { to: "x", ...m }, ["Nordmeer", "Sichtungen", "Korvette", "6 weitere Zeilen"]);
  assert.ok(m.html.includes("Patrouille &lt;Nordmeer&gt; &amp; Co") && !m.html.includes("<Nordmeer>"), "maskiert");
  assert.ok(m.text.includes("Patrouille <Nordmeer> & Co"), "Text unmaskiert");
});

test("Lagebild Stufe 3: Satellitenstart und Ende als eigene Abschnitte (Bahn, Kosten, Zusammenfassung)", () => {
  const atMs = Date.UTC(2026, 10, 27, 13, 5);
  const start = reportMailParts({
    id: 2, kind: "satellit", title: "Optischer Satellit gestartet", atMs, role: "attacker", winner: null,
    data: { satellite: { event: "start", name: "Optischer Satellit", baseName: "Hafen Anna", cost: { stahl: 5000, treibstoff: 2000, elektronik: 3500 }, expiresAtMs: atMs + 168 * 3600000, passes: 27, periodHours: 6, stripKm: 600, liveMinutes: 20, level: "erkennung", cloudMax: 0.6, firstPass: { atMs: atMs + 6 * 3600000, where: "Nordsee (2° W – 6° O)" } } },
  });
  assert.match(start.subject, /Optischer Satellit gestartet – erster Überflug über Nordsee/);
  const m1 = renderMail({ subject: start.subject, heading: start.heading, paragraphs: [], preheader: start.lead, blocks: start.blocks, button: { label: "Im Spiel öffnen", url: "https://x.test/?tab=berichte&bericht=2" }, unsubscribeUrl: "https://x.test/u" });
  check("satellit-start", { to: "x", ...m1 }, ["Startkosten", "Erster Überflug", "nicht unter Wolken", "5.000"]);
  const end = reportMailParts({
    id: 3, kind: "satellit", title: "Radarsatellit verglüht", atMs, role: "attacker", winner: null,
    data: { satellite: { event: "end", name: "Radarsatellit", baseName: "Hafen Anna", passes: 27, plannedPasses: 27, seen: 140, clouded: 0, last: { atMs, seen: 4, nests: 0, bases: 0, fleets: 4, where: "Biskaya (12° W – 4° W)" } } },
  });
  assert.match(end.subject, /Radarsatellit verglüht – 27 Überflüge, 140 Sichtungen/);
  const m2 = renderMail({ subject: end.subject, heading: end.heading, paragraphs: [], preheader: end.lead, blocks: end.blocks, button: { label: "Im Spiel öffnen", url: "https://x.test/?tab=berichte&bericht=3" }, unsubscribeUrl: "https://x.test/u" });
  check("satellit-ende", { to: "x", ...m2 }, ["Überflüge", "Sichtungen", "Letzter Überflug", "Biskaya"]);
});
