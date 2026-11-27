// Datenbankschema (drizzle) – Betrieb und Verwaltung: Einstellungen, Push, E-Mail, Sicherungen, Fehlermeldungen.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { bigint, index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts, bytea } from "./columns.ts";
import { player } from "./core.ts";

// ---------------------------------------------------------------- Betrieb, Verwaltung, Benachrichtigungen

/** Schlüssel-Wert-Einstellungen des Servers (VAPID-Schlüssel, SMTP, Versandzustand). */
export const serverSetting = pgTable("server_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Web-Push-Abo je Gerät; prefs: Art -> an/aus. */
export const pushSubscription = pgTable("push_subscription", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  prefs: jsonb("prefs").notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("push_subscription_endpoint").on(t.endpoint), index("push_subscription_player").on(t.playerId)]);

/** Einmalige Rücksetzcodes (Verwaltung oder E-Mail-Link), nur als SHA-256 gespeichert. */
export const passwordReset = pgTable("password_reset", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  /** admin | email */
  via: text("via").notNull(),
  createdBy: integer("created_by"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("password_reset_hash").on(t.codeHash), index("password_reset_player").on(t.playerId)]);

/** Erfolgreiche Sicherungen; schreibt scripts/backup.sh nach jedem pg_dump. */
export const backupRun = pgTable("backup_run", {
  id: serial("id").primaryKey(),
  file: text("file").notNull(),
  bytes: bigint("bytes", { mode: "number" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** E-Mail-Adresse eines Spielers mit Bestätigung, Einstellungen je Art und Abmelde-Token. */
export const playerEmail = pgTable("player_email", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  verifiedAt: ts("verified_at"),
  verifyHash: text("verify_hash"),
  verifyExpiresAt: ts("verify_expires_at"),
  /** Art -> an/aus für E-Mail. */
  prefs: jsonb("prefs").notNull().default({}),
  /** Abmelden ohne Anmeldung (Link in jeder Mail). */
  unsubscribeToken: text("unsubscribe_token").notNull(),
  lastDigestAt: ts("last_digest_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("player_email_unsub").on(t.unsubscribeToken)]);

/** Gesammelte Meldungen für die gebündelte E-Mail (Bau, Ausbildung). */
export const mailDigest = pgTable("mail_digest", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
}, (t) => [index("mail_digest_open").on(t.sentAt, t.playerId)]);

// ================================================================ Sicherungen in der Verwaltung (Herunterladen, „Jetzt sichern“)

/**
 * Auftrag „Jetzt sichern“ aus der Verwaltung. Die API hat keinen Docker-Zugriff: scripts/backup.sh (backup-Dienst)
 * prüft jede Minute auf offene Aufträge, führt pg_dump aus (Datei tidefront-…-manuell.dump) und setzt den Status.
 */
export const backupRequest = pgTable("backup_request", {
  id: serial("id").primaryKey(),
  requestedBy: integer("requested_by").references(() => player.id, { onDelete: "set null" }),
  /** backup (Jetzt sichern) | delete (Sicherung „file“ löschen; das API-Verzeichnis ist schreibgeschützt) */
  kind: text("kind").notNull().default("backup"),
  /** pending | running | done | failed */
  status: text("status").notNull().default("pending"),
  /** Dateiname der fertigen bzw. zu löschenden Sicherung. */
  file: text("file"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
}, (t) => [index("backup_request_status").on(t.status, t.id)]);

/** Einmaliges Download-Token für eine Sicherung (nur als SHA-256), 60 Sekunden gültig, an Admin und Datei gebunden. */
export const backupDownloadToken = pgTable("backup_download_token", {
  tokenHash: text("token_hash").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  file: text("file").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ================================================================ Fehlermeldungen
// „Fehler melden“ im Spiel: Beschreibung, automatische Angaben (Version, Bildschirm, Browser), Client-Log und
// Screenshot (JPEG/WebP, höchstens ~1,2 MB). Die Verwaltung sieht die Liste und schaltet den Status um.

export const bugReport = pgTable("bug_report", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => player.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  /** Automatische Angaben: Version, Build, Bildschirm, Browser, Fenstergröße, Spielername, Zeit. */
  meta: jsonb("meta").notNull().default({}),
  log: text("log").notNull().default(""),
  screenshot: bytea("screenshot"),
  /** MIME-Typ des Screenshots (image/jpeg, image/webp, image/png). */
  screenshotType: text("screenshot_type"),
  /** offen | erledigt */
  status: text("status").notNull().default("offen"),
  /** E-Mail an die Verwaltung verschickt (null = nicht eingerichtet oder fehlgeschlagen). */
  mailedAt: ts("mailed_at"),
}, (t) => [index("bug_report_player").on(t.playerId, t.createdAt), index("bug_report_status").on(t.status, t.id)]);
