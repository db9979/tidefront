// Elektrolyse-Rat (v1.38, Welle 5, Befund M-06): Was brächte die nächste Stufe der Elektrolyse nach der Stromvorhersage?
// Die Elektrolyse nimmt nur Ökostrom, der nach Bedarf und Speicher übrig bleibt – in üblichen Ausbauten fast nichts
// (Amortisation ≈ 680 Tage). Der Rat rechnet aus der Vorhersagekurve (Überschuss je Stunde: schon in der Elektrolyse
// plus verfallender Ökostrom) den zusätzlichen Treibstoff je Tag und die Tage, bis die Baukosten zum Richtpreis
// wieder drin sind. Den Strom fürs Seekabel nimmt er nicht mit (der Spieler hat ihn bewusst vergeben).
import type { Balance, ResourceMap } from "./types.ts";
import { upgradeCost } from "./buildings.ts";

/** Eine Stunde der Vorhersage (Ausschnitt aus der Stromkurve der Hafenansicht). */
export interface AdviceHour {
  atMs: number;
  /** Überschuss je Stunde, der schon in die Elektrolyse geht. */
  surplus: { fuel: number };
  /** Ökostrom ohne Abnehmer je Stunde. */
  greenWasted: number;
}

export interface ElectrolysisAdvice {
  /** Zusätzlicher Treibstoff je Tag mit der nächsten Stufe (nach der Vorhersage). */
  extraFuelPerDay: number;
  /** Baukosten der nächsten Stufe zum Richtpreis. */
  costValue: number;
  /** Tage, bis die Baukosten über den Treibstoff (Richtpreis) zurück sind; null, wenn nichts dazukommt. */
  paybackDays: number | null;
  /** Lohnt die Stufe nach der Vorhersage (Amortisation höchstens `goodDays`)? */
  worth: boolean;
}

/** Amortisation, ab der der Rat zum Bau rät (zwei Wochen: ein Drittel einer Saison). */
export const ELECTROLYSIS_GOOD_DAYS = 14;

/** Rat für die Stufe level + 1 aus der Vorhersagekurve (Stunden gleichmäßig, Länge aus den Zeitpunkten). */
export function electrolysisAdvice(curve: AdviceHour[], level: number, balance: Balance, goodDays = ELECTROLYSIS_GOOD_DAYS): ElectrolysisAdvice | null {
  const id = Object.keys(balance.buildings).find((k) => balance.buildings[k].electrolysisPerLevel);
  if (!id || curve.length === 0) return null;
  const def = balance.buildings[id];
  const ratio = def.electrolysisRatio ?? 10;
  const next = (def.electrolysisPerLevel ?? 0) * (level + 1);
  const stepH = curve.length > 1 ? Math.max(0.25, (curve[1].atMs - curve[0].atMs) / 3_600_000) : 1;
  let extra = 0;
  for (const h of curve) {
    const used = Math.max(0, h.surplus.fuel);
    const avail = used + Math.max(0, h.greenWasted);
    extra += (Math.max(0, Math.min(avail, next) - used) / ratio) * stepH;
  }
  const hours = curve.length * stepH;
  const extraFuelPerDay = (extra / hours) * 24;
  const price = balance.market.refPrice;
  const cost: ResourceMap = upgradeCost(id, level, balance);
  const costValue = Object.entries(cost).reduce((a, [r, n]) => a + n * (price[r] ?? 1), 0);
  const perDay = extraFuelPerDay * (price.treibstoff ?? 1);
  const paybackDays = perDay > 1e-6 ? costValue / perDay : null;
  return { extraFuelPerDay, costValue, paybackDays, worth: paybackDays !== null && paybackDays <= goodDays };
}
