// Spieler gegen Spieler (docs/VORLAGE-PVP.md) gegen ein echtes PostgreSQL (wird geleert): Kopfgeld und Mutfaktor im
// Bericht und in der Wertung, Paarbremse aus den Berichten, Absprache-Sperre, Verwaltungsliste, Anfängerschutz-Ende.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { createDb, migrateDb, tables } from "@tidefront/db";
import { nestSites, isCoast, COLS, ROWS } from "@tidefront/world";
import { protectionStatus, stampFactors, type BaseState, type PvpStamp } from "@tidefront/game-core";
import {
  balance,
  chooseBase,
  clearRankSnapshot,
  colluded,
  computeStandings,
  countsValue,
  launchMission,
  processDue,
  pvpTargetView,
  rankingView,
  rankSnapshot,
  recordTies,
  register,
  resValue,
  runningSeason,
  seed,
  setReportExcluded,
  suspiciousPairs,
  type Engine,
} from "../src/index.ts";
import { addSecondHarbor, harborState } from "./multi-base.ts";

const url = process.env.TEST_DATABASE_URL;
const { db, client } = createDb(url ?? "postgres://invalid", 10);
const engine: Engine = { db, notify: () => {}, log: () => {}, push: () => {} };
const cfg = balance.pvp!;
let keyN = 0;
const key = () => `pvp${++keyN}-${Date.now()}`;

function freeCoast(skip: number): { col: number; row: number } {
  const nests = new Set(nestSites().map((n) => `${n.col},${n.row}`));
  let k = 0;
  for (let row = 10; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (isCoast(col, row) && !nests.has(`${col},${row}`) && k++ === skip) return { col, row };
  }
  throw new Error("no coast");
}

