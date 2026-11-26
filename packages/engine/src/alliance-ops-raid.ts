// Allianz-Ops: Sammelangriff – Eröffnen, Beitreten, Rückzug, Abbruch und Auslaufen zur Beitrittsfrist.
// Jeder Teilnehmer stellt einen Verband aus dem eigenen Hafen (Mission mit Status "staged", plan.allianceRaidId):
// Einheiten und Treibstoff sind beim Beitritt gebunden, der Missionsplatz ist belegt. Zur Frist (Ereignis
// alliance_raid_launch) laufen alle so aus, dass sie gleichzeitig ankommen (alliance-ops-battle.ts).
import { and, eq, sql } from "drizzle-orm";
import {
  allianceOpsOf,
  isNestRespawned,
  jointSchedule,
  planMission,
  protectionStatus,
  returnMission,
  travelSeconds,
  type BaseState,
  type Counts,
  type Mission,
} from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine, type NoticeJob } from "./context.ts";
import { activeMissionCount, lockBase, lockOwnBase, readBase, saveBase, scheduleEvent, withSite } from "./store.ts";
import { missionWeather } from "./weather.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { diplomacyBlock, memberIds, membershipOf, systemMessage, type Notes } from "./alliance-core.ts";
import { runCommand } from "./commands.ts";
import { stationsAfterExit } from "./alliance-ops-station.ts";
import { scheduleAttackWarning } from "./event-notices.ts";
import { KIND_TEXT, isOpen, readWorldEvent } from "./world-events.ts";
import type { Handler, HandlerResult } from "./events.ts";

const MIN = 60000;
export type RaidRow = typeof tables.allianceRaid.$inferSelect;
type Ctx = { tx: Tx; playerId: number; nowMs: number; notify: Notes };

