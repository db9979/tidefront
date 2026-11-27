// Datenbankschema (drizzle) – Lagebild (docs/REGELN-LAGEBILD.md): gespeichertes Wissen über fremde Objekte.
// Zusammengeführt in ../schema.ts. Geschrieben beim Abruf der Karte (Live-Sicht, höchstens alle cacheSeconds je Partei)
// und bei Missionsankünften (Aufklärung, Kampfberichte = Lagebild); der Worker löscht Einträge älter als forgetHours.
import { boolean, index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { base, player } from "./core.ts";

/**
 * Eine Angabe je Partei und Objekt. owner: Partei wie in der Diplomatie ("p:<Spieler>" oder "a:<Allianz>");
 * kind: base | nest | field | wreck | fleet; objectId: ID des Objekts (fleet: Missions-ID);
 * level: sichtung | erkennung | lagebild; source: Anzeigetext der Quelle („Radar Hafen X“, „Aufklärung“);
 * data: Stand des Objekts zum Zeitpunkt seenAt (je Art, siehe packages/engine/src/intel-store.ts).
 */
export const intelSighting = pgTable("intel_sighting", {
  id: serial("id").primaryKey(),
  owner: text("owner").notNull(),
  kind: text("kind").notNull(),
  objectId: integer("object_id").notNull(),
  level: text("level").notNull(),
  source: text("source").notNull(),
  seenAt: ts("seen_at").notNull(),
  data: jsonb("data").notNull().default({}),
}, (t) => [
  uniqueIndex("intel_sighting_key").on(t.owner, t.kind, t.objectId),
  index("intel_sighting_seen").on(t.seenAt),
]);

/**
 * Lagebild Stufe 2: mobile Radarstation (Radarposten) auf einem Küstenfeld oder eigenen Rohstofffeld. Gehört einem
 * Hafen (baseId: zahlt den Treibstoff, nimmt die Besatzung beim Abbau auf); missionId: Besatzung (Mission „radarposten“
 * mit Status "stationed"). offline: zuletzt ohne Treibstoff (keine Reichweite). Zerstört oder abgebaut: Zeile gelöscht.
 */
export const radarPost = pgTable("radar_post", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  baseId: integer("base_id").notNull().references(() => base.id, { onDelete: "cascade" }),
  missionId: integer("mission_id"),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  fieldId: integer("field_id"),
  crew: jsonb("crew").notNull().default({}),
  offline: boolean("offline").notNull().default(false),
  lastTickAt: ts("last_tick_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("radar_post_player").on(t.playerId),
  uniqueIndex("radar_post_hex").on(t.col, t.row),
]);
