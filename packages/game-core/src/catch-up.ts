// Aufholhilfe (Balance-Block catchUp, docs/REGELN.md „Aufholhilfe“): Häfen, deren Ausbau (v1.35: + Militär) weit unter dem Median liegt,
// bekommen eine Baugutschrift. Sie bezahlt nur Gebäudestufen, liegt in einem eigenen Konto des Hafens (BaseState.catchUp),
// zählt nicht zum Lager und ist weder plünderbar noch handelbar oder transportierbar. Reine Funktionen; den stündlichen
// Lauf (Median, Rückstand, Zufluss) und das Startpaket macht der Server (engine/catch-up.ts).
import type { Balance, BaseState, ResourceMap } from "./types.ts";

export interface CatchUpBalance {
  /** Bonus beginnt unter diesem Verhältnis Ausbaupunkte / Median (0,70). */
  from: number;
  /** Voller Bonus ab diesem Verhältnis und darunter (0,30). */
  full: number;
  /** Deckel des Bonus als Anteil der Gebäudeproduktion (0,5 = +50 %). */
  cap: number;
  /** Hysterese: nach dem Wegfall (Verhältnis ≥ from) erst wieder unter diesem Verhältnis (0,60). */
  resumeBelow: number;
  /** Zum Median zählen nur Spieler, deren erster Hafen mindestens so viele Tage alt ist (3). */
  minBaseAgeDays: number;
  /** Höchstbestand der Gutschrift in Stunden Zufluss (24); darüber ruht der Zufluss. */
  storeHours: number;
  /** Ab diesem Saisontag (0 = erster Tag) kein Zufluss mehr (40). */
  stopDay: number;
  /** Startpaket: wer seinen ersten Hafen ab diesem Saisontag gründet (8) … */
  latePackFromDay: number;
  /** … bekommt diesen Anteil des Median-Ausbauwerts als Baugutschrift (0,15). */
  latePackShare: number;
  /** Abstand der Läufe im Worker in Minuten (60); so lange gilt auch der zwischengespeicherte Median. */
  refreshMinutes: number;
  /** Höchstens so viele Stunden Zufluss je Lauf (2), falls der Worker eine Weile stand. */
  maxCatchUpHours: number;
  /**
   * v1.35 (M-10): Rückstand nach Ausbau + Militär (Einheiten und Anlagen, auch unterwegs) statt nur Ausbau; fehlt/false:
   * nur Ausbau.
   */
  includeMilitary?: boolean;
  /**
   * v1.35 (AN-10): Mindestzufluss für Rückkehrer – solange die Hilfe läuft, je Stunde mindestens dieser Anteil der
   * Median-Gebäudeproduktion (Richtwert/h), unabhängig von der eigenen Produktion. Fehlt: 0.
   */
  minFlowShare?: number;
}

/** Konto der Aufholhilfe im Hafenzustand. Beträge zum Börsen-Richtwert (market.refPrice, Stahl = 1). */
export interface CatchUpState {
  /** Bestand der Baugutschrift. */
  credit: number;
  /** Aktueller Bonus (Anteil der Gebäudeproduktion, 0 bis cap). */
  bonus: number;
  /** Zuletzt gemessenes Verhältnis eigene Ausbaupunkte / Median (null: noch kein Median). */
  ratio: number | null;
  /** Hysterese: Hilfe läuft (erst unter resumeBelow wieder an, endet ab from). */
  active: boolean;
  /** Zeitpunkt des letzten Zuflusses (Worker). */
  lastAtMs: number;
  /** Summe aller Zuflüsse aus dem Bonus in dieser Saison. */
  earned: number;
  /** Startpaket für Spät-Einsteiger (Betrag), falls erhalten. */
  pack?: number;
}

export function catchUpOf(balance: Balance): CatchUpBalance | null {
  return balance.catchUp ?? null;
}

/** Wert einer Ressourcenmenge zum Börsen-Richtwert (Stahl = 1). */
export function refValue(m: ResourceMap, balance: Balance): number {
  const price = balance.market.refPrice as Record<string, number>;
  let s = 0;
  for (const [r, v] of Object.entries(m)) s += (v || 0) * (price[r] ?? 1);
  return s;
}

