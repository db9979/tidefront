// Felder: Missionen gegen Rohstofffelder (Missionsziel „field“): Aufklärung und „Besetzen“ (neutral: Kampf gegen die
// Kartell-Wache; besetzt: Angriff auf die Besatzung). Nach Sieg bleibt eine Besatzung (Mission „stationed“), der Rest
// fährt heim. Rückruf der Besatzung: Feld wird neutral. Eingehängt über markierte Eingriffe (Felder) in commands.ts
// (launchMission), views.ts (missionPreview) und handlers.ts (missionArrive). Regeln: docs/REGELN-FELDER.md.
import { eq } from "drizzle-orm";
import {
  activeUnits, garrisonCheck, guardDefender, resolveBattle, splitGarrison, strandTroops,
  type AttackerInput, type Counts, type DefenderInput, type Mission,
} from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine, type NoticeJob } from "./context.ts";
import { activeMissionCount, randomSeed, readBase, saveBase, scheduleEvent, withSite, type BaseRow } from "./store.ts";
import { modifiersFor, modsOf } from "./modifiers.ts";
import { battleWeather, missionWeather } from "./weather.ts";
import { diplomacyBlock, systemMessage } from "./alliance-core.ts";
import { runCommand } from "./commands.ts";
import { recordAchievement } from "./achievements.ts";
import {
  activeCounts, hasShips, insertMission, planNaval, playerName, pushNotice, sendHome, storeNavalReport,
  type MissionRowLike, type Notes,
} from "./naval-common.ts";
import { FIELD_TYPE, HOUR_MS, fieldById, fieldName, guarded, maxFieldsOf, ownedBy, rules, type FieldRow } from "./fields-core.ts";
import { settleField } from "./fields-run.ts";

export interface FieldInput {
  type: string;
  units: Counts;
  fieldId: number;
  /** Ganzer siegreicher Verband bleibt als Besatzung (sonst nur die Mindestbesatzung). */
  stayAll?: boolean;
}

/** Prüfungen und Planung. Codes: no_field, bad_type, own_field, field_limit, field_ships_only, garrison_too_weak, ally, pact … */
async function planField(db: DbOrTx, playerId: number, own: BaseRow, input: FieldInput, nowMs: number) {
  const f = rules();
  if (!f) throw new GameError("bad_type");
  const field = await fieldById(db, input.fieldId);
  if (!field) throw new GameError("no_field");
  let targetProtection;
  if (input.type === FIELD_TYPE) {
    if (field.ownerId === playerId) throw new GameError("own_field");
    const g = garrisonCheck(activeCounts(input.units), balance);
    if (!g.ok) throw new GameError(g.code);
    if ((await ownedBy(db, playerId)).length >= maxFieldsOf(own.state)) throw new GameError("field_limit");
    if (field.ownerId !== null) {
      const d = await diplomacyBlock(db, playerId, field.ownerId, nowMs);
      if (d) throw new GameError(d);
      // Schutzregeln wie beim Überfall: Schutz des Heimathafens des Besitzers.
      const home = field.baseId !== null ? await readBase(db, field.baseId) : null;
      if (home) targetProtection = withSite(home.state, home.col, home.row).protection;
    }
  } else if (input.type !== "aufklaerung") throw new GameError("bad_type");
  const r = planNaval(own, {
    type: input.type as Mission["type"], baseType: input.type === FIELD_TYPE ? "ueberfall" : "aufklaerung", units: input.units,
    col: field.col, row: field.row, activeMissions: await activeMissionCount(db, own.id), mods: await modsOf(db, own, nowMs), targetProtection,
  }, nowMs);
  return { r, field };
}

/** launchMission mit fieldId (Hafen aus dem Kommando-Kontext, bereits gesperrt). */
export async function launchField(tx: Tx, playerId: number, own: BaseRow, input: FieldInput, nowMs: number, notify: Notes) {
  const { r, field } = await planField(tx, playerId, own, input, nowMs);
  if (!r.ok) return r;
  await saveBase(tx, own.id, r.base);
  const plan = input.type === FIELD_TYPE ? { ...r.mission, stayAll: !!input.stayAll } : r.mission;
  const missionId = await insertMission(tx, { playerId, baseId: own.id, targetKind: "field", targetId: field.id, col: field.col, row: field.row, plan });
  notify.push([[playerId], "base"], [[playerId], "missions"]);
  return { ok: true as const, missionId, arriveAtMs: r.mission.arriveAtMs };
}

