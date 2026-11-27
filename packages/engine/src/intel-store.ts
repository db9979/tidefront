// Lagebild: gespeichertes Wissen (Tabelle intel_sighting). Live-Sichtungen schreibt der Kartenabruf (je Partei höchstens
// alle cacheSeconds), Lagebilder schreiben Aufklärung, Spionage und Kampfberichte (storeReport). Gelesen wird das jüngste
// Wissen aller Schlüssel der Partei (Allianz teilt alles); Verbände nur fleetMemoryHours, alles andere forgetHours.
import { and, gt, inArray, lt, sql } from "drizzle-orm";
import { intelAge, isNestRespawned, nestRespawnHours, protectionStatus, type BaseState, type IntelAge, type IntelLevel } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { intelRules, partyOf, type Sight } from "./intel-sight.ts";

export type IntelKind = "base" | "nest" | "field" | "wreck" | "fleet";

/** Stand einer Angabe für die Oberfläche: Alter, Zeitpunkt, Quelle, Kenntnisstufe. */
export interface IntelTag {
  age: IntelAge;
  atMs: number;
  source: string;
  level: IntelLevel;
}

export interface Known {
  kind: IntelKind;
  objectId: number;
  level: IntelLevel;
  source: string;
  seenAtMs: number;
  data: Record<string, unknown>;
  age: Exclude<IntelAge, "live">;
}

export interface SightingInput {
  kind: IntelKind;
  objectId: number;
  level: IntelLevel;
  source: string;
  data: Record<string, unknown>;
}

const keyOf = (kind: string, id: number) => `${kind}:${id}`;

/** Wissen der Partei (jüngste Angabe je Objekt über alle Schlüssel), ohne Vergessenes; Schlüssel "kind:id". */
export async function knownFor(db: DbOrTx, sight: Sight, nowMs: number, kinds: IntelKind[]): Promise<Map<string, Known>> {
  const ib = intelRules();
  const out = new Map<string, Known>();
  if (!ib) return out;
  const rows = await db.select().from(tables.intelSighting).where(and(
    inArray(tables.intelSighting.owner, sight.keys),
    inArray(tables.intelSighting.kind, kinds),
    gt(tables.intelSighting.seenAt, new Date(nowMs - ib.forgetHours * 3600000)),
  ));
  for (const r of rows) {
    const seenAtMs = r.seenAt.getTime();
    if (seenAtMs > nowMs) continue; // Wissen „aus der Zukunft“ (verstellte Uhr in Tests) zählt nicht
    if (r.kind === "fleet" && nowMs - seenAtMs > ib.fleetMemoryHours * 3600000) continue;
    const age = intelAge(seenAtMs, nowMs, ib);
    if (!age) continue;
    const k = keyOf(r.kind, r.objectId);
    const prev = out.get(k);
    if (prev && prev.seenAtMs >= seenAtMs) continue;
    out.set(k, { kind: r.kind as IntelKind, objectId: r.objectId, level: r.level as IntelLevel, source: r.source, seenAtMs, data: r.data as Record<string, unknown>, age });
  }
  return out;
}

export function knownGet(map: Map<string, Known>, kind: IntelKind, id: number): Known | undefined {
  return map.get(keyOf(kind, id));
}

/** Angaben einer Partei speichern (Upsert je Objekt, neuere ersetzen ältere). */
export async function recordSightings(db: DbOrTx, owner: string, rows: SightingInput[], atMs: number): Promise<void> {
  if (rows.length === 0 || !intelRules()) return;
  const seenAt = new Date(atMs);
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(tables.intelSighting)
      .values(rows.slice(i, i + 200).map((r) => ({ owner, kind: r.kind, objectId: r.objectId, level: r.level, source: r.source, seenAt, data: r.data })))
      .onConflictDoUpdate({
        target: [tables.intelSighting.owner, tables.intelSighting.kind, tables.intelSighting.objectId],
        set: { level: sql`excluded.level`, source: sql`excluded.source`, seenAt: sql`excluded.seen_at`, data: sql`excluded.data` },
        setWhere: sql`${tables.intelSighting.seenAt} <= excluded.seen_at`,
      });
  }
}

