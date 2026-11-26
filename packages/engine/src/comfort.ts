// Komfort: Verbandsvorlagen, „Wiederholen“ eigener Missionen, letzte Aufklärung eines Hafens,
// Einstellungen des Morgenberichts. Reine Lesezugriffe und kleine Schreibvorgänge, keine Spielregeln.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Counts, Mission } from "@tidefront/game-core";
import { tables, type Db, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine, type Notice } from "./context.ts";
import { baseOfPlayer } from "./store.ts";
import { diplomacyBlock } from "./alliance-core.ts";

export const TEMPLATE_MAX = 20;
export const TEMPLATE_NAME_MAX = 32;
export const MISSION_TYPES = ["ueberfall", "aufklaerung", "transport"] as const;
export type TemplateMissionType = (typeof MISSION_TYPES)[number];

/** Nur bekannte Spielereinheiten mit positiver ganzer Anzahl. Code: bad_units. */
export function cleanUnits(units: Record<string, number>): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(units)) {
    if (!Object.hasOwn(balance.units, id)) throw new GameError("unknown_unit");
    if (!Number.isInteger(n) || n < 0) throw new GameError("bad_count");
    if (n > 0) out[id] = n;
  }
  if (Object.keys(out).length === 0) throw new GameError("empty_fleet");
  return out;
}

export interface FitResult {
  /** Auf die Einheiten daheim gekürzt. */
  units: Counts;
  /** Gekürzte Typen: gewünscht und verfügbar. */
  short: { id: string; wanted: number; available: number }[];
}

/** Kürzt einen Verband auf die Einheiten daheim. */
export function fitTemplate(units: Counts, home: Counts): FitResult {
  const out: Counts = {};
  const short: FitResult["short"] = [];
  for (const [id, wanted] of Object.entries(units)) {
    const available = Math.max(0, Math.floor(home[id] ?? 0));
    const n = Math.min(wanted, available);
    if (n > 0) out[id] = n;
    if (n < wanted) short.push({ id, wanted, available });
  }
  return { units: out, short };
}

/** Vorlagen des Spielers mit Kürzung auf die Einheiten daheim. */
export async function listTemplates(db: DbOrTx, playerId: number) {
  const rows = await db
    .select()
    .from(tables.formationTemplate)
    .where(eq(tables.formationTemplate.playerId, playerId))
    .orderBy(sql`lower(${tables.formationTemplate.name})`);
  const own = await baseOfPlayer(db, playerId);
  const home = own?.state.units ?? {};
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    units: r.units as Counts,
    missionType: r.missionType as TemplateMissionType | null,
    updatedAtMs: r.updatedAt.getTime(),
    fit: fitTemplate(r.units as Counts, home),
  }));
}

/**
 * Speichert eine Vorlage; gleicher Name (ohne Groß-/Kleinschreibung) überschreibt.
 * Codes: bad_name, unknown_unit, bad_count, empty_fleet, bad_type, template_limit.
 */
export async function saveTemplate(
  db: Db,
  playerId: number,
  input: { name: string; units: Record<string, number>; missionType?: string | null },
): Promise<{ ok: true; id: number } | { ok: false; code: string }> {
  try {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > TEMPLATE_NAME_MAX) return { ok: false, code: "bad_name" };
    const units = cleanUnits(input.units);
    const type = input.missionType ?? null;
    if (type !== null && !(MISSION_TYPES as readonly string[]).includes(type)) return { ok: false, code: "bad_type" };
    return await db.transaction(async (tx) => {
      // Spielerzeile sperren: Obergrenze auch bei gleichzeitigem Speichern.
      await tx.select({ id: tables.player.id }).from(tables.player).where(eq(tables.player.id, playerId)).for("update");
      const [existing] = await tx
        .select({ id: tables.formationTemplate.id })
        .from(tables.formationTemplate)
        .where(and(eq(tables.formationTemplate.playerId, playerId), sql`lower(${tables.formationTemplate.name}) = lower(${name})`));
      if (existing) {
        await tx
          .update(tables.formationTemplate)
          .set({ name, units, missionType: type, updatedAt: new Date() })
          .where(eq(tables.formationTemplate.id, existing.id));
        return { ok: true as const, id: existing.id };
      }
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tables.formationTemplate)
        .where(eq(tables.formationTemplate.playerId, playerId));
      if ((n?.n ?? 0) >= TEMPLATE_MAX) return { ok: false as const, code: "template_limit" };
      const [row] = await tx
        .insert(tables.formationTemplate)
        .values({ playerId, name, units, missionType: type })
        .returning({ id: tables.formationTemplate.id });
      return { ok: true as const, id: row.id };
    });
  } catch (err) {
    if (err instanceof GameError) return { ok: false, code: err.code };
    throw err;
  }
}

