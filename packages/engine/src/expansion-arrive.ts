// Mehrere Häfen: Ankunft einer Gründung (neuer Hafen, Kolonieschiff verbraucht, Geleit kehrt heim) oder Verlegung
// (Einheiten, Ladung und Admiral wechseln dauerhaft den Hafen). Regeln: docs/REGELN-EXPANSION.md.
import { eq } from "drizzle-orm";
import { createColony, deliverCargo, expansionOf, mergeVeterancy, returnMission, settle, type Counts, type Mission } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { tables, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { homeBaseOf, lockBase, lockBases, saveBase, scheduleEvent } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { recordAchievement } from "./achievements.ts";
import { activeCounts, pushNotice, sendHome, storeNavalReport, type MissionRowLike, type Notes } from "./naval-common.ts";
import { FOUNDING_TYPE, foundingCheck } from "./expansion.ts";
import { colonyNameAt } from "./harbor-names.ts";

const HOUR_MS = 3600000;

/** Gründe einer gescheiterten Gründung als Text für den Bericht. */
export const FOUNDING_FAIL_TEXT: Record<string, string> = {
  field_taken: "Feld besetzt", too_close: "zu nah an einem fremden Hafen", too_close_own: "zu nah an einem eigenen Hafen",
  resource_field: "Rohstofffeld", trade_port: "Handelshafen", not_coast: "keine Küste", too_far: "zu weit vom Heimathafen",
  command_level: "Kommandozentrale zu niedrig", base_limit: "Höchstzahl Häfen erreicht", colony_ship: "kein Kolonieschiff",
  expansion_off: "Gründungen abgeschaltet", no_base: "kein Heimathafen",
};

/** Ankunft einer Gründung/Verlegung (mission_arrive, Weiche in handlers.ts). */
export async function expansionArrive(tx: Tx, m: MissionRowLike & { plan: unknown }, dueMs: number): Promise<HandlerResult> {
  const plan = m.plan as Mission;
  return m.type === FOUNDING_TYPE ? foundingArrive(tx, m, plan, dueMs) : transferArrive(tx, m, plan, dueMs);
}

async function foundingArrive(tx: Tx, m: MissionRowLike, plan: Mission, due: number): Promise<HandlerResult> {
  const pid = m.playerId!;
  const notify: Notes = [[[pid], "missions"], [[pid], "reports"], [[pid], "base"]];
  const push: NoticeJob[] = [];
  const e = expansionOf(balance);
  const origin = await lockBase(tx, m.baseId!); // Sperre vor dem Anlegen des neuen Hafens
  const at = { col: m.targetCol, row: m.targetRow };
  let blocker = e ? await foundingCheck(tx, pid, at, undefined, m.id) : "expansion_off";
  if (!blocker && (plan.units[e!.colonyShip] ?? 0) < 1) blocker = "colony_ship";
  let baseId: number | null = null;
  let name = "";
  if (!blocker) {
    const home = (await homeBaseOf(tx, pid))!;
    name = await colonyNameAt(tx, pid, at.col, at.row); // Ortsname aus der Karte
    const state = createColony(balance, due, hexCenter(at.col, at.row), home.state.protection, plan.cargo);
    // Wettlauf: base_field ist eindeutig; der Verlierer bekommt „Feld besetzt“.
    const ins = await tx.insert(tables.base).values({ playerId: pid, name, col: at.col, row: at.row, state, isHome: false })
      .onConflictDoNothing().returning({ id: tables.base.id });
    if (ins.length === 0) blocker = "field_taken";
    else baseId = ins[0].id;
  }
  if (blocker || baseId === null) {
    const reason = FOUNDING_FAIL_TEXT[blocker!] ?? blocker!;
    const title = `Gründung gescheitert: ${reason}`;
    const reportId = await storeNavalReport(tx, {
      kind: "gruendung", title, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, atMs: due,
      report: { founding: { col: at.col, row: at.row, ok: false, code: blocker, units: plan.units, cargo: plan.cargo } },
    });
    await sendHome(tx, m, plan, activeCounts(plan.units), plan.cargo ?? {}, reportId, due);
    push.push(pushNotice(pid, "report", title, "Das Kolonieschiff kehrt mit seiner Ladung heim.", "berichte", reportId));
    return { notify, push };
  }
  await scheduleEvent(tx, "raid_launch", due + (e!.firstRaidAfterHours * HOUR_MS), {}, baseId);
  const escort: Counts = {};
  for (const [id, n] of Object.entries(activeCounts(plan.units))) {
    const k = id === e!.colonyShip ? n - 1 : n;
    if (k > 0) escort[id] = k;
  }
  const title = `Außenposten ${name} gegründet`;
  const reportId = await storeNavalReport(tx, {
    kind: "gruendung", title, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, defenderBaseId: baseId, atMs: due,
    report: { founding: { col: at.col, row: at.row, ok: true, baseId, name, cargo: plan.cargo, escort } },
  });
  if (Object.keys(escort).length > 0) {
    await sendHome(tx, m, plan, escort, {}, reportId, due); // Geleit kehrt heim; das Kolonieschiff fehlt bei der Rückkehr
  } else {
    if (origin) await saveBase(tx, origin.id, returnMission(origin.state, plan.units, {}, {}, due, balance, await modsOf(tx, origin, due)));
    await tx.update(tables.mission).set({ status: "done", returning: {}, cargoHome: {}, reportId, returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
  }
  await recordAchievement(tx, pid, "kolonien", 1, { atMs: due }); // Erfolg „Kolonist“
  push.push(pushNotice(pid, "report", title, "Dein neuer Hafen steht unter Gründungsschutz.", "berichte", reportId));
  notify.push([null, "map"]);
  return { notify, push };
}

async function transferArrive(tx: Tx, m: MissionRowLike, plan: Mission, due: number): Promise<HandlerResult> {
  const pid = m.playerId!;
  const notify: Notes = [[[pid], "missions"], [[pid], "reports"], [[pid], "base"]];
  const bases = await lockBases(tx, [m.baseId!, m.targetId ?? m.baseId!]); // aufsteigend
  const origin = bases.get(m.baseId!);
  const target = m.targetId !== null ? bases.get(m.targetId) : undefined;
  const units = activeCounts(plan.units);
  if (!origin || !target || target.playerId !== pid || target.id === origin.id) {
    const reportId = await storeNavalReport(tx, {
      kind: "verlegung", title: "Verlegung abgebrochen: Zielhafen fehlt", attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, atMs: due,
      report: { transfer: { ok: false, units, cargo: plan.cargo } },
    });
    const returnAt = due + Math.max(0, plan.arriveAtMs - plan.departAtMs);
    await tx.update(tables.mission).set({ status: "returning", returning: units, cargoHome: plan.cargo ?? {}, reportId, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
    await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
    return { notify };
  }
  const from = returnMission(origin.state, plan.units, {}, {}, due, balance, await modsOf(tx, origin, due));
  const to = deliverCargo(settle(target.state, due, balance, await modsOf(tx, target, due)), plan.cargo ?? {}, due, balance, await modsOf(tx, target, due));
  // Veteranen: Erfahrung des Ausgangshafens, gewichtet mit dem Bestand des Ziels gemischt.
  const vet = mergeVeterancy(to, origin.state.veterancy, units);
  if (vet) to.veterancy = vet;
  else delete to.veterancy;
  for (const [id, n] of Object.entries(units)) to.units[id] = (to.units[id] ?? 0) + n;
  await saveBase(tx, origin.id, from);
  await saveBase(tx, target.id, to);
  if (plan.admiralId !== undefined) {
    await tx.update(tables.admiral).set({ baseId: target.id }).where(eq(tables.admiral.id, plan.admiralId)); // mitfahrender Admiral wechselt den Hafen
  }
  const reportId = await storeNavalReport(tx, {
    kind: "verlegung", title: `Verlegung nach ${target.name} angekommen`, attackerPlayerId: pid, defenderPlayerId: null,
    attackerBaseId: origin.id, defenderBaseId: target.id, atMs: due,
    report: { transfer: { ok: true, from: origin.name, to: target.name, units, cargo: plan.cargo, admiralId: plan.admiralId ?? null } },
  });
  await tx.update(tables.mission).set({ status: "done", returning: units, cargoHome: {}, reportId, returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
  return { notify };
}
