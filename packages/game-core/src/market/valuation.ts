// Börsenwert als Orientierung für den Spielerhandel (reine Anzeige; Spielerhandel verändert die Kurse nicht).
// Ressourcen × aktueller Börsenkurs, Kredite 1:1, ohne Gebühren.

/** Ab dieser Abweichung (Prozent) gilt ein Tausch als deutlich unter/über Börsenwert. */
export const STRONG_DEVIATION_PCT = 20;

/** Gegenwert in Krediten; null, wenn für die Ressource kein Kurs vorliegt. */
export function assetValue(asset: string, qty: number, prices: Record<string, number>): number | null {
  if (asset === "credits") return qty;
  const p = prices[asset];
  return p !== undefined && Number.isFinite(p) ? qty * p : null;
}

export interface TradeValue {
  /** Was der Leser gibt, in Krediten. */
  give: number;
  /** Was der Leser bekommt, in Krediten. */
  get: number;
  /** get − give. */
  diff: number;
  /** Abweichung in Prozent bezogen auf das Gegebene (negativ: der Leser bekommt weniger, als er gibt). */
  pct: number;
  /** |pct| über STRONG_DEVIATION_PCT. */
  strong: boolean;
}

/** Tausch aus Sicht des Lesers: er gibt giveQty giveAsset und bekommt getQty getAsset. */
export function tradeValue(
  giveAsset: string, giveQty: number, getAsset: string, getQty: number, prices: Record<string, number>,
): TradeValue | null {
  const give = assetValue(giveAsset, giveQty, prices);
  const get = assetValue(getAsset, getQty, prices);
  if (give === null || get === null || give <= 0) return null;
  const pct = (get / give - 1) * 100;
  return { give, get, diff: get - give, pct, strong: Math.abs(pct) > STRONG_DEVIATION_PCT };
}

/** Kredite je Einheit von a aus einem Tauschverhältnis qtyA gegen qtyB (b zum Börsenkurs, Kredite 1:1). */
export function creditsPerUnit(qtyA: number, b: string, qtyB: number, prices: Record<string, number>): number | null {
  const vb = assetValue(b, qtyB, prices);
  return vb === null || qtyA <= 0 ? null : vb / qtyA;
}