const persisted = new Map<string, number>();

/** Live-Sichtungen höchstens alle cacheSeconds je Partei und Bereich speichern (Pi: wenige Schreibzugriffe). */
export async function persistLive(db: DbOrTx, sight: Sight, scope: string, nowMs: number, rows: () => SightingInput[]): Promise<void> {
  const ib = intelRules();
  if (!ib) return;
  const k = `${sight.party}|${scope}`;
  const last = persisted.get(k);
  if (last !== undefined && nowMs >= last && nowMs - last < ib.cacheSeconds * 1000) return;
  persisted.set(k, nowMs);
  await recordSightings(db, sight.party, rows(), nowMs);
}

/** Zwischenspeicher der Schreibdrosselung leeren (Tests). */
export function clearPersistThrottle(): void {
  persisted.clear();
}

/** Stand eines Nests für das Wissen und die Karte. */
export function nestData(n: { level: number; defeatedAt: Date | null }, nowMs: number) {
  const empty = n.defeatedAt !== null && !isNestRespawned(n.defeatedAt.getTime(), nowMs, balance, n.level);
  return { level: n.level, empty, respawnAtMs: n.defeatedAt ? n.defeatedAt.getTime() + nestRespawnHours(balance, n.level) * 3600000 : null };
}

/**
 * Bericht als Lagebild (Aufklärung, Spionage, Kampf): der Absender (Angreifer) kennt das Ziel jetzt genau.
 * Hafenziele (defenderBaseId), Nester (nestId) und Felder (report.field.id); Fehler im Lagebild brechen nichts ab.
 */
export async function recordReportIntel(db: DbOrTx, v: { kind: string; attackerPlayerId: number | null; defenderBaseId: number | null; nestId: number | null; report: unknown; atMs: number }): Promise<void> {
  if (!intelRules() || v.attackerPlayerId === null) return;
  if (v.kind === "transport") return;
  const source = v.kind === "aufklaerung" ? "Aufklärung" : v.kind === "spionage" ? "Spionage" : "Kampfbericht";
  const rows: SightingInput[] = [];
  if (v.defenderBaseId !== null) {
    const [b] = await db.select({ state: tables.base.state }).from(tables.base).where(inArray(tables.base.id, [v.defenderBaseId]));
    if (b) rows.push({ kind: "base", objectId: v.defenderBaseId, level: "lagebild", source, data: { protection: protectionOf(b.state, v.atMs) } });
  }
  if (v.nestId !== null) {
    const [n] = await db.select().from(tables.nest).where(inArray(tables.nest.id, [v.nestId]));
    if (n) rows.push({ kind: "nest", objectId: n.id, level: "lagebild", source, data: nestData(n, v.atMs) });
  }
  const fieldId = (v.report as { field?: { id?: number } } | null)?.field?.id;
  if (typeof fieldId === "number") {
    const [f] = await db.select().from(tables.resourceField).where(inArray(tables.resourceField.id, [fieldId]));
    if (f) rows.push({ kind: "field", objectId: f.id, level: "lagebild", source, data: { ownerId: f.ownerId, guarded: Object.values((f.guard ?? {}) as Record<string, number>).some((x) => x > 0), guardAtMs: f.guardAt?.getTime() ?? null } });
  }
  if (rows.length === 0) return;
  const { party } = await partyOf(db, v.attackerPlayerId);
  await recordSightings(db, party, rows, v.atMs);
}

/** Schutzstatus eines Hafenzustands (Grund oder null), wie mapView ihn zeigt. */
export function protectionOf(state: unknown, nowMs: number): string | null {
  return protectionStatus((state as BaseState).protection, nowMs, balance).reason;
}

/** Worker: Wissen älter als forgetHours löschen. */
export async function purgeIntel(db: DbOrTx, nowMs: number): Promise<number> {
  const ib = intelRules();
  if (!ib) return 0;
  const r = await db.delete(tables.intelSighting).where(lt(tables.intelSighting.seenAt, new Date(nowMs - ib.forgetHours * 3600000))).returning({ id: tables.intelSighting.id });
  return r.length;
}