export async function lockRaid(tx: Tx, id: number): Promise<RaidRow | null> {
  const [r] = await tx.select().from(tables.allianceRaid).where(eq(tables.allianceRaid.id, id)).for("update");
  return r ?? null;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

function fail(code: string): never {
  throw new GameError(code);
}

/** Ziel eines Sammelangriffs. Codes: no_target, no_event, event_over, raid_bad_target. */
async function resolveTarget(db: DbOrTx, input: { col: number; row: number; eventId?: number }, nowMs: number) {
  if (input.eventId !== undefined) {
    const ev = await readWorldEvent(db, input.eventId);
    if (!ev) fail("no_event");
    if (!isOpen(ev) || nowMs >= ev.endsAt.getTime()) fail("event_over");
    // Schatzschiff fährt: kein gemeinsamer Treffpunkt. Großflotte und Belagerung liegen fest.
    if (ev.kind === "schatzschiff") fail("raid_bad_target");
    const name = ev.kind === "belagerung" ? `Belagerungsring vor ${ev.data.baseName ?? "?"}` : KIND_TEXT[ev.kind];
    return { kind: "event" as const, id: ev.id, col: ev.col, row: ev.row, name };
  }
  const [b] = await db.select().from(tables.base).where(and(eq(tables.base.col, input.col), eq(tables.base.row, input.row)));
  if (b) return { kind: "base" as const, id: b.id, col: b.col, row: b.row, name: b.name };
  const [n] = await db.select().from(tables.nest).where(and(eq(tables.nest.col, input.col), eq(tables.nest.row, input.row)));
  if (n) return { kind: "nest" as const, id: n.id, col: n.col, row: n.row, name: `Piratennest Stufe ${n.level}` };
  return fail("no_target");
}

/**
 * Darf dieser Spieler das Ziel (noch) angreifen? Überfall-Schutzregeln wie beim einzelnen Überfall.
 * Codes: no_target, own_base, ally, pact, target_protected, nest_empty, event_over, own_siege. Liefert den Zielzustand.
 */
export async function targetProblem(db: DbOrTx, playerId: number, t: { targetKind: string; targetId: number }, nowMs: number): Promise<{ code: string | null; state?: BaseState }> {
  if (t.targetKind === "base") {
    const [b] = await db.select().from(tables.base).where(eq(tables.base.id, t.targetId));
    if (!b) return { code: "no_target" };
    if (b.playerId === playerId) return { code: "own_base" };
    const d = await diplomacyBlock(db, playerId, b.playerId, nowMs);
    if (d) return { code: d };
    const state = withSite(b.state as BaseState, b.col, b.row);
    if (protectionStatus(state.protection, nowMs, balance).protected) return { code: "target_protected" };
    return { code: null, state };
  }
  if (t.targetKind === "nest") {
    const [n] = await db.select().from(tables.nest).where(eq(tables.nest.id, t.targetId));
    if (!n) return { code: "no_target" };
    if (n.defeatedAt && !isNestRespawned(n.defeatedAt.getTime(), nowMs, balance)) return { code: "nest_empty" };
    return { code: null };
  }
  const ev = await readWorldEvent(db, t.targetId);
  if (!ev || !isOpen(ev) || nowMs >= ev.endsAt.getTime()) return { code: "event_over" };
  if (ev.kind === "belagerung" && ev.data.ownerId === playerId) return { code: "own_siege" };
  return { code: null };
}

async function nameOf(db: DbOrTx, id: number): Promise<string> {
  const [p] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
  return p?.name ?? "?";
}

/** Teilnehmer (Spieler, Mission) eines Sammelangriffs in Beitrittsreihenfolge. */
export async function raidMembers(db: DbOrTx, raidId: number) {
  return db
    .select({ playerId: tables.allianceRaidMember.playerId, missionId: tables.allianceRaidMember.missionId })
    .from(tables.allianceRaidMember)
    .where(eq(tables.allianceRaidMember.raidId, raidId))
    .orderBy(tables.allianceRaidMember.id);
}

/** Verband beitreten lassen: planen wie ein Überfall, Einheiten und Treibstoff binden, Mission "staged". */
async function joinWith(ctx: Ctx, raid: RaidRow, units: Counts, baseId?: number): Promise<{ missionId: number }> {
  const { tx, playerId, nowMs } = ctx;
  const own = await lockOwnBase(tx, playerId, baseId); // mehrere Häfen: Verband aus dem aktiven Hafen

  const p = await targetProblem(tx, playerId, raid, nowMs);
  if (p.code) fail(p.code);
  const members = await raidMembers(tx, raid.id);
  if (members.some((m) => m.playerId === playerId)) fail("raid_joined");
  if (members.length >= allianceOpsOf(balance).raid.maxParticipants) fail("raid_full");
  const mods = await modsOf(tx, own, nowMs);
  const r = planMission(
    own.state,
    {
      type: "ueberfall", units, origin: hexCenter(own.col, own.row), target: hexCenter(raid.targetCol, raid.targetRow),
      activeMissions: await activeMissionCount(tx, own.id), targetProtection: p.state?.protection,
      weather: missionWeather(own.col, own.row, raid.targetCol, raid.targetRow, nowMs),
    },
    nowMs,
    balance,
    mods,
  );
  if (!r.ok) fail(r.code);
  await saveBase(tx, own.id, r.base);
  const travel = r.mission.arriveAtMs - r.mission.departAtMs;
  const at = Math.max(raid.desiredArriveAt.getTime(), raid.joinDeadline.getTime() + travel);
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId, baseId: own.id, type: "ueberfall", targetKind: raid.targetKind, targetId: raid.targetId, targetCol: raid.targetCol,
      targetRow: raid.targetRow, plan: { ...r.mission, allianceRaidId: raid.id }, status: "staged", arriveAt: new Date(at),
    })
    .returning({ id: tables.mission.id });
  await tx.insert(tables.allianceRaidMember).values({ raidId: raid.id, playerId, missionId: m.id, joinedAt: new Date(nowMs) });
  ctx.notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { missionId: m.id };
}

