// Handelsstatistik des Spielerhandels: abgeschlossene Angebote der letzten 7 Tage je Paar (Summen, Anzahl).
// Nur Anzeige: Spielerhandel verändert die Börsenkurse nicht. Die Umrechnung in Taler je Einheit zum
// aktuellen Börsenkurs macht die Oberfläche. Bis zu 60 s zwischengespeichert.
import { and, eq, gte, sql } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { tradeAssets } from "./player-trade.ts";

export const TRADE_STATS_WINDOW_MS = 7 * 24 * 3600000;
const TRADE_STATS_TTL_MS = 60000;

export interface TradePairStat {
  /** Bewertete Seite (Ressource); Taler stehen immer auf Seite b. */
  a: string;
  b: string;
  /** Anzahl abgeschlossener Geschäfte. */
  count: number;
  qtyA: number;
  qtyB: number;
}

interface RawPair { give: string; want: string; count: number; giveQty: number; wantQty: number }

/** Fasst Rohsummen je Richtung zu ungeordneten Paaren zusammen (Reihenfolge wie tradeAssets, Taler zuletzt). */
export function foldTradePairs(raw: RawPair[], assets: string[]): TradePairStat[] {
  const idx = (a: string) => { const i = assets.indexOf(a); return i < 0 ? assets.length : i; };
  const map = new Map<string, TradePairStat>();
  for (const r of raw) {
    if (r.give === r.want || r.count <= 0) continue;
    const swap = idx(r.give) > idx(r.want);
    const a = swap ? r.want : r.give;
    const b = swap ? r.give : r.want;
    const k = `${a}|${b}`;
    const s = map.get(k) ?? { a, b, count: 0, qtyA: 0, qtyB: 0 };
    s.count += r.count;
    s.qtyA += swap ? r.wantQty : r.giveQty;
    s.qtyB += swap ? r.giveQty : r.wantQty;
    map.set(k, s);
  }
  return [...map.values()].sort((x, y) => idx(x.a) - idx(y.a) || idx(x.b) - idx(y.b));
}

let cache: { at: number; pairs: TradePairStat[] } | null = null;

/** Für Tests. */
export function clearTradeStatsCache(): void {
  cache = null;
}

/** Abgeschlossene Spielergeschäfte der letzten 7 Tage je Paar. */
export async function playerTradeStats(engine: Engine) {
  const nowMs = Date.now();
  if (!cache || nowMs - cache.at > TRADE_STATS_TTL_MS) {
    const o = tables.playerOffer;
    const raw = await engine.db
      .select({
        give: o.give, want: o.want,
        count: sql<number>`count(*)::int`,
        giveQty: sql<number>`coalesce(sum(${o.giveQty}), 0)::float8`,
        wantQty: sql<number>`coalesce(sum(${o.wantQty}), 0)::float8`,
      })
      .from(o)
      .where(and(eq(o.status, "accepted"), gte(o.closedAt, new Date(nowMs - TRADE_STATS_WINDOW_MS))))
      .groupBy(o.give, o.want);
    cache = { at: nowMs, pairs: foldTradePairs(raw, tradeAssets()) };
  }
  return { serverNow: nowMs, windowMs: TRADE_STATS_WINDOW_MS, pairs: cache.pairs };
}
