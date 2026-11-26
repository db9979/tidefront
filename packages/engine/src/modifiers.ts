// Modifikatoren eines Spielers: eine Stelle, an der alle Quellen zusammenlaufen (Forschung, Veteranen; später
// Wetter, Admirale, Weltereignisse). Quellen werden multiplikativ kombiniert (combineModifiers im Kern).
// Jede Stelle des Servers, die eine Kernfunktion für einen Spielerstützpunkt aufruft, übergibt das Ergebnis.
// Für Info-Blätter liefert modifierBreakdown die Quellen getrennt (Grundwert · Forschung · Veteranen …).
import { combineModifiers, researchModifiers, sabotageModifiers, veteranModifiers, type BaseState, type Modifiers } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseOfPlayer } from "./store.ts";

/** Weitere Quelle: liefert Modifikatoren eines Spielers zum Zeitpunkt nowMs (z. B. Wetter am Hafen). */
export type ModifierSource = (
  db: DbOrTx,
  playerId: number,
  ctx: { state: BaseState | null; nowMs: number },
) => Promise<Modifiers | null | undefined> | Modifiers | null | undefined;

/** Eine Quelle mit Namen, wie sie das Info-Blatt aufschlüsselt. */
export interface NamedModifiers {
  id: string;
  label: string;
  mods: Modifiers;
}

const SOURCES: { id: string; label: string; source: ModifierSource }[] = [];

/**
 * Meldet eine weitere Quelle an (Wetter, Admirale, Ereignisse). Reihenfolge ist egal (Produkt).
 * `id`/`label` erscheinen in der Aufschlüsselung der Info-Blätter (Vorgabe „Weitere“).
 */
export function registerModifierSource(source: ModifierSource, id = "weitere", label = "Weitere"): () => void {
  const entry = { id, label, source };
  SOURCES.push(entry);
  return () => {
    const i = SOURCES.indexOf(entry);
    if (i >= 0) SOURCES.splice(i, 1);
  };
}

/**
 * Eingebaute Quellen aus dem Stützpunktzustand allein:
 * - Forschung dieser Saison (research.levels),
 * - Veteranen (veterancy): attackUnit[Typ] = 1 + Rangbonus, wirkt im Kampf nur auf diesen Typ
 *   (Angreifer und Verteidiger; Kartell und Nester haben keine).
 */
export function baseModifierSources(state: BaseState | null | undefined): NamedModifiers[] {
  return [
    { id: "forschung", label: "Forschung", mods: state?.research ? researchModifiers(state.research.levels, balance) : {} },
    { id: "veteranen", label: "Veteranen", mods: veteranModifiers(state?.veterancy, balance) },
  ];
}

/** Modifikatoren aus dem Stützpunktzustand allein (Forschung, Veteranen). */
export function baseModifiers(state: BaseState | null | undefined): Modifiers {
  return combineModifiers(...baseModifierSources(state).map((s) => s.mods));
}

/** Alle Quellen eines Spielers getrennt (leere Quellen eingeschlossen). */
export async function modifierSourcesFor(
  db: DbOrTx,
  playerId: number | null,
  opts: { state?: BaseState | null; nowMs?: number } = {},
): Promise<NamedModifiers[]> {
  if (playerId === null) return [];
  const state = opts.state !== undefined ? opts.state : ((await baseOfPlayer(db, playerId))?.state ?? null);
  const nowMs = opts.nowMs ?? Date.now();
  const extra = await Promise.all(
    SOURCES.map(async (s) => ({ id: s.id, label: s.label, mods: (await s.source(db, playerId, { state, nowMs })) ?? {} })),
  );
  // Sabotage (Nachrichtendienst): laufende Sabotage im eigenen Hafen, zeitabhängig.
  const sabotage = { id: "sabotage", label: "Sabotage", mods: sabotageModifiers(state, nowMs, balance) };
  return [...baseModifierSources(state), sabotage, ...extra];
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
  return combineModifiers(...(await modifierSourcesFor(db, playerId, opts)).map((s) => s.mods));
}

/** Kurzform für eine geladene Stützpunktzeile. */
export function modsOf(db: DbOrTx, row: { playerId: number; state: BaseState }, nowMs?: number): Promise<Modifiers> {
  return modifiersFor(db, row.playerId, { state: row.state, nowMs });
}

/** Gesamt und Quellen getrennt für eine Stützpunktzeile (Info-Blätter). */
export async function modifierBreakdown(
  db: DbOrTx,
  row: { playerId: number; state: BaseState },
  nowMs?: number,
): Promise<{ total: Modifiers; sources: NamedModifiers[] }> {
  const sources = await modifierSourcesFor(db, row.playerId, { state: row.state, nowMs });
  return { total: combineModifiers(...sources.map((s) => s.mods)), sources };
}