/** Gebundenen Verband freigeben: Einheiten und Treibstoff zurück, Mission erledigt, Teilnahme gelöscht. */
export async function releaseStaged(tx: Tx, missionId: number, nowMs: number): Promise<void> {
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  await tx.delete(tables.allianceRaidMember).where(eq(tables.allianceRaidMember.missionId, missionId));
  if (!m || m.status !== "staged" || m.baseId === null) return;
  const plan = m.plan as Mission;
  const b = await lockBase(tx, m.baseId);
  if (b) {
    const mods = await modsOf(tx, b, nowMs);
    await saveBase(tx, b.id, returnMission(b.state, plan.units, plan.units, { treibstoff: plan.fuelCost }, nowMs, balance, mods));
  }
  await tx.update(tables.mission).set({ status: "done" }).where(eq(tables.mission.id, m.id));
}

function pushAll(ids: number[], title: string, body: string, tag: string): NoticeJob[] {
  return ids.map((playerId) => ({ playerId, notice: { kind: "fleet" as const, title, body, url: "/?tab=allianz", tag } }));
}

/** Sammelangriff eröffnen und mit dem eigenen Verband beitreten. Codes: no_alliance, raid_limit, bad_time, Zielcodes, Planungscodes. */
export function openRaid(
  engine: Engine,
  playerId: number,
  key: string,
  input: { col: number; row: number; eventId?: number; units: Counts; joinMinutes: number; arriveMinutes: number; baseId?: number },
) {
  const jobs: NoticeJob[] = [];
  return runCommand<{ ok: true; raidId: number; missionId: number }>(engine, playerId, key, "raidOpen", async (ctx) => {
    const cfg = allianceOpsOf(balance).raid;
    const ms = await membershipOf(ctx.tx, playerId);
    if (!ms) fail("no_alliance");
    await ctx.tx.select({ id: tables.alliance.id }).from(tables.alliance).where(eq(tables.alliance.id, ms.allianceId)).for("update");
    const [open] = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tables.allianceRaid)
      .where(and(eq(tables.allianceRaid.allianceId, ms.allianceId), eq(tables.allianceRaid.status, "offen")));
    if ((open?.n ?? 0) >= cfg.maxOpenPerAlliance) fail("raid_limit");
    const j = input.joinMinutes;
    if (!(j >= cfg.minJoinMinutes && j <= cfg.maxJoinHours * 60 && input.arriveMinutes >= j && input.arriveMinutes <= cfg.maxArriveHours * 60)) fail("bad_time");
    const t = await resolveTarget(ctx.tx, input, ctx.nowMs);
    const deadline = ctx.nowMs + Math.round(j * MIN);
    const [raid] = await ctx.tx
      .insert(tables.allianceRaid)
      .values({
        allianceId: ms.allianceId, creatorPlayerId: playerId, targetKind: t.kind, targetId: t.id, targetCol: t.col, targetRow: t.row,
        targetName: t.name, desiredArriveAt: new Date(ctx.nowMs + Math.round(input.arriveMinutes * MIN)), joinDeadline: new Date(deadline),
        status: "offen", createdAt: new Date(ctx.nowMs),
      })
      .returning();
    const { missionId } = await joinWith(ctx, raid, input.units, input.baseId);
    await scheduleEvent(ctx.tx, "alliance_raid_launch", deadline, { raidId: raid.id }, null);
    const ids = await memberIds(ctx.tx, ms.allianceId);
    const who = await nameOf(ctx.tx, playerId);
    const body = `${who} ruft zum Sammelangriff auf ${t.name} (Feld ${t.col}/${t.row}). Beitritt bis ${clock(deadline)} Uhr, gewünschte Ankunft ${clock(raid.desiredArriveAt.getTime())} Uhr. Beitreten im Allianz-Bildschirm unter „Sammelangriffe“.`;
    await systemMessage(ctx.tx, ctx.notify, ids, `Sammelangriff auf ${t.name}`, body);
    jobs.push(...pushAll(ids.filter((id) => id !== playerId), `Sammelangriff auf ${t.name}`, `${who} ruft zum Sammelangriff. Beitritt bis ${clock(deadline)} Uhr.`, `raid-${raid.id}`));
    ctx.notify.push([ids, "alliance"]);
    return { ok: true as const, raidId: raid.id, missionId };
  }).then((r) => {
    if (r.ok && jobs.length) engine.push?.(jobs);
    return r;
  });
}

