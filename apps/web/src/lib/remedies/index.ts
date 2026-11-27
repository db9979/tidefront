// „Was hilft?“: zu einem Ablehnungscode der passende Abhilfe-Hinweis mit Sprungzielen.
// Codes ohne Eintrag (Tippfehler, Server, „gibt es nicht mehr“) bekommen bewusst keinen Hinweis.
import { ECONOMY } from "./economy.ts";
import { MISSIONS } from "./missions.ts";
import { TRADE } from "./trade.ts";
import { WORLD } from "./world.ts";
import type { Remedy, RemedyCtx, RemedyTable } from "./types.ts";

export type { NavTarget, Remedy, RemedyAction, RemedyDetail, RemedyCtx } from "./types.ts";

export const REMEDIES: RemedyTable = { ...ECONOMY, ...MISSIONS, ...TRADE, ...WORLD };

/** Abhilfe zu einem Code; null, wenn der Spieler nichts tun kann (oder der Code unbekannt ist). */
export function remedy(code: string | null | undefined, ctx: RemedyCtx): Remedy | null {
  if (!code || !Object.hasOwn(REMEDIES, code)) return null;
  try {
    return REMEDIES[code](ctx);
  } catch {
    return null; // Ein Hinweis darf nie die Anzeige der Meldung verhindern.
  }
}
