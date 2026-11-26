// Datenbankschema (drizzle) – Fortschritt und Komfort: Tagesbefehle, Verbandsvorlagen, Morgenbericht, Auftragsbuch.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { player } from "./core.ts";
import { season } from "./social.ts";

// ================================================================ Tagesbefehle (tägliche Herausforderungen)
// Je Spieler und Tag (Tageswechsel 0:00 Uhr in TZ, Vorgabe Europe/Berlin) drei Befehle: Slot 0 leicht, 1 mittel,
// 2 schwer. Vergabe lazy beim ersten Abruf des Tages; der Unique-Index verhindert Doppelvergabe. Fortschritt
// schreibt packages/engine/src/challenges.ts fort. Beide Tabellen werden am Saisonende geleert.

/** Ein Tagesbefehl. reward: Ressourcen; points: Saisonpunkte der Kategorie Befehle. */
export const dailyChallenge = pgTable("daily_challenge", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  /** Kalendertag in der Spielzeitzone, z. B. 2026-11-26. */
  day: text("day").notNull(),
  /** 0 leicht, 1 mittel, 2 schwer. */
  slot: integer("slot").notNull(),
  /** Art aus dem Pool (challenge-pool.ts). */
  kind: text("kind").notNull(),
  /** Zusatz der Art, z. B. Ressource oder Mindeststufe eines Nests. */
  param: text("param"),
  target: integer("target").notNull(),
  progress: integer("progress").notNull().default(0),
  reward: jsonb("reward").notNull(),
  points: integer("points").notNull(),
  /** Serienbonus, gutgeschrieben mit dem letzten abgeholten Befehl eines Tages. */
  bonusPoints: integer("bonus_points").notNull().default(0),
  /** Dieser Befehl wurde neu gewürfelt (höchstens einer je Tag). */
  rerolled: boolean("rerolled").notNull().default(false),
  completedAt: ts("completed_at"),
  claimedAt: ts("claimed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("daily_challenge_slot").on(t.playerId, t.day, t.slot),
  index("daily_challenge_open").on(t.playerId, t.claimedAt),
]);

/** Serie: Anzahl aufeinanderfolgender Tage, an denen alle drei Befehle abgeholt wurden. */
export const dailyStreak = pgTable("daily_streak", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  /** Letzter vollständig abgeschlossener Tag. */
  lastDay: text("last_day").notNull(),
  length: integer("length").notNull(),
  best: integer("best").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ================================================================ Komfort: Verbandsvorlagen und Morgenbericht

/** Gespeicherter Verband eines Spielers (Einheiten und Anzahlen, optional Missionsart); Name je Spieler eindeutig. */
export const formationTemplate = pgTable("formation_template", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Einheit -> Anzahl (nur positive Anzahlen). */
  units: jsonb("units").notNull(),
  /** ueberfall | aufklaerung | transport oder null. */
  missionType: text("mission_type"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("formation_template_name").on(t.playerId, sql`lower(${t.name})`)]);

/** Morgenbericht je Spieler; lastSentDay (JJJJ-MM-TT in timeZone) macht den Versand je Tag idempotent. */
export const morningSummary = pgTable("morning_summary", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Uhrzeit als Minute des Tages (Vorgabe 7:00). */
  minuteOfDay: integer("minute_of_day").notNull().default(420),
  timeZone: text("time_zone").notNull().default("Europe/Berlin"),
  /** Zusätzlich als Push. */
  push: boolean("push").notNull().default(false),
  lastSentDay: text("last_sent_day"),
  lastSentAt: ts("last_sent_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Erledigte Aufträge und Lieferungen für den Morgenbericht (nur bei aktiviertem Bericht, 3 Tage aufbewahrt). */
export const summaryEntry = pgTable("summary_entry", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("summary_entry_player").on(t.playerId, t.createdAt)]);

// ================================================================ Auftragsbuch: abgeholte Belohnungen
// Je Spieler, Saison und Auftrag eine Zeile (step = Schritt-ID oder "final" für die Abschlussbelohnung).
// Durch season_id bleibt jede Saison getrennt; in einer neuen Saison sind alle Aufträge wieder offen.
// boost_used_at (nur bei "final"): wann die einmalige Bauzeitverkürzung angewendet wurde; null = steht noch aus.

export const guideClaim = pgTable("guide_claim", {
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => season.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  claimedAt: ts("claimed_at").notNull().defaultNow(),
  boostUsedAt: ts("boost_used_at"),
}, (t) => [uniqueIndex("guide_claim_pk").on(t.playerId, t.seasonId, t.step)]);