/** Mit eigenem Verband beitreten. Codes: no_raid, raid_closed, raid_other_alliance, raid_joined, raid_full, Ziel- und Planungscodes. */
export function joinRaid(engine: Engine, playerId: number, key: string, input: { raidId: number; units: Counts; baseId?: number }) {
  const jobs: NoticeJob[] = [];
  return runCommand<{ ok: true; missionId: number }>(engine, playerId, key, "raidJoin", async (ctx) => {
    const raid = await lockRaid(ctx.tx, input.raidId);
    if (!raid) fail("no_raid");
    if (raid.status !== "offen" || ctx.nowMs >= raid.joinDeadline.getTime()) fail("raid_closed");
    const ms = await membershipOf(ctx.tx, playerId);
    if (!ms || ms.allianceId !== raid.allianceId) fail("raid_other_alliance");
    const others = (await raidMembers(ctx.tx, raid.id)).map((m) => m.playerId);
    const r = await joinWith(ctx, raid, input.units, input.baseId);
    const who = await nameOf(ctx.tx, playerId);
    await systemMessage(ctx.tx, ctx.notify, [...others, playerId], `Sammelangriff auf ${raid.targetName}`, `${who} tritt dem Sammelangriff bei (${others.length + 1} Verbände). Auslaufen ${clock(raid.joinDeadline.getTime())} Uhr.`);
    jobs.push(...pushAll(others, `Sammelangriff: ${who} ist dabei`, `${others.length + 1} Verbände gegen ${raid.targetName}.`, `raid-${raid.id}`));
    ctx.notify.push([await memberIds(ctx.tx, raid.allianceId), "alliance"]);
    return { ok: true as const, missionId: r.missionId };
  }).then((r) => {
    if (r.ok && jobs.length) engine.push?.(jobs);
    return r;
  });
}

/**
 * Vor dem Auslaufen zurückziehen: Verband und Treibstoff zurück (in den Hafen, aus dem er kam – mission.base_id;
 * baseId wird nicht gebraucht). Codes: no_raid, raid_launched, not_joined.
 */
export function withdrawRaid(engine: Engine, playerId: number, key: string, raidId: number, _baseId?: number) {
  return runCommand<{ ok: true }>(engine, playerId, key, "raidWithdraw", async (ctx) => {
    const raid = await lockRaid(ctx.tx, raidId);
    if (!raid) fail("no_raid");
    if (raid.status !== "offen") fail("raid_launched");
    const mine = (await raidMembers(ctx.tx, raid.id)).find((m) => m.playerId === playerId);
    if (!mine) fail("not_joined");
    await releaseStaged(ctx.tx, mine.missionId, ctx.nowMs);
    const rest = (await raidMembers(ctx.tx, raid.id)).map((m) => m.playerId);
    await systemMessage(ctx.tx, ctx.notify, [...rest, playerId], `Sammelangriff auf ${raid.targetName}`, `${await nameOf(ctx.tx, playerId)} hat sich zurückgezogen (${rest.length} Verbände).`);
    ctx.notify.push([[playerId], "base"], [[playerId], "missions"], [await memberIds(ctx.tx, raid.allianceId), "alliance"]);
    return { ok: true as const };
  });
}

/** Abbrechen vor dem Auslaufen: Eröffner, Führung oder Offiziere. Codes: no_raid, raid_launched, no_rights. */
export function cancelRaid(engine: Engine, playerId: number, key: string, raidId: number, _baseId?: number) { // Verbände kehren in ihre Häfen zurück
  return runCommand<{ ok: true }>(engine, playerId, key, "raidCancel", async (ctx) => {
    const raid = await lockRaid(ctx.tx, raidId);
    if (!raid) fail("no_raid");
    if (raid.status !== "offen") fail("raid_launched");
    const ms = await membershipOf(ctx.tx, playerId);
    if (!ms || ms.allianceId !== raid.allianceId) fail("no_rights");
    if (raid.creatorPlayerId !== playerId && ms.role === "mitglied") fail("no_rights");
    await abortRaid(ctx.tx, ctx.notify, raid, "abgebrochen", `${await nameOf(ctx.tx, playerId)} hat den Sammelangriff auf ${raid.targetName} abgebrochen. Eure Verbände sind wieder im Hafen.`, ctx.nowMs);
    return { ok: true as const };
  });
}

