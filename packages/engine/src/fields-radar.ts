// Felder: Radar-Vorwarnung bei Angriffen anderer Spieler auf ein besetztes Feld (docs/REGELN-FELDER.md, Angriffe).
// Wie bei Häfen (event-notices.ts attackWarning, radar.ts): fällig zu Ankunft − Vorwarnzeit; die Vorwarnzeit ist
// radarWarningFactor × Vorwarnzeit des Heimathafens des Felds (Radar mit Strom, Sabotage, Nebel, Tarnung des Angreifers).
// Einmal erkannt bleibt erkannt (plan.detectedAtMs). Push und Systemnachricht an den Besitzer.
import { and, eq, inArray } from "drizzle-orm";
import { fieldWarningMinutes, radarWarningMinutes, settle } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import { readBase, scheduleEvent, type BaseRow } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { systemMessage } from "./alliance-core.ts";
import { detectedAtOf, detectIncoming, isDetected, markDetected, warnFactor } from "./radar.ts";
import { RADAR_RECHECK_MS } from "./event-notices.ts";
import { fmtClock, playerName, type Notes } from "./naval-common.ts";
import { FIELD_TYPE, fieldById, fieldName, type FieldRow } from "./fields-core.ts";

/** Vorwarnzeit (Minuten, ohne Tarnung) für Felder des Hafens `b` zum Zeitpunkt `atMs`. */
export async function fieldWarnMinutes(db: DbOrTx, b: BaseRow, atMs: number): Promise<number> {
  const mods = await modsOf(db, b, atMs);
  return fieldWarningMinutes(radarWarningMinutes(settle(b.state, atMs, balance, mods), balance, mods), balance);
}

/** Beim Auslaufen eines Angriffs auf ein fremdes besetztes Feld: Vorwarnung planen. */
export async function scheduleFieldWarning(tx: Tx, missionId: number, field: FieldRow, arriveAtMs: number, nowMs: number, warningFactor = 1): Promise<void> {
  if (field.ownerId === null || field.baseId === null) return;
  const b = await readBase(tx, field.baseId);
  if (!b) return;
  const warnMs = (await fieldWarnMinutes(tx, b, nowMs)) * warningFactor * 60000;
  await scheduleEvent(tx, "field_warning", Math.max(nowMs, arriveAtMs - warnMs), { missionId }, field.baseId);
}

const minutesText = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60000));
  return min >= 120 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`;
};

/** game_event field_warning: Angriff auf ein Feld erkannt (sonst neu planen, solange der Verband unterwegs ist). */
export async function fieldWarning(tx: Tx, payload: Record<string, unknown>, due: number): Promise<HandlerResult> {
  const none: HandlerResult = { notify: [] };
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(payload.missionId)));
  if (!m || m.status !== "outbound" || m.targetKind !== "field" || m.targetId === null || m.type !== FIELD_TYPE) return none;
  const f = await fieldById(tx, m.targetId);
  if (!f || f.ownerId === null || f.ownerId === m.playerId || f.baseId === null) return none;
  const b = await readBase(tx, f.baseId);
  if (!b) return none;
  if (detectedAtOf(m.plan) === null) {
    const warn = await fieldWarnMinutes(tx, b, due);
    if (!isDetected(m, due, warn)) {
      const next = Math.min(m.arriveAt.getTime() - warn * warnFactor(m.plan) * 60000, due + RADAR_RECHECK_MS);
      if (next < m.arriveAt.getTime()) await scheduleEvent(tx, "field_warning", Math.max(next, due + 1), { missionId: m.id }, b.id);
      return none;
    }
    await markDetected(tx, [m.id], due);
  }
  const attacker = m.playerId !== null ? await playerName(tx, m.playerId) : "Unbekannt";
  const arrive = m.arriveAt.getTime();
  const left = minutesText(arrive - due);
  const name = fieldName(f);
  const notify: Notes = [[[f.ownerId], "missions"]];
  await systemMessage(tx, notify, [f.ownerId], `Angriff auf ${name} erkannt`,
    `Das Radar von ${b.name} meldet einen Verband von ${attacker} auf dem Weg zu deinem Feld ${name}. Ankunft in ${left} ` +
    `(${fmtClock(arrive)} Uhr). Deine Besatzung verteidigt; du kannst sie verstärken oder zurückrufen.`);
  return {
    notify,
    push: [{ playerId: f.ownerId, notice: {
      kind: "attack", url: "/?tab=truppen", tag: `field-attack-${m.id}`, title: `Angriff auf ${name} erkannt`,
      body: `${attacker} greift dein Feld an. Ankunft in ${left} (${fmtClock(arrive)} Uhr).`,
      facts: [["Angreifer", attacker], ["Ziel", name], ["Ankunft in", left], ["Ankunft", `${fmtClock(arrive)} Uhr`]],
    } }],
  };
}

/**
 * Lesemodell „Meine Felder“: erkannte Angriffe auf eigene Felder (Feld-ID → Ankünfte) und eigene Verstärkungen
 * unterwegs. Angreifer bleiben bis zum Kampf unbekannt (wie bei Häfen).
 */
export async function fieldIncoming(db: DbOrTx, playerId: number, mine: FieldRow[], nowMs: number) {
  const attacks = new Map<number, { arriveAtMs: number }[]>();
  const reinforcements = new Map<number, { arriveAtMs: number; units: Record<string, number> }[]>();
  if (mine.length === 0) return { attacks, reinforcements };
  const rows = await db.select().from(tables.mission).where(and(
    eq(tables.mission.targetKind, "field"),
    inArray(tables.mission.targetId, mine.map((f) => f.id)),
    eq(tables.mission.status, "outbound"),
    eq(tables.mission.type, FIELD_TYPE),
  ));
  const warnByBase = new Map<number, number>();
  for (const f of mine) {
    if (f.baseId === null || warnByBase.has(f.baseId)) continue;
    const b = await readBase(db, f.baseId);
    warnByBase.set(f.baseId, b ? await fieldWarnMinutes(db, b, nowMs) : 0);
  }
  for (const f of mine) {
    const here = rows.filter((m) => m.targetId === f.id);
    for (const m of here.filter((x) => x.playerId === playerId)) {
      const list = reinforcements.get(f.id) ?? [];
      list.push({ arriveAtMs: m.arriveAt.getTime(), units: (m.plan as { units: Record<string, number> }).units });
      reinforcements.set(f.id, list);
    }
    const hostile = here.filter((x) => x.playerId !== playerId);
    const seen = await detectIncoming(db, hostile, nowMs, warnByBase.get(f.baseId ?? -1) ?? 0);
    if (seen.length > 0) attacks.set(f.id, seen.map((m) => ({ arriveAtMs: m.arriveAt.getTime() })).sort((a, b) => a.arriveAtMs - b.arriveAtMs));
  }
  return { attacks, reinforcements };
}
