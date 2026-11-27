// Marktnachrichten (Server): Zeilen in market_news anlegen und fortschreiben, effektiven Richtwert berechnen,
// Lesemodell (market.news), Push „Marktnachricht“, Saisonende. Anlässe: market-news-sources.ts. Kern: news.ts.
// Richtwert-Steuerung: Zielversatz = Summe der Einflüsse (gedeckelt ±maxTotal); der effektive Versatz folgt ihm
// höchstens maxChangePerHour je Stunde. Gespeichert wird nur der zuletzt fortgeschriebene Stand (server_setting
// "market_ref_offsets"); Börse, Angebot und Handel schreiben ihn zur Anfrage hin lazy fort (deterministisch).
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, type Engine, type NoticeJob } from "./context.ts";
import { getSetting, setSetting } from "./settings.ts";

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const REF_OFFSETS_KEY = "market_ref_offsets";
export const SCARCITY_KEY = "market_scarcity";

export const RES_NAME: Record<string, string> = { stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant" };

export type NewsSource = "weltereignis" | "kriegslage" | "knappheit" | "saison" | "handelsbilanz";

/** Werte aus balance.json; fehlen sie, gibt es keine Marktnachrichten (Richtwert = Grundrichtwert). */
export function newsBalance(): marketCore.MarketNewsBalance | null {
  return balance.market.news ?? null;
}

/** Eine gewünschte Nachricht (Anlass × Ressource). */
export interface NewsSpec {
  key: string;
  source: NewsSource;
  resource: string;
  pct: number;
  reason: string;
  startMs: number;
  endMs: number;
  fadeMs: number;
}

type NewsRow = typeof tables.marketNews.$inferSelect;

/** Zeitpunkt als SQL-Parameter in Rohausdrücken (Date wird dort nicht umgewandelt). */
function tsParam(ms: number) {
  return sql`${new Date(ms).toISOString()}::timestamptz`;
}

function toInfluence(r: NewsRow): marketCore.MarketInfluence {
  return { resource: r.resource, pct: r.pct, startMs: r.startsAt.getTime(), endMs: r.endsAt.getTime(), fadeMs: r.fadeMinutes * MIN_MS };
}

/** „+12 %“, „−4 %“, „+1,1 %“ (auf eine Nachkommastelle). */
export function pctText(pct: number): string {
  const p = Math.round(Math.abs(pct) * 1000) / 10;
  return `${pct < 0 ? "−" : "+"}${Number.isInteger(p) ? String(p) : p.toLocaleString("de-DE")} %`;
}

/**
 * Legt die Nachricht an oder schreibt sie fort. Gleiche Wirkung wie die letzte noch wirkende Zeile desselben Anlasses:
 * nur Ende, Abklingen und Grund werden angepasst. Andere Wirkung: die alte Zeile endet sofort (ohne Abklingen) und eine
 * neue beginnt jetzt (bei Wirkung unter minPct keine). Rückgabe: true, wenn sich etwas geändert hat.
 */
export async function upsertNews(tx: Tx, spec: NewsSpec, nowMs: number): Promise<boolean> {
  const cfg = newsBalance();
  if (!cfg || !balance.resources.includes(spec.resource)) return false;
  const pct = marketCore.roundPct(spec.pct);
  const fadeMinutes = Math.max(0, Math.round(spec.fadeMs / MIN_MS));
  const [last] = await tx
    .select()
    .from(tables.marketNews)
    .where(and(eq(tables.marketNews.key, spec.key), eq(tables.marketNews.resource, spec.resource)))
    .orderBy(desc(tables.marketNews.id))
    .limit(1);
  const live = last !== undefined && last.endsAt.getTime() + last.fadeMinutes * MIN_MS > nowMs;
  if (last && live && Math.abs(last.pct - pct) < 1e-9) {
    if (last.endsAt.getTime() === spec.endMs && last.fadeMinutes === fadeMinutes && last.reason === spec.reason) return false;
    await tx.update(tables.marketNews)
      .set({ endsAt: new Date(spec.endMs), fadeMinutes, reason: spec.reason })
      .where(eq(tables.marketNews.id, last.id));
    return true;
  }
  let changed = false;
  if (last && live) {
    await tx.update(tables.marketNews)
      .set({ endsAt: new Date(Math.min(nowMs, last.endsAt.getTime())), fadeMinutes: 0 })
      .where(eq(tables.marketNews.id, last.id));
    changed = true;
  }
  if (Math.abs(pct) < cfg.minPct) return changed;
  await tx.insert(tables.marketNews).values({
    key: spec.key, source: spec.source, resource: spec.resource, pct, reason: spec.reason,
    startsAt: new Date(spec.startMs), endsAt: new Date(spec.endMs), fadeMinutes,
  });
  return true;
}

/** Beendet alle noch wirkenden Zeilen eines Anlasses sofort (z. B. Knappheit bei weniger als 3 aktiven Häfen). */
export async function closeNews(tx: Tx, key: string, nowMs: number): Promise<boolean> {
  const rows = await tx
    .update(tables.marketNews)
    .set({ endsAt: new Date(nowMs), fadeMinutes: 0 })
    .where(and(eq(tables.marketNews.key, key), gt(tables.marketNews.endsAt, new Date(nowMs))))
    .returning({ id: tables.marketNews.id });
  return rows.length > 0;
}

/** Zeilen, die zu nowMs noch wirken (oder erst beginnen). */
async function liveRows(db: DbOrTx, nowMs: number): Promise<NewsRow[]> {
  return db
    .select()
    .from(tables.marketNews)
    .where(sql`${tables.marketNews.endsAt} + ${tables.marketNews.fadeMinutes} * interval '1 minute' > ${tsParam(nowMs)}`);
}

function parseOffsets(raw: string | null): marketCore.RefOffsets | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as marketCore.RefOffsets;
    return typeof v?.atMs === "number" && v.offset && typeof v.offset === "object" ? v : null;
  } catch {
    return null;
  }
}

