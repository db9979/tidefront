// Felder: Rohstofffelder auf See (docs/REGELN-FELDER.md) – Auswahl der aktiven Felder aus der festen Kandidatenliste,
// gemeinsame Abfragen (Rang, Zonen, Allianz) und das Lesemodell für Karte und „Meine Felder“.
// Felder hängen am Spieler UND an einem Heimathafen (baseId): Ziel der Ertragskonvois (vorbereitet für mehrere Häfen).
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  fieldBaseYield, fieldsOf, fieldYield, fieldZones, maxFieldsFor, yieldFactor,
  type Counts, type FieldsBalance, type ResourceMap,
} from "@tidefront/game-core";
import { fieldSites, hexCenter, hexDistanceKm, type FieldSite } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { baseOfPlayer } from "./store.ts";
import { relationsOf } from "./alliance-core.ts";

export const FIELD_TYPE = "besetzen";
export const HOUR_MS = 3600000;

export interface FieldRow {
  id: number;
  siteIndex: number;
  col: number;
  row: number;
  kind: string;
  tier: number;
  ownerId: number | null;
  baseId: number | null;
  missionId: number | null;
  guard: unknown;
  guardAt: Date | null;
  capturedAt: Date | null;
  lastTickAt: Date | null;
  createdAt: Date;
}

/** Anzeigenamen der Feldarten. */
export const FIELD_KIND_TEXT: Record<string, string> = {
  oelfeld: "Ölfeld", erzbucht: "Erzbucht", fischgrund: "Fischgrund", elektronikwrack: "Elektronik-Wrack",
};
export const fieldName = (f: { kind: string; tier: number }) => `${FIELD_KIND_TEXT[f.kind] ?? f.kind} (Stufe ${f.tier})`;

export function rules(): FieldsBalance | null {
  return fieldsOf(balance);
}

export function sitesOf(f: FieldsBalance): FieldSite[] {
  return fieldSites(f.siteSeed, Object.fromEntries(Object.entries(f.kinds).map(([k, v]) => [k, v.share])), f.tierShares);
}

export async function fieldById(db: DbOrTx, id: number, lock = false): Promise<FieldRow | null> {
  const q = db.select().from(tables.resourceField).where(eq(tables.resourceField.id, id));
  const [r] = lock ? await q.for("update") : await q;
  return (r as FieldRow) ?? null;
}

/** Eigene Felder in Einnahme-Reihenfolge (Rang für den abnehmenden Ertrag). */
export async function ownedBy(db: DbOrTx, playerId: number): Promise<FieldRow[]> {
  const rows = await db.select().from(tables.resourceField).where(eq(tables.resourceField.ownerId, playerId));
  return (rows as FieldRow[]).sort((a, b) => (a.capturedAt?.getTime() ?? 0) - (b.capturedAt?.getTime() ?? 0) || a.id - b.id);
}

/** Höchstzahl eigener Felder nach Stufe der Hafenkommandantur des Heimathafens. */
export function maxFieldsOf(state: { buildings: Record<string, number> }): number {
  return maxFieldsFor(state.buildings.hafenkommandantur ?? 0, balance);
}

/** Allianz je Spieler (nur Mitglieder). */
export async function allianceMap(db: DbOrTx): Promise<Map<number, number>> {
  const rows = await db.select({ playerId: tables.allianceMember.playerId, allianceId: tables.allianceMember.allianceId }).from(tables.allianceMember);
  return new Map(rows.map((r) => [r.playerId, r.allianceId]));
}

/** Zonen aller besetzten Felder (Feld-ID → Zone, Größe, Bonus). */
export async function zonesOf(db: DbOrTx, fields: FieldRow[]) {
  const am = await allianceMap(db);
  return fieldZones(
    fields.filter((f) => f.ownerId !== null).map((f) => ({ id: f.id, allianceId: am.get(f.ownerId!) ?? null, at: hexCenter(f.col, f.row) })),
    balance,
  );
}

/** Wache vorhanden (neutrales Feld vom Kartell gehalten)? */
export function guarded(f: FieldRow): boolean {
  return Object.values((f.guard as Counts) ?? {}).some((n) => n > 0);
}

// ---------------------------------------------------------------- Auswahl der aktiven Felder

