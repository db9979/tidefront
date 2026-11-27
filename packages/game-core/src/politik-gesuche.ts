// Weltpolitik: Gesuche der KI-Spieler (docs/REGELN-WELTPOLITIK.md, Abschnitt 4). Ein Gesuch ist ein normaler
// Liefervertrag an den KI-Spieler (Frist 24 h) mit Lohn: 3 h Produktion des Spielers als Waren aus dem Lager des
// KI-Spielers. Je KI-Spieler höchstens 6 h seiner eigenen Produktion Lohn je Tag. Rein: Menge, Lohn, Budget.
import type { ResourceMap } from "./types.ts";

export interface GesucheBalance {
  /** Arten: liefern ist an; geleit und feld sind vorbereitet (erst nach der U-Boot-Korrektur). */
  kinds: Record<"liefern" | "geleit" | "feld", boolean>;
  /** Spielweisen, die Gesuche geben (Händler, Festung). */
  profiles: string[];
  rewardHours: number;
  /** Deckel: Lohn höchstens so viele Stunden Produktion. */
  maxRewardHours: number;
  /** Tagesbudget je KI-Spieler in Stunden seiner eigenen Produktion. */
  budgetHours: number;
  deadlineHours: number;
  /** Liefermenge: so viele Stunden Produktion des Spielers in diesem Gut. */
  qtyHours: number;
  /** Neulinge (Auftragsbuch offen): höchstens dieser Anteil des Tageslimits. */
  newbieLimitShare: number;
  /** Der KI-Spieler gibt keinen Lohn aus dem Lager unter diesem Anteil der Lagergröße. */
  reserveShare: number;
  /** Erreicht der Lohn aus dem Lager nicht diesen Anteil des Solls, gibt es kein Angebot („Lager leer“). */
  minRewardShare: number;
  /** Ab diesem Saisontag (auf 42 Tage bezogen) keine neuen Gesuche. */
  lastDay: number;
  /** Bevorzugter Tagesbefehl-Platz (Stufe), den ein angenommenes Gesuch belegt. */
  slot: number;
}

export function valueOf(m: ResourceMap, refPrice: Record<string, number>): number {
  let v = 0;
  for (const [r, q] of Object.entries(m)) v += Math.max(0, q) * (refPrice[r] ?? 0);
  return v;
}

/**
 * Lohn aus dem Lager der KI: je Gut rewardHours × Produktion des Spielers, höchstens der Bestand über der Reserve,
 * insgesamt höchstens maxRewardHours Produktion (Wert). null, wenn weniger als minRewardShare des Solls zusammenkommt.
 */
export function gesuchReward(
  humanPerHour: ResourceMap, kiStock: ResourceMap, kiCapacity: number, refPrice: Record<string, number>, cfg: GesucheBalance,
): { reward: ResourceMap; value: number; wanted: number } | null {
  const want: ResourceMap = {};
  for (const [r, q] of Object.entries(humanPerHour)) if (q > 0) want[r] = q * Math.min(cfg.rewardHours, cfg.maxRewardHours);
  const wanted = valueOf(want, refPrice);
  if (!(wanted > 0)) return null;
  const reward: ResourceMap = {};
  for (const [r, q] of Object.entries(want)) {
    const free = Math.floor((kiStock[r] ?? 0) - cfg.reserveShare * kiCapacity);
    const take = Math.max(0, Math.min(Math.floor(q), free));
    if (take > 0) reward[r] = take;
  }
  const value = valueOf(reward, refPrice);
  if (value < cfg.minRewardShare * wanted) return null;
  return { reward, value: Math.round(value), wanted: Math.round(wanted) };
}

/** Liefermenge: qtyHours Produktion in diesem Gut, auf Schritte gerundet, mindestens minQty, höchstens maxQty. */
export function gesuchQty(perHour: number, cfg: GesucheBalance, minQty: number, step: number, maxQty: number): number | null {
  const s = Math.max(1, step);
  const raw = Math.floor((Math.max(0, perHour) * cfg.qtyHours) / s) * s;
  const qty = Math.min(Math.max(raw, minQty), Math.floor(maxQty / s) * s);
  return qty >= minQty ? qty : null;
}

/** Tagesbudget eines KI-Spielers (Wert) und was davon noch frei ist. */
export function gesuchBudget(kiPerHour: ResourceMap, usedValue: number, refPrice: Record<string, number>, cfg: GesucheBalance): { budget: number; left: number } {
  const budget = valueOf(kiPerHour, refPrice) * cfg.budgetHours;
  return { budget: Math.round(budget), left: Math.max(0, Math.round(budget - usedValue)) };
}