/** Alle gebundenen Verbände freigeben und den Sammelangriff beenden (offen → abgebrochen/verfallen). */
export async function abortRaid(tx: Tx, notes: Notes, raid: RaidRow, status: string, text: string, nowMs: number): Promise<void> {
  const members = await raidMembers(tx, raid.id);
  for (const m of members) await releaseStaged(tx, m.missionId, nowMs);
  await tx.update(tables.allianceRaid).set({ status }).where(eq(tables.allianceRaid.id, raid.id));
  const ids = members.map((m) => m.playerId);
  await systemMessage(tx, notes, ids, `Sammelangriff auf ${raid.targetName}`, text);
  notes.push([ids, "base"], [ids, "missions"], [await memberIds(tx, raid.allianceId), "alliance"]);
}

/** Nach Austritt/Ausschluss/Auflösung: Teilnahmen an offenen Sammelangriffe der alten Allianz enden. */
export async function raidsAfterExit(tx: Tx, notes: Notes, playerIds: number[], allianceId: number, nowMs: number): Promise<void> {
  const raids = await tx.select().from(tables.allianceRaid).where(and(eq(tables.allianceRaid.allianceId, allianceId), eq(tables.allianceRaid.status, "offen"))).for("update");
  const remaining = await memberIds(tx, allianceId);
  for (const raid of raids) {
    if (remaining.length === 0) {
      await abortRaid(tx, notes, raid, "abgebrochen", `Die Allianz besteht nicht mehr: der Sammelangriff auf ${raid.targetName} ist abgebrochen.`, nowMs);
      continue;
    }
    for (const m of await raidMembers(tx, raid.id)) {
      if (!playerIds.includes(m.playerId)) continue;
      await releaseStaged(tx, m.missionId, nowMs);
      notes.push([[m.playerId], "base"], [[m.playerId], "missions"]);
    }
  }
}

/** Allianzaustritt, Ausschluss, Auflösung (nach dem Löschen der Mitgliedschaft): Stationierungen und Teilnahmen. */
export async function allianceOpsExit(tx: Tx, notes: Notes, playerIds: number[], allianceId: number): Promise<void> {
  const nowMs = Date.now();
  await stationsAfterExit(tx, notes, playerIds, nowMs);
  await raidsAfterExit(tx, notes, playerIds, allianceId, nowMs);
}

// ---------------------------------------------------------------- Auslaufen zur Beitrittsfrist

/**
 * Ereignis alliance_raid_launch: Ziel und Teilnehmer erneut prüfen (Schutz, Diplomatie); wer nicht mehr darf, wird
 * freigegeben. Reisezeiten mit Wetter zum Auslaufen; Ankunft auf den langsamsten Verband. Radar-Vorwarnung einmal
 * für den ganzen Angriff (gemeinsame Ankunft, schwächste Tarnung).
 */