/**
 * Hält die Zahl der aktiven Felder bei `count`: neutrale Felder zu nah an einem Hafen verschwinden, ebenso neutrale
 * Felder ohne Hafen in der Nähe (älter als ein Tag), wenn es bessere Plätze gibt. Neue Felder bevorzugt dort, wo
 * Häfen mehrerer Spieler in Reichweite liegen (zwischen den Häfen), nie näher als minKmFromBase an einem Hafen.
 */
export async function spawnFields(db: DbOrTx, nowMs: number): Promise<number> {
  const f = rules();
  if (!f) return 0;
  const sites = sitesOf(f);
  const bases = await db.select({ col: tables.base.col, row: tables.base.row, playerId: tables.base.playerId }).from(tables.base);
  const existing = (await db.select().from(tables.resourceField)) as FieldRow[];
  const aimed = new Set((await db
    .select({ id: tables.mission.targetId })
    .from(tables.mission)
    .where(and(eq(tables.mission.targetKind, "field"), eq(tables.mission.status, "outbound")))).map((r) => r.id));
  const nearest = (h: { col: number; row: number }) => bases.reduce((m, b) => Math.min(m, hexDistanceKm(b, h)), Infinity);
  const score = (h: { col: number; row: number }) =>
    Math.min(3, new Set(bases.filter((b) => hexDistanceKm(b, h) <= f.preferKm).map((b) => b.playerId)).size);
  const used = new Set(existing.map((e) => e.siteIndex));
  const free = sites
    .filter((s) => !used.has(s.index) && nearest(s) >= f.minKmFromBase)
    .map((s) => ({ s, score: score(s) }))
    .sort((a, b) => b.score - a.score || a.s.index - b.s.index);
  const betterExists = free.some((c) => c.score > 0);
  const drop = existing.filter((e) => e.ownerId === null && !aimed.has(e.id) && (
    nearest(e) < f.minKmFromBase || (betterExists && score(e) === 0 && nowMs - e.createdAt.getTime() > 24 * HOUR_MS)));
  if (drop.length > 0) await db.delete(tables.resourceField).where(inArray(tables.resourceField.id, drop.map((d) => d.id)));
  const need = f.count - (existing.length - drop.length);
  const add = free.slice(0, Math.max(0, need));
  if (add.length > 0) {
    await db.insert(tables.resourceField).values(add.map(({ s }) => ({
      siteIndex: s.index, col: s.col, row: s.row, kind: s.kind, tier: s.tier,
      guard: { ...(f.guard[s.tier - 1] ?? {}) }, createdAt: new Date(nowMs),
    }))).onConflictDoNothing();
  }
  return add.length;
}

// ---------------------------------------------------------------- Lesemodell

/** Letztes Lagebild je Feld aus eigenen Aufklärungsberichten. */
async function intelOf(db: DbOrTx, playerId: number) {
  const rows = await db
    .select({ report: tables.battleReport.report, createdAt: tables.battleReport.createdAt })
    .from(tables.battleReport)
    .where(and(eq(tables.battleReport.attackerPlayerId, playerId), eq(tables.battleReport.kind, "aufklaerung"), sql`${tables.battleReport.report} ? 'field'`))
    .orderBy(desc(tables.battleReport.createdAt))
    .limit(300);
  const out = new Map<number, { atMs: number; units: Counts; owner: string | null }>();
  for (const r of rows) {
    const fld = (r.report as { field?: { id: number; units?: Counts; owner?: string | null } }).field;
    if (fld && !out.has(fld.id)) out.set(fld.id, { atMs: r.createdAt.getTime(), units: fld.units ?? {}, owner: fld.owner ?? null });
  }
  return out;
}

/** Besatzungen (aktueller Bestand) je Missions-ID. */
export async function garrisons(db: DbOrTx, missionIds: number[]): Promise<Map<number, Counts>> {
  if (missionIds.length === 0) return new Map();
  const rows = await db.select({ id: tables.mission.id, returning: tables.mission.returning }).from(tables.mission).where(inArray(tables.mission.id, missionIds));
  return new Map(rows.map((r) => [r.id, (r.returning as Counts | null) ?? {}]));
}

