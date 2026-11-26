// Datenbankschema (drizzle) – Felder: Rohstofffelder auf See einnehmen (docs/REGELN-FELDER.md).
// Zusammengeführt in ../schema.ts. Beide Tabellen werden am Saisonende geleert (packages/engine/src/fields-run.ts
// clearFields). Ablauf über game_event-Typen field_tick, field_delivery, field_raid.
import { index, integer, jsonb, pgTable, real, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { base, player } from "./core.ts";
import { alliance } from "./social.ts";

/**
 * Ein aktives Rohstofffeld. siteIndex: Index in der festen Kandidatenliste (fieldSites). Besetzt: ownerId, baseId
 * (Heimathafen, Ziel der Ertragskonvois) und missionId (Besatzung, Mission mit status "stationed"). Neutral: guard
 * ist die Kartell-Wache ({} = keine; guardAt = neue Wache ab).
 */
export const resourceField = pgTable("resource_field", {
  id: serial("id").primaryKey(),
  siteIndex: integer("site_index").notNull(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  kind: text("kind").notNull(),
  tier: integer("tier").notNull(),
  ownerId: integer("player_id").references(() => player.id, { onDelete: "set null" }),
  baseId: integer("base_id").references(() => base.id, { onDelete: "cascade" }),
  missionId: integer("mission_id"),
  guard: jsonb("guard").notNull().default({}),
  guardAt: ts("guard_at"),
  capturedAt: ts("captured_at"),
  /** Bis hierhin ist der Ertrag abgerechnet (Lieferzyklus). */
  lastTickAt: ts("last_tick_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("resource_field_site").on(t.siteIndex), uniqueIndex("resource_field_hex").on(t.col, t.row), index("resource_field_owner").on(t.ownerId)]);

/** Allianzwertung: gesammelte Feldpunkte je Allianz in der laufenden Saison. */
export const fieldScore = pgTable("field_score", {
  allianceId: integer("alliance_id").primaryKey().references(() => alliance.id, { onDelete: "cascade" }),
  points: real("points").notNull().default(0),
});
