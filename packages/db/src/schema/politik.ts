// Datenbankschema (drizzle) – Weltpolitik (docs/REGELN-WELTPOLITIK.md): Gezeit-Fenster und Wochenbeschlüsse,
// Seerat (Sitzungen, geheime Stimmen), Gesuche der KI-Spieler und Merker für das Ansehen. Zusammengeführt in
// ../schema.ts. Alles hängt an season_id; nichts wird am Saisonende gelöscht (die nächste Saison hat neue Zeilen).
// Bewusst ohne Fremdschlüssel auf player (Sperrreihenfolge, gelöschte Konten): Zeilen gelöschter Spieler bleiben stumm.
import { bigint, index, integer, jsonb, pgTable, primaryKey, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";

/**
 * Ein Wirkungsfenster der Saison. slot gezeit: eines der 3 Gezeit-Fenster (plan_kind = ausgewürfelte Art, good beim
 * Rohstoffboom); slot woche: Wirkzeit eines Wochenbeschlusses. effect = was tatsächlich gilt: die Gezeit-Art, ein
 * Beschluss oder "ruhig" (nichts). source: plan | seerat | admin (Not-Aus).
 */
export const politikFenster = pgTable("politik_fenster", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull(),
  slot: text("slot").notNull(),
  idx: integer("idx").notNull(),
  planKind: text("plan_kind"),
  good: text("good"),
  effect: text("effect").notNull(),
  source: text("source").notNull().default("plan"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  /** Beginn verarbeitet (Push, Marktnachricht). */
  startedAt: ts("started_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("politik_fenster_slot").on(t.seasonId, t.slot, t.idx), index("politik_fenster_zeit").on(t.startsAt, t.endsAt)]);

/**
 * Sitzung des Seerats zu einem Fenster. options: Knöpfe ("plan", Beschlüsse, "ruhig"). status: geplant | offen |
 * geschlossen | ausgesetzt (Not-Aus). result: gewählte Option; tally: Gewichte, Stimmenzahl, KI-Stimmen, Quorum.
 */
export const seeratSitzung = pgTable("seerat_sitzung", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull(),
  fensterId: integer("fenster_id").notNull().references(() => politikFenster.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  options: jsonb("options").notNull(),
  status: text("status").notNull().default("geplant"),
  opensAt: ts("opens_at").notNull(),
  closesAt: ts("closes_at").notNull(),
  result: text("result"),
  tally: jsonb("tally"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("seerat_sitzung_fenster").on(t.fensterId), index("seerat_sitzung_zeit").on(t.opensAt)]);

/** Geheime Stimme eines Menschen (Ergebnis zeigt nur Summen). */
export const seeratStimme = pgTable("seerat_stimme", {
  sitzungId: integer("sitzung_id").notNull().references(() => seeratSitzung.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull(),
  option: text("option").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sitzungId, t.playerId] })]);

/**
 * Gesuch eines KI-Spielers an einen Menschen (je Spieler höchstens eines je Spieltag, day = Spieltag). kind: liefern
 * (geleit/feld vorbereitet). status: angeboten | angenommen | erfuellt | gescheitert | abgelehnt | verfallen.
 * reward: Lohn (Waren), beim Anbieten aus dem Lager der KI abgezogen (Treuhand); value: Lohn zum Richtwert.
 * contract_id: der Liefervertrag nach der Annahme; challenge_id: belegter Tagesbefehl-Platz.
 */
export const kiGesuch = pgTable("ki_gesuch", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull(),
  playerId: integer("player_id").notNull(),
  kiId: integer("ki_id").notNull(),
  day: text("day").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  resource: text("resource").notNull(),
  qty: integer("qty").notNull(),
  reward: jsonb("reward").notNull(),
  value: integer("value").notNull(),
  contractId: integer("contract_id"),
  challengeId: integer("challenge_id"),
  offeredAt: ts("offered_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  closedAt: ts("closed_at"),
}, (t) => [
  uniqueIndex("ki_gesuch_tag").on(t.seasonId, t.playerId, t.day),
  index("ki_gesuch_status").on(t.status, t.expiresAt),
  index("ki_gesuch_ki").on(t.kiId, t.day),
]);

/**
 * Merker für das Ansehen, die sich nicht aus vorhandenen Zeilen ablesen lassen (Pakt mit einem KI-Spieler gekündigt:
 * at_ms = Erlöschen). Das Ansehen selbst wird beim Lesen aus Verträgen, Gesuchen, Berichten und diesen Merkern gerechnet.
 * Stufe 2 (globaler Ruf, Ächtung) nutzt dieselbe Tabelle mit ki_id = 0 (kein KI-Spieler): kind ruf_pakt_ende (Pakt mit
 * einem Menschen gekündigt, at_ms = Erlöschen, ref = "pakt:<id>:<Erlöschen>:<Partei>") und kind aechtung (at_ms = Beginn,
 * ref = "sitzung:<id>:<Ende ms>"). Keine Schemaänderung.
 */
export const ansehenMerker = pgTable("ansehen_merker", {
  id: serial("id").primaryKey(),
  seasonId: integer("season_id").notNull(),
  playerId: integer("player_id").notNull(),
  kiId: integer("ki_id").notNull(),
  kind: text("kind").notNull(),
  atMs: bigint("at_ms", { mode: "number" }).notNull(),
  ref: text("ref").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ansehen_merker_ref").on(t.playerId, t.kiId, t.kind, t.ref), index("ansehen_merker_player").on(t.seasonId, t.playerId)]);
