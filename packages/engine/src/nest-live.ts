// Lebendige Nester auf dem Server (Regeln: game-core nest-living.ts, docs/REGELN.md „Piratennester“): Zustand aus der
// Zeile lesen, Wurf geheim würfeln und speichern (nie aus ID oder Zeit ableitbar), Eroberung (Wurf der Wiederbesetzung
// sofort ziehen, Beute ab Wiederbesetzung), gewonnene Abwehr (Überlebende mit Zeitpunkt), Lagebild-Daten für das Wissen.
// Ein Schreibzugriff je Kampf; Erholung und Beute rechnet jeder Abruf aus den Zeitstempeln.
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  afterDefense, garrisonAt, isNestRespawned, lootFactorAt, mulberry32, nestRespawnHours, nestVaries, rollNest,
  type Counts, type NestLiveState, type NestRoll,
} from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { randomSeed } from "./store.ts";

const HOUR_MS = 3600000;

export interface NestRow {
  id: number;
  level: number;
  defeatedAt: Date | null;
  roll?: unknown;
  garrison?: unknown;
  garrisonAt?: Date | null;
  lootAt?: Date | null;
}

/** Gespeicherter Zustand (alte Zeilen ohne Wurf: Mitte, ohne Beutewachstum). */
export function nestState(n: NestRow): NestLiveState {
  return {
    roll: (n.roll as NestRoll | null | undefined) ?? null,
    garrison: (n.garrison as NestLiveState["garrison"] | undefined) ?? null,
    garrisonAtMs: n.garrisonAt ? n.garrisonAt.getTime() : null,
    lootAtMs: n.lootAt ? n.lootAt.getTime() : null,
  };
}

/** Geheimer Wurf (Server-Zufall). */
export function secretRoll(level: number): NestRoll {
  return rollNest(level, balance, mulberry32(randomSeed()));
}

/** Nester ohne Wurf (neu angelegt, Saisonwechsel, Stand vor den lebendigen Nestern): würfeln, Beute ab jetzt. */
export async function ensureNestRolls(db: DbOrTx, nowMs: number, rows?: NestRow[]): Promise<number> {
  if (!balance.pirates.living) return 0;
  const missing = rows ? rows.filter((n) => n.roll === null || n.roll === undefined) : await db.select().from(tables.nest).where(isNull(tables.nest.roll));
  for (const n of missing) {
    // Leeres Nest: Wurf der Wiederbesetzung, Beute ab dann.
    const lootAt = n.defeatedAt ? n.defeatedAt.getTime() + nestRespawnHours(balance, n.level) * HOUR_MS : nowMs;
    await db.update(tables.nest).set({ roll: secretRoll(n.level), lootAt: new Date(lootAt) }).where(and(eq(tables.nest.id, n.id), isNull(tables.nest.roll)));
  }
  return missing.length;
}

/** Saisonwechsel: Wurf, Besatzung und Beute zurücksetzen (neuer Wurf beim nächsten ensureNestRolls). */
export async function resetNestLife(tx: Tx, nowMs: number): Promise<void> {
  await tx.update(tables.nest).set({ roll: null, garrison: null, garrisonAt: null, lootAt: null });
  await ensureNestRolls(tx, nowMs);
}

/** Eroberung: Nest leer; der Wurf der Wiederbesetzung steht sofort fest (geheim), Beute wächst ab der Wiederbesetzung. */
export async function nestConquered(tx: Tx, n: NestRow, due: number): Promise<void> {
  const back = due + nestRespawnHours(balance, n.level) * HOUR_MS;
  await tx.update(tables.nest).set({
    defeatedAt: new Date(due), roll: balance.pirates.living ? secretRoll(n.level) : null, garrison: null, garrisonAt: null,
    lootAt: balance.pirates.living ? new Date(back) : null,
  }).where(eq(tables.nest.id, n.id));
}

/** Gewonnene Abwehr: Überlebende (Einheiten und Anlagen nach dem Kampf) mit Zeitpunkt; Wurf und Beute bleiben. */
export async function nestDefended(tx: Tx, n: NestRow, final: Counts, due: number): Promise<void> {
  if (!balance.pirates.living) return;
  const st = afterDefense(n.level, nestState(n), final, due, balance);
  await tx.update(tables.nest).set({ garrison: st.garrison, garrisonAt: new Date(due) }).where(eq(tables.nest.id, n.id));
}

/** Ist das Nest gerade leer? */
export function nestEmpty(n: NestRow, nowMs: number): boolean {
  return n.defeatedAt !== null && !isNestRespawned(n.defeatedAt.getTime(), nowMs, balance, n.level);
}

/**
 * Lagebild eines besetzten Nests (intel_sighting.data.lagebild): Wurf, Überlebende mit Zeitpunkt, Besetzung und Stand.
 * Die Karte rechnet daraus Erholung und Beute hoch (game-core garrisonAt, lootFactorAt). Leer: null (der Wurf der
 * Wiederbesetzung bleibt geheim).
 */
export function nestLagebild(n: NestRow, atMs: number): NestLagebild | null {
  if (!balance.pirates.living || nestEmpty(n, atMs)) return null;
  const st = nestState(n);
  return { atMs, roll: st.roll, garrison: st.garrison, garrisonAtMs: st.garrisonAtMs, lootAtMs: st.lootAtMs };
}

export interface NestLagebild {
  atMs: number;
  roll: NestRoll | null;
  garrison: NestLiveState["garrison"];
  garrisonAtMs: number | null;
  lootAtMs: number | null;
}

/**
 * Ist ein Lagebild noch genau? Jünger als staleHours und seither keine Wiederbesetzung (Besetzung gleich der aktuellen).
 * `lootAtMs` des Nests ist die laufende Besetzung.
 */
export function lagebildExact(lb: NestLagebild | null | undefined, n: NestRow, nowMs: number): boolean {
  if (!lb || !balance.intel) return false;
  if (nowMs - lb.atMs > balance.intel.staleHours * HOUR_MS) return false;
  if (nestEmpty(n, nowMs)) return false;
  return (lb.lootAtMs ?? null) === (n.lootAt ? n.lootAt.getTime() : null);
}

/** Aktuelle Besatzung und Beutefaktor (Kampfbericht der Aufklärung). */
export function nestNow(n: NestRow, nowMs: number) {
  const st = nestState(n);
  return { ...garrisonAt(n.level, st, nowMs, balance), lootFactor: lootFactorAt(st.lootAtMs, nowMs, balance), varies: nestVaries(n.level, balance) };
}

/** Für Tests und den Integrator: Zustand aller Nester als SQL-Ausdruck zählen (nicht im Spielablauf). */
export async function nestsWithoutRoll(db: DbOrTx): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tables.nest).where(isNull(tables.nest.roll));
  return r?.n ?? 0;
}
