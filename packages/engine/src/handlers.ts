// Ereignis-Handler. Jeder läuft in der Transaktion seines Ereignisses und sperrt Stützpunkte aufsteigend.
import { and, eq, gt, sql } from "drizzle-orm";
import {
  applyDefenseResult,
  attackerReturning,
  baseStrength,
  combineModifiers,
  completeTraining,
  completeUpgrade,
  composeRaid,
  defenderFromBase,
  deliverCargo,
  fleetTotals,
  isNestRespawned,
  isWeakTarget,
  nestDefender,
  nestGarrison,
  raidBlocked,
  resolveBattle,
  returnMission,
  salvageWreck,
  scoutBase,
  settle,
  type AttackerInput,
  type BattleReport,
  type Counts,
  type Mission,
  type ResourceMap,
} from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { recordReportIntel } from "./intel-store.ts"; // Lagebild
import { balance } from "./context.ts";
import { cartelRaidPlan, nestSpots } from "./kartell-route.ts"; // Seewege: Kartell fährt über Wasser
import type { EventRow, Handler, HandlerResult } from "./events.ts";
import { lockBase, lockBases, randomSeed, readBase, saveBase, scheduleEvent } from "./store.ts";
import { attackWarning, scheduleAttackWarning } from "./event-notices.ts";
import { atWar } from "./alliance-core.ts"; // Diplomatie (Krieg)
// Weltereignisse (world-events*.ts): Missionsziel „event“ und eigene Ereignistypen.
import { eventMissionArrive } from "./world-events-missions.ts";
import { WORLD_EVENT_HANDLERS } from "./world-events-run.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { withAttackExperience } from "./veterans.ts";
import { cartelStrength, scaledRaidBalance } from "./cartel-strength.ts"; // Verwaltung: Kartell-Stärke
import { scoutWithDisinfo } from "./espionage.ts"; // Nachrichtendienst (Desinformation)
import { battleWeather, fogAt } from "./weather.ts"; // Wetter am Kampfort und Nebel (v1.6)
import { admiralsAfterBattle, defenseAdmiral, missionAdmiral } from "./admirals-battle.ts"; // Admirale
// Allianz-Ops: Stationierung (Ankunft, stationierte Verbündete verteidigen mit)
import { STATION_TYPE, settleGuests, stationArrive, stationedGuests, withGuests } from "./alliance-ops-station.ts";
import { holdDelivery, NAVAL_HANDLERS, navalArrive } from "./naval.ts"; // See: Minen/Blockade/Konvoi
import { mineReturnFor } from "./naval-mines.ts"; // See: Minen auf der Rückfahrt
import { fieldArrive } from "./fields-missions.ts"; // Felder: Aufklärung/Besetzen
import { FIELD_HANDLERS } from "./fields-run.ts"; // Felder: field_tick, field_delivery, field_raid
import { expansionArrive, isExpansionType } from "./expansion.ts"; // Mehrere Häfen: Gründung/Verlegung
import { INTEL_HANDLERS, withIntelArrive } from "./intel-ops.ts"; // Lagebild Stufe 2: Patrouille, Kampagne, Radarposten

const HOUR_MS = 3600000;
const none = (): HandlerResult => ({ notify: [] });

const buildComplete: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  const order = b.state.buildQueue[0];
  // Abgebrochen, verschoben oder schon erledigt: nichts zu tun. Sonst alle fälligen Aufträge abschließen.
  if (!order || order.finishesAt > due) return none();
  const r = completeUpgrade(b.state, due, balance, await modsOf(tx, b, due));
  if (!r.ok) return none();
  await saveBase(tx, b.id, r.base);
  return { notify: [[[b.playerId], "base"]] };
};

const trainingComplete: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  const r = completeTraining(b.state, due, balance, await modsOf(tx, b, due));
  if (!r.ok) return none();
  await saveBase(tx, b.id, r.base);
  return { notify: [[[b.playerId], "base"]] };
};

