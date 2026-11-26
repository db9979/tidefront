// Ereignis-Handler. Jeder läuft in der Transaktion seines Ereignisses und sperrt Stützpunkte aufsteigend.
import { and, eq, gt, sql } from "drizzle-orm";
import {
  applyDefenseResult,
  attackerReturning,
  baseStrength,
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
import { balance, RAID_LEAD_MS } from "./context.ts";
import type { EventRow, Handler, HandlerResult } from "./events.ts";
import { lockBase, lockBases, randomSeed, readBase, saveBase, scheduleEvent } from "./store.ts";

const HOUR_MS = 3600000;
const none = (): HandlerResult => ({ notify: [] });

const buildComplete: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  const order = b.state.buildQueue[0];
  // Abgebrochen, verschoben oder schon erledigt: nichts zu tun. Sonst alle fälligen Aufträge abschließen.
  if (!order || order.finishesAt > due) return none();
  const r = completeUpgrade(b.state, due, balance);
  if (!r.ok) return none();
  await saveBase(tx, b.id, r.base);
  return { notify: [[[b.playerId], "base"]] };
};

const trainingComplete: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  const r = completeTraining(b.state, due, balance);
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

/** Wrackfeld am Kampfort anlegen. */
async function dropWreck(tx: Tx, col: number, row: number, wreck: ResourceMap, atMs: number): Promise<void> {
  if ((wreck.stahl ?? 0) + (wreck.elektronik ?? 0) <= 0) return;
  await tx.insert(tables.wreck).values({
    col,
    row,
    stahl: wreck.stahl ?? 0,
    elektronik: wreck.elektronik ?? 0,
    createdAt: new Date(atMs),
  });
}

/** Wrackgut am Feld bergen, bis die freie Ladekapazität erschöpft ist. */
async function salvageAt(tx: Tx, col: number, row: number, freeCargo: number, atMs: number): Promise<ResourceMap> {
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

async function storeReport(
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
  return r.id;
}

/** Ankunft einer Spieler-Mission am Ziel. */
const missionArrive: Handler = async (tx, ev, due) => {
  const m = await lockMission(tx, Number(ev.payload.missionId));
  if (!m || m.status !== "outbound") return none();
  const plan = m.plan as Mission;
  const notify: HandlerResult["notify"] = [[[m.playerId!], "missions"]];
  const origin = await readBase(tx, m.baseId!);
  let returning: Counts = { ...plan.units };
  let cargoHome: ResourceMap = {};
  let reportId: number | null = null;
  const attackerName = await playerName(tx, m.playerId);

  if (m.targetKind === "base") {
    const target = await lockBase(tx, m.targetId!);
    if (!target) {
      // Ziel existiert nicht mehr: Verband kehrt um.
    } else if (m.type === "transport") {
      await saveBase(tx, target.id, deliverCargo(target.state, plan.cargo, due, balance));
      notify.push([[target.playerId], "base"]);
      reportId = await storeReport(tx, {
        kind: "transport", title: `Transport an ${target.name} angekommen`, attackerPlayerId: m.playerId,
        defenderPlayerId: target.playerId, attackerBaseId: m.baseId, defenderBaseId: target.id, nestId: null,
        winner: null, seed: null, atMs: due,
        report: { cargo: plan.cargo, from: attackerName, to: target.name },
      });
    } else if (m.type === "aufklaerung") {
      const scout = scoutBase(target.state, due, balance);
      reportId = await storeReport(tx, {
        kind: "aufklaerung", title: `Aufklärung: ${target.name}`, attackerPlayerId: m.playerId, defenderPlayerId: null,
        attackerBaseId: m.baseId, defenderBaseId: target.id, nestId: null, winner: null, seed: null, atMs: due,
        report: { scout, targetName: target.name, owner: await playerName(tx, target.playerId) },
      });
    } else {
      const defenderBase = settle(target.state, due, balance);
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
      };
      const seed = randomSeed();
      const res = resolveBattle(attacker, defenderFromBase(defenderBase, balance), balance, seed);
      if (!res.ok) throw new Error(`battle: ${res.code}`);
      const report = res.report;
      await saveBase(tx, target.id, applyDefenseResult(defenderBase, report, due, balance));
      await dropWreck(tx, m.targetCol, m.targetRow, report.wreck, due);
      returning = attackerReturning(report);
      cargoHome = report.loot;
      reportId = await storeReport(tx, {
        kind: "ueberfall",
        title: `Überfall auf ${target.name}`,
        attackerPlayerId: m.playerId, defenderPlayerId: target.playerId, attackerBaseId: m.baseId,
        defenderBaseId: target.id, nestId: null, winner: report.winner, seed, atMs: due,
        report: { battle: report, attackerName, defenderName: await playerName(tx, target.playerId), targetName: target.name, attacker },
      });
      notify.push([[target.playerId], "base"], [[target.playerId], "reports"]);
    }
  } else if (m.targetKind === "nest") {
    const [nest] = await tx.select().from(tables.nest).where(eq(tables.nest.id, m.targetId!)).for("update");
    const empty = nest.defeatedAt !== null && !isNestRespawned(nest.defeatedAt.getTime(), due, balance);
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
      const attacker: AttackerInput = { units: plan.units, versorgungsmangel: origin?.state.versorgungsmangel ?? false };
      const seed = randomSeed();
      const res = resolveBattle(attacker, def.defender, balance, seed);
      if (!res.ok) throw new Error(`battle: ${res.code}`);
      const report = res.report;
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
        report: { battle: report, attackerName, defenderName: "Freibeuter-Kartell", targetName: `Piratennest Stufe ${nest.level}`, attacker },
      });
    } else if (m.type === "ueberfall") {
      reportId = await storeReport(tx, {
        kind: "leer", title: `Piratennest Stufe ${nest.level} ist verlassen`, attackerPlayerId: m.playerId,
        defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: null, nestId: nest.id, winner: null,
        seed: null, atMs: due, report: { nestLevel: nest.level },
      });
    }
  }

  // Wrackgut bergen: freie Ladekapazität der heimkehrenden Schiffe nach der Beute.
  const free = fleetTotals(returning, balance).cargoCapacity - sumMap(cargoHome);
  const salvage = await salvageAt(tx, m.targetCol, m.targetRow, free, due);
  if (salvage.stahl + salvage.elektronik > 0) cargoHome = addMaps(cargoHome, salvage);

  const returnAt = (plan.returnAtMs ?? due) + Math.max(0, due - plan.arriveAtMs);
  await tx
    .update(tables.mission)
    .set({ status: "returning", returning, cargoHome, reportId, returnAt: new Date(returnAt) })
    .where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  notify.push([[m.playerId!], "reports"]);
  return { notify };
};

