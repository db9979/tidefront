// Datenbankschema (drizzle) – See: Minen, Blockade und Konvois (docs/REGELN-SEE.md).
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei). Alle Tabellen werden am Saisonende
// geleert (packages/engine/src/naval.ts clearNaval). Ablauf über game_event-Typen blockade_end, convoy_raid.
import { index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { base, player } from "./core.ts";

/** Minenfeld auf einem Seefeld. strength sinkt mit jedem Treffer und beim Räumen; verfällt zu expiresAt. */
export const minefield = pgTable("minefield", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  baseId: integer("base_id").references(() => base.id, { onDelete: "cascade" }),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  strength: integer("strength").notNull(),
  /** Höchste je gelegte Stärke (Anzeige „noch x von y“). */
  maxStrength: integer("max_strength").notNull(),
  createdAt: ts("created_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("minefield_expires").on(t.expiresAt), index("minefield_field").on(t.col, t.row)]);

/** Fremde Minenfelder, die ein Spieler kennt (Treffer, Aufklärung, Räumfahrt). Radar wirkt ohne Eintrag. */
export const minefieldKnown = pgTable("minefield_known", {
  minefieldId: integer("minefield_id").notNull().references(() => minefield.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  knownAt: ts("known_at").notNull(),
}, (t) => [uniqueIndex("minefield_known_pk").on(t.minefieldId, t.playerId)]);

/**
 * Seeblockade vor einem fremden Hafen. units: aktueller Blockadeverband (Verluste aus Angriffen bleiben).
 * status active | ended; outcome expired | recalled | broken.
 */
export const blockade = pgTable("blockade", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id").notNull(),
  attackerId: integer("attacker_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  attackerBaseId: integer("attacker_base_id").notNull(),
  targetBaseId: integer("target_base_id").notNull().references(() => base.id, { onDelete: "cascade" }),
  targetPlayerId: integer("target_player_id").notNull(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  units: jsonb("units").notNull(),
  status: text("status").notNull().default("active"),
  outcome: text("outcome"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  endedAt: ts("ended_at"),
}, (t) => [index("blockade_target").on(t.targetBaseId, t.status), index("blockade_mission").on(t.missionId)]);

/**
 * Konvoi: eine Spielerhandel-Lieferung (deliveryId) oder ein Transport (missionId) auf der Route from → to.
 * escort: Geleitschutz (beim Transport der Verband selbst), escortMissionId: Geleitmission beim Handel.
 * cargo: aktuelle Ladung (nach Verlusten). status underway | arrived. events: Abfangversuche (Anzeige).
 */
export const convoy = pgTable("convoy", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  deliveryId: text("delivery_id"),
  missionId: integer("mission_id"),
  senderId: integer("sender_id"),
  recipientId: integer("recipient_id").notNull(),
  recipientBaseId: integer("recipient_base_id").notNull(),
  fromCol: integer("from_col").notNull(),
  fromRow: integer("from_row").notNull(),
  toCol: integer("to_col").notNull(),
  toRow: integer("to_row").notNull(),
  cargo: jsonb("cargo").notNull(),
  escort: jsonb("escort").notNull().default({}),
  escortMissionId: integer("escort_mission_id"),
  /** Geplanter Abfangzeitpunkt des Kartells (null = keiner). */
  cartelAt: ts("cartel_at"),
  events: jsonb("events").notNull().default([]),
  status: text("status").notNull().default("underway"),
  departAt: ts("depart_at").notNull(),
  arriveAt: ts("arrive_at").notNull(),
}, (t) => [
  index("convoy_status").on(t.status, t.arriveAt),
  uniqueIndex("convoy_delivery").on(t.deliveryId),
  index("convoy_mission").on(t.missionId),
]);
