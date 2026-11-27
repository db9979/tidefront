// Felder: Ablauf (docs/REGELN-FELDER.md). Globales field_tick alle deliveryHours: Ertrag je besetztem Feld (Rang,
// Zonenbonus) als Konvoi zum Heimathafen (abfangbar, Blockade hält zurück), Unterhalt in Proviant, Allianzpunkte,
// Würfel für Kartellangriffe, neue Wachen und Felder. field_delivery: Konvoi läuft ein. field_raid: Kartell greift an.
// field_warning: Radar-Vorwarnung bei Spielerangriffen (fields-radar.ts).
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  activeUnits, blockadeOf, cargoValue, cartelFieldRaid, clampEscort, combineModifiers, deliverCargo, fieldUpkeep, fieldYield,
  resolveBattle, settle, settleBattle, victoryRuleOf, type Counts,
} from "@tidefront/game-core";
import { seaRoute } from "@tidefront/world";
import { tables, type Db, type Tx } from "@tidefront/db";
import { balance, type NoticeJob } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { lockBase, lockBases, randomSeed, saveBase, scheduleEvent } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { battleWeather } from "./weather.ts";
import { systemMessage } from "./alliance-core.ts";
import { runningSeasonRow } from "./world-events.ts";
import { activeBlockade, createConvoy } from "./naval.ts";
import { pushNotice, storeNavalReport, type Notes } from "./naval-common.ts";
import { HOUR_MS, allianceMap, garrisonMods, fieldById, fieldName, ownedBy, rules, spawnFields, zonesOf, type FieldRow } from "./fields-core.ts";
import { endGarrison, releaseField } from "./fields-missions.ts";
import { fieldEscortOf } from "./fields-escort.ts";
import { garrisonAdmiral } from "./fields-admiral.ts";
import { admiralsAfterBattle } from "./admirals-battle.ts";
import { fieldWarning } from "./fields-radar.ts";
import { recordAchievement } from "./achievements.ts";

const none = (): HandlerResult => ({ notify: [] });

/**
 * Ertrag seit lastTickAt abrechnen: Unterhalt vom Heimathafen (Proviant, höchstens der Bestand), Ertrag als Konvoi
 * (Ankunft nach Fahrzeit mit convoySpeedKmh). Rang und Zone werden hier neu bestimmt. Sperrt den Heimathafen.
 */
export async function settleField(tx: Tx, f: FieldRow, due: number, notify: Notes, ctx?: { rank: number; zone: boolean }): Promise<void> {
  const r = rules();
  if (!r || f.ownerId === null || f.baseId === null || !f.lastTickAt) return;
  const hours = (due - f.lastTickAt.getTime()) / HOUR_MS;
  if (!(hours > 0)) return;
  let rank = ctx?.rank;
  let zone = ctx?.zone;
  if (rank === undefined || zone === undefined) {
    rank = (await ownedBy(tx, f.ownerId)).findIndex((x) => x.id === f.id);
    const all = (await tx.select().from(tables.resourceField)) as FieldRow[];
    zone = !!(await zonesOf(tx, all)).get(f.id)?.bonus;
  }
  const b = await lockBase(tx, f.baseId);
  await tx.update(tables.resourceField).set({ lastTickAt: new Date(due) }).where(eq(tables.resourceField.id, f.id));
  if (!b) return;
  const mods = await modsOf(tx, b, due);
  const state = settle(b.state, due, balance, mods);
  const upkeep = fieldUpkeep(f.tier, hours, balance);
  state.resources.proviant = Math.max(0, (state.resources.proviant ?? 0) - upkeep);
  await saveBase(tx, b.id, state);
  const cargo = fieldYield(f.kind, f.tier, hours, Math.max(0, rank), zone, balance);
  if (Object.keys(cargo).length > 0) {
    const arrive = due + Math.ceil((seaRoute(f, b).km / r.convoySpeedKmh) * HOUR_MS); // Seewege: Konvoi fährt über Wasser
    // Geleitabteilung der Besatzung fährt mit (missionId = Besatzung; liveEscort liest ihren aktuellen Bestand).
    const escort = await fieldEscortOf(tx, f.missionId);
    const convoyId = await createConvoy(tx, {
      kind: "feld", senderId: null, recipientId: f.ownerId, recipientBaseId: b.id, from: f, to: b, cargo, departMs: due, arriveMs: arrive,
      ...(f.missionId !== null ? { missionId: f.missionId } : {}), escort,
    });
    await scheduleEvent(tx, "field_delivery", arrive, { convoyId }, b.id);
  }
  notify.push([[f.ownerId], "base"], [[f.ownerId], "market"]);
}