/** missionPreview mit fieldId. */
export async function previewField(db: DbOrTx, playerId: number, own: BaseRow, input: FieldInput, nowMs: number) {
  const field = await fieldById(db, input.fieldId);
  const distanceKm = field ? hexDistanceKm(own, field) : 0;
  try {
    const { r } = await planField(db, playerId, own, input, nowMs);
    if (!r.ok) return { ok: false as const, code: r.code, distanceKm };
    const m = r.mission;
    return {
      ok: true as const, distanceKm: m.distanceKm, travelSeconds: m.travelSeconds, fuelCost: m.fuelCost, arriveAtMs: m.arriveAtMs,
      returnAtMs: m.returnAtMs, target: { kind: "field", own: false }, intercept: null,
      weather: field ? missionWeather(own.col, own.row, field.col, field.row, nowMs) : null, weatherFactor: m.weather?.shipFactor ?? 1,
    };
  } catch (err) {
    if (err instanceof GameError) return { ok: false as const, code: err.code, distanceKm };
    throw err;
  }
}

/** Besatzung einer Mission auflösen (vernichtet oder nach Niederlage heim mit den Überlebenden). */
export async function endGarrison(tx: Tx, missionId: number | null, survivors: Counts, due: number): Promise<void> {
  if (missionId === null) return;
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  if (!m || m.status !== "stationed") return;
  const plan = m.plan as Mission;
  const left = activeUnits(survivors);
  const returnAt = Object.keys(left).length === 0 ? due : due + Math.max(0, plan.arriveAtMs - plan.departAtMs);
  await tx.update(tables.mission).set({ status: "returning", returning: left, cargoHome: {}, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
}

/** Feld wird neutral (ohne Wache bis guardAt bzw. mit der angegebenen Wache). */
export async function releaseField(tx: Tx, f: FieldRow, due: number, guard: Counts | null): Promise<void> {
  const r = rules()!;
  await tx.update(tables.resourceField).set({
    ownerId: null, baseId: null, missionId: null, capturedAt: null, lastTickAt: null,
    guard: guard ?? {}, guardAt: guard ? null : new Date(due + r.guardRespawnHours * HOUR_MS),
  }).where(eq(tables.resourceField.id, f.id));
}

function wreckAt(tx: Tx, f: FieldRow, wreck: { stahl?: number; elektronik?: number }, due: number) {
  if ((wreck.stahl ?? 0) + (wreck.elektronik ?? 0) <= 0) return Promise.resolve();
  return tx.insert(tables.wreck).values({ col: f.col, row: f.row, stahl: wreck.stahl ?? 0, elektronik: wreck.elektronik ?? 0, createdAt: new Date(due) }).then(() => undefined);
}

/** Besatzung bilden: ursprüngliche Mission bleibt (stationed), Überzählige fahren als eigene Mission heim. */
async function stationGarrison(tx: Tx, m: MissionRowLike, plan: Mission, garrison: Counts, rest: Counts, due: number): Promise<void> {
  const travel = Math.max(0, plan.arriveAtMs - plan.departAtMs);
  const kept: Counts = {};
  for (const [id, n] of Object.entries(plan.units)) {
    const k = n - (rest[id] ?? 0);
    if (k > 0) kept[id] = k; // Besatzung plus Verluste bleiben auf dieser Mission (unitsAway stimmt bei der Rückkehr)
  }
  await tx.update(tables.mission).set({ status: "stationed", plan: { ...plan, units: kept }, returning: garrison, cargoHome: {} }).where(eq(tables.mission.id, m.id));
  if (Object.keys(rest).length === 0) return;
  const back = due + travel;
  const [r] = await tx.insert(tables.mission).values({
    playerId: m.playerId, baseId: m.baseId, type: FIELD_TYPE, targetKind: "field", targetId: m.targetId, targetCol: m.targetCol, targetRow: m.targetRow,
    plan: { ...plan, units: rest, admiralId: undefined }, status: "returning", returning: rest, cargoHome: {}, arriveAt: new Date(due), returnAt: new Date(back),
  }).returning({ id: tables.mission.id });
  await scheduleEvent(tx, "mission_return", back, { missionId: r.id }, m.baseId);
}

/** mission_arrive mit targetKind "field". */
export async function fieldArrive(tx: Tx, m: MissionRowLike, plan: Mission, origin: BaseRow | null, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const field = m.targetId !== null ? await fieldById(tx, m.targetId, true) : null;
  const units = activeCounts(plan.units);
  if (!field) {
    const reportId = await storeNavalReport(tx, { kind: "feld", title: "Feld nicht mehr vorhanden", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, report: { field: { gone: true } }, atMs: due });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const name = fieldName(field);
  const garrison = field.missionId !== null ? (await tx.select({ returning: tables.mission.returning }).from(tables.mission).where(eq(tables.mission.id, field.missionId)))[0] : undefined;
  const garrisonUnits = activeUnits((garrison?.returning as Counts | null) ?? {});
  const ownerName = field.ownerId !== null ? await playerName(tx, field.ownerId) : null;
  if (m.type === "aufklaerung") {
    const reportId = await storeNavalReport(tx, {
      kind: "aufklaerung", title: `Aufklärung: ${name}`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, atMs: due,
      report: { field: { id: field.id, kind: field.kind, tier: field.tier, owner: ownerName, units: field.ownerId !== null ? garrisonUnits : activeUnits(field.guard as Counts) } },
    });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  // Besetzen: Ziel noch angreifbar?
  const refused = field.ownerId === pid ? "own_field" : field.ownerId !== null ? await diplomacyBlock(tx, pid, field.ownerId, due) : null;
  if (refused || !hasShips(units)) {
    const reportId = await storeNavalReport(tx, { kind: "feld", title: `${name}: nicht besetzt`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, report: { field: { id: field.id, refused: refused ?? "fleet_lost" } }, atMs: due });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    return;
  }
  const defenderUnits = field.ownerId !== null ? garrisonUnits : activeUnits(field.guard as Counts);
  const attackerMods = await modifiersFor(tx, pid, { state: origin?.state ?? null, nowMs: due });
  const attacker: AttackerInput = { units, modifiers: attackerMods, versorgungsmangel: origin?.state.versorgungsmangel ?? false };
  let survivors = units;
  let destroyed = true;
  let battle: unknown = null;
  let seed: number | null = null;
  let defenderLeft: Counts = {};
  if (Object.keys(defenderUnits).length > 0) {
    seed = randomSeed();
    const defender: DefenderInput = field.ownerId !== null
      ? { units: defenderUnits, defenses: {}, modifiers: await modifiersFor(tx, field.ownerId, { nowMs: due }) }
      : guardDefender(defenderUnits);
    const res = resolveBattle(attacker, defender, balance, seed, battleWeather(field.col, field.row, due));
    if (!res.ok) throw new Error(`battle: ${res.code}`);
    const s = strandTroops(res.report, balance);
    destroyed = s.destroyed;
    survivors = activeUnits(s.report.attacker.final);
    defenderLeft = activeUnits(s.report.defender.final);
    battle = { ...s.report, loot: {} };
    await wreckAt(tx, field, s.report.wreck, due);
  }
  const prevOwner = field.ownerId;
  let outcome: "captured" | "cleared" | "held" | "limit" = "held";
  if (destroyed) {
    if (prevOwner !== null) await endGarrison(tx, field.missionId, {}, due);
    const split = splitGarrison(survivors, !!(plan as { stayAll?: boolean }).stayAll, balance);
    const limit = origin ? maxFieldsOf(origin.state) : 0;
    if (split && origin && (await ownedBy(tx, pid)).length < limit) {
      await tx.update(tables.resourceField).set({
        ownerId: pid, baseId: origin.id, missionId: m.id, guard: {}, guardAt: null, capturedAt: new Date(due), lastTickAt: new Date(due),
      }).where(eq(tables.resourceField.id, field.id));
      await stationGarrison(tx, m, plan, split.garrison, split.rest, due);
      await recordAchievement(tx, pid, "felder", 1, { atMs: due }); // Erfolg „Landnahme“
      outcome = "captured";
    } else {
      await releaseField(tx, field, due, null);
      outcome = split ? "limit" : "cleared";
    }
  } else if (prevOwner !== null) {
    await tx.update(tables.mission).set({ returning: defenderLeft }).where(eq(tables.mission.id, field.missionId!));
  } else {
    await tx.update(tables.resourceField).set({ guard: defenderLeft }).where(eq(tables.resourceField.id, field.id));
  }
  const attackerName = await playerName(tx, pid);
  const title = outcome === "captured" ? `${name} besetzt` : outcome === "held" ? `Angriff auf ${name} abgewiesen`
    : outcome === "limit" ? `${name} freigekämpft – Höchstzahl Felder erreicht` : `${name} freigekämpft – zu schwach für eine Besatzung`;
  const reportId = await storeNavalReport(tx, {
    kind: "feld", title, attackerPlayerId: pid, defenderPlayerId: prevOwner, attackerBaseId: m.baseId, defenderBaseId: field.baseId,
    winner: destroyed ? "attacker" : "defender", seed, atMs: due,
    report: {
      field: { id: field.id, kind: field.kind, tier: field.tier, outcome, owner: ownerName },
      ...(battle ? { battle, attackerName, defenderName: ownerName ?? "Kartell-Wache", targetName: name, attacker } : {}),
    },
  });
  if (outcome === "captured") {
    await tx.update(tables.mission).set({ reportId }).where(eq(tables.mission.id, m.id));
  } else {
    await sendHome(tx, m, plan, survivors, {}, reportId, due);
  }
  push.push(pushNotice(pid, "report", title, outcome === "captured" ? "Deine Besatzung hält das Feld." : "Der Verband kehrt heim.", "berichte"));
  if (prevOwner !== null) {
    const lost = destroyed;
    await systemMessage(tx, notify, [prevOwner], lost ? `${name} verloren` : `${name} gehalten`,
      lost ? `${attackerName} hat deine Besatzung auf ${name} geschlagen.${outcome === "captured" ? " Das Feld gehört jetzt ihm." : " Das Feld ist wieder neutral."}`
        : `Deine Besatzung auf ${name} hat den Angriff von ${attackerName} abgewiesen.`);
    push.push(pushNotice(prevOwner, "attack", lost ? `${name} verloren` : `${name} gehalten`, `Angreifer: ${attackerName}.`, "berichte"));
    notify.push([[prevOwner], "reports"], [[prevOwner], "missions"], [[prevOwner], "base"]);
  }
  notify.push([null, "map"], [[pid], "reports"]);
}

/** Besatzung zurückrufen: Feld wird neutral, angefangener Ertrag geht noch als Konvoi heim. Codes: no_field. */
export function fieldRecall(engine: Engine, playerId: number, key: string, fieldId: number) {
  return runCommand<{ ok: true; returnAtMs: number }>(engine, playerId, key, "fieldRecall", async (ctx) => {
    const field = await fieldById(ctx.tx, fieldId, true); // Reihenfolge: Feld vor Besatzung
    if (!field || field.ownerId !== playerId) throw new GameError("no_field");
    await settleField(ctx.tx, field, ctx.nowMs, ctx.notify);
    const [m] = field.missionId !== null ? await ctx.tx.select().from(tables.mission).where(eq(tables.mission.id, field.missionId)).for("update") : [];
    let returnAtMs = ctx.nowMs;
    if (m && m.status === "stationed") {
      const plan = m.plan as Mission;
      returnAtMs = ctx.nowMs + Math.max(0, plan.arriveAtMs - plan.departAtMs);
      await endGarrison(ctx.tx, m.id, (m.returning as Counts | null) ?? {}, ctx.nowMs);
    }
    await releaseField(ctx.tx, field, ctx.nowMs, null);
    ctx.notify.push([[playerId], "missions"], [[playerId], "base"], [null, "map"]);
    return { ok: true as const, returnAtMs };
  });
}
