// See: Feste Lieferzeit für Börsenkäufe (Fairness, ENTSCHEIDUNGEN-5.md „Feste Lieferzeit“): Mit market.deliveryHours
// kommt jeder Börsenkauf nach genau so vielen Stunden an, egal wie weit der Handelshafen entfernt ist. Der Konvoi fährt
// den Seeweg mit passend angepasster Geschwindigkeit (Position aus Abfahrt/Ankunft). Das Kartellrisiko rechnet mit der
// Strecke, die ein Konvoi mit convoySpeedKmh in dieser Zeit fährt – für alle gleich. Fehlt der Wert: alte Regel (Entfernung).
import type { MarketBalance } from "./types.ts";

const HOUR_MS = 3_600_000;

type DeliveryCfg = Pick<MarketBalance["market"], "convoySpeedKmh" | "deliveryHours">;

/** Fahrzeit einer Börsenlieferung in ms (fest mit deliveryHours, sonst Seeweg / convoySpeedKmh). */
export function deliveryTravelMs(cfg: DeliveryCfg, distanceKm: number): number {
  if (cfg.deliveryHours !== undefined && cfg.deliveryHours > 0) return Math.round(cfg.deliveryHours * HOUR_MS);
  const km = distanceKm > 0 && Number.isFinite(distanceKm) ? distanceKm : 0;
  return Math.ceil((km / cfg.convoySpeedKmh) * HOUR_MS);
}

/** Strecke, mit der das Kartellrisiko eines Börsenkonvois rechnet (fest: deliveryHours × convoySpeedKmh). */
export function deliveryRiskKm(cfg: DeliveryCfg, distanceKm: number): number {
  if (cfg.deliveryHours !== undefined && cfg.deliveryHours > 0) return cfg.deliveryHours * cfg.convoySpeedKmh;
  return distanceKm;
}
