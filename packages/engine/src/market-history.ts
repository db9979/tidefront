// Saisonchart der Börse: Stundenschlusskurse je Ressource (Tabelle market_price_hour) schreiben und lesen.
// Der Marktzustand hält nur die letzten 24 Stunden (Kursband); hier bleibt je volle Stunde ein Punkt für die ganze Saison.
// Geschrieben vom 10-Minuten-Lauf der Marktnachrichten (runMarketNewsTx): jede abgeschlossene Stunde einmal, fehlende
// Stunden (Worker stand) bis 24 h rückwirkend aus dem Verlauf rekonstruiert. Geleert am Saisonende (clearMarketNews).
import { eq, inArray, max } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { marketRefs } from "./market-news.ts";

const HOUR_MS = 3_600_000;
/** So weit reicht der Verlauf im Marktzustand sicher zurück (Kursband 24 h). */
const BACKFILL_HOURS = 24;

/**
 * Schreibt die Schlusskurse aller abgeschlossenen, noch fehlenden Stunden bis nowMs (höchstens 24 zurück). Kurs zum
 * Stundenende = letzter Handel davor, zum effektiven Richtwert zurückgeführt (wie die Börse ihn dann gezeigt hätte).
 * Rückgabe: Zahl der neuen Zeilen.
 */
export async function recordMarketCloses(tx: Tx, nowMs: number): Promise<number> {
  const lastEnd = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const rows = await tx.select().from(tables.market).where(inArray(tables.market.resource, balance.resources));
  if (rows.length === 0) return 0;
  const done = await tx
    .select({ resource: tables.marketPriceHour.resource, last: max(tables.marketPriceHour.hourMs) })
    .from(tables.marketPriceHour)
    .groupBy(tables.marketPriceHour.resource);
  const lastByRes = new Map(done.map((d) => [d.resource, Number(d.last ?? 0)]));
  const refs = (await marketRefs(tx, nowMs)).refs;
  const halfLife = balance.market.reversionHalfLifeHours;
  const values: (typeof tables.marketPriceHour.$inferInsert)[] = [];
  for (const row of rows) {
    const r = row.resource as marketCore.ResourceId;
    const st = row.state as marketCore.ResourceMarketState;
    const ref = refs[r] ?? balance.market.refPrice[r];
    // Nicht vor dem Beginn des Marktes (Saisonstart) und nicht vor der letzten geschriebenen Stunde.
    const first = st.history[0]?.tMs ?? st.lastUpdateMs;
    let from = Math.max(lastEnd - (BACKFILL_HOURS - 1) * HOUR_MS, (lastByRes.get(r) ?? 0) + HOUR_MS);
    from = Math.max(from, Math.ceil(first / HOUR_MS) * HOUR_MS);
    for (let h = from; h <= lastEnd; h += HOUR_MS) {
      const price = marketCore.priceAt(st.history, h, ref, halfLife) ?? st.price;
      values.push({ resource: r, hourMs: h, price, ref });
    }
  }
  if (values.length === 0) return 0;
  await tx.insert(tables.marketPriceHour).values(values).onConflictDoNothing();
  return values.length;
}

/** market.chart: Stundenschlusskurse einer Ressource in der laufenden Saison, dazu Grundrichtwert. */
export async function marketChartView(db: DbOrTx, resource: string, nowMs = Date.now()) {
  if (!balance.resources.includes(resource)) return { serverNow: nowMs, resource, baseRef: 0, points: [] as { t: number; p: number; ref: number }[] };
  const rows = await db
    .select({ t: tables.marketPriceHour.hourMs, p: tables.marketPriceHour.price, ref: tables.marketPriceHour.ref })
    .from(tables.marketPriceHour)
    .where(eq(tables.marketPriceHour.resource, resource))
    .orderBy(tables.marketPriceHour.hourMs);
  return {
    serverNow: nowMs,
    resource,
    baseRef: balance.market.refPrice[resource],
    points: rows.map((r) => ({ t: Number(r.t), p: r.p, ref: r.ref })),
  };
}
