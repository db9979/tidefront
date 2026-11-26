// Datenbankschema (drizzle) – Allianz-Ops: Sammelangriffe einer Allianz und ihre Teilnehmer.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
// Die Verbände selbst sind Missionen (Tabelle mission): Teilnehmer eines Sammelangriffs mit Status "staged" bis zum
// Auslaufen (plan.allianceRaidId), Stationierungen mit Typ "stationierung" und Status "stationed" (packages/engine/src/
// alliance-ops*.ts). Beide Tabellen werden am Saisonende geleert.
import { index, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { player } from "./core.ts";

/** Ein Sammelangriff. status: offen | ausgelaufen | beendet | abgebrochen | verfallen. */
export const allianceRaid = pgTable("alliance_raid", {
  id: serial("id").primaryKey(),
  /** Allianz beim Eröffnen (kein Fremdschlüssel: beim Auflösen bricht der Server den Angriff selbst ab). */
  allianceId: integer("alliance_id").notNull(),
  creatorPlayerId: integer("creator_player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  /** base | nest | event */
  targetKind: text("target_kind").notNull(),
  targetId: integer("target_id").notNull(),
  targetCol: integer("target_col").notNull(),
  targetRow: integer("target_row").notNull(),
  targetName: text("target_name").notNull(),
  /** Gewünschte Ankunft; die tatsächliche (arriveAt) richtet sich nach dem langsamsten Verband. */
  desiredArriveAt: ts("desired_arrive_at").notNull(),
  /** Beitrittsfrist = frühestes Auslaufen der Verbände. */
  joinDeadline: ts("join_deadline").notNull(),
  arriveAt: ts("arrive_at"),
  status: text("status").notNull(),
  reportId: integer("report_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("alliance_raid_alliance").on(t.allianceId, t.status)]);

/** Teilnehmer eines Sammelangriffs: je Spieler ein Verband (Mission). Rückzug vor dem Auslaufen löscht die Zeile. */
export const allianceRaidMember = pgTable("alliance_raid_member", {
  id: serial("id").primaryKey(),
  raidId: integer("raid_id").notNull().references(() => allianceRaid.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  missionId: integer("mission_id").notNull(),
  joinedAt: ts("joined_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("alliance_raid_member_once").on(t.raidId, t.playerId), index("alliance_raid_member_player").on(t.playerId)]);