export async function deleteTemplate(db: Db, playerId: number, id: number): Promise<boolean> {
  const r = await db
    .delete(tables.formationTemplate)
    .where(and(eq(tables.formationTemplate.id, id), eq(tables.formationTemplate.playerId, playerId)))
    .returning({ id: tables.formationTemplate.id });
  return r.length > 0;
}

// ---------------------------------------------------------------- Wiederholen

export interface RepeatPlan {
  type: string;
  col: number;
  row: number;
  units: Counts;
  /** Gekürzt auf die Einheiten daheim. */
  fit: FitResult;
  /** Vorab erkennbare Ablehnung (Fehlercode wie bei launchMission), sonst null. */
  blocked: string | null;
}

/** Ablehnungen, die sich schon vor der Planung prüfen lassen: eigener Hafen, Verbündete, Paktpartner. */
async function blockedFor(db: DbOrTx, playerId: number, type: string, col: number, row: number): Promise<string | null> {
  const [b] = await db
    .select({ playerId: tables.base.playerId })
    .from(tables.base)
    .where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  if (!b) return null;
  if (b.playerId === playerId) return "own_base";
  if (type === "ueberfall") return diplomacyBlock(db, playerId, b.playerId, Date.now());
  return null;
}

async function toRepeat(db: DbOrTx, playerId: number, m: { type: string; targetCol: number; targetRow: number; plan: unknown }, home: Counts): Promise<RepeatPlan> {
  const units = { ...((m.plan as Mission).units ?? {}) };
  const blocked = await blockedFor(db, playerId, m.type, m.targetCol, m.targetRow);
  return { type: m.type, col: m.targetCol, row: m.targetRow, units, fit: fitTemplate(units, home), blocked };
}

/** Ziel und Zusammensetzung der eigenen Mission zu einem Bericht; null, wenn es keine gibt. */
export async function repeatFromReport(db: DbOrTx, playerId: number, reportId: number): Promise<RepeatPlan | null> {
  const [m] = await db
    .select()
    .from(tables.mission)
    .where(and(eq(tables.mission.reportId, reportId), eq(tables.mission.playerId, playerId)));
  if (!m || !(MISSION_TYPES as readonly string[]).includes(m.type)) return null;
  const own = await baseOfPlayer(db, playerId);
  return toRepeat(db, playerId, m, own?.state.units ?? {});
}

/** Zuletzt heimgekehrte eigene Missionen (neueste zuerst). */
export async function recentMissions(db: DbOrTx, playerId: number, limit = 5) {
  const rows = await db
    .select()
    .from(tables.mission)
    .where(and(
      eq(tables.mission.playerId, playerId),
      eq(tables.mission.status, "done"),
      inArray(tables.mission.type, [...MISSION_TYPES]),
    ))
    .orderBy(desc(tables.mission.returnAt), desc(tables.mission.id))
    .limit(limit);
  const own = await baseOfPlayer(db, playerId);
  const home = own?.state.units ?? {};
  return Promise.all(rows.map(async (m) => ({
    id: m.id,
    reportId: m.reportId,
    returnedAtMs: (m.returnAt ?? m.arriveAt).getTime(),
    recalled: (m.plan as Mission).recalledAtMs !== undefined,
    ...(await toRepeat(db, playerId, m, home)),
  })));
}