/** game_event field_tick: Lieferzyklus aller besetzten Felder. */
async function fieldTick(tx: Tx, due: number): Promise<HandlerResult> {
  const r = rules();
  if (!r) return none();
  const notify: Notes = [[null, "map"]];
  const push: NoticeJob[] = [];
  await scheduleEvent(tx, "field_tick", due + r.deliveryHours * HOUR_MS, {}, null);
  await spawnFields(tx, due);
  // Neue Kartell-Wachen auf neutralen Feldern.
  const due0 = await tx.select().from(tables.resourceField)
    .where(and(isNull(tables.resourceField.ownerId), lte(tables.resourceField.guardAt, new Date(due)))) as FieldRow[];
  for (const f of due0) {
    await tx.update(tables.resourceField).set({ guard: { ...(r.guard[f.tier - 1] ?? {}) }, guardAt: null }).where(eq(tables.resourceField.id, f.id));
  }
  const all = (await tx.select().from(tables.resourceField).orderBy(tables.resourceField.id).for("update")) as FieldRow[];
  const owned = all.filter((f) => f.ownerId !== null);
  if (owned.length === 0) return { notify };
  const zones = await zonesOf(tx, all);
  await lockBases(tx, owned.map((f) => f.baseId!).filter((id) => id !== null));
  const am = await allianceMap(tx);
  const byOwner = new Map<number, FieldRow[]>();
  for (const f of owned) byOwner.set(f.ownerId!, [...(byOwner.get(f.ownerId!) ?? []), f]);
  const points = new Map<number, number>();
  for (const list of byOwner.values()) {
    list.sort((a, b) => (a.capturedAt?.getTime() ?? 0) - (b.capturedAt?.getTime() ?? 0) || a.id - b.id);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const hours = f.lastTickAt ? (due - f.lastTickAt.getTime()) / HOUR_MS : 0;
      await settleField(tx, f, due, notify, { rank: i, zone: !!zones.get(f.id)?.bonus });
      const a = am.get(f.ownerId!);
      if (a !== undefined && hours > 0) points.set(a, (points.get(a) ?? 0) + (r.alliancePointsPerFieldDay * hours) / 24);
      const raid = cartelFieldRaid(f.tier, randomSeed(), balance);
      if (raid) {
        const at = due + r.cartelRaidLeadMinutes * 60000;
        await scheduleEvent(tx, "field_raid", at, { fieldId: f.id, ownerId: f.ownerId, units: raid }, null);
        push.push(pushNotice(f.ownerId!, "attack", `Kartell hält auf ${fieldName(f)} zu`, `Ankunft in etwa ${r.cartelRaidLeadMinutes} Minuten. Deine Besatzung verteidigt (mit Geleitabteilung).`));
        await systemMessage(tx, notify, [f.ownerId!], `Kartell hält auf ${fieldName(f)} zu`, `Ein Kartellverband (${raid.schnellboot ?? 0} Schnellboote) greift in etwa ${r.cartelRaidLeadMinutes} Minuten dein Feld an.`);
      }
    }
  }
  for (const [allianceId, p] of points) {
    await tx.insert(tables.fieldScore).values({ allianceId, points: p })
      .onConflictDoUpdate({ target: tables.fieldScore.allianceId, set: { points: sql`${tables.fieldScore.points} + ${p}` } });
  }
  return { notify, push };
}

/** game_event field_delivery: Ertragskonvoi läuft ein (Blockade hält ihn zurück). */
async function fieldDelivery(tx: Tx, payload: Record<string, unknown>, due: number): Promise<HandlerResult> {
  const [c] = await tx.select().from(tables.convoy).where(eq(tables.convoy.id, Number(payload.convoyId))).for("update");
  if (!c || c.status !== "underway") return none();
  const bb = blockadeOf(balance);
  const block = bb ? await activeBlockade(tx, { baseId: c.recipientBaseId }, due) : null;
  if (block && bb) {
    const next = Math.max(due + 1000, Math.min(block.endsAt.getTime(), due + bb.deliveryHoldMinutes * 60000));
    await tx.update(tables.convoy).set({ arriveAt: new Date(next) }).where(eq(tables.convoy.id, c.id));
    await scheduleEvent(tx, "field_delivery", next, { convoyId: c.id }, c.recipientBaseId);
    return none();
  }
  await tx.update(tables.convoy).set({ status: "arrived" }).where(eq(tables.convoy.id, c.id));
  const b = await lockBase(tx, c.recipientBaseId);
  if (b) await saveBase(tx, b.id, deliverCargo(b.state, c.cargo as Counts, due, balance, await modsOf(tx, b, due)));
  // Wochenziel „Erträge von Feldern einfahren“ (Wert zum Richtpreis, Stahl-Äquivalent); kein Erfolg.
  if (b) await recordAchievement(tx, c.recipientId, "feldertrag", cargoValue(c.cargo as Counts, balance), { atMs: due });
  return { notify: [[[c.recipientId], "base"], [[c.recipientId], "market"]] };
}

