// Strecken für den Kasten „Geleitschutz“ (TST-02, Abschlussprüfung 0.38): dieselbe Richtung wie die gebuchte Mission.
// Seewege sind richtungsabhängig (seaRoute(a, b) ≠ seaRoute(b, a)); das Geleit fährt immer vom eigenen Hafen los
// (planNaval: missionRoute(own → Ziel)), Treibstoff = 2 × diese Strecke. Der Konvoi selbst fährt Verkäufer → Käufer,
// das Kartellrisiko würfelt mit der Luftlinie (createConvoy ohne riskKm).
import { and, eq, ne } from "drizzle-orm";
import { hexDistanceKm, seaRoute } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { travelMs } from "./player-trade.ts";

type Hex = { col: number; row: number };

/** Einfache Strecke einer Geleitfahrt vom eigenen Hafen zum Ziel, wie die Mission sie bucht (mindestens die Luftlinie). */
export function escortTripKm(own: Hex, target: Hex): number {
  return Math.round(Math.max(hexDistanceKm(own, target), seaRoute(own, target).km));
}

/** Börse: Handelshafen mit der Geleitstrecke Hafen → Handelshafen (attachTradeEscort fährt so; distanceKm ist umgekehrt). */
export function withEscortKm<P extends Hex>(own: Hex, port: P): P & { escortKm: number } {
  return { ...port, escortKm: escortTripKm(own, port) };
}

/** Konvoi Verkäufer → Käufer mit Geleit des Käufers: Strecke fürs Kartellrisiko, Geleitfahrt, Fahrzeit des Konvois. */
export function buyerEscortRoute(buyer: Hex, seller: Hex): { riskKm: number; escortKm: number; travelMs: number } {
  return { riskKm: Math.round(hexDistanceKm(seller, buyer)), escortKm: escortTripKm(buyer, seller), travelMs: travelMs(seller, buyer) };
}

/** Höchstzahl der Häfen für den Median (Rechenzeit der Wegsuche). */
const MEDIAN_SAMPLE = 40;

/**
 * Partner noch unbekannt (Angebot einstellen): Median der Geleitstrecken vom eigenen Hafen zu den Heimathäfen der
 * anderen Spieler (Seeweg, Richtung wie die Mission). null, wenn es keine anderen Häfen gibt.
 */
export async function medianPartnerKm(db: DbOrTx, playerId: number, own: Hex): Promise<number | null> {
  const rows = await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)
    .where(and(eq(tables.base.isHome, true), ne(tables.base.playerId, playerId))).limit(MEDIAN_SAMPLE);
  if (rows.length === 0) return null;
  const km = rows.map((r) => escortTripKm(own, r)).sort((a, b) => a - b);
  const h = Math.floor(km.length / 2);
  return km.length % 2 ? km[h] : Math.round((km[h - 1] + km[h]) / 2);
}
