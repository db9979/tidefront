// Datenbankschema (drizzle) – Messbarkeit (Welle 2, Abschlussprüfung 0.38): Tagesschnappschuss je Hafen, Schrittdauer
// des Workers je Tag, Nutzungszähler je System und Tag. Alles schreibt der Worker (engine/src/metrics.ts,
// worker-steps.ts); gelesen wird nur in der Verwaltung (admin-balance.ts). Bewusst ohne Fremdschlüssel: die Zeilen
// überleben Saisonwechsel und gelöschte Häfen (Zeitreihe über Saisons).
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";

/**
 * Tagesschnappschuss je Hafen (erste Wartungsrunde des Kalendertags in der Spielzeitzone, also Stand zu Tagesbeginn):
 * Bestand, Netto-Produktion je Stunde, Lagerkapazität, Ausbau und Militär. Grundlage der Admin-Karten „Rohstoffbilanz“
 * und „Zuflüsse“ (Produktion je Tag).
 */
export const baseDay = pgTable("base_day", {
  /** Kalendertag in der Spielzeitzone, z. B. 2026-11-27. */
  day: text("day").notNull(),
  baseId: integer("base_id").notNull(),
  playerId: integer("player_id").notNull(),
  /** KI-Spieler (bot_profile gesetzt) – die Verwaltung zeigt Menschen und KI getrennt. */
  bot: boolean("bot").notNull(),
  seasonId: integer("season_id"),
  /** Bestand je Rohstoff (nach settle). */
  resources: jsonb("resources").notNull(),
  /** Netto-Produktion je Stunde und Rohstoff (nach Unterhalt, mit Modifikatoren). */
  perHour: jsonb("per_hour").notNull(),
  capacity: doublePrecision("capacity").notNull(),
  /** Summe aller Gebäudestufen; kz: Stufe der Kommandozentrale. */
  levels: integer("levels").notNull(),
  kz: integer("kz").notNull(),
  /** Wert der Einheiten (daheim und unterwegs) und Anlagen zum Richtpreis. */
  military: doublePrecision("military").notNull(),
  /** Taler des Spielers (nur in der Zeile des Heimathafens, sonst null). */
  credits: doublePrecision("credits"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.day, t.baseId] }), index("base_day_player").on(t.playerId, t.day)]);

/**
 * Schrittdauer des Workers je Tag und Schritt (Wartung alle 10 min, Minutenschritte, KI-Züge, Ereignisse): Läufe,
 * Summe und Höchstwert in ms, Zahl der langsamen Läufe (≥ SLOW_STEP_MS). Der Worker sammelt im Speicher und schreibt
 * nach jeder Wartungsrunde aufaddiert (worker-steps.ts).
 */
export const workerStepDay = pgTable("worker_step_day", {
  day: text("day").notNull(),
  step: text("step").notNull(),
  runs: integer("runs").notNull().default(0),
  totalMs: doublePrecision("total_ms").notNull().default(0),
  maxMs: doublePrecision("max_ms").notNull().default(0),
  slow: integer("slow").notNull().default(0),
  /** Fehlgeschlagene Läufe (Ausnahme im Schritt). */
  errors: integer("errors").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.step] })]);

/**
 * Nutzungszähler je System und Tag aus dem Befehlsprotokoll (command_log, 7 Tage aufbewahrt): verschiedene Spieler und
 * Befehle, Menschen und KI getrennt. Der Worker verdichtet abgeschlossene Tage einmal (metrics.ts); die Zeile
 * system = "gesamt" markiert den Tag als erledigt.
 */
export const usageDay = pgTable("usage_day", {
  day: text("day").notNull(),
  /** z. B. bau, ausbildung, boerse, spielerhandel, vertraege, missionen, felder, lagebild … (metrics.ts SYSTEMS). */
  system: text("system").notNull(),
  humans: integer("humans").notNull().default(0),
  humanUses: integer("human_uses").notNull().default(0),
  bots: integer("bots").notNull().default(0),
  botUses: integer("bot_uses").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.system] })]);