export interface MarketRefs {
  /** Effektiver Richtwert je Ressource (ohne Nachrichten exakt der Grundrichtwert). */
  refs: Record<string, number>;
  /** Effektiver Versatz (Anteil am Grundrichtwert) und Zielversatz je Ressource. */
  offsets: Record<string, number>;
  target: Record<string, number>;
  rows: NewsRow[];
}

/** Effektiver Richtwert zu nowMs: gespeicherter Stand, höchstens maxChangePerHour Richtung Ziel fortgeschrieben. */
export async function marketRefs(db: DbOrTx, nowMs: number): Promise<MarketRefs> {
  const cfg = newsBalance();
  const zero = Object.fromEntries(balance.resources.map((r) => [r, 0]));
  if (!cfg) return { refs: { ...balance.market.refPrice }, offsets: zero, target: { ...zero }, rows: [] };
  const rows = await liveRows(db, nowMs);
  const target = marketCore.targetOffsets(rows.map(toInfluence), balance.resources, nowMs, cfg.maxTotal);
  const stored = parseOffsets(await getSetting(db, REF_OFFSETS_KEY));
  const stepped = marketCore.stepOffsets(stored, target, nowMs, cfg.maxChangePerHour, cfg.maxTotal);
  return { refs: marketCore.effectiveRefPrices(balance.market.refPrice, stepped.offset), offsets: stepped.offset, target, rows };
}

/** Für den Börsenkern: effektive Richtwerte, oder undefined, wenn alle dem Grundrichtwert gleichen (bit-gleich). */
export async function effectiveMarketRefs(db: DbOrTx, nowMs: number): Promise<marketCore.RefPrices | undefined> {
  const m = await marketRefs(db, nowMs);
  return Object.values(m.offsets).every((o) => o === 0) ? undefined : (m.refs as marketCore.RefPrices);
}

/** Schreibt den effektiven Versatz auf nowMs fort und speichert ihn (Worker, alle 10 Minuten). */
export async function persistRefOffsets(tx: Tx, nowMs: number): Promise<Record<string, number>> {
  const cfg = newsBalance();
  if (!cfg) return {};
  const m = await marketRefs(tx, nowMs);
  await setSetting(tx, REF_OFFSETS_KEY, JSON.stringify({ atMs: nowMs, offset: m.offsets }));
  return m.offsets;
}

// ---------------------------------------------------------------- Lesemodell

