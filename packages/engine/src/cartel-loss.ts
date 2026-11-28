// Kartell-Überfall (v1.35, Nutzerentscheid 2): bleibender Verlust eines Überfalls (Plünderung + endgültig verlorene
// Einheiten und Anlagen, zum Richtpreis) in Stunden Produktion des Hafens. Steht im Bericht (report.lossHours) und in
// der Berichtsansicht/E-Mail, damit die Kosten der Flotte daheim sichtbar sind.
import { productionRates, type BaseState, type BattleReport, type Modifiers } from "@tidefront/game-core";
import { balance } from "./context.ts";
import { resValue, unitValue } from "./scoring.ts";

/** Bleibender Verlust (Richtwert): Plünderung plus Verluste des Verteidigers abzüglich Rückkehrer aus Lazarett/Reparatur. */
export function cartelLossValue(report: BattleReport): number {
  let loss = resValue(report.loot);
  for (const [id, n] of Object.entries(report.defender.losses ?? {})) loss += Math.max(0, n - (report.defender.returned?.[id] ?? 0)) * unitValue(id);
  return loss;
}

/** Verlust in Stunden Produktion (eine Nachkommastelle); ohne Produktion null. */
export function cartelLossHours(state: BaseState, report: BattleReport, mods: Modifiers | undefined, atMs: number): number | null {
  const perHour = resValue(productionRates(state, balance, mods, atMs).perHour);
  if (!(perHour > 0)) return null;
  return Math.round((cartelLossValue(report) / perHour) * 10) / 10;
}
