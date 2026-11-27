// See: Börsenkäufe reisen als Konvoi vom nächsten Handelshafen (über See) zum Käuferhafen – sichtbar auf der Karte,
// vom Kartell überfallbar (geringere Chance als Handelskonvois: convoys.marketChanceFactor/marketMaxChance), von
// Kriegsgegnern abfangbar. Ankunft nach fester Lieferzeit market.deliveryHours (game-core market/delivery.ts), das
// Kartellrisiko rechnet mit der dazu passenden festen Strecke statt der Entfernung (für alle gleich). Geleitschutz
// optional in der Order: eigene Schiffe fahren dem Konvoi zum Handelshafen entgegen (wie beim Spielerhandel).
// Regeln: docs/REGELN-SEE.md, Abschnitt Konvois.
import { market, type Counts } from "@tidefront/game-core";
import { nearestTradePortBySea } from "@tidefront/world";
import type { Tx } from "@tidefront/db";
import type { BaseRow } from "./store.ts";
import { marketBalance } from "./context.ts";
import { attachTradeEscort, createConvoy } from "./naval-convoy.ts";

/**
 * Konvoi zu einer Börsenlieferung anlegen; mit Geleit (Schiffe daheim) läuft es sofort aus. Fehler des Geleits
 * (escort_ships_only, Treibstoff, Missionsplätze …) brechen den Kauf ab (GameError), damit nichts halb geschieht.
 */
export async function createMarketConvoy(
  tx: Tx,
  playerId: number,
  base: BaseRow,
  d: { id: string; resource: string; qty: number; departMs: number; arriveMs: number },
  escort: Counts | undefined,
): Promise<number> {
  const port = nearestTradePortBySea(base);
  const from = { col: port.col, row: port.row };
  const convoyId = await createConvoy(tx, {
    kind: "boerse", deliveryId: d.id, senderId: null, recipientId: playerId, recipientBaseId: base.id,
    from, to: { col: base.col, row: base.row }, cargo: { [d.resource]: d.qty }, departMs: d.departMs, arriveMs: d.arriveMs,
    riskKm: market.deliveryRiskKm(marketBalance.market, port.distanceKm),
  });
  if (escort && Object.values(escort).some((n) => n > 0)) await attachTradeEscort(tx, playerId, base, escort, convoyId, from, d.arriveMs, d.departMs);
  return convoyId;
}
