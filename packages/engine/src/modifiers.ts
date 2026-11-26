// Modifikatoren eines Spielers: eine Stelle, an der alle Quellen zusammenlaufen (Forschung, Veteranen; später
// Wetter, Admirale, Weltereignisse). Quellen werden multiplikativ kombiniert (combineModifiers im Kern).
// Jede Stelle des Servers, die eine Kernfunktion für einen Spielerstützpunkt aufruft, übergibt das Ergebnis.
// Für Info-Blätter liefert modifierBreakdown die Quellen getrennt (Grundwert · Forschung · Veteranen …).
import { combineModifiers, researchModifiers, sabotageModifiers, veteranModifiers, type BaseState, type Modifiers } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { homeBaseOf } from "./store.ts";

/**
 * Kontext einer Quelle. Mehrere Häfen: baseId/isHome benennen den Hafen, für den gerechnet wird
 * (fehlen sie, ist es der Heimathafen bzw. unbekannt – Quellen fallen dann auf den Heimathafen zurück).
 */
export interface ModifierContext {
  state: BaseState | null;
  nowMs: number;
  baseId?: number;
  isHome?: boolean;
}

/** Weitere Quelle: liefert Modifikatoren eines Spielers zum Zeitpunkt nowMs (z. B. Wetter am Hafen). */
export type ModifierSource = (
  db: DbOrTx,
  playerId: number,
  ctx: ModifierContext,
) => Promise<Modifiers | null | undefined> | Modifiers | null | undefined;

/** Optionen für modifiersFor/modifierSourcesFor (state: geladener Hafenzustand; baseId/isHome: welcher Hafen). */
export interface ModifierOpts {
  state?: BaseState | null;
  nowMs?: number;
  baseId?: number;
  isHome?: boolean;
}

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
export function baseModifierSources(state: BaseState | null | undefined, researchFrom: BaseState | null | undefined = state): NamedModifiers[] {
  return [
    // Mehrere Häfen: Forschung ist spielerweit und liegt im Heimathafen (researchFrom).
    { id: "forschung", label: "Forschung", mods: researchFrom?.research ? researchModifiers(researchFrom.research.levels, balance) : {} },
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
  opts: ModifierOpts = {},
): Promise<NamedModifiers[]> {
  if (playerId === null) return [];
  let { baseId, isHome } = opts;
  let state: BaseState | null;
  if (opts.state !== undefined) state = opts.state;
  else {
    const home = await homeBaseOf(db, playerId);
    state = home?.state ?? null;
    baseId = home?.id;
    isHome = true;
  }
  const nowMs = opts.nowMs ?? Date.now();
  // Kolonie: Forschungsstufen aus dem Heimathafen (eine zusätzliche Abfrage nur für Nicht-Heimathäfen).
  const researchFrom = isHome === false ? ((await homeBaseOf(db, playerId))?.state ?? null) : state;
  const ctx: ModifierContext = { state, nowMs, baseId, isHome };
  const extra = await Promise.all(
    SOURCES.map(async (s) => ({ id: s.id, label: s.label, mods: (await s.source(db, playerId, ctx)) ?? {} })),
  );
  // Sabotage (Nachrichtendienst): laufende Sabotage im eigenen Hafen, zeitabhängig.
  const sabotage = { id: "sabotage", label: "Sabotage", mods: sabotageModifiers(state, nowMs, balance) };
  return [...baseModifierSources(state, researchFrom), sabotage, ...extra];
}

/**
 * Alle Modifikatoren eines Spielers. `state`: bereits geladener (ggf. gesperrter) Stützpunktzustand, sonst
 * wird er gelesen. Spieler ohne Stützpunkt oder null (Kartell, Nester): neutral.
 */
export async function modifiersFor(
  db: DbOrTx,
  playerId: number | null,
  opts: ModifierOpts = {},
): Promise<Modifiers> {
  if (playerId === null) return {};
  return combineModifiers(...(await modifierSourcesFor(db, playerId, opts)).map((s) => s.mods));
}

/** Stützpunktzeile, wie modsOf/modifierBreakdown sie brauchen (id/isHome: Hafen, s. ModifierContext). */
export interface ModifierRow {
  playerId: number;
  state: BaseState;
  id?: number;
  isHome?: boolean;
}

/** Kurzform für eine geladene Stützpunktzeile. */
export function modsOf(db: DbOrTx, row: ModifierRow, nowMs?: number): Promise<Modifiers> {
  return modifiersFor(db, row.playerId, { state: row.state, nowMs, baseId: row.id, isHome: row.isHome });
}

/** Gesamt und Quellen getrennt für eine Stützpunktzeile (Info-Blätter). */
export async function modifierBreakdown(
  db: DbOrTx,
  row: ModifierRow,
  nowMs?: number,
): Promise<{ total: Modifiers; sources: NamedModifiers[] }> {
  const sources = await modifierSourcesFor(db, row.playerId, { state: row.state, nowMs, baseId: row.id, isHome: row.isHome });
  return { total: combineModifiers(...sources.map((s) => s.mods)), sources };
}