/** market.news: wirkende Nachrichten und die der letzten 24 Stunden, dazu Richtwerte je Ressource. */
export async function marketNewsView(db: DbOrTx, nowMs = Date.now()) {
  const cfg = newsBalance();
  const since = new Date(nowMs - DAY_MS);
  const rows = cfg
    ? await db
      .select()
      .from(tables.marketNews)
      .where(or(
        sql`${tables.marketNews.endsAt} + ${tables.marketNews.fadeMinutes} * interval '1 minute' > ${tsParam(nowMs - DAY_MS)}`,
        gt(tables.marketNews.createdAt, since),
      ))
      .orderBy(desc(tables.marketNews.startsAt), desc(tables.marketNews.id))
      .limit(60)
    : [];
  const m = await marketRefs(db, nowMs);
  return {
    serverNow: nowMs,
    maxTotal: cfg?.maxTotal ?? 0,
    maxChangePerHour: cfg?.maxChangePerHour ?? 0,
    refs: balance.resources.map((r) => ({
      id: r,
      base: balance.market.refPrice[r],
      effective: m.refs[r],
      offset: m.offsets[r] ?? 0,
      target: m.target[r] ?? 0,
    })),
    news: rows.map((r) => {
      const inf = toInfluence(r);
      const fadeEndsAtMs = marketCore.influenceEndsMs(inf);
      return {
        id: r.id,
        source: r.source as NewsSource,
        resource: r.resource,
        pct: r.pct,
        /** Wirkung jetzt (beim Abklingen kleiner als pct). */
        current: marketCore.influenceAt(inf, nowMs),
        direction: r.pct > 0 ? ("up" as const) : ("down" as const),
        title: `${r.reason} – ${RES_NAME[r.resource] ?? r.resource} ${pctText(r.pct)}`,
        reason: r.reason,
        startsAtMs: inf.startMs,
        endsAtMs: inf.endMs,
        fadeEndsAtMs,
        active: nowMs >= inf.startMs && nowMs < fadeEndsAtMs,
      };
    }),
  };
}

/** Admin-Statistik: aktuelle Einflüsse je Ressource (Versatz, Ziel, Zahl der Nachrichten). */
export async function marketNewsAdmin(db: DbOrTx, nowMs = Date.now()) {
  const m = await marketRefs(db, nowMs);
  return balance.resources.map((r) => ({
    id: r,
    offset: m.offsets[r] ?? 0,
    target: m.target[r] ?? 0,
    effective: m.refs[r],
    influences: m.rows
      .filter((x) => x.resource === r && marketCore.influenceAt(toInfluence(x), nowMs) !== 0)
      .map((x) => ({ source: x.source, reason: x.reason, now: marketCore.influenceAt(toInfluence(x), nowMs) })),
  }));
}

// ---------------------------------------------------------------- Push und Saisonende

/**
 * Push „Marktnachricht“ für neue Zeilen ab pushMinPct (nur Zeilen der letzten 2 Stunden; ältere werden still
 * als erledigt markiert). Empfänger: Geräte, die die Art eingeschaltet haben (Vorgabe aus).
 */
export async function collectNewsPush(tx: Tx, nowMs: number): Promise<NoticeJob[]> {
  const cfg = newsBalance();
  if (!cfg) return [];
  const fresh = await tx
    .update(tables.marketNews)
    .set({ pushedAt: new Date(nowMs) })
    .where(isNull(tables.marketNews.pushedAt))
    .returning();
  const due = fresh.filter((r) => Math.abs(r.pct) >= cfg.pushMinPct && r.createdAt.getTime() > nowMs - 2 * HOUR_MS);
  if (due.length === 0) return [];
  const subs = await tx
    .selectDistinct({ playerId: tables.pushSubscription.playerId })
    .from(tables.pushSubscription)
    .where(sql`(${tables.pushSubscription.prefs} ->> 'market') = 'true'`);
  const jobs: NoticeJob[] = [];
  for (const r of due) {
    const body = `${r.reason} – ${RES_NAME[r.resource] ?? r.resource} ${pctText(r.pct)} auf den Richtwert.`;
    for (const s of subs) {
      jobs.push({ playerId: s.playerId, notice: { kind: "market", title: "Marktnachricht", body, url: "/?tab=boerse", tag: `markt-${r.key}-${r.resource}` } });
    }
  }
  return jobs;
}

/** Saisonende: Nachrichten, Versatz, Knappheitswerte und Saisonchart verfallen (die Börse steht wieder auf Grundrichtwert). */
export async function clearMarketNews(tx: Tx): Promise<void> {
  await tx.delete(tables.marketNews);
  await tx.delete(tables.marketPriceHour); // Saisonchart: der Verlauf beginnt mit der neuen Saison neu
  await tx.delete(tables.serverSetting).where(inArray(tables.serverSetting.key, [REF_OFFSETS_KEY, SCARCITY_KEY]));
}

/** Benachrichtigt nach dem Commit (Worker). */
export function afterNewsRun(engine: Engine, changed: boolean, jobs: NoticeJob[]): void {
  if (changed) engine.notify(null, "market");
  if (jobs.length > 0) engine.push?.(jobs);
}
