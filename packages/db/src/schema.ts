import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

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
}, (t) => [uniqueIndex("base_field").on(t.col, t.row), uniqueIndex("base_player").on(t.playerId)]);

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

export const market = pgTable("market", {
  resource: text("resource").primaryKey(),
  state: jsonb("state").notNull(),
});

/** Journal der Börse; wird nur fortgeschrieben. */
export const tradeLedger = pgTable("trade_ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tradeId: text("trade_id").notNull(),
  tMs: bigint("t_ms", { mode: "number" }).notNull(),
  account: text("account").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount", { precision: 24, scale: 2 }).notNull(),
}, (t) => [index("ledger_account").on(t.account, t.asset), index("ledger_trade").on(t.tradeId)]);

export const delivery = pgTable("delivery", {
  id: text("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  baseId: integer("base_id").notNull(),
  resource: text("resource").notNull(),
  qty: integer("qty").notNull(),
  departAt: ts("depart_at").notNull(),
  arriveAt: ts("arrive_at").notNull(),
  status: text("status").notNull().default("underway"),
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

// ================================================================ Soziales und Saison (Punkte 5 und 6)

/** Nachricht zwischen Spielern; fromPlayerId null = Systemnachricht (z. B. Saisonende). */
export const message = pgTable("message", {
  id: serial("id").primaryKey(),
  fromPlayerId: integer("from_player_id").references(() => player.id, { onDelete: "set null" }),
  toPlayerId: integer("to_player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  readAt: ts("read_at"),
}, (t) => [
  index("message_to").on(t.toPlayerId, t.createdAt),
  index("message_from").on(t.fromPlayerId, t.createdAt),
]);

/** Saison: genau eine läuft (status running), ihr Ende ist als Ereignis season_end geplant. */
export const season = pgTable("season", {
  id: serial("id").primaryKey(),
  number: integer("number").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  /** running | finished */
  status: text("status").notNull().default("running"),
  finishedAt: ts("finished_at"),
}, (t) => [uniqueIndex("season_number").on(t.number)]);

/** Endstand eines Spielers in einer beendeten Saison. */
export const seasonResult = pgTable("season_result", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => season.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  /** Name zum Saisonende. */
  playerName: text("player_name").notNull(),
  rank: integer("rank").notNull(),
  ausbau: integer("ausbau").notNull(),
  militaer: integer("militaer").notNull(),
  kampf: integer("kampf").notNull(),
  beute: integer("beute").notNull(),
  /** Punkte aus Tagesbefehlen (siehe Abschnitt Tagesbefehle). */
  befehle: integer("befehle").notNull().default(0),
  total: integer("total").notNull(),
  /** Auszeichnungen: gold, silber, bronze, best_ausbau, best_militaer, best_kampf, best_beute, best_befehle. */
  awards: jsonb("awards").notNull(),
}, (t) => [
  uniqueIndex("season_result_player").on(t.seasonId, t.playerId),
  index("season_result_rank").on(t.seasonId, t.rank),
]);
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

// ---------------------------------------------------------------- Freunde einladen (persönliche Einladungen)

/**
 * Persönliche Einladung eines Spielers (per E-Mail oder als geteilter Link). Der Code selbst liegt als
 * einmaliger Eintrag in invite_code (max_uses 1); Zurückziehen setzt dort zusätzlich disabled_at.
 */
export const playerInvite = pgTable("player_invite", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().references(() => inviteCode.code, { onDelete: "cascade" }),
  inviterId: integer("inviter_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  /** email | link */
  channel: text("channel").notNull(),
  /** Adresse des Freundes (nur bei channel email). */
  email: text("email"),
  /** Name des Freundes (optional, Anrede und Übersicht). */
  friendName: text("friend_name"),
  /** Persönliche Nachricht (höchstens 500 Zeichen). */
  message: text("message"),
  /** Token für „Keine Einladungen mehr an diese Adresse“ (nur bei channel email). */
  blockToken: text("block_token"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  /** Letzter Versand der Mail („erneut senden“ frühestens 24 h danach). */
  sentAt: ts("sent_at"),
  sendCount: integer("send_count").notNull().default(0),
  revokedAt: ts("revoked_at"),
  acceptedAt: ts("accepted_at"),
  acceptedPlayerId: integer("accepted_player_id").references(() => player.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("player_invite_code").on(t.code),
  uniqueIndex("player_invite_block").on(t.blockToken),
  index("player_invite_inviter").on(t.inviterId, t.createdAt),
  index("player_invite_email").on(sql`lower(${t.email})`),
  index("player_invite_accepted").on(t.acceptedPlayerId),
]);

/** Adressen, die keine Einladungen mehr wollen; nur als SHA-256 der kleingeschriebenen Adresse. */
export const inviteBlock = pgTable("invite_block", {
  emailHash: text("email_hash").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ================================================================ Tagesbefehle (tägliche Herausforderungen)
// Je Spieler und Tag (Tageswechsel 0:00 Uhr in TZ, Vorgabe Europe/Berlin) drei Befehle: Slot 0 leicht, 1 mittel,
// 2 schwer. Vergabe lazy beim ersten Abruf des Tages; der Unique-Index verhindert Doppelvergabe. Fortschritt
// schreibt packages/engine/src/challenges.ts fort. Beide Tabellen werden am Saisonende geleert.

/** Ein Tagesbefehl. reward: Ressourcen; points: Saisonpunkte der Kategorie Befehle. */
export const dailyChallenge = pgTable("daily_challenge", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  /** Kalendertag in der Spielzeitzone, z. B. 2026-11-26. */
  day: text("day").notNull(),
  /** 0 leicht, 1 mittel, 2 schwer. */
  slot: integer("slot").notNull(),
  /** Art aus dem Pool (challenge-pool.ts). */
  kind: text("kind").notNull(),
  /** Zusatz der Art, z. B. Ressource oder Mindeststufe eines Nests. */
  param: text("param"),
  target: integer("target").notNull(),
  progress: integer("progress").notNull().default(0),
  reward: jsonb("reward").notNull(),
  points: integer("points").notNull(),
  /** Serienbonus, gutgeschrieben mit dem letzten abgeholten Befehl eines Tages. */
  bonusPoints: integer("bonus_points").notNull().default(0),
  /** Dieser Befehl wurde neu gewürfelt (höchstens einer je Tag). */
  rerolled: boolean("rerolled").notNull().default(false),
  completedAt: ts("completed_at"),
  claimedAt: ts("claimed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("daily_challenge_slot").on(t.playerId, t.day, t.slot),
  index("daily_challenge_open").on(t.playerId, t.claimedAt),
]);

/** Serie: Anzahl aufeinanderfolgender Tage, an denen alle drei Befehle abgeholt wurden. */
export const dailyStreak = pgTable("daily_streak", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  /** Letzter vollständig abgeschlossener Tag. */
  lastDay: text("last_day").notNull(),
  length: integer("length").notNull(),
  best: integer("best").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ================================================================ Sicherungen in der Verwaltung (Herunterladen, „Jetzt sichern“)

/**
 * Auftrag „Jetzt sichern“ aus der Verwaltung. Die API hat keinen Docker-Zugriff: scripts/backup.sh (backup-Dienst)
 * prüft jede Minute auf offene Aufträge, führt pg_dump aus (Datei tidefront-…-manuell.dump) und setzt den Status.
 */
export const backupRequest = pgTable("backup_request", {
  id: serial("id").primaryKey(),
  requestedBy: integer("requested_by").references(() => player.id, { onDelete: "set null" }),
  /** pending | running | done | failed */
  status: text("status").notNull().default("pending"),
  /** Dateiname der fertigen Sicherung. */
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

// ================================================================ Komfort: Verbandsvorlagen und Morgenbericht

/** Gespeicherter Verband eines Spielers (Einheiten und Anzahlen, optional Missionsart); Name je Spieler eindeutig. */
export const formationTemplate = pgTable("formation_template", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Einheit -> Anzahl (nur positive Anzahlen). */
  units: jsonb("units").notNull(),
  /** ueberfall | aufklaerung | transport oder null. */
  missionType: text("mission_type"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("formation_template_name").on(t.playerId, sql`lower(${t.name})`)]);

/** Morgenbericht je Spieler; lastSentDay (JJJJ-MM-TT in timeZone) macht den Versand je Tag idempotent. */
export const morningSummary = pgTable("morning_summary", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Uhrzeit als Minute des Tages (Vorgabe 7:00). */
  minuteOfDay: integer("minute_of_day").notNull().default(420),
  timeZone: text("time_zone").notNull().default("Europe/Berlin"),
  /** Zusätzlich als Push. */
  push: boolean("push").notNull().default(false),
  lastSentDay: text("last_sent_day"),
  lastSentAt: ts("last_sent_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Erledigte Aufträge und Lieferungen für den Morgenbericht (nur bei aktiviertem Bericht, 3 Tage aufbewahrt). */
export const summaryEntry = pgTable("summary_entry", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("summary_entry_player").on(t.playerId, t.createdAt)]);

// ================================================================ Allianzen, Diplomatie, Handel zwischen Spielern
// Allianzen und Verträge überdauern das Saisonende; offene Handelsangebote verfallen dort (Treuhand an season:<n>).

/** Allianz; Name und Kürzel (2–4 Zeichen) eindeutig ohne Groß-/Kleinschreibung. */
export const alliance = pgTable("alliance", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tag: text("tag").notNull(),
  description: text("description").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("alliance_name_lower").on(sql`lower(${t.name})`), uniqueIndex("alliance_tag_lower").on(sql`lower(${t.tag})`)]);

/** Mitgliedschaft; ein Spieler gehört höchstens einer Allianz an. role: fuehrung | offizier | mitglied. */
export const allianceMember = pgTable("alliance_member", {
  playerId: integer("player_id").primaryKey().references(() => player.id, { onDelete: "cascade" }),
  allianceId: integer("alliance_id").notNull().references(() => alliance.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  joinedAt: ts("joined_at").notNull().defaultNow(),
}, (t) => [index("alliance_member_alliance").on(t.allianceId)]);

/** Offene Einladung (von der Allianz) oder Beitrittsanfrage (vom Spieler). kind: einladung | anfrage. */
export const allianceRequest = pgTable("alliance_request", {
  id: serial("id").primaryKey(),
  allianceId: integer("alliance_id").notNull().references(() => alliance.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  createdBy: integer("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("alliance_request_pair").on(t.allianceId, t.playerId), index("alliance_request_player").on(t.playerId)]);

/** Allianz-Chat; playerId null, wenn der Absender gelöscht ist. */
export const allianceChat = pgTable("alliance_chat", {
  id: serial("id").primaryKey(),
  allianceId: integer("alliance_id").notNull().references(() => alliance.id, { onDelete: "cascade" }),
  playerId: integer("player_id").references(() => player.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("alliance_chat_alliance").on(t.allianceId, t.createdAt)]);

/**
 * Vertrag zwischen zwei Parteien ("a:<allianz>" oder "p:<spieler ohne Allianz>"), partyA < partyB.
 * kind pakt: status angeboten | aktiv, endsAt = Ende nach Kündigung. kind krieg: status aktiv, gilt ab activeFrom;
 * peaceBy = Partei, die Frieden angeboten hat.
 */
export const diplomacy = pgTable("diplomacy", {
  id: serial("id").primaryKey(),
  partyA: text("party_a").notNull(),
  partyB: text("party_b").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  proposedBy: text("proposed_by").notNull(),
  activeFrom: ts("active_from"),
  endsAt: ts("ends_at"),
  peaceBy: text("peace_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("diplomacy_pair").on(t.partyA, t.partyB, t.kind), index("diplomacy_b").on(t.partyB)]);

/**
 * Handelsangebot zwischen Spielern: gibt giveQty von give (Ressource oder credits), will wantQty von want.
 * Die Ware liegt ab dem Einstellen in Treuhand (Journal-Konto escrow:po-<id>).
 * status: open | accepted | cancelled | expired. visibility: public | alliance.
 */
export const playerOffer = pgTable("player_offer", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  give: text("give").notNull(),
  giveQty: integer("give_qty").notNull(),
  want: text("want").notNull(),
  wantQty: integer("want_qty").notNull(),
  visibility: text("visibility").notNull(),
  /** Allianz des Anbieters beim Einstellen (für visibility alliance). */
  allianceId: integer("alliance_id"),
  status: text("status").notNull().default("open"),
  buyerId: integer("buyer_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
}, (t) => [index("player_offer_status").on(t.status, t.createdAt), index("player_offer_seller").on(t.sellerId, t.status)]);

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
