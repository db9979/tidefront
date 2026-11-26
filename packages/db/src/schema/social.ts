// Datenbankschema (drizzle) – Soziales und Saison: Nachrichten, Saison, Einladungen, Allianzen, Diplomatie, Handel.
// Zusammengeführt in ../schema.ts (drizzle.config.ts liest nur diese Datei).
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";
import { inviteCode, player } from "./core.ts";

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

/** Allianzwertung zum Saisonende (Ruhmeshalle). */
export const seasonAllianceResult = pgTable("season_alliance_result", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull().references(() => season.id, { onDelete: "cascade" }),
  /** null, wenn die Allianz inzwischen aufgelöst ist. */
  allianceId: integer("alliance_id").references(() => alliance.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  tag: text("tag").notNull(),
  rank: integer("rank").notNull(),
  members: integer("members").notNull(),
  total: integer("total").notNull(),
  /** Spieler-IDs der Mitglieder zum Saisonende (eigene Allianz in der Ruhmeshalle). */
  playerIds: jsonb("player_ids").notNull().default([]),
}, (t) => [uniqueIndex("season_alliance_result_alliance").on(t.seasonId, t.allianceId), index("season_alliance_result_rank").on(t.seasonId, t.rank)]);
