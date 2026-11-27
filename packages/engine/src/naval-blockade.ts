// See: Seeblockade – Verband liegt vor einem fremden Hafen; Produktion −%, Lieferungen zurückgehalten, Börsenverkauf
// gesperrt. Ende bei Ablauf, Rückruf oder Niederlage (docs/REGELN-SEE.md, Abschnitt Blockade).
import { and, eq, gt, lte } from "drizzle-orm";
import {
  activeUnits,
  blockadeCheck,
  blockadeHours,
  blockadeOf,
  blockadeProductionFactor,
  resolveBattle,
  strandTroops,
  type AttackerInput,
  type Counts,
  type Mission,
  type Modifiers,
} from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { intelFogOn, liveAt, sightOf } from "./intel-sight.ts"; // Lagebild
import { balance, GameError, type Engine, type NoticeJob } from "./context.ts";
import { activeMissionCount, homeBaseOf, randomSeed, readBase, saveBase, scheduleEvent, withSite, type BaseRow } from "./store.ts";
import { modifiersFor, modsOf, registerModifierSource } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { diplomacyBlock } from "./alliance-core.ts";
import { runCommand } from "./commands.ts";
import { systemMessage } from "./world-events.ts";
import {
  HOUR_MS, fmtClock, hostile, insertMission, partyMates, planNaval, playerName, pushNotice, sendHome, storeNavalReport,
  type MissionRowLike, type NavalInput, type Notes,
} from "./naval-common.ts";

export interface BlockadeRow {
  id: number;
  missionId: number;
  attackerId: number;
  attackerBaseId: number;
  targetBaseId: number;
  targetPlayerId: number;
  col: number;
  row: number;
  units: unknown;
  status: string;
  outcome: string | null;
  startsAt: Date;
  endsAt: Date;
  endedAt: Date | null;
}

/** Laufende Blockade eines Hafens zum Zeitpunkt nowMs (die zuerst endende), null ohne. Mehrere Häfen: je Hafen. */
export async function activeBlockade(db: DbOrTx, where: { baseId: number }, nowMs: number): Promise<BlockadeRow | null> {
  const t = tables.blockade;
  const rows = await db
    .select()
    .from(t)
    .where(and(
      eq(t.status, "active"),
      eq(t.targetBaseId, where.baseId),
      lte(t.startsAt, new Date(nowMs)),
      gt(t.endsAt, new Date(nowMs)),
    ))
    .orderBy(t.endsAt)
    .limit(1);
  return (rows[0] as BlockadeRow) ?? null;
}

// Modifikator-Quelle „Blockade“: Gebäudeproduktion des blockierten Hafens mal productionFactor. Mehrere Häfen: nur
// der Hafen, für den gerechnet wird (ctx.baseId; ohne Angabe der Heimathafen) – andere Häfen bleiben unberührt.
registerModifierSource(async (db, playerId, ctx) => {
  if (!blockadeOf(balance)) return null;
  const baseId = ctx.baseId ?? (await homeBaseOf(db, playerId))?.id;
  if (baseId === undefined || !(await activeBlockade(db, { baseId }, ctx.nowMs))) return null;
  const f = blockadeProductionFactor(balance);
  return { production: Object.fromEntries(balance.resources.map((r) => [r, f])) } satisfies Modifiers;
}, "blockade", "Blockade");

async function targetBase(db: DbOrTx, col: number, row: number): Promise<BaseRow | null> {
  const [b] = await db.select().from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  return b ? { ...b, state: withSite(b.state as BaseRow["state"], b.col, b.row) } : null;
}

/** Planung einer Blockade. Codes: no_target, own_base, ally, pact, blockade_*, already_blockading, target_protected … */
async function planBlockade(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const target = await targetBase(db, input.col, input.row);
  if (!target) throw new GameError("no_target");
  if (target.playerId === playerId) throw new GameError("own_base");
  const d = await diplomacyBlock(db, playerId, target.playerId, nowMs);
  if (d) throw new GameError(d);
  const c = blockadeCheck(input.units, balance);
  if (!c.ok) throw new GameError(c.code);
  const [dup] = await db
    .select({ id: tables.blockade.id })
    .from(tables.blockade)
    .where(and(eq(tables.blockade.attackerId, playerId), eq(tables.blockade.targetBaseId, target.id), eq(tables.blockade.status, "active")));
  if (dup) throw new GameError("already_blockading");
  const hours = blockadeHours(input.holdHours, balance);
  const r = planNaval(own, {
    type: "blockade", baseType: "ueberfall", units: input.units, col: target.col, row: target.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs), targetProtection: target.state.protection,
  }, nowMs);
  if (!r.ok) return r;
  // Rückkehr erst nach der Haltezeit.
  const travel = r.mission.arriveAtMs - r.mission.departAtMs;
  r.mission.returnAtMs = r.mission.arriveAtMs + hours * HOUR_MS + travel;
  return { ...r, target, hours };
}

