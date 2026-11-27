// KI-Spieler an der Börse (Welle 2, AN-05): Schwellen in Stunden Produktion statt Füllgrad des Lagers. Früher verkauften
// die Bots erst ab 50–85 % Füllgrad – das Lager wächst exponentiell, also nie (2 Geschäfte in 42 Tagen, Händler und
// Festung 0 Taler). Jetzt: Überschuss über HOLD_HOURS Produktion (Händler TRADER_HOLD_HOURS) und über dem Bedarf der
// nächsten Ausbauten wird verkauft – das hält KI-Lager klein (Nutzerentscheid: kein Hortlager als Beute für Menschen).
// Knappe Ware (unter BUY_BELOW_HOURS Produktion oder unter dem Bedarf) wird mit den Talern zugekauft.
// Reine Entscheidung ohne Datenbank (botMarketPlan); ausgeführt wird in bots-econ.ts über den Befehl trade.
import { maxAllowedLevel, plannedLevel, upgradeCost, type BaseState, type ResourceMap } from "@tidefront/game-core";
import { balance } from "./context.ts";

/** Bestand, den die KI je Rohstoff behält (Stunden ihrer Produktion); darüber wird verkauft. */
export const HOLD_HOURS = 24;
/** Händler halten noch weniger (verkaufen früher). */
export const TRADER_HOLD_HOURS = 12;
/** Unter diesem Bestand (Stunden Produktion) gilt ein Rohstoff als knapp und wird zugekauft … */
export const BUY_BELOW_HOURS = 6;
/** … bis zu diesem Bestand. */
export const BUY_TO_HOURS = 12;
/** Kleinste Menge je Geschäft. */
export const MIN_LOT = 100;
/** Verkauft wird erst, wenn der Überschuss mindestens dieser Anteil des Haltebestands ist (keine Kleinstverkäufe je Zug). */
export const SELL_TRIGGER_SHARE = 0.25;
/** Zukauf mindestens so viele Stunden Produktion (keine Kleinstkäufe je Zug). */
export const BUY_MIN_HOURS = 2;
/** Untergrenze der Produktion je Stunde für die Stundenrechnung (ohne Erzeuger keine Division durch 0). */
export const RATE_FLOOR = 20;
/** Anteil der freien Taler, die ein Zukauf höchstens ausgibt (Händler mehr). */
const BUY_SHARE = { trader: 0.6, other: 0.4 };
/** Anzahl der nächsten (billigsten) Ausbauten, deren Kosten nicht verkauft werden. */
export const NEED_BUILDS = 3;

export interface MarketPlanInput {
  stock: ResourceMap;
  /** Produktion je Stunde (netto, kann negativ sein). */
  perHour: ResourceMap;
  /** Bedarf der nächsten Ausbauten (wird nicht verkauft, Fehlmenge gilt als knapp). */
  need: ResourceMap;
  /** Freier Rahmen des Tageslimits je Rohstoff. */
  room: ResourceMap;
  price: ResourceMap;
  /** Größte Menge je Geschäft (Preiswirkung höchstens maxImpactPerTrade: Markttiefe × Anteil). */
  maxLot: ResourceMap;
  /** Verfügbare Taler (nach Rücklagen). */
  credits: number;
  trader: boolean;
}

export interface MarketPlan {
  /** Verkäufe, größter Überschuss (Wert) zuerst, je Rohstoff höchstens einer. */
  sell: { resource: string; qty: number }[];
  buy: { resource: string; qty: number } | null;
}

const rateOf = (i: MarketPlanInput, r: string) => Math.max(RATE_FLOOR, i.perHour[r] ?? 0);

/** Bestand, der je Rohstoff bleibt: max(Halte-Stunden × Produktion, Bedarf). */
export function keepLevel(i: MarketPlanInput, r: string): number {
  return Math.max((i.trader ? TRADER_HOLD_HOURS : HOLD_HOURS) * rateOf(i, r), i.need[r] ?? 0);
}

/** Höchstens so viele Verkäufe je Zug (je Rohstoff einer; Lose sind durch die Preiswirkung klein). */
export const MAX_SELLS = 3;

/** Größtes Los je Rohstoff: Preiswirkung knapp unter maxImpactPerTrade. */
export function maxLots(): ResourceMap {
  const out: ResourceMap = {};
  for (const r of balance.resources) out[r] = Math.floor((balance.market.depth[r] ?? 0) * balance.market.maxImpactPerTrade * 0.98);
  return out;
}

/** Verkäufe (größter Überschuss nach Wert zuerst) und ein Zukauf (knappster Rohstoff) je Zug, alles im Tageslimit. */
export function botMarketPlan(i: MarketPlanInput, resources: readonly string[] = balance.resources): MarketPlan {
  const lot = (r: string) => Math.min(i.room[r] ?? 0, i.maxLot[r] ?? Infinity);
  const sell = resources
    .filter((r) => (i.stock[r] ?? 0) - keepLevel(i, r) >= SELL_TRIGGER_SHARE * keepLevel(i, r))
    .map((r) => ({ resource: r, qty: Math.floor(Math.min((i.stock[r] ?? 0) - keepLevel(i, r), lot(r))) }))
    .filter((x) => x.qty >= MIN_LOT)
    .sort((a, b) => b.qty * (i.price[b.resource] ?? 1) - a.qty * (i.price[a.resource] ?? 1))
    .slice(0, MAX_SELLS);
  let buy: MarketPlan["buy"] = null;
  let worst = Infinity;
  const proceeds = sell.reduce((a, x) => a + x.qty * (i.price[x.resource] ?? 1), 0) * (1 - balance.market.fee);
  const credits = i.credits + proceeds;
  for (const r of resources) {
    if (sell.some((x) => x.resource === r)) continue;
    const stock = i.stock[r] ?? 0;
    const need = i.need[r] ?? 0;
    const hours = stock / rateOf(i, r);
    if (hours >= BUY_BELOW_HOURS && stock >= need) continue;
    const target = Math.max(BUY_TO_HOURS * rateOf(i, r), need);
    const price = i.price[r] ?? 1;
    const qty = Math.floor(Math.min(target - stock, (credits * (i.trader ? BUY_SHARE.trader : BUY_SHARE.other)) / (price * (1 + balance.market.fee)), lot(r)));
    if (qty < Math.max(MIN_LOT, BUY_MIN_HOURS * rateOf(i, r))) continue;
    const score = stock / Math.max(1, target);
    if (score < worst) { worst = score; buy = { resource: r, qty }; }
  }
  return { sell, buy };
}

/** Bedarf der NEED_BUILDS billigsten offenen Ausbauten vorhandener Gebäude (Kosten der nächsten Stufe, Richtpreis). */
export function nextBuildNeed(s: BaseState): ResourceMap {
  const ref = (r: string) => balance.market.refPrice[r] ?? 1;
  const costs = Object.keys(balance.buildings)
    .filter((id) => (s.buildings[id] ?? 0) > 0 && plannedLevel(s, id) < maxAllowedLevel(s, id, balance))
    .map((id) => upgradeCost(id, plannedLevel(s, id), balance))
    .map((c) => ({ c, v: Object.entries(c).reduce((a, [r, n]) => a + n * ref(r), 0) }))
    .sort((a, b) => a.v - b.v)
    .slice(0, NEED_BUILDS);
  const out: ResourceMap = {};
  for (const { c } of costs) for (const [r, n] of Object.entries(c)) out[r] = (out[r] ?? 0) + n;
  return out;
}