export const raidLaunch: Handler = async (tx, ev, due) => {
  const raid = await lockRaid(tx, Number(ev.payload.raidId));
  if (!raid || raid.status !== "offen") return { notify: [] };
  const notes: Notes = [];
  const members = await raidMembers(tx, raid.id);
  const general = await targetProblem(tx, -1, raid, due);
  if (general.code) {
    await abortRaid(tx, notes, raid, "abgebrochen", `Der Sammelangriff auf ${raid.targetName} fällt aus: das Ziel ist nicht mehr angreifbar. Eure Verbände bleiben im Hafen.`, due);
    return { notify: notes };
  }
  const keep: { playerId: number; mission: typeof tables.mission.$inferSelect; travelMs: number; stealth: number }[] = [];
  for (const m of members) {
    const p = await targetProblem(tx, m.playerId, raid, due);
    const [mission] = await tx.select().from(tables.mission).where(eq(tables.mission.id, m.missionId)).for("update");
    const origin = mission?.baseId ? await readBase(tx, mission.baseId) : null;
    if (p.code || !mission || mission.status !== "staged" || !origin) {
      await releaseStaged(tx, m.missionId, due);
      await systemMessage(tx, notes, [m.playerId], `Sammelangriff auf ${raid.targetName}`, "Dein Verband darf das Ziel nicht mehr angreifen und bleibt im Hafen.");
      continue;
    }
    const plan = mission.plan as Mission;
    const mods = await modifiersFor(tx, m.playerId, { state: origin.state, nowMs: due, baseId: origin.id, isHome: origin.isHome });
    const hasShips = Object.entries(plan.units).some(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
    const w = missionWeather(origin.col, origin.row, raid.targetCol, raid.targetRow, due);
    const seconds = (travelSeconds(plan.units, plan.distanceKm, balance, mods) ?? 0) * (hasShips && w ? w.shipFactor : 1);
    keep.push({ playerId: m.playerId, mission, travelMs: Math.ceil(seconds * 1000), stealth: mods.stealth ?? 1 });
  }
  if (keep.length === 0) {
    await tx.update(tables.allianceRaid).set({ status: "verfallen" }).where(eq(tables.allianceRaid.id, raid.id));
    notes.push([await memberIds(tx, raid.allianceId), "alliance"]);
    return { notify: notes };
  }
  const sched = jointSchedule(raid.desiredArriveAt.getTime(), raid.joinDeadline.getTime(), keep.map((k) => k.travelMs));
  const warningFactor = Math.max(...keep.map((k) => k.stealth));
  for (let i = 0; i < keep.length; i++) {
    const k = keep[i];
    const plan = k.mission.plan as Mission;
    const next: Mission = {
      ...plan, departAtMs: sched.departAtMs[i], arriveAtMs: sched.arriveAtMs, returnAtMs: sched.arriveAtMs + k.travelMs, travelSeconds: k.travelMs / 1000,
    };
    if (warningFactor !== 1) next.warningFactor = warningFactor;
    else delete next.warningFactor;
    await tx.update(tables.mission).set({ status: "outbound", plan: next, arriveAt: new Date(sched.arriveAtMs) }).where(eq(tables.mission.id, k.mission.id));
  }
  await tx.update(tables.allianceRaid).set({ status: "ausgelaufen", arriveAt: new Date(sched.arriveAtMs) }).where(eq(tables.allianceRaid.id, raid.id));
  await scheduleEvent(tx, "alliance_raid_arrive", sched.arriveAtMs, { raidId: raid.id }, raid.targetKind === "base" ? raid.targetId : null);
  const ids = keep.map((k) => k.playerId);
  const late = sched.arriveAtMs > raid.desiredArriveAt.getTime() + MIN ? " (später als gewünscht: der langsamste Verband bestimmt die Ankunft)" : "";
  const text = `${keep.length} Verbände laufen gegen ${raid.targetName} aus. Gemeinsame Ankunft ${clock(sched.arriveAtMs)} Uhr${late}.`;
  await systemMessage(tx, notes, ids, `Sammelangriff läuft aus`, text);
  const result: HandlerResult = { notify: [...notes, [ids, "missions"], [await memberIds(tx, raid.allianceId), "alliance"]], push: pushAll(ids, "Sammelangriff läuft aus", text, `raid-${raid.id}`) };
  if (raid.targetKind === "base" && general.state) {
    const [b] = await tx.select({ playerId: tables.base.playerId, isHome: tables.base.isHome }).from(tables.base).where(eq(tables.base.id, raid.targetId));
    const targetMods = await modifiersFor(tx, b.playerId, { state: general.state, nowMs: due, baseId: raid.targetId, isHome: b.isHome });
    await scheduleAttackWarning(tx, { missionId: keep[0].mission.id, targetBaseId: raid.targetId, targetState: general.state, arriveAtMs: sched.arriveAtMs, nowMs: due, targetMods, warningFactor });
    result.notify.push([[b.playerId], "missions"]);
  }
  return result;
};

