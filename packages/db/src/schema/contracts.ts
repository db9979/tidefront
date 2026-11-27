// Datenbankschema (drizzle) – Lieferverträge (Termingeschäfte, seit v1.31; Kern packages/game-core/src/market/contracts.ts,
// Server packages/engine/src/contracts-*.ts). Zusammengeführt in ../schema.ts.
import { bigint, index, integer, jsonb, pgTable, serial, text, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { ts } from "./columns.ts";

/**
 * Ein Liefervertrag bzw. eine Abo-Tranche (abo_id = id der ersten Tranche). Gegenpartei ist eine KI (kind "ki") oder ein
 * Mensch (kind "spieler"). Beträge in ganzen Cent. Treuhand: Anzahlung des Käufers bzw. voller Preis der KI-Käuferin
 * (buyer_deposit_cents), Pfand des Verkäufers (seller_pledge_cents), Ware der KI-Verkäuferin (escrow_qty), gebucht im
 * Journal auf escrow:mc-<id>. Fälligkeiten laufen als Ereignis contract_due (Schritte remind, settle, grace, expire).
 *
 * status: angeboten (Spielerangebot wartet) | offen | nachfrist | erfuellt | teilweise | geplatzt (nichts erfüllt) |
 * gekuendigt | zurueckgezogen | abgelaufen (Angebot) | rueckabgewickelt (Saisonende).
 */
export const marketContract = pgTable("market_contract", {
  id: serial("id").primaryKey(),
  /** ki | spieler */
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  /** Abo: id der ersten Tranche (bei ihr selbst gesetzt); sonst null. */
  aboId: integer("abo_id"),
  tranche: integer("tranche").notNull().default(1),
  tranches: integer("tranches").notNull().default(1),
  sellerId: integer("seller_id"),
  buyerId: integer("buyer_id"),
  sellerBaseId: integer("seller_base_id"),
  buyerBaseId: integer("buyer_base_id"),
  /** Wer den Vertrag angeboten bzw. abgeschlossen hat (Mensch). */
  proposerId: integer("proposer_id").notNull(),
  /** Spielerangebot nur an diesen Spieler (null: an alle). */
  targetId: integer("target_id"),
  resource: text("resource").notNull(),
  qty: integer("qty").notNull(),
  /** Käufer zahlt je Einheit; Verkäufer bekommt je Einheit (Differenz: Gebührentopf). */
  buyerUnit: doublePrecision("buyer_unit").notNull(),
  sellerUnit: doublePrecision("seller_unit").notNull(),
  /** Kurs beim Abschluss (Anzeige, Paarbremse). */
  course: doublePrecision("course").notNull(),
  buyerDepositCents: bigint("buyer_deposit_cents", { mode: "number" }).notNull().default(0),
  sellerPledgeCents: bigint("seller_pledge_cents", { mode: "number" }).notNull().default(0),
  escrowQty: integer("escrow_qty").notNull().default(0),
  /** abstrakt | konvoi */
  delivery: text("delivery").notNull(),
  dueAt: ts("due_at").notNull(),
  /** Abwicklung (Zahlung, Abbuchung, Abfahrt des Konvois): Fälligkeit minus Fahrzeit, sonst gleich due_at. */
  settleAt: ts("settle_at").notNull(),
  graceUntil: ts("grace_until"),
  /** Gültig bis (nur Angebote an Spieler). */
  offerUntil: ts("offer_until"),
  /** Geleit des Käufers für den Konvoi (läuft bei Abfahrt aus, wenn möglich). */
  escort: jsonb("escort"),
  /** Zählt für Erfolge und Tagesbefehle „Handel“ (Spielerverträge zwischen verbundenen Spielern: nein). */
  counts: boolean("counts").notNull().default(true),
  deliveredQty: integer("delivered_qty"),
  buyerPenaltyCents: bigint("buyer_penalty_cents", { mode: "number" }).notNull().default(0),
  sellerPenaltyCents: bigint("seller_penalty_cents", { mode: "number" }).notNull().default(0),
  /** Lieferung (Konvoi) bei Abwicklung, für Anzeige und Karte. */
  deliveryId: text("delivery_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  signedAt: ts("signed_at"),
  closedAt: ts("closed_at"),
}, (t) => [
  index("market_contract_seller").on(t.sellerId, t.status),
  index("market_contract_buyer").on(t.buyerId, t.status),
  index("market_contract_status").on(t.status, t.settleAt),
]);
