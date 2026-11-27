// Datenbankschema (drizzle) – Erfolge (dauerhafte Abzeichen über Saisons) und Wochenziele.
// Zusammengeführt in ../schema.ts. Fortschritt schreibt packages/engine/src/achievements.ts fort
// (Erweiterungsstelle recordAchievement); diese Tabellen werden am Saisonende NICHT geleert.
import { bigint, index, integer, jsonb, pgTable, primaryKey, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { player } from "./core.ts";

/** Dauerhafter Zähler je Spieler (z. B. nester, beute, spionage). Saisonübergreifend. */
export const achievementCounter = pgTable("achievement_counter", {
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  counter: text("counter").notNull(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.counter] })]);

/**
 * Freigeschaltete Stufe eines Erfolgs (tier 1 Bronze, 2 Silber, 3 Gold). Der Unique-Index macht die
 * Freischaltung idempotent; reward wird bei der Freischaltung festgeschrieben, claimedAt genau einmal gesetzt.
 * notifiedAt: Push an den Spieler versandt (der Worker holt offene Zeilen nach).
 */
export const achievementTier = pgTable("achievement_tier", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  achievementId: text("achievement_id").notNull(),
  tier: integer("tier").notNull(),
  /** { credits?, stahl?, treibstoff?, elektronik?, proviant? } */
  reward: jsonb("reward").notNull(),
  unlockedAt: ts("unlocked_at").notNull().defaultNow(),
  claimedAt: ts("claimed_at"),
  notifiedAt: ts("notified_at"),
}, (t) => [
  uniqueIndex("achievement_tier_unique").on(t.playerId, t.achievementId, t.tier),
  index("achievement_tier_notify").on(t.notifiedAt),
]);

/**
 * Wochenziel: drei je Spieler und Woche (Montag 0:00 Uhr Europe/Berlin bis Sonntag). week = Montag als
 * JJJJ-MM-TT. Vergabe lazy und deterministisch; Unique-Index verhindert Doppelvergabe. bonus: Wochenbonus,
 * gutgeschrieben mit dem letzten der drei abgeholten Ziele (einmal je Woche).
 */
export const weeklyGoal = pgTable("weekly_goal", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  week: text("week").notNull(),
  slot: integer("slot").notNull(),
  kind: text("kind").notNull(),
  /** Zusatz, z. B. Mindeststufe eines Nests. */
  param: text("param"),
  target: integer("target").notNull(),
  progress: integer("progress").notNull().default(0),
  /** Ressourcen und Taler (credits). */
  reward: jsonb("reward").notNull(),
  bonus: jsonb("bonus"),
  completedAt: ts("completed_at"),
  claimedAt: ts("claimed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("weekly_goal_slot").on(t.playerId, t.week, t.slot),
  index("weekly_goal_open").on(t.playerId, t.claimedAt),
]);
