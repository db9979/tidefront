// Zugriff auf Zeilen mit Sperren. Reihenfolge der Sperren überall: Ereignis, Stützpunkte (aufsteigende ID),
// Spieler, Marktzeile.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BaseState } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { GameError } from "./context.ts";

export interface BaseRow {
  id: number;
  playerId: number;
  name: string;
  col: number;
  row: number;
  state: BaseState;
  /** Heimathafen (genau einer je Spieler); weitere Häfen sind Kolonien. */
  isHome: boolean;
}

/** Zustand mit Lage des Hafens für das Wetter (v1.6; ältere Stände erhalten sie beim Lesen aus col/row). */
export function withSite(state: BaseState, col: number, row: number): BaseState {
  return state.site ? state : { ...state, site: hexCenter(col, row) };
}

function toRow(r: { id: number; playerId: number; name: string; col: number; row: number; state: unknown; isHome: boolean }): BaseRow {
  return { id: r.id, playerId: r.playerId, name: r.name, col: r.col, row: r.row, isHome: r.isHome, state: withSite(r.state as BaseState, r.col, r.row) };
}

/** Sperrt Stützpunkte in aufsteigender ID und liefert sie als Map. */
export async function lockBases(tx: DbOrTx, ids: number[]): Promise<Map<number, BaseRow>> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  const out = new Map<number, BaseRow>();
  if (unique.length === 0) return out;
  const rows = await tx
    .select()
    .from(tables.base)
    .where(inArray(tables.base.id, unique))
    .orderBy(asc(tables.base.id))
    .for("update");
  for (const r of rows) out.set(r.id, toRow(r));
  return out;
}

export async function lockBase(tx: DbOrTx, id: number): Promise<BaseRow | null> {
  return (await lockBases(tx, [id])).get(id) ?? null;
}

export async function readBase(tx: DbOrTx, id: number): Promise<BaseRow | null> {
  const [r] = await tx.select().from(tables.base).where(eq(tables.base.id, id));
  return r ? toRow(r) : null;
}

/** Heimathafen des Spielers (is_home; höchstens einer, Teil-Unique-Index base_home). */
export async function homeBaseOf(tx: DbOrTx, playerId: number): Promise<BaseRow | null> {
  const [r] = await tx
    .select()
    .from(tables.base)
    .where(and(eq(tables.base.playerId, playerId), eq(tables.base.isHome, true)));
  return r ? toRow(r) : null;
}

/** Alias auf homeBaseOf (mehrere Häfen: deterministisch der Heimathafen). */
export const baseOfPlayer = homeBaseOf;

/** Alle Häfen des Spielers, aufsteigend nach ID (der Heimathafen ist in der Regel der erste). */
export async function basesOfPlayer(tx: DbOrTx, playerId: number): Promise<BaseRow[]> {
  const rows = await tx.select().from(tables.base).where(eq(tables.base.playerId, playerId)).orderBy(asc(tables.base.id));
  return rows.map(toRow);
}

/**
 * Eigener Hafen ohne Sperre: mit baseId nur, wenn er dem Spieler gehört (sonst GameError "no_base"),
 * ohne baseId der Heimathafen. Für Ansichten und Vorschauen.
 */
export async function ownBase(tx: DbOrTx, playerId: number, baseId?: number): Promise<BaseRow> {
  const row = baseId === undefined ? await homeBaseOf(tx, playerId) : await readBase(tx, baseId);
  if (!row || row.playerId !== playerId) throw new GameError("no_base");
  return row;
}

/** Wie ownBase, aber gesperrt (FOR UPDATE); Besitz wird nach dem Sperren geprüft. */
export async function lockOwnBase(tx: DbOrTx, playerId: number, baseId?: number): Promise<BaseRow> {
  const id = baseId ?? (await homeBaseOf(tx, playerId))?.id;
  if (id === undefined) throw new GameError("no_base");
  const row = await lockBase(tx, id);
  if (!row || row.playerId !== playerId) throw new GameError("no_base");
  return row;
}

export async function saveBase(tx: DbOrTx, id: number, state: BaseState): Promise<void> {
  await tx.update(tables.base).set({ state }).where(eq(tables.base.id, id));
}

/** Plant ein Ereignis; läuft in der Transaktion der auslösenden Aktion. */
export async function scheduleEvent(
  tx: DbOrTx,
  type: string,
  dueAtMs: number,
  payload: Record<string, unknown>,
  baseId: number | null,
): Promise<void> {
  await tx.insert(tables.gameEvent).values({ type, dueAt: new Date(dueAtMs), payload, baseId });
}

export async function activeMissionCount(tx: DbOrTx, baseId: number): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tables.mission)
    // Allianz-Ops: gebundene (staged) und stationierte Verbände belegen ihren Missionsplatz.
    .where(and(eq(tables.mission.baseId, baseId), inArray(tables.mission.status, ["outbound", "returning", "staged", "stationed", "holding"]))); // See: holding = Blockade
  return r?.n ?? 0;
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