/** game_event field_raid: Kartellverband gegen die Besatzung. Unterliegt sie, hält das Kartell das Feld (neutral). */
async function fieldRaid(tx: Tx, payload: Record<string, unknown>, due: number): Promise<HandlerResult> {
  const f = await fieldById(tx, Number(payload.fieldId), true);
  if (!f || f.ownerId === null || f.ownerId !== Number(payload.ownerId) || f.missionId === null) return none();
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, f.missionId)).for("update");
  if (!m || m.status !== "stationed") return none();
  const owner = f.ownerId;
  const units = activeUnits(payload.units as Counts);
  // Die ganze Besatzung verteidigt, auch die Geleitabteilung: der Kartellverband ist eine Stunde vorher gemeldet,
  // die Abteilung kehrt rechtzeitig zum Feld zurück (gegen Spielerangriffe nicht, fields-missions.ts).
  const garrison = activeUnits((m.returning as Counts | null) ?? {});
  const admD = await garrisonAdmiral(tx, m, due); // Admiral der Besatzung (fields-admiral.ts)
  const seed = randomSeed();
  const res = resolveBattle({ units }, { units: garrison, defenses: {}, modifiers: combineModifiers(await garrisonMods(tx, f, due), admD?.mods) }, balance, seed, battleWeather(f.col, f.row, due));
  if (!res.ok) throw new Error(`battle: ${res.code}`);
  const { report, destroyed } = settleBattle(res.report, balance, victoryRuleOf("feld"));
  const admirals = await admiralsAfterBattle(tx, report, seed, null, admD, due);
  const name = fieldName(f);
  const notify: Notes = [[null, "map"], [[owner], "reports"], [[owner], "missions"]];
  const left = activeUnits(report.defender.final);
  if (destroyed) {
    await endGarrison(tx, m.id, left, due);
    await releaseField(tx, f, due, { ...(rules()!.guard[f.tier - 1] ?? {}) });
  } else {
    await tx.update(tables.mission).set({ returning: left }).where(eq(tables.mission.id, m.id));
    // Verluste der Geleitabteilung: sie bleibt höchstens so groß wie das, was von der Besatzung übrig ist.
    await tx.update(tables.resourceField).set({ escort: clampEscort(left, (f.escort as Counts) ?? {}) }).where(eq(tables.resourceField.id, f.id));
  }
  if ((report.wreck.stahl ?? 0) + (report.wreck.elektronik ?? 0) > 0) {
    await tx.insert(tables.wreck).values({ col: f.col, row: f.row, stahl: report.wreck.stahl ?? 0, elektronik: report.wreck.elektronik ?? 0, createdAt: new Date(due) });
  }
  const title = destroyed ? `${name} an das Kartell verloren` : `Kartell vor ${name} abgewehrt`;
  const reportId = await storeNavalReport(tx, {
    kind: "feld", title, attackerPlayerId: null, defenderPlayerId: owner, defenderBaseId: f.baseId, winner: destroyed ? "attacker" : "defender", seed, atMs: due,
    report: { field: { id: f.id, kind: f.kind, tier: f.tier, outcome: destroyed ? "cartel" : "held" }, battle: { ...report, loot: {} }, attackerName: "Freibeuter-Kartell", defenderName: "Besatzung", targetName: name, attacker: { units }, ...(admirals ? { admirals } : {}) },
  });
  await systemMessage(tx, notify, [owner], title, destroyed ? `Das Kartell hat deine Besatzung auf ${name} geschlagen. Das Feld ist wieder neutral.` : `Deine Besatzung auf ${name} hat den Kartellverband zurückgeschlagen.`);
  return { notify, push: [pushNotice(owner, "attack", title, destroyed ? "Das Feld ist wieder neutral." : "Das Feld bleibt deins.", "berichte", reportId)] };
}

export const FIELD_HANDLERS: Record<string, (tx: Tx, ev: { payload: Record<string, unknown> }, due: number) => Promise<HandlerResult>> = {
  field_tick: (tx, _ev, due) => fieldTick(tx, due),
  field_delivery: (tx, ev, due) => fieldDelivery(tx, ev.payload, due),
  field_raid: (tx, ev, due) => fieldRaid(tx, ev.payload, due),
  field_warning: (tx, ev, due) => fieldWarning(tx, ev.payload, due),
};

/** Worker (alle 10 Minuten, auch nach Saisonwechsel): Felder anlegen und field_tick planen, falls keines ansteht. */
export async function ensureFieldPlanner(db: Db, nowMs: number): Promise<number | null> {
  const r = rules();
  if (!r) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340013)`);
    if (!(await runningSeasonRow(tx))) return null;
    await spawnFields(tx, nowMs);
    const [pending] = await tx.select({ id: tables.gameEvent.id }).from(tables.gameEvent)
      .where(and(eq(tables.gameEvent.type, "field_tick"), eq(tables.gameEvent.status, "pending"))).limit(1);
    if (pending) return null;
    const at = nowMs + r.deliveryHours * HOUR_MS;
    await scheduleEvent(tx, "field_tick", at, {}, null);
    return at;
  });
}

/** Saisonende: Felder und Feldpunkte verfallen (geplante Ereignisse löscht season.ts). */
export async function clearFields(tx: Tx): Promise<void> {
  await tx.delete(tables.fieldScore);
  await tx.delete(tables.resourceField);
}

/** Allianzwertung: Feldpunkte je Allianz (gerundet). */
export async function fieldPoints(tx: Tx | Db): Promise<Map<number, number>> {
  const rows = await tx.select().from(tables.fieldScore);
  return new Map(rows.map((r) => [r.allianceId, Math.round(r.points)]));
}
