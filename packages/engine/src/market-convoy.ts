// See: Börsenkäufe reisen als Konvoi vom nächsten Handelshafen (über See) zum Käuferhafen – sichtbar auf der Karte,
// vom Kartell überfallbar (geringere Chance als Handelskonvois: convoys.marketChanceFactor/marketMaxChance), von
// Kriegsgegnern abfangbar. Ankunft nach fester Lieferzeit market.deliveryHours (game-core market/delivery.ts), das
// Kartellrisiko rechnet mit der dazu passenden festen Strecke statt der Entfernung (für alle gleich) und – v1.35 – mit
// dem Warenwert aller eigenen Börsenkonvois der letzten 4 h (geteilte Orders senken das Risiko kaum noch). Geleitschutz
// optional in der Order: eigene Schiffe fahren dem Konvoi zum Handelshafen entgegen (wie beim Spielerhandel).
// Regeln: docs/REGELN-SEE.md, Abschnitt Konvois.
import { and, eq, gt } from "drizzle-orm";
import { cargoValue, convoysOf, market, type Counts, type ResourceMap } from "@tidefront/game-core";
import { nearestTradePortBySea } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import type { BaseRow } from "./store.ts";
import { balance, marketBalance } from "./context.ts";

/**
 * v1.35 (M-09): Warenwert der eigenen Börsenkonvois, die in den letzten convoys.marketValueWindowHours ausgelaufen sind
 * (ohne Fenster 0). Er zählt bei der Kartellchance des nächsten Börsenkonvois mit; die Order zeigt ihn an.
 */
export async function recentMarketConvoyValue(db: DbOrTx, playerId: number, nowMs: number): Promise<number> {
  const h = convoysOf(balance)?.marketValueWindowHours;
  if (!h) return 0;
  const rows = await db.select({ cargo: tables.convoy.cargo }).from(tables.convoy).where(and(
    eq(tables.convoy.kind, "boerse"), eq(tables.convoy.recipientId, playerId), gt(tables.convoy.departAt, new Date(nowMs - h * 3600000)),
  ));
  return rows.reduce((s, r) => s + cargoValue((r.cargo ?? {}) as ResourceMap, balance), 0);
}
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
  const cargo = { [d.resource]: d.qty };
  const riskValue = cargoValue(cargo, balance) + (await recentMarketConvoyValue(tx, playerId, d.departMs)); // v1.35
  const convoyId = await createConvoy(tx, {
    kind: "boerse", deliveryId: d.id, senderId: null, recipientId: playerId, recipientBaseId: base.id,
    from, to: { col: base.col, row: base.row }, cargo, departMs: d.departMs, arriveMs: d.arriveMs,
    riskKm: market.deliveryRiskKm(marketBalance.market, port.distanceKm), riskValue,
  });
  if (escort && Object.values(escort).some((n) => n > 0)) await attachTradeEscort(tx, playerId, base, escort, convoyId, from, d.arriveMs, d.departMs);
  return convoyId;
}
