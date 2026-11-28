// Missionsplanung vom Ziel her (UX-0.43 U-2): „Planen“ auf einem Ziel-Blatt (Nest, Feld, Weltereignis, Hafen) schlägt
// den kleinsten siegreichen Verband aus dem Bestand vor (Probekampf ≥ 90 % gegen frische Würfe), sonst, was fehlt.
// Grundlage ist die Suche „Was fehlt zum Sieg?“ (win-search.ts): Sie startet beim ganzen Bestand, verkleinert erst
// neue, dann eigene Einheiten und prüft gegen 300 weitere Würfe. Hier nur die Einordnung für die Planung. Rein.
import { searchWinningForce, type WinSearchInput, type WinSearchResult } from "./win-search.ts";
import type { Balance, Counts, ResourceMap } from "./types.ts";

/** Zielsicherheit des Vorschlags in der Planung. */
export const PLAN_SUGGEST_TARGET = 0.9;

export interface PlanSuggestion {
  /** bestand: der Bestand reicht (units ⊆ Bestand); fehlt: extra ausbilden; unerreichbar: auch das reicht nicht. */
  status: "bestand" | "fehlt" | "unerreichbar";
  /** Vorgeschlagener Verband (bei „fehlt“ samt extra; die Planung kürzt auf das, was daheim ist). */
  units: Counts;
  extra: Counts;
  extraCost: ResourceMap;
  trainSeconds: number;
  /** Siegchance gegen die Prüf-Seeds. */
  winRate: number;
  reason: WinSearchResult["reason"];
}

/** Ergebnis der Suche für die Planung einordnen (rein). */
export function classifySuggestion(r: WinSearchResult): PlanSuggestion {
  const status = !r.reachable ? "unerreichbar" : Object.keys(r.extra).length === 0 ? "bestand" : "fehlt";
  return { status, units: r.units, extra: r.extra, extraCost: r.extraCost, trainSeconds: r.trainSeconds, winRate: r.winRate, reason: r.reason };
}

/** Vorschlag rechnen (Zielsicherheit 90 %, falls nicht anders angegeben). */
export function suggestPlan(input: Omit<WinSearchInput, "target"> & { target?: number }, balance: Balance, onProgress?: (share: number) => void): PlanSuggestion {
  return classifySuggestion(searchWinningForce({ ...input, target: input.target ?? PLAN_SUGGEST_TARGET }, balance, onProgress));
}
