// Lagebild: kleine Abfragen für Befehle, Vorschauen, Felder und KI-Spieler (dieselbe Sicht wie die Karte).
import { eq } from "drizzle-orm";
import { hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { intelFogOn, intelRules, liveAt, sightOf, sourceAt, type Sight } from "./intel-sight.ts";
import { knownFor, knownGet, persistLive, type IntelTag, type Known, type SightingInput } from "./intel-store.ts";

/**
 * Weiß der Spieler, dass ein Nest gerade verlassen ist? Ohne Kartennebel immer; sonst bei Sicht auf das Nest oder
 * gespeichertem Wissen „verlassen“. Sonst darf er es angreifen (Risiko), die Planung verrät den Zustand nicht.
 */
export async function nestKnown(db: DbOrTx, playerId: number, nestId: number, nowMs: number): Promise<boolean> {
  if (!(await intelFogOn(db, nowMs))) return true;
  const [n] = await db.select().from(tables.nest).where(eq(tables.nest.id, nestId));
  if (!n) return true;
  const sight = await sightOf(db, playerId, nowMs);
  if (liveAt(sight, n.col, n.row)) return true;
  const k = knownGet(await knownFor(db, sight, nowMs, ["nest"]), "nest", nestId);
  return !!k && (k.data as { empty?: boolean }).empty === true;
}

/** Feld-Sicht für fieldsView: je fremdem Feld live (mit Quelle), gespeichertes Wissen oder nichts. */
export interface FieldSight {
  fog: boolean;
  sight: Sight | null;
  live: (col: number, row: number) => IntelTag | null;
  known: (fieldId: number) => Known | undefined;
  persist: (rows: SightingInput[]) => Promise<void>;
}

export async function fieldSight(db: DbOrTx, playerId: number, nowMs: number): Promise<FieldSight> {
  const fog = await intelFogOn(db, nowMs);
  const sight = fog && intelRules() ? await sightOf(db, playerId, nowMs) : null;
  const known = sight ? await knownFor(db, sight, nowMs, ["field"]) : new Map<string, Known>();
  return {
    fog: !!sight,
    sight,
    live: (col, row) => {
      if (!sight) return null;
      const lvl = liveAt(sight, col, row);
      if (!lvl) return null;
      const p = hexCenterXY(col, row);
      return { age: "live", atMs: nowMs, source: sourceAt(sight, p.x, p.y), level: lvl };
    },
    known: (id) => knownGet(known, "field", id),
    persist: async (rows) => { if (sight) await persistLive(db, sight, "fields", nowMs, () => rows); },
  };
}