const missionReturn: Handler = async (tx, ev, due) => {
  const m = await lockMission(tx, Number(ev.payload.missionId));
  if (!m || m.status !== "returning") return none();
  const b = await lockBase(tx, m.baseId!);
  const plan = m.plan as Mission;
  if (b) {
    const [row] = await tx.select().from(tables.mission).where(eq(tables.mission.id, m.id));
    const next = returnMission(
      b.state,
      plan.units,
      (row.returning as Counts) ?? {},
      (row.cargoHome as ResourceMap) ?? {},
      due,
      balance,
    );
    await saveBase(tx, b.id, next);
  }
  await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
  return { notify: [[[m.playerId!], "base"], [[m.playerId!], "missions"]] };
};

/** Kartell läuft aus: Verband nach der aktuellen Verteidigung, Ankunft nach RAID_LEAD_MS. */
const raidLaunch: Handler = async (tx, ev, due) => {
  const b = await lockBase(tx, ev.baseId!);
  if (!b) return none();
  await scheduleEvent(tx, "raid_launch", due + balance.pirates.raidIntervalHours * HOUR_MS, {}, b.id);
  const arrive = due + RAID_LEAD_MS;
  if (raidBlocked(b.state.protection, due, balance).blocked || raidBlocked(b.state.protection, arrive, balance).blocked) {
    return none();
  }
  const state = settle(b.state, due, balance);
  const raid = composeRaid(state.units, state.defenses, balance);
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId: null, baseId: null, type: "kartell", targetKind: "base", targetId: b.id, targetCol: b.col,
      targetRow: b.row, plan: { units: raid.units, attacker: raid.attacker, departAtMs: due, arriveAtMs: arrive },
      status: "outbound", arriveAt: new Date(arrive),
    })
    .returning({ id: tables.mission.id });
  await scheduleEvent(tx, "raid_arrive", arrive, { missionId: m.id }, b.id);
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
    await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
    return { notify: [[[b.playerId], "missions"]] };
  }
  const state = settle(b.state, due, balance);
  const seed = randomSeed();
  const res = resolveBattle(plan.attacker, defenderFromBase(state, balance), balance, seed);
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const report: BattleReport = res.report;
  await saveBase(tx, b.id, applyDefenseResult(state, report, due, balance));
  await dropWreck(tx, b.col, b.row, report.wreck, due);
  const reportId = await storeReport(tx, {
    kind: "kartell", title: `Kartell überfällt ${b.name}`, attackerPlayerId: null, defenderPlayerId: b.playerId,
    attackerBaseId: null, defenderBaseId: b.id, nestId: null, winner: report.winner, seed, atMs: due,
    report: { battle: report, attackerName: "Freibeuter-Kartell", defenderName: await playerName(tx, b.playerId), targetName: b.name, attacker: plan.attacker },
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
  const b = await lockBase(tx, d.baseId);
  if (b) await saveBase(tx, b.id, deliverCargo(b.state, { [d.resource]: d.qty }, due, balance));
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
  mission_arrive: missionArrive,
  mission_return: missionReturn,
  raid_launch: raidLaunch,
  raid_arrive: raidArrive,
  delivery_arrive: deliveryArrive,
  season_end: (tx, ev, due) => import("./season.ts").then((m) => m.seasonEnd(tx, ev, due)),
};

// Für Tests
export type { EventRow };
export { lockBases };