interface MissionRow {
  id: number;
  playerId: number | null;
  baseId: number | null;
  type: string;
  targetKind: string;
  targetId: number | null;
  targetCol: number;
  targetRow: number;
  plan: unknown;
  status: string;
}

async function lockMission(tx: Tx, id: number): Promise<MissionRow | null> {
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, id)).for("update");
  return (m as MissionRow) ?? null;
}

async function playerName(tx: Tx, id: number | null): Promise<string> {
  if (id === null) return "Freibeuter-Kartell";
  const [p] = await tx.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
  return p?.name ?? "?";
}

/** Wrackfeld am Kampfort anlegen. (Auch für Allianz-Ops.) */
export async function dropWreck(tx: Tx, col: number, row: number, wreck: ResourceMap, atMs: number): Promise<void> {
  if ((wreck.stahl ?? 0) + (wreck.elektronik ?? 0) <= 0) return;
  await tx.insert(tables.wreck).values({
    col,
    row,
    stahl: wreck.stahl ?? 0,
    elektronik: wreck.elektronik ?? 0,
    createdAt: new Date(atMs),
  });
}

/** Wrackgut am Feld bergen, bis die freie Ladekapazität erschöpft ist. (Auch für Allianz-Ops.) */
export async function salvageAt(tx: Tx, col: number, row: number, freeCargo: number, atMs: number): Promise<ResourceMap> {
  const got: ResourceMap = { stahl: 0, elektronik: 0 };
  if (freeCargo <= 0) return got;
  const rows = await tx
    .select()
    .from(tables.wreck)
    .where(and(eq(tables.wreck.col, col), eq(tables.wreck.row, row)))
    .orderBy(tables.wreck.id)
    .for("update");
  let free = freeCargo;
  for (const w of rows) {
    const s = salvageWreck({ stahl: w.stahl, elektronik: w.elektronik, createdAtMs: w.createdAt.getTime() }, free, atMs, balance);
    got.stahl += s.taken.stahl;
    got.elektronik += s.taken.elektronik;
    free -= s.taken.stahl + s.taken.elektronik;
    if (s.rest.stahl < 1 && s.rest.elektronik < 1) await tx.delete(tables.wreck).where(eq(tables.wreck.id, w.id));
    else await tx.update(tables.wreck).set({ stahl: s.rest.stahl, elektronik: s.rest.elektronik }).where(eq(tables.wreck.id, w.id));
    if (free <= 0) break;
  }
  return got;
}

function sumMap(m: ResourceMap): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}

