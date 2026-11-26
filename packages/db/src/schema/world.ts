// Datenbankschema (drizzle) – Weltereignisse des Freibeuter-Kartells.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { player } from "./core.ts";

// ================================================================ Weltereignisse des Freibeuter-Kartells
// Schatzschiff, Großflotte und Belagerung (REGELN.md, Abschnitt Weltereignisse). Ablauf über game_event-Typen
// world_event_spawn/_move/_attack/_end (packages/engine/src/world-events*.ts). Beide Tabellen werden am
// Saisonende geleert.

/** Ein Weltereignis. units: aktueller Kartellverband (Verluste bleiben bestehen). */
export const worldEvent = pgTable("world_event", {
  id: serial("id").primaryKey(),
  /** schatzschiff | grossflotte | belagerung */
  kind: text("kind").notNull(),
  /** announced (Großflotte vor dem Auslaufen) | active | ended */
  status: text("status").notNull(),
  /** Bei ended: defeated | escaped | expired | withdrawn. */
  outcome: text("outcome"),
  seasonId: integer("season_id"),
  /** Aktuelles Feld (Schatzschiff: zuletzt fortgeschrieben, Großflotte: Sammelpunkt bzw. letzter Hafen). */
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  /** Belagerter Hafen (nur Belagerung). */
  targetBaseId: integer("target_base_id"),
  units: jsonb("units").notNull(),
  initialUnits: jsonb("initial_units").notNull(),
  /** Route, Ziele, Beute bzw. Beutepool, ausgezahlte Beute (je Art, siehe world-events.ts). */
  data: jsonb("data").notNull(),
  startsAt: ts("starts_at").notNull(),
  /** Großflotte: Ende der Ankündigung (Auslaufen); sonst = startsAt. */
  activeAt: ts("active_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  winnerPlayerId: integer("winner_player_id").references(() => player.id, { onDelete: "set null" }),
  endedAt: ts("ended_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("world_event_status").on(t.status, t.endsAt), index("world_event_target").on(t.targetBaseId, t.status)]);

/** Beitrag eines Spielers zu einem Ereignis: vernichtete Lebenspunkte, Beute, Angriffe. */
export const worldEventDamage = pgTable("world_event_damage", {
  eventId: integer("event_id").notNull().references(() => worldEvent.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  hp: integer("hp").notNull().default(0),
  loot: jsonb("loot").notNull().default({}),
  attacks: integer("attacks").notNull().default(0),
}, (t) => [uniqueIndex("world_event_damage_pk").on(t.eventId, t.playerId)]);
