// Modifikatoren eines Spielers: eine Stelle, an der alle Quellen zusammenlaufen (heute Forschung; später
// Wetter, Admirale, Weltereignisse). Quellen werden multiplikativ kombiniert (combineModifiers im Kern).
// Jede Stelle des Servers, die eine Kernfunktion für einen Spielerstützpunkt aufruft, übergibt das Ergebnis.
import { combineModifiers, researchModifiers, type BaseState, type Modifiers } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseOfPlayer } from "./store.ts";

/** Weitere Quelle: liefert Modifikatoren eines Spielers zum Zeitpunkt nowMs (z. B. Wetter am Hafen). */
export type ModifierSource = (
  db: DbOrTx,
  playerId: number,
  ctx: { state: BaseState | null; nowMs: number },
) => Promise<Modifiers | null | undefined> | Modifiers | null | undefined;

const SOURCES: ModifierSource[] = [];

/** Meldet eine weitere Quelle an (Wetter, Admirale, Ereignisse). Reihenfolge ist egal (Produkt). */
export function registerModifierSource(source: ModifierSource): () => void {
  SOURCES.push(source);
  return () => {
    const i = SOURCES.indexOf(source);
    if (i >= 0) SOURCES.splice(i, 1);
  };
}

/** Modifikatoren aus dem Stützpunktzustand allein (Forschung dieser Saison). */
export function baseModifiers(state: BaseState | null | undefined): Modifiers {
  return state?.research ? researchModifiers(state.research.levels, balance) : {};
}

/**
 * Alle Modifikatoren eines Spielers. `state`: bereits geladener (ggf. gesperrter) Stützpunktzustand, sonst
 * wird er gelesen. Spieler ohne Stützpunkt oder null (Kartell, Nester): neutral.
 */
export async function modifiersFor(
  db: DbOrTx,
  playerId: number | null,
  opts: { state?: BaseState | null; nowMs?: number } = {},
): Promise<Modifiers> {
  if (playerId === null) return {};
  const state = opts.state !== undefined ? opts.state : ((await baseOfPlayer(db, playerId))?.state ?? null);
  const nowMs = opts.nowMs ?? Date.now();
  const extra = await Promise.all(SOURCES.map((s) => s(db, playerId, { state, nowMs })));
  return combineModifiers(baseModifiers(state), ...extra);
}

/** Kurzform für eine geladene Stützpunktzeile. */
export function modsOf(db: DbOrTx, row: { playerId: number; state: BaseState }, nowMs?: number): Promise<Modifiers> {
  return modifiersFor(db, row.playerId, { state: row.state, nowMs });
}
