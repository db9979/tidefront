// Hafenansicht live: Bestände aus dem Stand der letzten Abfrage (serverNow) plus verstrichener Zeit hochrechnen
// (Förderung je Stunde, bis zur Lagergrenze, nie unter 0). Grundlage für Kosten-Rotfärbung, Höchstmengen,
// „Was hilft?“-Fehlmengen und Wartezeiten, damit sie sich ohne Neuöffnen anpassen.
import { useMemo } from "react";
import { queryClient, trpc, type BaseData } from "./trpc.ts";
import { liveResources } from "./live.res.ts";
import { useNow } from "./time.ts";

const asOfs = new WeakMap<BaseData, number>();

/** Zeitpunkt (Serverzeit), zu dem die Bestände dieser Hafenansicht galten; null, wenn unbekannt. */
export function asOfBase(base: BaseData): number | null {
  const known = asOfs.get(base);
  if (known !== undefined) return known;
  for (const q of queryClient.getQueryCache().findAll({ queryKey: trpc.base.get.pathKey() })) {
    const d = q.state.data as { base?: BaseData | null; serverNow?: number } | undefined;
    if (d?.base === base && typeof d.serverNow === "number") {
      asOfs.set(base, d.serverNow);
      return d.serverNow;
    }
  }
  return null;
}

/** Hafenansicht mit hochgerechneten Beständen zum Zeitpunkt `now` (ohne bekannten Stand unverändert). */
export function liveBaseAt<B extends BaseData | null | undefined>(base: B, now: number): B {
  if (!base) return base;
  const asOf = asOfBase(base);
  if (asOf === null) return base;
  return { ...base, resources: { ...base.resources, ...liveResources(base, asOf, now) } };
}

/**
 * Stromspeicher live: Stand der Abfrage plus Laden/Entladen je Stunde (grid.now.charge), zwischen 0 und Kapazität.
 * Nur bis zur nächsten vollen Stunde – danach gilt die nächste Stunde der Kurve (Wetter), die der Abruf nachliefert.
 */
export function liveStoredAt(base: BaseData, now: number): number {
  const g = base.grid.now;
  const asOf = asOfBase(base);
  if (asOf === null || !(g.capacity > 0)) return g.stored;
  const until = Math.min(now, Math.ceil(asOf / 3_600_000) * 3_600_000);
  const v = g.stored + (g.charge * Math.max(0, until - asOf)) / 3_600_000;
  return Math.max(0, Math.min(g.capacity, v));
}

/** Wie liveBaseAt, mit der gemeinsamen Uhr (sekündlich neu). */
export function useLiveBase<B extends BaseData | null | undefined>(base: B): B {
  const now = useNow();
  return useMemo(() => liveBaseAt(base, now), [base, now]);
}
