// Zugriff auf Zeilen mit Sperren. Reihenfolge der Sperren überall: Ereignis, Stützpunkte (aufsteigende ID),
// Spieler, Marktzeile.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BaseState } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";

export interface BaseRow {
  id: number;
  playerId: number;
  name: string;
  col: number;
  row: number;
  state: BaseState;
}

/** Zustand mit Lage des Hafens für das Wetter (v1.6; ältere Stände erhalten sie beim Lesen aus col/row). */
export function withSite(state: BaseState, col: number, row: number): BaseState {
  return state.site ? state : { ...state, site: hexCenter(col, row) };
}

function toRow(r: { id: number; playerId: number; name: string; col: number; row: number; state: unknown }): BaseRow {
  return { ...r, state: withSite(r.state as BaseState, r.col, r.row) };
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

export async function baseOfPlayer(tx: DbOrTx, playerId: number): Promise<BaseRow | null> {
  const [r] = await tx.select().from(tables.base).where(eq(tables.base.playerId, playerId));
  return r ? toRow(r) : null;
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
    .where(and(eq(tables.mission.baseId, baseId), inArray(tables.mission.status, ["outbound", "returning"])));
  return r?.n ?? 0;
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