// ---------------------------------------------------------------- Letzte Aufklärung

/** Lagebild der letzten eigenen Aufklärung des Spielerhafens auf diesem Feld; null ohne Aufklärung. */
export async function lastScout(db: DbOrTx, playerId: number, col: number, row: number) {
  const [b] = await db.select({ id: tables.base.id }).from(tables.base).where(and(eq(tables.base.col, col), eq(tables.base.row, row)));
  if (!b) return null;
  const [r] = await db
    .select({ id: tables.battleReport.id, report: tables.battleReport.report, createdAt: tables.battleReport.createdAt })
    .from(tables.battleReport)
    .where(and(
      eq(tables.battleReport.kind, "aufklaerung"),
      eq(tables.battleReport.attackerPlayerId, playerId),
      eq(tables.battleReport.defenderBaseId, b.id),
    ))
    .orderBy(desc(tables.battleReport.createdAt))
    .limit(1);
  const scout = (r?.report as { scout?: Record<string, unknown> } | undefined)?.scout;
  if (!r || !scout) return null;
  return {
    reportId: r.id,
    atMs: r.createdAt.getTime(),
    units: (scout.units ?? {}) as Counts,
    defenses: (scout.defenses ?? {}) as Counts,
    resources: (scout.resources ?? {}) as Counts,
    protectedPerResource: Number(scout.protectedPerResource ?? 0),
  };
}

// ---------------------------------------------------------------- Morgenbericht: Einstellungen

export const SUMMARY_DEFAULT = { enabled: false, minuteOfDay: 7 * 60, timeZone: "Europe/Berlin", push: false };

export function validTimeZone(tz: string): boolean {
  if (tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function summarySettings(db: DbOrTx, playerId: number) {
  const [r] = await db.select().from(tables.morningSummary).where(eq(tables.morningSummary.playerId, playerId));
  return {
    enabled: r?.enabled ?? SUMMARY_DEFAULT.enabled,
    minuteOfDay: r?.minuteOfDay ?? SUMMARY_DEFAULT.minuteOfDay,
    timeZone: r?.timeZone ?? SUMMARY_DEFAULT.timeZone,
    push: r?.push ?? SUMMARY_DEFAULT.push,
    lastSentAtMs: r?.lastSentAt?.getTime() ?? null,
  };
}

/** Codes: bad_time, bad_tz. */
export async function setSummarySettings(
  db: Db,
  playerId: number,
  input: { enabled: boolean; minuteOfDay: number; timeZone: string; push: boolean },
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!Number.isInteger(input.minuteOfDay) || input.minuteOfDay < 0 || input.minuteOfDay >= 1440) return { ok: false, code: "bad_time" };
  if (!validTimeZone(input.timeZone)) return { ok: false, code: "bad_tz" };
  const values = { enabled: input.enabled, minuteOfDay: input.minuteOfDay, timeZone: input.timeZone, push: input.push, updatedAt: new Date() };
  await db
    .insert(tables.morningSummary)
    .values({ playerId, ...values })
    .onConflictDoUpdate({ target: tables.morningSummary.playerId, set: values });
  return { ok: true };
}

/** Arten, die für den Morgenbericht mitgeschrieben werden (Kämpfe kommen aus den Berichten). */
const ENTRY_KINDS = new Set(["build", "training", "fleet", "delivery"]);

/** Schreibt eine Meldung für den Morgenbericht mit, wenn der Spieler ihn aktiviert hat. */
export async function recordSummaryEntry(engine: Engine, playerId: number, n: Notice): Promise<void> {
  if (!ENTRY_KINDS.has(n.kind)) return;
  await engine.db.execute(sql`
    insert into summary_entry (player_id, kind, title, body)
    select ${playerId}, ${n.kind}, ${n.title.slice(0, 200)}, ${n.body.slice(0, 500)}
    where exists (select 1 from morning_summary where player_id = ${playerId} and enabled)`);
}
