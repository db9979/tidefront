// Datenbankschema (drizzle) – Kern: Spieler, Sitzungen, Stützpunkte, Missionen, Kampfberichte, Ereignisse, Wracks.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";

export const player = pgTable("player", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  passHash: text("pass_hash").notNull(),
  /** TraderState der Börse ohne stock (die Bestände liegen im Stützpunkt). */
  trader: jsonb("trader").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Verwaltung: ADMIN_NAMES beim migrate bzw. erster Spieler. */
  isAdmin: boolean("is_admin").notNull().default(false),
  /** Letzte Aktivität (höchstens alle paar Minuten fortgeschrieben). */
  lastSeenAt: ts("last_seen_at"),
}, (t) => [uniqueIndex("player_name_lower").on(sql`lower(${t.name})`)]);

export const session = pgTable("session", {
  token: text("token").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const inviteCode = pgTable("invite_code", {
  code: text("code").primaryKey(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Von der Verwaltung deaktiviert; dann nicht mehr nutzbar. */
  disabledAt: ts("disabled_at"),
});

export const base = pgTable("base", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  /** BaseState aus game-core (Zeitstempel in ms). */
  state: jsonb("state").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Heimathafen des Spielers (genau einer je Spieler, Teil-Unique-Index); weitere Häfen sind Kolonien. */
  isHome: boolean("is_home").notNull().default(false),
}, (t) => [
  uniqueIndex("base_field").on(t.col, t.row),
  uniqueIndex("base_home").on(t.playerId).where(sql`${t.isHome}`),
  index("base_player_idx").on(t.playerId),
]);

export const nest = pgTable("nest", {
  id: serial("id").primaryKey(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  level: integer("level").notNull(),
  defeatedAt: ts("defeated_at"),
}, (t) => [uniqueIndex("nest_field").on(t.col, t.row)]);

export const mission = pgTable("mission", {
  id: serial("id").primaryKey(),
  /** null beim Kartell. */
  playerId: integer("player_id").references(() => player.id, { onDelete: "cascade" }),
  baseId: integer("base_id").references(() => base.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: integer("target_id"),
  targetCol: integer("target_col").notNull(),
  targetRow: integer("target_row").notNull(),
  /** Mission aus game-core bzw. beim Kartell { units, attacker }. */
  plan: jsonb("plan").notNull(),
  status: text("status").notNull(),
  arriveAt: ts("arrive_at").notNull(),
  returnAt: ts("return_at"),
  returning: jsonb("returning"),
  cargoHome: jsonb("cargo_home"),
  reportId: integer("report_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("mission_base_status").on(t.baseId, t.status),
  index("mission_target").on(t.targetKind, t.targetId, t.status),
]);

export const battleReport = pgTable("battle_report", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  attackerPlayerId: integer("attacker_player_id"),
  defenderPlayerId: integer("defender_player_id"),
  attackerBaseId: integer("attacker_base_id"),
  defenderBaseId: integer("defender_base_id"),
  nestId: integer("nest_id"),
  winner: text("winner"),
  seed: bigint("seed", { mode: "number" }),
  balanceVersion: text("balance_version").notNull(),
  report: jsonb("report").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("report_attacker").on(t.attackerPlayerId, t.createdAt),
  index("report_defender").on(t.defenderPlayerId, t.createdAt),
]);

export const gameEvent = pgTable("game_event", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  dueAt: ts("due_at").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  baseId: integer("base_id"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
}, (t) => [
  index("game_event_due").on(t.status, t.dueAt),
  index("game_event_base").on(t.baseId, t.status, t.dueAt),
]);

export const commandLog = pgTable("command_log", {
  key: text("key").primaryKey(),
  playerId: integer("player_id").notNull(),
  command: text("command").notNull(),
  response: jsonb("response"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const wreck = pgTable("wreck", {
  id: serial("id").primaryKey(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  stahl: doublePrecision("stahl").notNull(),
  elektronik: doublePrecision("elektronik").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("wreck_field").on(t.col, t.row)]);

export const auditRun = pgTable("audit_run", {
  id: serial("id").primaryKey(),
  ok: integer("ok").notNull(),
  details: jsonb("details").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