export async function launchBlockade(tx: Tx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number, notify: Notes) {
  const r = await planBlockade(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, {
    playerId, baseId: own.id, targetKind: "base", targetId: r.target.id, col: r.target.col, row: r.target.row,
    plan: { ...r.mission, holdHours: r.hours },
  });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

export async function previewBlockade(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const r = await planBlockade(db, playerId, own, input, nowMs);
  if (!r.ok) return r;
  return { ok: true as const, mission: r.mission, extra: { holdHours: r.hours, holdUntilMs: r.mission.arriveAtMs + r.hours * HOUR_MS } };
}

/** Ankunft vor dem Hafen: Blockade beginnt (sofern das Ziel noch angreifbar ist). */
export async function blockadeArrive(tx: Tx, m: MissionRowLike, plan: Mission & { holdHours?: number }, units: Counts, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const [target] = await tx.select().from(tables.base).where(eq(tables.base.id, m.targetId!));
  const blocked = !target ? "no_target" : await diplomacyBlock(tx, pid, target.playerId, due);
  if (!target || blocked || !Object.values(units).some((n) => n > 0)) {
    const reportId = await storeNavalReport(tx, {
      kind: "blockade", title: "Blockade nicht begonnen", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
      report: { blockade: { refused: blocked ?? "fleet_lost", targetName: target?.name ?? "?" } }, atMs: due,
    });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const hours = blockadeHours(plan.holdHours, balance);
  const endsAt = due + hours * HOUR_MS;
  const travel = plan.arriveAtMs - plan.departAtMs;
  const [b] = await tx.insert(tables.blockade).values({
    missionId: m.id, attackerId: pid, attackerBaseId: m.baseId!, targetBaseId: target.id, targetPlayerId: target.playerId,
    col: target.col, row: target.row, units: activeUnits(units), startsAt: new Date(due), endsAt: new Date(endsAt),
  }).returning({ id: tables.blockade.id });
  await tx.update(tables.mission).set({ status: "holding", returning: activeUnits(units), returnAt: new Date(endsAt + travel) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "blockade_end", endsAt, { blockadeId: b.id }, null);
  const who = await playerName(tx, pid);
  const reportId = await storeNavalReport(tx, {
    kind: "blockade", title: `Blockade vor ${target.name} bis ${fmtClock(endsAt)}`, attackerPlayerId: pid, defenderPlayerId: target.playerId,
    attackerBaseId: m.baseId, defenderBaseId: target.id,
    report: { blockade: { id: b.id, targetName: target.name, attackerName: who, units: activeUnits(units), endsAtMs: endsAt, factor: blockadeProductionFactor(balance) } }, atMs: due,
  });
  await systemMessage(tx, [target.playerId], `Seeblockade vor ${target.name}`,
    `${who} blockiert deinen Hafen ${target.name} bis ${fmtClock(endsAt)}. Produktion −${Math.round((1 - blockadeProductionFactor(balance)) * 100)} %, eingehende Lieferungen werden zurückgehalten, Börsenverkäufe sind gesperrt. Greife den Blockadeverband auf der Karte an, um die Blockade zu brechen.`, due);
  push.push(pushNotice(target.playerId, "attack", `Seeblockade vor ${target.name}`, `${who} blockiert deinen Hafen ${target.name} bis ${fmtClock(endsAt)}.`, "karte", reportId));
  notify.push([[target.playerId], "base"], [[target.playerId], "messages"], [[target.playerId], "reports"], [null, "map"]);
}

/** Beendet eine Blockade (idempotent): Verband fährt mit dem, was übrig ist, heim. */
export async function endBlockade(tx: Tx, b: BlockadeRow, outcome: "expired" | "recalled" | "broken", due: number, notify: Notes): Promise<void> {
  if (b.status !== "active") return;
  await tx.update(tables.blockade).set({ status: "ended", outcome, endedAt: new Date(due) }).where(eq(tables.blockade.id, b.id));
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, b.missionId)).for("update");
  if (m && m.status === "holding") {
    const plan = m.plan as Mission;
    const returnAt = due + Math.max(0, plan.arriveAtMs - plan.departAtMs);
    await tx.update(tables.mission).set({ status: "returning", returning: activeUnits(b.units as Counts), returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
    await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
  }
  const [t] = await tx.select({ name: tables.base.name }).from(tables.base).where(eq(tables.base.id, b.targetBaseId));
  const text = outcome === "broken" ? "gebrochen – der Blockadeverband ist versenkt" : outcome === "recalled" ? "aufgehoben – der Verband kehrt heim" : "beendet – die Haltezeit ist abgelaufen";
  await systemMessage(tx, [b.targetPlayerId, b.attackerId], `Blockade vor ${t?.name ?? "?"} ${outcome === "broken" ? "gebrochen" : "beendet"}`, `Die Blockade vor ${t?.name ?? "?"} ist ${text}. Lieferungen und Handel laufen wieder.`, due);
  notify.push([[b.targetPlayerId, b.attackerId], "base"], [[b.targetPlayerId, b.attackerId], "messages"], [[b.attackerId], "missions"], [null, "map"]);
}

async function lockBlockade(tx: Tx, id: number): Promise<BlockadeRow | null> {
  const [b] = await tx.select().from(tables.blockade).where(eq(tables.blockade.id, id)).for("update");
  return (b as BlockadeRow) ?? null;
}

/** game_event blockade_end */
export async function blockadeEndHandler(tx: Tx, payload: Record<string, unknown>, due: number) {
  const notify: Notes = [];
  const b = await lockBlockade(tx, Number(payload.blockadeId));
  if (b && b.status === "active" && due >= b.endsAt.getTime()) await endBlockade(tx, b, "expired", due, notify);
  return { notify };
}

/** Eigene Blockade aufheben (Rückruf). Codes: no_blockade. */
export function liftBlockade(engine: Engine, playerId: number, key: string, blockadeId: number, _baseId?: number) { // Besitz über die Blockade
  return runCommand(engine, playerId, key, "liftBlockade", async (ctx) => {
    const b = await lockBlockade(ctx.tx, blockadeId);
    if (!b || b.attackerId !== playerId || b.status !== "active") throw new GameError("no_blockade");
    await endBlockade(ctx.tx, b, "recalled", ctx.nowMs, ctx.notify);
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- Angriff auf einen Blockadeverband

/** Planung des Angriffs (Missionsart ueberfall mit blockadeId). Codes: no_blockade, own_blockade, ally, pact. */
async function planAttack(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const [b] = await db.select().from(tables.blockade).where(eq(tables.blockade.id, input.blockadeId!));
  if (!b || b.status !== "active" || b.endsAt.getTime() <= nowMs) throw new GameError("no_blockade");
  if (b.attackerId === playerId) throw new GameError("own_blockade");
  if (!(await hostile(db, playerId, b.attackerId, nowMs))) throw new GameError((await diplomacyBlock(db, playerId, b.attackerId, nowMs)) ?? "ally");
  const r = planNaval(own, {
    type: "ueberfall", baseType: "aufklaerung", units: input.units, col: b.col, row: b.row,
    activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs),
  }, nowMs);
  if (!r.ok) return r;
  return { ...r, blockade: b as BlockadeRow };
}

export async function launchBlockadeAttack(tx: Tx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number, notify: Notes) {
  const r = await planAttack(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "blockade", targetId: r.blockade.id, col: r.blockade.col, row: r.blockade.row, plan: r.mission });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

export async function previewBlockadeAttack(db: DbOrTx, playerId: number, own: BaseRow, input: NavalInput, nowMs: number) {
  const r = await planAttack(db, playerId, own, input, nowMs);
  if (!r.ok) return r;
  return { ok: true as const, mission: r.mission, extra: { blockadeUnits: activeUnits(r.blockade.units as Counts), holdUntilMs: r.blockade.endsAt.getTime() } };
}

/** Seekampf gegen den Blockadeverband auf dem Feld vor dem Hafen. */
export async function blockadeAttackArrive(tx: Tx, m: MissionRowLike, plan: Mission, units: Counts, origin: BaseRow | null, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const b = await lockBlockade(tx, m.targetId!);
  if (!b || b.status !== "active" || !Object.values(units).some((n) => n > 0)) {
    const reportId = await storeNavalReport(tx, {
      kind: "blockadekampf", title: "Blockade: niemand mehr vor dem Hafen", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
      report: { blockade: { over: true } }, atMs: due,
    });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const attacker: AttackerInput = { units, versorgungsmangel: origin?.state.versorgungsmangel ?? false, modifiers: await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due, baseId: origin?.id, isHome: origin?.isHome }) };
  // Blockadeverband kämpft mit den Modifikatoren seines Ausgangshafens (mehrere Häfen).
  const home = await readBase(tx, b.attackerBaseId);
  const defMods = home && home.playerId === b.attackerId ? await modsOf(tx, home, due) : await modifiersFor(tx, b.attackerId, { nowMs: due });
  const seed = randomSeed();
  const res = resolveBattle(attacker, { units: activeUnits(b.units as Counts), defenses: {}, modifiers: defMods }, balance, seed, battleWeather(b.col, b.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report: raw, destroyed } = strandTroops(res.report, balance);
  const report = { ...raw, loot: {} };
  const left = activeUnits(raw.defender.final);
  await tx.update(tables.blockade).set({ units: left }).where(eq(tables.blockade.id, b.id));
  if ((report.wreck.stahl ?? 0) + (report.wreck.elektronik ?? 0) > 0) {
    await tx.insert(tables.wreck).values({ col: b.col, row: b.row, stahl: report.wreck.stahl ?? 0, elektronik: report.wreck.elektronik ?? 0, createdAt: new Date(due) });
  }
  const [t] = await tx.select({ name: tables.base.name }).from(tables.base).where(eq(tables.base.id, b.targetBaseId));
  const attackerName = await playerName(tx, pid);
  const defenderName = await playerName(tx, b.attackerId);
  const title = destroyed ? `Blockade vor ${t?.name ?? "?"} gebrochen` : `Angriff auf die Blockade vor ${t?.name ?? "?"}`;
  const reportId = await storeNavalReport(tx, {
    kind: "blockadekampf", title, attackerPlayerId: pid, defenderPlayerId: b.attackerId, attackerBaseId: m.baseId, defenderBaseId: b.attackerBaseId,
    winner: report.winner, seed,
    report: { battle: report, attackerName, defenderName, targetName: `Blockadeverband vor ${t?.name ?? "?"}`, attacker, blockade: { id: b.id, destroyed, remaining: left } },
    atMs: due,
  });
  if (destroyed) await endBlockade(tx, { ...b, units: left }, "broken", due, notify);
  push.push(pushNotice(b.attackerId, "attack", destroyed ? "Blockade gebrochen" : "Blockade angegriffen", `${attackerName} hat deinen Blockadeverband angegriffen.`, "berichte", reportId));
  if (b.targetPlayerId !== pid) push.push(pushNotice(b.targetPlayerId, "report", title, `${attackerName} hat den Blockadeverband angegriffen.`, "berichte", reportId));
  notify.push([[b.attackerId], "reports"], [[b.attackerId], "missions"], [null, "map"]);
  await sendHome(tx, m, plan, activeUnits(raw.attacker.final), {}, reportId, due);
}

/** Blockaden für die Karte: alle laufenden (öffentlich sichtbar), mit Rolle des Betrachters. */
export async function blockadesView(db: DbOrTx, playerId: number, nowMs: number) {
  const rows = (await db.select().from(tables.blockade).where(and(eq(tables.blockade.status, "active"), gt(tables.blockade.endsAt, new Date(nowMs))))) as BlockadeRow[];
  if (rows.length === 0) return [];
  const mates = new Set(await partyMates(db, playerId));
  // Lagebild: fremde Blockaden (weder eigene noch gegen die eigene Allianz) nur in Sicht.
  const sight = (await intelFogOn(db, nowMs)) ? await sightOf(db, playerId, nowMs) : null;
  const out = [];
  for (const b of rows) {
    if (sight && b.attackerId !== playerId && !mates.has(b.targetPlayerId) && !liveAt(sight, b.col, b.row, "fleet")) continue;
    const [t] = await db.select({ name: tables.base.name }).from(tables.base).where(eq(tables.base.id, b.targetBaseId));
    out.push({
      id: b.id, col: b.col, row: b.row, endsAtMs: b.endsAt.getTime(), targetName: t?.name ?? "?", attackerName: await playerName(db, b.attackerId),
      role: b.attackerId === playerId ? ("own" as const) : b.targetPlayerId === playerId ? ("target" as const) : mates.has(b.targetPlayerId) ? ("ally" as const) : ("other" as const),
      canAttack: b.attackerId !== playerId && (await hostile(db, playerId, b.attackerId, nowMs)),
      units: b.attackerId === playerId || b.targetPlayerId === playerId || mates.has(b.targetPlayerId) ? activeUnits(b.units as Counts) : null,
    });
  }
  return out;
}