function addMaps(a: ResourceMap, b: ResourceMap): ResourceMap {
  const out: ResourceMap = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export async function storeReport( // auch für Allianz-Ops
  tx: Tx,
  values: {
    kind: string;
    title: string;
    attackerPlayerId: number | null;
    defenderPlayerId: number | null;
    attackerBaseId: number | null;
    defenderBaseId: number | null;
    nestId: number | null;
    winner: string | null;
    seed: number | null;
    report: unknown;
    atMs: number;
  },
): Promise<number> {
  const [r] = await tx
    .insert(tables.battleReport)
    .values({ ...values, balanceVersion: balance.version, createdAt: new Date(values.atMs) })
    .returning({ id: tables.battleReport.id });
  await recordReportIntel(tx, values); // Lagebild: der Bericht zeigt dem Absender das Ziel genau
  return r.id;
}

/** Ankunft einer Spieler-Mission am Ziel. */
const missionArrive: Handler = async (tx, ev, due) => {
  const m = await lockMission(tx, Number(ev.payload.missionId));
  if (!m || m.status !== "outbound") return none();
  if (m.type === STATION_TYPE) return stationArrive(tx, m, due); // Allianz-Ops: Stationierung
  if (isExpansionType(m.type)) return expansionArrive(tx, m, due); // Mehrere Häfen
  let plan = m.plan as Mission;
  const notify: HandlerResult["notify"] = [[[m.playerId!], "missions"]];
  const push: NonNullable<HandlerResult["push"]> = [];
  // See: Minen/Blockade/Konvoi – eigene Missionsarten, Minen auf der Hinfahrt, Transport-Konvoi (naval.ts).
  const naval = await navalArrive(tx, m, plan, due, notify, push);
  if (naval.done) return { notify: [...notify, [[m.playerId!], "reports"], [[m.playerId!], "base"]], push };
  plan = naval.plan;
  const origin = await readBase(tx, m.baseId!);
  if (m.targetKind === "field") { await fieldArrive(tx, m, plan, origin, due, notify, push); return { notify: [...notify, [[m.playerId!], "base"]], push }; } // Felder
  let returning: Counts = { ...plan.units };
  let cargoHome: ResourceMap = {};
  let reportId: number | null = null;
  const attackerName = await playerName(tx, m.playerId);
  // Modifikatoren des Angreifers (Kampf, Ladung) und je Ziel des Verteidigers.
  // Admirale: Führer des Verbands wirkt auf Kampf, Ladung und Beute dieses Verbands.
  const admA = await missionAdmiral(tx, plan, m.id, m.playerId);
  const attackerMods = combineModifiers(await modifiersFor(tx, m.playerId, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome }), admA?.mods);

  if (m.targetKind === "base") {
    const target = await lockBase(tx, m.targetId!);
    if (!target) {
      // Ziel existiert nicht mehr: Verband kehrt um.
    } else if (m.type === "transport") {
      await saveBase(tx, target.id, deliverCargo(target.state, plan.cargo, due, balance, await modsOf(tx, target, due)));
      notify.push([[target.playerId], "base"]);
      reportId = await storeReport(tx, {
        kind: "transport", title: `Transport an ${target.name} angekommen`, attackerPlayerId: m.playerId,
        defenderPlayerId: target.playerId, attackerBaseId: m.baseId, defenderBaseId: target.id, nestId: null,
        winner: null, seed: null, atMs: due,
        report: { cargo: plan.cargo, from: attackerName, to: target.name },
      });
    } else if (m.type === "aufklaerung") {
      // Nebel (v1.6) und Nachrichtendienst: hinterlegte Desinformation des Ziels verfälscht dieses Lagebild (einmalig).
      const { scout } = await scoutWithDisinfo(tx, target, m.playerId, scoutBase(target.state, due, balance, await modsOf(tx, target, due), fogAt(target.col, target.row, due)), due);
      reportId = await storeReport(tx, {
        kind: "aufklaerung", title: `Aufklärung: ${target.name}`, attackerPlayerId: m.playerId, defenderPlayerId: null,
        attackerBaseId: m.baseId, defenderBaseId: target.id, nestId: null, winner: null, seed: null, atMs: due,
        report: { scout, targetName: target.name, owner: await playerName(tx, target.playerId) },
      });
    } else {
      const targetMods = await modsOf(tx, target, due);
      const defenderBase = settle(target.state, due, balance, targetMods);
      const [prior] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tables.battleReport)
        .where(and(
          eq(tables.battleReport.kind, "ueberfall"),
          eq(tables.battleReport.attackerPlayerId, m.playerId!),
          eq(tables.battleReport.defenderBaseId, target.id),
          gt(tables.battleReport.createdAt, new Date(due - balance.loot.repeatWindowHours * HOUR_MS)),
        ));
      const attacker: AttackerInput = {
        units: plan.units,
        versorgungsmangel: origin?.state.versorgungsmangel ?? false,
        priorAttacksInWindow: prior?.n ?? 0,
        weakTarget: origin ? isWeakTarget(baseStrength(origin.state), baseStrength(defenderBase), balance) : false,
        modifiers: attackerMods,
      };
      // Diplomatie: im Krieg (nach Vorlauf) entfällt die Schwachziel-Kürzung der Beute.
      if (attacker.weakTarget && (await atWar(tx, m.playerId!, target.playerId, due))) attacker.weakTarget = false;
      const seed = randomSeed();
      const admD = await defenseAdmiral(tx, target.playerId, target.id, due); // Admirale: Hafenkommandant des Ziels
      const defender = defenderFromBase(defenderBase, balance, combineModifiers(targetMods, admD?.mods));
      const guests = await stationedGuests(tx, target.id); // Allianz-Ops: stationierte Verbündete verteidigen mit
      const res = resolveBattle(attacker, withGuests(defender, guests), balance, seed, battleWeather(target.col, target.row, due));
      if (!res.ok) throw new Error(`battle: ${res.code}`);
      const report = res.report;
      const admirals = await admiralsAfterBattle(tx, report, seed, admA, admD, due); // Admirale
      const hostReport = await settleGuests(tx, guests, defender, report, due, notify); // Allianz-Ops
      await saveBase(tx, target.id, applyDefenseResult(defenderBase, hostReport, due, balance, targetMods));
      await dropWreck(tx, m.targetCol, m.targetRow, report.wreck, due);
      returning = attackerReturning(report);
      cargoHome = report.loot;
      reportId = await storeReport(tx, {
        kind: "ueberfall",
        title: `Überfall auf ${target.name}`,
        attackerPlayerId: m.playerId, defenderPlayerId: target.playerId, attackerBaseId: m.baseId,
        defenderBaseId: target.id, nestId: null, winner: report.winner, seed, atMs: due,
        report: { battle: report, attackerName, defenderName: await playerName(tx, target.playerId), targetName: target.name, attacker, protectedPerResource: defender.protectedPerResource ?? 0, admirals, ...(hostReport.guests ? { guests: hostReport.guests } : {}) },
      });
      notify.push([[target.playerId], "base"], [[target.playerId], "reports"]);
    }
  } else if (m.targetKind === "nest") {
    const [nest] = await tx.select().from(tables.nest).where(eq(tables.nest.id, m.targetId!)).for("update");
    const empty = nest.defeatedAt !== null && !isNestRespawned(nest.defeatedAt.getTime(), due, balance, nest.level);
    if (m.type === "aufklaerung") {
      const g = nestGarrison(nest.level, balance);
      reportId = await storeReport(tx, {
        kind: "aufklaerung", title: `Aufklärung: Piratennest Stufe ${nest.level}`, attackerPlayerId: m.playerId,
        defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: nest.id, winner: null,
        seed: null, atMs: due,
        report: { nest: { level: nest.level, empty, garrison: g.ok && !empty ? g.nest : null } },
      });
    } else if (m.type === "ueberfall" && !empty) {
      const def = nestDefender(nest.level, balance);
      if (!def.ok) throw new Error(def.code);
      const attacker: AttackerInput = { units: plan.units, versorgungsmangel: origin?.state.versorgungsmangel ?? false, modifiers: attackerMods };
      const seed = randomSeed();
      const res = resolveBattle(attacker, def.defender, balance, seed, battleWeather(nest.col, nest.row, due));
      if (!res.ok) throw new Error(`battle: ${res.code}`);
      const report = res.report;
      const admirals = await admiralsAfterBattle(tx, report, seed, admA, null, due); // Admirale
      if (report.winner === "attacker") {
        await tx.update(tables.nest).set({ defeatedAt: new Date(due) }).where(eq(tables.nest.id, nest.id));
        notify.push([null, "map"]);
      }
      await dropWreck(tx, m.targetCol, m.targetRow, report.wreck, due);
      returning = attackerReturning(report);
      cargoHome = report.loot;
      reportId = await storeReport(tx, {
        kind: "ueberfall", title: `Überfall auf Piratennest Stufe ${nest.level}`, attackerPlayerId: m.playerId,
        defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: nest.id,
        winner: report.winner, seed, atMs: due,
        report: { battle: report, attackerName, defenderName: "Freibeuter-Kartell", targetName: `Piratennest Stufe ${nest.level}`, attacker, admirals },
      });
    } else if (m.type === "ueberfall") {
      reportId = await storeReport(tx, {
        kind: "leer", title: `Piratennest Stufe ${nest.level} ist verlassen`, attackerPlayerId: m.playerId,
        defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: nest.id, winner: null,
        seed: null, atMs: due, report: { nestLevel: nest.level },
      });
    }
  } else if (m.targetKind === "event") {
    // Weltereignis: Kampf, Beute und Ende in world-events-missions.ts.
    const r = await eventMissionArrive(tx, m, plan, origin, due, attackerName, admA); // Admirale: Führer des Verbands
    returning = r.returning;
    cargoHome = r.cargoHome;
    reportId = r.reportId;
    notify.push(...r.notify);
    push.push(...r.push);
  }

  // Wrackgut bergen: freie Ladekapazität der heimkehrenden Schiffe nach der Beute.
  const free = fleetTotals(returning, balance, attackerMods).cargoCapacity - sumMap(cargoHome);
  const salvage = await salvageAt(tx, m.targetCol, m.targetRow, free, due);
  if (salvage.stahl + salvage.elektronik > 0) {
    cargoHome = addMaps(cargoHome, salvage);
    // Im Bericht getrennt von der Beute ausweisen.
    if (reportId !== null) {
      await tx.update(tables.battleReport)
        .set({ report: sql`${tables.battleReport.report} || ${JSON.stringify({ salvage })}::jsonb` })
        .where(eq(tables.battleReport.id, reportId));
    }
  }

  const returnAt = (plan.returnAtMs ?? due) + Math.max(0, due - plan.arriveAtMs);
  await tx
    .update(tables.mission)
    .set({ status: "returning", returning, cargoHome, reportId, returnAt: new Date(returnAt) })
    .where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  notify.push([[m.playerId!], "reports"]);
  return { notify, push };
};

