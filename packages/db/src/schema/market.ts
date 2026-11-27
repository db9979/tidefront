// Datenbankschema (drizzle) – Börse: Marktzustand, Journal, Lieferungen, Marktnachrichten.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { bigint, bigserial, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";

export const market = pgTable("market", {
  resource: text("resource").primaryKey(),
  state: jsonb("state").notNull(),
});

/** Journal der Börse; wird nur fortgeschrieben. */
export const tradeLedger = pgTable("trade_ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tradeId: text("trade_id").notNull(),
  tMs: bigint("t_ms", { mode: "number" }).notNull(),
  account: text("account").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount", { precision: 24, scale: 2 }).notNull(),
}, (t) => [
  index("ledger_account").on(t.account, t.asset),
  index("ledger_trade").on(t.tradeId),
  // Handelsbilanz der Marktnachrichten: Netto-Käufe der letzten 72 h (alle 10 Minuten).
  index("ledger_t").on(t.tMs),
]);

/**
 * Saisonchart: Schlusskurs je Ressource und volle Stunde (Kurs zum Ende der Stunde, Rückkehr eingerechnet) und der
 * effektive Richtwert zu dem Zeitpunkt (Grundrichtwert steht in balance.json). Der 10-Minuten-Lauf der Marktnachrichten
 * schreibt jede abgeschlossene Stunde einmal (fehlende bis 24 h rückwirkend); etwa 4 × 24 × 42 ≈ 4.000 Zeilen je
 * Saison. Wird am Saisonende geleert.
 */
export const marketPriceHour = pgTable("market_price_hour", {
  resource: text("resource").notNull(),
  /** Ende der Stunde (ms seit 1970, volle Stunde UTC). */
  hourMs: bigint("hour_ms", { mode: "number" }).notNull(),
  price: doublePrecision("price").notNull(),
  /** Effektiver Richtwert (mit Marktnachrichten). */
  ref: doublePrecision("ref").notNull(),
}, (t) => [primaryKey({ columns: [t.resource, t.hourMs] })]);

export const delivery = pgTable("delivery", {
  id: text("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  baseId: integer("base_id").notNull(),
  resource: text("resource").notNull(),
  qty: integer("qty").notNull(),
  departAt: ts("depart_at").notNull(),
  arriveAt: ts("arrive_at").notNull(),
  status: text("status").notNull().default("underway"),
});

// ================================================================ Marktnachrichten
// Einflüsse der Welt auf den Richtwert der Börse (REGELN.md, Abschnitt Marktnachrichten; Kern
// packages/game-core/src/market/news.ts, Server packages/engine/src/market-news*.ts). Je Anlass und Ressource eine
// Zeile: volle Wirkung pct von starts_at bis ends_at, danach linear abklingend über fade_minutes. Ändert sich die
// Wirkung eines laufenden Anlasses, endet die alte Zeile sofort (fade 0) und eine neue beginnt. Der gesteuerte
// effektive Versatz (höchstens maxChangePerHour) steht in server_setting "market_ref_offsets", die Tageswerte der
// Knappheit in "market_scarcity". Die Tabelle wird am Saisonende geleert.

export const marketNews = pgTable("market_news", {
  id: serial("id").primaryKey(),
  /** Anlass: "we:<Ereignis-ID>", "kriegslage", "knappheit", "saison". */
  key: text("key").notNull(),
  /** weltereignis | kriegslage | knappheit | saison */
  source: text("source").notNull(),
  resource: text("resource").notNull(),
  /** Anteil am Grundrichtwert, z. B. 0.12 = +12 %. */
  pct: doublePrecision("pct").notNull(),
  reason: text("reason").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  fadeMinutes: integer("fade_minutes").notNull().default(0),
  /** Push „Marktnachricht“ verschickt (oder bewusst übersprungen). */
  pushedAt: ts("pushed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  /**
   * Hotfix 0.38.1 (AN-02): Wirkung endet = ends_at + fade_minutes (vom Server bei jedem Schreiben gesetzt), damit die
   * wirkenden Zeilen über einen Index gefunden werden. null nur bei Zeilen von vor dem Hotfix (Wartung trägt nach).
   */
  effectiveUntil: ts("effective_until"),
}, (t) => [
  index("market_news_key").on(t.key, t.resource, t.id), index("market_news_ends").on(t.endsAt),
  index("market_news_live").on(t.effectiveUntil),
]);
