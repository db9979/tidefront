// Wenn Taler fehlen: Rohstoff mit dem größten Überschuss zum Verkaufen vorschlagen (Order-Hinweis und „Was hilft?“).
import type { BaseData } from "../trpc.ts";
import { fmtNum, label } from "../names.ts";

/** An der Börse handelbare Rohstoffe. */
export const TRADE_GOODS = ["stahl", "treibstoff", "elektronik", "proviant"] as const;

export interface Surplus {
  resource: string;
  /** Bestand im aktiven Hafen. */
  have: number;
  /** Vorgeschlagene Verkaufsmenge. */
  qty: number;
}

/**
 * Rohstoff mit dem größten Überschuss: höchste Lagerfüllung (alle Rohstoffe teilen dieselbe Lagergröße, also der
 * größte Bestand). `avoid` (die Ware, die man gerade kaufen will) nur, wenn sonst nichts im Lager ist.
 * Menge: was über einem halb vollen Lager liegt, sonst ein Viertel des Bestands; ab 100 auf Zehner abgerundet.
 */
export function surplus(base: BaseData | null, avoid?: string): Surplus | null {
  if (!base) return null;
  const all = TRADE_GOODS.map((r) => ({ r, have: Math.floor(base.resources[r] ?? 0) }))
    .filter((x) => x.have >= 1)
    .sort((a, b) => b.have - a.have);
  const pick = all.find((x) => x.r !== avoid) ?? all[0];
  if (!pick) return null;
  const over = pick.have - Math.floor(base.capacity / 2);
  let qty = over >= 1 ? over : Math.floor(pick.have / 4);
  if (qty >= 100) qty = Math.floor(qty / 10) * 10;
  return { resource: pick.r, have: pick.have, qty: Math.max(1, Math.min(qty, pick.have)) };
}

/** Sperrgrund der Order bei zu wenig Talern: Kontostand und was sich verkaufen lässt. */
export function noFundsText(credits: number, base: BaseData | null | undefined, buying?: string): string {
  const have = Math.max(0, Math.floor(credits));
  const head = have < 1 ? "Du hast 0 Taler." : `Du hast ${fmtNum(have)} Taler – zu wenig${buying ? ` für 1 ${label(buying)}` : ""}.`;
  const s = surplus(base ?? null, buying);
  return s ? `${head} Verkaufe zuerst Rohstoffe – z. B. ${label(s.resource)} (Überschuss).` : `${head} Verkaufe zuerst Rohstoffe oder handle mit Spielern.`;
}