const missionReturn: Handler = async (tx, ev, due) => {
  const m = await lockMission(tx, Number(ev.payload.missionId));
  if (!m || m.status !== "returning") return none();
  const b = await lockBase(tx, m.baseId!);
  const plan = m.plan as Mission;
  const notify: HandlerResult["notify"] = [[[m.playerId!], "base"], [[m.playerId!], "missions"]];
  if (b) {
    const [row] = await tx.select().from(tables.mission).where(eq(tables.mission.id, m.id));
    // See: Minen auf der Rückfahrt (naval-mines.ts) – Verluste fehlen bei der Rückkehr, Ladung nach Laderaum.
    const back = await mineReturnFor(tx, m, plan, (row.returning as Counts) ?? {}, (row.cargoHome as ResourceMap) ?? {}, due, notify);
    const next = returnMission(
      b.state,
      plan.units,
      back.units,
      back.cargo,
      due,
      balance,
      await modsOf(tx, b, due),
    );
    // Veteranen: Erfahrung des heimgekehrten Verbands aus dem Kampfbericht der Mission.
    await saveBase(tx, b.id, await withAttackExperience(tx, row.reportId, m.playerId, next));
  }
  await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
  return { notify };
};

/** Kartell läuft aus: Verband nach der aktuellen Verteidigung, Ankunft nach RAID_LEAD_MS (Seewege: länger um Land). */
const raidLaunch: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  await scheduleEvent(tx, "raid_launch", due + balance.pirates.raidIntervalHours * HOUR_MS, {}, b.id);
  // Seewege: vom nächsten Nest über Wasser; Vorlauf 1 h auf offener See, länger um Land (kartell-route.ts).
  const sea = cartelRaidPlan(await nestSpots(tx), b);
  const arrive = due + sea.leadMs;
  if (raidBlocked(b.state.protection, due, balance).blocked || raidBlocked(b.state.protection, arrive, balance).blocked) {
    return none();
  }
  const mods = await modsOf(tx, b, due);
  const state = settle(b.state, due, balance, mods);
  // Eigener Seed für die Stärke-Schwankung des Kartells (unabhängig vom Kampf-Seed).
  // Verwaltung: Regler „Kartell-Stärke“ skaliert die Überfallstärke (100 % = Balance).
  const raid = composeRaid(state.units, state.defenses, scaledRaidBalance(balance, await cartelStrength(tx)), randomSeed(), mods);
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId: null, baseId: null, type: "kartell", targetKind: "base", targetId: b.id, targetCol: b.col,
      targetRow: b.row, plan: { units: raid.units, attacker: raid.attacker, departAtMs: due, arriveAtMs: arrive, ...(sea.route ? { route: sea.route } : {}) },
      status: "outbound", arriveAt: new Date(arrive),
    })
    .returning({ id: tables.mission.id });
  await scheduleEvent(tx, "raid_arrive", arrive, { missionId: m.id }, b.id);
  await scheduleAttackWarning(tx, { missionId: m.id, targetBaseId: b.id, targetState: state, arriveAtMs: arrive, nowMs: due, targetMods: mods });
  return { notify: [[[b.playerId], "missions"]] };
};