/** Bonus nach Rückstand: cap × clamp((from − r) / (from − full); 0; 1). */
export function catchUpCurve(ratio: number, cu: CatchUpBalance): number {
  const t = (cu.from - ratio) / Math.max(1e-9, cu.from - cu.full);
  return cu.cap * Math.max(0, Math.min(1, t));
}

/**
 * Bonus mit Hysterese: läuft die Hilfe, endet sie erst bei r ≥ from; ruht sie, beginnt sie erst unter resumeBelow.
 * Erster Lauf (keine Vorgeschichte oder noch keine Messung) wie „ruht nicht“: unter from beginnt sie sofort.
 */
export function catchUpBonus(ratio: number | null, cu: CatchUpBalance, prev?: Pick<CatchUpState, "active" | "ratio"> | null): { bonus: number; active: boolean } {
  if (ratio === null || !Number.isFinite(ratio)) return { bonus: 0, active: false };
  // Ohne frühere Messung (neues Konto, z. B. nur Startpaket) gilt die Hilfe als „nicht ruhend“.
  const wasActive = prev && prev.ratio !== null ? prev.active : true;
  const active = ratio < (wasActive ? cu.from : cu.resumeBelow);
  return { bonus: active ? catchUpCurve(ratio, cu) : 0, active };
}

/** Median einer Zahlenliste (leer: null). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Aufteilung der Baukosten: Die Gutschrift wird zuerst verbraucht und deckt denselben Anteil jeder Ressource
 * (abgerundet, damit nie mehr als der Bestand verbraucht wird); den Rest zahlt das Lager.
 */
export function splitBuildCost(cost: ResourceMap, credit: number, balance: Balance): { fromCredit: ResourceMap; fromStock: ResourceMap; used: number } {
  const total = refValue(cost, balance);
  const share = credit > 0 && total > 0 ? Math.min(1, credit / total) : 0;
  const fromCredit: ResourceMap = {};
  const fromStock: ResourceMap = {};
  for (const [r, v] of Object.entries(cost)) {
    const c = share >= 1 ? v : Math.floor(v * share);
    if (c > 0) fromCredit[r] = c;
    fromStock[r] = v - c;
  }
  return { fromCredit, fromStock, used: refValue(fromCredit, balance) };
}

/** Bestand der Baugutschrift eines Hafens (0 ohne Konto). */
export function buildCredit(base: BaseState): number {
  return Math.max(0, base.catchUp?.credit ?? 0);
}

/** Neues Konto mit Startwerten (Stand ohne Messung). */
export function emptyCatchUp(nowMs: number): CatchUpState {
  return { credit: 0, bonus: 0, ratio: null, active: false, lastAtMs: nowMs, earned: 0 };
}

/**
 * Zufluss eines Laufs: bonus × Gebäudeproduktion (Wert je Stunde) × Stunden (höchstens maxCatchUpHours), v1.35 je Stunde
 * mindestens `minPerHour` (Mindestzufluss für Rückkehrer), solange ein Bonus läuft. Der Bestand wächst höchstens bis
 * storeHours × Zufluss je Stunde; darüber ruht der Zufluss (ein Startpaket darf darüber liegen).
 */
export function accrueCatchUp(state: CatchUpState, buildingValuePerHour: number, nowMs: number, cu: CatchUpBalance, flowing = true, minPerHour = 0): CatchUpState {
  const hours = Math.max(0, Math.min(cu.maxCatchUpHours, (nowMs - state.lastAtMs) / 3600000));
  const perHour = flowing && state.bonus > 0 ? Math.max(state.bonus * Math.max(0, buildingValuePerHour), Math.max(0, minPerHour)) : 0;
  const ceiling = cu.storeHours * perHour;
  const add = Math.max(0, Math.min(perHour * hours, ceiling - state.credit));
  return { ...state, credit: state.credit + add, earned: state.earned + add, lastAtMs: nowMs };
}