/** Nächster Lieferzyklus (geplantes field_tick). */
export async function nextTickMs(db: DbOrTx): Promise<number | null> {
  const [e] = await db
    .select({ dueAt: tables.gameEvent.dueAt })
    .from(tables.gameEvent)
    .where(and(eq(tables.gameEvent.type, "field_tick"), eq(tables.gameEvent.status, "pending")))
    .orderBy(tables.gameEvent.dueAt)
    .limit(1);
  return e?.dueAt.getTime() ?? null;
}

/** Karte und „Meine Felder“: alle Felder mit Besitzerfarbe, bekannte Besatzung, Zonen; eigene mit Ertrag. */
export async function fieldsView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const f = rules();
  if (!f) return null;
  const db = engine.db;
  const rows = ((await db.select().from(tables.resourceField)) as FieldRow[]).sort((a, b) => a.id - b.id);
  const relations = await relationsOf(db, playerId, nowMs);
  const names = new Map((await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player)
    .where(inArray(tables.player.id, [0, ...rows.map((r) => r.ownerId ?? 0)]))).map((p) => [p.id, p.name]));
  const zones = await zonesOf(db, rows);
  const intel = await intelOf(db, playerId);
  const garrison = await garrisons(db, rows.filter((r) => r.missionId !== null).map((r) => r.missionId!));
  const own = await baseOfPlayer(db, playerId);
  const mine = await ownedBy(db, playerId);
  const rank = new Map(mine.map((m, i) => [m.id, i]));
  const next = await nextTickMs(db);
  const relationOf = (r: FieldRow) => r.ownerId === null ? (guarded(r) ? "kartell" : "frei")
    : r.ownerId === playerId ? "own" : relations.get(r.ownerId) ?? "neutral";
  const fields = rows.map((r) => {
    const relation = relationOf(r);
    const open = relation === "own" || relation === "allianz";
    const known = intel.get(r.id);
    const z = zones.get(r.id);
    return {
      id: r.id, col: r.col, row: r.row, kind: r.kind, tier: r.tier, relation,
      owner: r.ownerId !== null ? names.get(r.ownerId) ?? "?" : null,
      yieldPerHour: fieldBaseYield(r.kind, r.tier, balance),
      garrison: open && r.missionId !== null ? garrison.get(r.missionId) ?? {} : null,
      guard: r.ownerId === null ? (open || known ? (r.guard as Counts) : null) : null,
      guardAtMs: r.ownerId === null && !guarded(r) && r.guardAt ? r.guardAt.getTime() : null,
      intel: known && !open ? { atMs: known.atMs, units: known.units, owner: known.owner } : null,
      zone: z ? { id: z.zone, size: z.size, bonus: z.bonus } : null,
    };
  });
  const minePart = mine.map((m) => {
    const z = zones.get(m.id);
    const i = rank.get(m.id)!;
    return {
      id: m.id, col: m.col, row: m.row, kind: m.kind, tier: m.tier, missionId: m.missionId,
      garrison: m.missionId !== null ? garrison.get(m.missionId) ?? {} : {},
      factor: yieldFactor(i, balance), zoneBonus: !!z?.bonus,
      yieldPerHour: fieldYield(m.kind, m.tier, 1, i, !!z?.bonus, balance) as ResourceMap,
      upkeepPerHour: f.upkeepProviantPerHour[m.tier - 1] ?? 0,
      home: m.baseId === own?.id ? own?.name ?? null : null,
      capturedAtMs: m.capturedAt?.getTime() ?? null,
    };
  });
  const am = await allianceMap(db);
  const myAlliance = am.get(playerId);
  const [score] = myAlliance !== undefined ? await db.select().from(tables.fieldScore).where(eq(tables.fieldScore.allianceId, myAlliance)) : [];
  return {
    serverNow: nowMs,
    maxFields: own ? maxFieldsOf(own.state) : 0,
    nextDeliveryAtMs: next,
    fields,
    mine: minePart,
    alliancePoints: score ? Math.round(score.points) : null,
  };
}

/** Besetzte Felder mit Besitzer (für Allianzwertung und Tests). */
export async function ownedFields(db: DbOrTx): Promise<FieldRow[]> {
  return (await db.select().from(tables.resourceField).where(isNotNull(tables.resourceField.ownerId))) as FieldRow[];
}
