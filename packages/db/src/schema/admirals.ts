// Datenbankschema (drizzle) – Admirale. Zusammengeführt in ../schema.ts.
// Ein Admiral gehört zu Spieler und Stützpunkt (verschwindet mit dem Stützpunkt am Saisonende). Unterwegs ist er,
// solange die Mission in missionId nicht beendet ist (Status der Mission, keine eigene Buchführung bei der Rückkehr).
import { boolean, index, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { base, player } from "./core.ts";

export const admiral = pgTable("admiral", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  baseId: integer("base_id").notNull().references(() => base.id, { onDelete: "cascade" }),
  /** Name aus der Namensliste (game-core ADMIRAL_NAMES), je Spieler eindeutig. */
  name: text("name").notNull(),
  xp: integer("xp").notNull().default(0),
  /** Erste Spezialisierung (beim Ernennen). */
  spec1: text("spec1").notNull(),
  /** Zweite Spezialisierung (ab balance.admirals.secondSpecFromRank wählbar). */
  spec2: text("spec2"),
  /**
   * Landungstrupp: einmalige kostenlose Umschulung der ersten Spezialisierung noch offen. Bestehende
   * Admirale erhalten sie über den Vorgabewert; neu ernannte wählen frei und bekommen false.
   */
  retrainFree: boolean("retrain_free").notNull().default(true),
  /** Hafenkommandant: führt daheim die Verteidigung (höchstens einer je Spieler). */
  stationed: boolean("stationed").notNull().default(false),
  /** Zuletzt geführte Mission; unterwegs, solange sie outbound oder returning ist. */
  missionId: integer("mission_id"),
  woundedUntil: ts("wounded_until"),
  captiveUntil: ts("captive_until"),
  battles: integer("battles").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("admiral_player").on(t.playerId)]);
