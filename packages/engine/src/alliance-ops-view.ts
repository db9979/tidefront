// Allianz-Ops: Lesemodelle – Sammelangriffe der eigenen Allianz (Allianz-Bildschirm) und Zugriff auf die gemeinsamen
// Kampfberichte (alle Teilnehmer sehen denselben Bericht).
import { and, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import { allianceOpsOf, type Counts, type Mission } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { membershipOf } from "./alliance-core.ts";

const DAY_MS = 24 * 3600000;

/** IDs gemeinsamer Berichte, an denen der Spieler teilnahm (optional nur `onlyId`). */
export async function sharedReportIds(db: DbOrTx, playerId: number, onlyId?: number): Promise<number[]> {
  const rows = await db
    .select({ id: tables.allianceRaid.reportId })
    .from(tables.allianceRaidMember)
    .innerJoin(tables.allianceRaid, eq(tables.allianceRaid.id, tables.allianceRaidMember.raidId))
    .where(and(
      eq(tables.allianceRaidMember.playerId, playerId),
      isNotNull(tables.allianceRaid.reportId),
      ...(onlyId !== undefined ? [eq(tables.allianceRaid.reportId, onlyId)] : []),
    ));
  return rows.map((r) => r.id!).filter((x) => x !== null);
}

/**
 * Sammelangriffe der eigenen Allianz: offen, unterwegs und die der letzten 24 Stunden. Spielerweit (Allianz); mit
 * mehreren Häfen nennt joinedBaseId den Hafen des eigenen Verbands (baseId des aktiven Hafens wird nicht gebraucht).
 */
export async function allianceRaidsView(engine: Engine, playerId: number, _baseId?: number) {
  const nowMs = Date.now();
  const ms = await membershipOf(engine.db, playerId);
  const cfg = allianceOpsOf(balance);
  if (!ms) return { serverNow: nowMs, alliance: false as const, limits: cfg, raids: [] };
  const raids = await engine.db
    .select()
    .from(tables.allianceRaid)
    .where(and(
      eq(tables.allianceRaid.allianceId, ms.allianceId),
      or(inArray(tables.allianceRaid.status, ["offen", "ausgelaufen"]), gt(tables.allianceRaid.createdAt, new Date(nowMs - DAY_MS))),
    ))
    .orderBy(desc(tables.allianceRaid.id))
    .limit(20);
  const ids = raids.map((r) => r.id);
  const members = ids.length
    ? await engine.db
      .select({ raidId: tables.allianceRaidMember.raidId, playerId: tables.allianceRaidMember.playerId, name: tables.player.name, plan: tables.mission.plan, status: tables.mission.status, arriveAt: tables.mission.arriveAt, baseId: tables.mission.baseId })
      .from(tables.allianceRaidMember)
      .innerJoin(tables.player, eq(tables.player.id, tables.allianceRaidMember.playerId))
      .innerJoin(tables.mission, eq(tables.mission.id, tables.allianceRaidMember.missionId))
      .where(inArray(tables.allianceRaidMember.raidId, ids))
      .orderBy(tables.allianceRaidMember.id)
    : [];
  const creators = new Map(
    (raids.length ? await engine.db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player).where(inArray(tables.player.id, raids.map((r) => r.creatorPlayerId))) : [])
      .map((p) => [p.id, p.name]),
  );
  return {
    serverNow: nowMs,
    alliance: true as const,
    limits: cfg,
    raids: raids.map((r) => {
      const list = members.filter((m) => m.raidId === r.id);
      const plannedArrive = list.reduce((mx, m) => Math.max(mx, m.arriveAt.getTime()), r.desiredArriveAt.getTime());
      return {
        id: r.id,
        status: r.status,
        target: { kind: r.targetKind, id: r.targetId, col: r.targetCol, row: r.targetRow, name: r.targetName },
        creator: creators.get(r.creatorPlayerId) ?? "?",
        desiredArriveAtMs: r.desiredArriveAt.getTime(),
        joinDeadlineMs: r.joinDeadline.getTime(),
        /** Tatsächliche (nach dem Auslaufen) bzw. voraussichtliche Ankunft. */
        arriveAtMs: r.arriveAt?.getTime() ?? plannedArrive,
        reportId: r.reportId,
        joined: list.some((m) => m.playerId === playerId),
        joinedBaseId: list.find((m) => m.playerId === playerId)?.baseId ?? null,
        canCancel: r.status === "offen" && (r.creatorPlayerId === playerId || ms.role !== "mitglied"),
        participants: list.map((m) => ({ name: m.name, mine: m.playerId === playerId, units: (m.plan as Mission).units as Counts, status: m.status })),
      };
    }),
  };
}