async function newPlayer(name: string, field: number, units: Record<string, number>) {
  const p = await register(db, { inviteCode: "TEST", name, password: "geheim123" });
  const f = freeCoast(field);
  const r = await chooseBase(engine, p.playerId, key(), { ...f, name: `Hafen ${name}`, nightShieldStartHour: null, tzOffsetMinutes: 0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const baseId = (r as { baseId: number }).baseId;
  await patchBase(baseId, (s) => {
    s.units = { ...units };
    s.defenses = {};
    s.resources = { ...s.resources, stahl: 30000, treibstoff: 60000, elektronik: 8000, proviant: 60000 };
    s.buildings.hafenkommandantur = 4;
    s.protection.createdAtMs = 0;
  });
  return { playerId: p.playerId, baseId, ...f };
}
type P = Awaited<ReturnType<typeof newPlayer>>;

async function patchBase(baseId: number, patch: (s: BaseState) => void) {
  const [b] = await db.select().from(tables.base).where(eq(tables.base.id, baseId));
  const s = b.state as BaseState;
  patch(s);
  await db.update(tables.base).set({ state: s }).where(eq(tables.base.id, baseId));
}

async function raid(from: P, to: P, units: Record<string, number>) {
  const r = await launchMission(engine, from.playerId, key(), { type: "ueberfall", units, col: to.col, row: to.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [m] = await db.select().from(tables.mission).where(eq(tables.mission.id, (r as { missionId: number }).missionId));
  await processDue(engine, m.arriveAt.getTime() + 1);
  const [done] = await db.select().from(tables.mission).where(eq(tables.mission.id, m.id));
  const [rep] = await db.select().from(tables.battleReport).where(eq(tables.battleReport.id, done.reportId!));
  return rep;
}

let Kai: P, Lea: P, Neu: P;

before(async () => {
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);
  await seed(db, "TEST:100");
  // Kai führt deutlich (Rang 1), Lea folgt (Rang 2), Neu ist neu (Anfängerschutz).
  Kai = await newPlayer("Kai", 0, { korvette: 40 });
  Lea = await newPlayer("Lea", 1, { korvette: 14, landungsschiff: 2, schuetzen: 120 });
  Neu = await newPlayer("Neu", 2, { korvette: 4, landungsschiff: 1, schuetzen: 40 });
  await patchBase(Neu.baseId, (s) => { s.protection.createdAtMs = Date.now(); });
  // Keine Kartell-Überfälle während der Tests.
  await db.delete(tables.gameEvent).where(eq(tables.gameEvent.type, "raid_launch"));
  await clearRankSnapshot(db);
});

after(async () => {
  await client.end();
});

test("Kopfgeld im Bericht: Lea (Rang 2) überfällt Kai (Rang 1) – Rang, Kopfgeld und Mutfaktor festgehalten und gewertet", async () => {
  const snap = await rankSnapshot(db, Date.now());
  assert.equal(snap.ranks[String(Kai.playerId)][0], 1);
  assert.equal(snap.ranks[String(Lea.playerId)][0], 2);
  // Rangliste und Zielansicht zeigen das Kopfgeld.
  const ranking = await rankingView(engine, Lea.playerId);
  assert.equal(ranking.rows.find((r) => r.playerId === Kai.playerId)!.bounty, 50);
  assert.equal(ranking.rows.find((r) => r.playerId === Lea.playerId)!.bounty, 35);
  const view = (await pvpTargetView(engine, Lea.playerId, { col: Kai.col, row: Kai.row })).target!;
  assert.equal(view.bountyPct, 50);
  assert.equal(view.targetRank, 1);
  assert.ok(view.mut > 1, "stärkeres Ziel");
  assert.equal(view.pairFights, 0);
  assert.equal(view.beginnerEnds, false);
  // Kai greift nach unten: kein Kopfgeld, Mutfaktor < 1.
  const down = (await pvpTargetView(engine, Kai.playerId, { col: Lea.col, row: Lea.row })).target!;
  assert.equal(down.bountyPct, 0);
  assert.ok(down.mut < 1);

  const rep = await raid(Lea, Kai, { korvette: 12 });
  const report = rep.report as { pvp: PvpStamp; battle: { attacker: { losses: Record<string, number> }; defender: { losses: Record<string, number> }; loot: Record<string, number> } };
  const s = report.pvp;
  assert.ok(s, "report.pvp");
  assert.equal(s.attackerRank, 2);
  assert.equal(s.defenderRank, 1);
  assert.equal(s.bountyRank, 1);
  assert.equal(s.bountyFactor, 1.5);
  assert.equal(s.collusion, false);
  assert.ok(s.mut > 1 && s.mut <= 1.5);

  const season = (await runningSeason(db))!;
  const st = await computeStandings(db, season.startsAt.getTime(), Date.now());
  const f = stampFactors(s, cfg);
  const lea = st.find((r) => r.playerId === Lea.playerId)!;
  const kai = st.find((r) => r.playerId === Kai.playerId)!;
  const pf = balance.scoring?.pvpFactor ?? 1; // v1.38: Spielerkämpfe Kampf × pvpFactor
  assert.equal(lea.kampf, Math.floor((countsValue(report.battle.defender.losses) * pf * f.kampf) / 100));
  assert.equal(lea.beute, Math.floor((resValue(report.battle.loot) * f.beute) / 100));
  assert.equal(kai.kampf, Math.floor((countsValue(report.battle.attacker.losses) * pf * 0.5) / 100), "Verteidigung der Spitze zählt halb");
  assert.ok(countsValue(report.battle.attacker.losses) > 0, "Lea verliert Schiffe");

  // Nach dem Kampf: Paarbremse für den nächsten Kampf sichtbar.
  const again = (await pvpTargetView(engine, Lea.playerId, { col: Kai.col, row: Kai.row })).target!;
  assert.equal(again.pairFights, 1);
  assert.equal(again.pairFactor, 0.5);
});

test("Paarbremse aus den Berichten: 1 / 0,5 / 0,25 / 0 je Paar in 72 h, beide Richtungen; Verwaltung nimmt Berichte aus der Wertung", async () => {
  const season = (await runningSeason(db))!;
  // Eigene Spieler ohne Stempel (alte Berichte): nur die Paarbremse wirkt.
  const a = await register(db, { inviteCode: "TEST", name: "Ahoi", password: "geheim123" });
  const b = await register(db, { inviteCode: "TEST", name: "Brise", password: "geheim123" });
  const t0 = Math.max(Date.now(), season.startsAt.getTime()) + 1000; // Berichte ab Saisonbeginn
  const add = async (atk: number, def: number, hoursAfter: number) => {
    const [r] = await db.insert(tables.battleReport).values({
      kind: "ueberfall", title: "Test", attackerPlayerId: atk, defenderPlayerId: def, winner: "attacker", balanceVersion: balance.version,
      report: { battle: { attacker: { losses: {} }, defender: { losses: { korvette: 1 } }, loot: {} } }, createdAt: new Date(t0 + hoursAfter * 3600000),
    }).returning({ id: tables.battleReport.id });
    return r.id;
  };
  const ids = [await add(a.playerId, b.playerId, 0), await add(b.playerId, a.playerId, 10), await add(a.playerId, b.playerId, 20), await add(a.playerId, b.playerId, 30)];
  const v = countsValue({ korvette: 1 });
  let st = await computeStandings(db, season.startsAt.getTime(), Date.now());
  const pts = (id: number) => st.find((r) => r.playerId === id)!.kampf;
  // a: Kämpfe 1 (×1), 3 (×0,25), 4 (×0); b: Kampf 2 (×0,5).
  const pf = balance.scoring?.pvpFactor ?? 1;
  assert.equal(pts(a.playerId), Math.floor((v * pf * 1.25) / 100));
  assert.equal(pts(b.playerId), Math.floor((v * pf * 0.5) / 100));

  // Verwaltung: das Paar ist auffällig (4 Kämpfe, Siege ohne Verluste des Verteidigers).
  const list = await suspiciousPairs(db, Date.now());
  const pair = list.pairs.find((p) => p.a === Math.min(a.playerId, b.playerId) && p.b === Math.max(a.playerId, b.playerId))!;
  assert.ok(pair, "Paar gelistet");
  assert.equal(pair.fights, 4);
  // Ersten Bericht aus der Wertung nehmen: a verliert ihn, die Paarbremse zählt ihn weiter mit.
  await setReportExcluded(db, ids[0], true);
  st = await computeStandings(db, season.startsAt.getTime(), Date.now());
  assert.equal(pts(a.playerId), Math.floor((v * pf * 0.25) / 100));
  assert.equal((await suspiciousPairs(db, Date.now())).pairs.find((p) => p === pair || (p.a === pair.a && p.b === pair.b))!.reports.find((r) => r.id === ids[0])!.excluded, true);
  await setReportExcluded(db, ids[0], false);
  st = await computeStandings(db, season.startsAt.getTime(), Date.now());
  assert.equal(pts(a.playerId), Math.floor((v * pf * 1.25) / 100));
  await assert.rejects(setReportExcluded(db, 999999, true), (e: { code?: string }) => e.code === "no_report");
});

test("Absprache-Sperre: Handel, Transport oder frühere Allianz in 7 Tagen – kein Kopfgeld, Mutfaktor höchstens 1", async () => {
  assert.equal(await colluded(db, Neu.playerId, Kai.playerId, Date.now()), false);
  // Angenommenes Handelsangebot zwischen Neu und Kai.
  await db.insert(tables.playerOffer).values({
    sellerId: Kai.playerId, give: "stahl", giveQty: 10, want: "proviant", wantQty: 10, visibility: "public", status: "accepted",
    buyerId: Neu.playerId, closedAt: new Date(),
  });
  assert.equal(await colluded(db, Neu.playerId, Kai.playerId, Date.now()), true);
  const v = (await pvpTargetView(engine, Neu.playerId, { col: Kai.col, row: Kai.row })).target!;
  assert.equal(v.collusion, true);
  assert.equal(v.bountyPct, 0);
  assert.equal(v.bountyBlocked, true);
  assert.ok(v.mut <= 1);
  // Nach 7 Tagen ist es vorbei.
  assert.equal(await colluded(db, Neu.playerId, Kai.playerId, Date.now() + (cfg.collusionDays + 1) * 86400000), false);
  // Beendete Allianz (recordTies, z. B. Austritt) und Transport zählen ebenso.
  assert.equal(await colluded(db, Lea.playerId, Neu.playerId, Date.now()), false);
  await recordTies(db, [Lea.playerId], [Neu.playerId], Date.now());
  assert.equal(await colluded(db, Lea.playerId, Neu.playerId, Date.now()), true);
  await db.insert(tables.battleReport).values({
    kind: "transport", title: "Transport", attackerPlayerId: Kai.playerId, defenderPlayerId: Lea.playerId, balanceVersion: balance.version, report: { cargo: {} },
  });
  assert.equal(await colluded(db, Lea.playerId, Kai.playerId, Date.now()), true);
});

test("Anfängerschutz endet mit dem ersten eigenen Überfall auf einen Spielerhafen – in allen Häfen", async () => {
  const colony = await addSecondHarbor(db, Neu.playerId, { near: Neu, maxKm: 900, patch: (s) => { s.protection.createdAtMs = Date.now(); } });
  const before = await harborState(db, Neu.baseId);
  assert.equal(protectionStatus(before.protection, Date.now(), balance).reason, "anfaengerschutz");
  const view = (await pvpTargetView(engine, Neu.playerId, { col: Lea.col, row: Lea.row })).target!;
  assert.equal(view.beginnerEnds, true, "Hinweis „Dein Anfängerschutz endet damit“");
  const r = await launchMission(engine, Neu.playerId, key(), { type: "ueberfall", units: { korvette: 2 }, col: Lea.col, row: Lea.row });
  assert.equal(r.ok, true, JSON.stringify(r));
  const home = await harborState(db, Neu.baseId);
  const col = await harborState(db, colony.baseId);
  assert.ok(home.protection.beginnerEndedAtMs! > 0);
  assert.notEqual(protectionStatus(home.protection, Date.now() + 1000, balance).reason, "anfaengerschutz");
  assert.ok(col.protection.beginnerEndedAtMs! > 0, "Kolonie ebenso");
  assert.notEqual(protectionStatus(col.protection, Date.now() + 1000, balance).reason, "anfaengerschutz");
  // Jetzt ist Neu selbst angreifbar (kein Anfängerschutz mehr).
  const back = await launchMission(engine, Lea.playerId, key(), { type: "ueberfall", units: { korvette: 1 }, col: Neu.col, row: Neu.row });
  assert.equal(back.ok, true, JSON.stringify(back));
  const v2 = (await pvpTargetView(engine, Neu.playerId, { col: Kai.col, row: Kai.row })).target!;
  assert.equal(v2.beginnerEnds, false);
  const [m] = await db.select().from(tables.mission).where(and(eq(tables.mission.playerId, Neu.playerId), eq(tables.mission.type, "ueberfall")));
  assert.ok(m);
});