const raidArrive: Handler = async (tx, ev, due) => {
  const m = await lockMission(tx, Number(ev.payload.missionId));
  if (!m || m.status !== "outbound") return none();
  const b = await lockBase(tx, m.targetId!);
  if (!b) return none();
  const plan = m.plan as { attacker: AttackerInput };
  const blocked = raidBlocked(b.state.protection, due, balance);
  if (blocked.blocked) {
    // Sichtbarer Hinweis für den Verteidiger: der Verband traf auf den Schutz und drehte ab.
    const reportId = await storeReport(tx, {
      kind: "abgewiesen", title: `Kartell-Überfall auf ${b.name} abgewiesen`, attackerPlayerId: null, defenderPlayerId: b.playerId,
      attackerBaseId: null, defenderBaseId: b.id, nestId: null, winner: null, seed: null, atMs: due,
      report: { reason: blocked.reason ?? null, targetName: b.name },
    });
    await tx.update(tables.mission).set({ status: "done", reportId }).where(eq(tables.mission.id, m.id));
    return { notify: [[[b.playerId], "missions"], [[b.playerId], "reports"]] };
  }
  // Kartell-Verteidigung: Forschung (und künftige Quellen) des Verteidigers wirken.
  const mods = await modsOf(tx, b, due);
  const state = settle(b.state, due, balance, mods);
  const seed = randomSeed();
  const admD = await defenseAdmiral(tx, b.playerId, b.id, due); // Admirale: Hafenkommandant
  const defender = defenderFromBase(state, balance, combineModifiers(mods, admD?.mods));
  const guests = await stationedGuests(tx, b.id); // Allianz-Ops: stationierte Verbündete verteidigen mit
  const res = resolveBattle(plan.attacker, withGuests(defender, guests), balance, seed, battleWeather(b.col, b.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const report: BattleReport = res.report;
  const admirals = await admiralsAfterBattle(tx, report, seed, null, admD, due); // Admirale
  const hostReport = await settleGuests(tx, guests, defender, report, due); // Allianz-Ops
  await saveBase(tx, b.id, applyDefenseResult(state, hostReport, due, balance, mods));
  await dropWreck(tx, b.col, b.row, report.wreck, due);
  const reportId = await storeReport(tx, {
    kind: "kartell", title: `Kartell überfällt ${b.name}`, attackerPlayerId: null, defenderPlayerId: b.playerId,
    attackerBaseId: null, defenderBaseId: b.id, nestId: null, winner: report.winner, seed, atMs: due,
    report: { battle: report, attackerName: "Freibeuter-Kartell", defenderName: await playerName(tx, b.playerId), targetName: b.name, attacker: plan.attacker, protectedPerResource: defender.protectedPerResource ?? 0, admirals, ...(hostReport.guests ? { guests: hostReport.guests } : {}) },
  });
  await tx.update(tables.mission).set({ status: "done", reportId }).where(eq(tables.mission.id, m.id));
  return { notify: [[[b.playerId], "base"], [[b.playerId], "reports"], [[b.playerId], "missions"]] };
};

const deliveryArrive: Handler = async (tx, ev, due) => {
  const [d] = await tx
    .select()
    .from(tables.delivery)
    .where(eq(tables.delivery.id, String(ev.payload.deliveryId)))
    .for("update");
  if (!d || d.status !== "underway") return none();
  if (await holdDelivery(tx, d, due)) return { notify: [[[d.playerId], "base"]] }; // See: Blockade hält Lieferungen zurück
  // Minen können beim Einlaufen Ladung versenkt haben (deliveryConvoyArrived kürzt die Lieferung).
  const [fresh] = await tx.select({ qty: tables.delivery.qty }).from(tables.delivery).where(eq(tables.delivery.id, d.id));
  if (fresh) d.qty = fresh.qty;
  const b = await lockBase(tx, d.baseId);
  if (b) await saveBase(tx, b.id, deliverCargo(b.state, { [d.resource]: d.qty }, due, balance, await modsOf(tx, b, due)));
  // Journal: die Lieferung geht an den Spieler.
  await tx.insert(tables.tradeLedger).values([
    { tradeId: `${d.id}:arrival`, tMs: due, account: `delivery:${d.id}`, asset: d.resource, amount: String(-d.qty) },
    { tradeId: `${d.id}:arrival`, tMs: due, account: `player:${d.playerId}`, asset: d.resource, amount: String(d.qty) },
  ]);
  await tx.update(tables.delivery).set({ status: "delivered" }).where(eq(tables.delivery.id, d.id));
  return { notify: [[[d.playerId], "base"], [[d.playerId], "market"]] };
};

export const HANDLERS: Record<string, Handler> = {
  build_complete: buildComplete,
  training_complete: trainingComplete,
  mission_arrive: withIntelArrive(missionArrive), // Lagebild Stufe 2
  mission_return: missionReturn,
  raid_launch: raidLaunch,
  raid_arrive: raidArrive,
  delivery_arrive: deliveryArrive,
  season_end: (tx, ev, due) => import("./season.ts").then((m) => m.seasonEnd(tx, ev, due)),
  cable_tick: (tx, ev, due) => import("./power-cable.ts").then((m) => m.cableTick(tx, ev, due)), // Seekabel (v1.21)
  attack_warning: attackWarning,
  ...WORLD_EVENT_HANDLERS,
  ...NAVAL_HANDLERS, // See: Minen/Blockade/Konvoi (blockade_end, convoy_raid)
  ...FIELD_HANDLERS, // Felder
  ...INTEL_HANDLERS, // Lagebild Stufe 2 (patrol_tick, patrol_end, radar_post_tick)
  pact_expire: (tx, _ev, due) => import("./alliance-core.ts").then(async (m) => {
    const notify: HandlerResult["notify"] = [];
    await m.purgeExpired(tx, due, notify);
    return { notify };
  }),
  research_complete: (tx, ev, due) => import("./research.ts").then((m) => m.researchComplete(tx, ev, due)),
  // Nachrichtendienst und Spionage (espionage-run.ts)
  spy_arrive: (tx, ev, due) => import("./espionage-run.ts").then((m) => m.spyArrive(tx, ev, due)),
  spy_sabotage_end: (tx, ev, due) => import("./espionage-run.ts").then((m) => m.spySabotageEnd(tx, ev, due)),
  // Allianz-Ops: Sammelangriff läuft zur Beitrittsfrist aus und kommt gemeinsam an
  alliance_raid_launch: (tx, ev, due) => import("./alliance-ops-raid.ts").then((m) => m.raidLaunch(tx, ev, due)),
  alliance_raid_arrive: (tx, ev, due) => import("./alliance-ops-battle.ts").then((m) => m.raidArrive(tx, ev, due)),
};

// Für Tests
export type { EventRow };
export { lockBases };
