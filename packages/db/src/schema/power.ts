// Datenbankschema (drizzle) – Seekabel / Stromverbund (v1.21, docs/REGELN-STROM.md).
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei). Die Tabelle wird am Saisonende geleert
// (season.ts). Ablauf über game_event cable_tick (packages/engine/src/power-cable.ts); der Zustand des Netzes
// (gesendet, Kabelpuffer) steht in base.state.cable.
import { doublePrecision, index, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { base, player } from "./core.ts";

/**
 * Kabel von einem abgebenden Hafen (from) zu einem empfangenden (to). status: angefragt (fremder Hafen, wartet auf
 * Zustimmung des Empfängers) oder aktiv. price: Kredite je gelieferter Strom-Stunde (0 = Allianzhilfe, eigene Häfen
 * immer 0). Wird ein Hafen gelöscht, wird die Seite null und die nächste Abrechnung trennt das Kabel.
 */
export const powerCable = pgTable("power_cable", {
  id: serial("id").primaryKey(),
  fromBaseId: integer("from_base_id").references(() => base.id, { onDelete: "set null" }),
  toBaseId: integer("to_base_id").references(() => base.id, { onDelete: "set null" }),
  fromPlayerId: integer("from_player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  toPlayerId: integer("to_player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  price: doublePrecision("price").notNull().default(0),
  distanceKm: doublePrecision("distance_km").notNull(),
  createdAt: ts("created_at").notNull(),
  activeSince: ts("active_since"),
  lastTickAt: ts("last_tick_at"),
  /** Summen seit Inbetriebnahme: angekommen, unterwegs verloren bzw. verfallen, bezahlt (Kredite). */
  delivered: doublePrecision("delivered").notNull().default(0),
  lost: doublePrecision("lost").notNull().default(0),
  paid: doublePrecision("paid").notNull().default(0),
}, (t) => [index("power_cable_from").on(t.fromBaseId), index("power_cable_to").on(t.toBaseId)]);
