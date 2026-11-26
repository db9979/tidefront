// Weltereignisse des Freibeuter-Kartells: gemeinsame Teile. Zeilen und Daten je Art, Sperren, Systemnachrichten,
// Ende eines Ereignisses, Belagerungs-Hook siegeEffects, Planer-Start (Worker) und Aufräumen am Saisonende.
// Ablauf: world-events-spawn.ts (Entstehen), world-events-run.ts (Fahrt, Angriffe, Ende, Handler-Tabelle),
// world-events-missions.ts (Missionen gegen Ereignisse), world-events-view.ts (Lesemodell).
import { and, eq, inArray, sql } from "drizzle-orm";
import { pickKind, worldEventsBalance, type Counts, type ResourceMap, type RoutePoint, type WorldEventKind } from "@tidefront/game-core";
import { tables, type Db, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, type Notice, type NoticeJob } from "./context.ts";
import { scheduleEvent } from "./store.ts";
import { worldEventNews } from "./market-news-sources.ts";

const HOUR_MS = 3600000;

export interface Hex {
  col: number;
  row: number;
}

/** Ziel der Großflotte; status: pending, attacked (mit Bericht), skipped (Schutz), gone (Hafen existiert nicht mehr). */
export interface ArmadaTarget extends Hex {
  baseId: number;
  playerId: number;
  name: string;
  status: "pending" | "attacked" | "skipped" | "gone";
  winner?: "attacker" | "defender";
}

export interface WorldEventData {
  /** Lebenspunkte des Verbands beim Entstehen (Bezug der Schadenswertung). */
  initialHp: number;
  /** Stärkefaktor nach Saisonfortschritt. */
  strength: number;
  /** Schatzschiff: Wegpunkte (Felder) und Route mit Zeiten, Zielhafen, Beute. */
  path?: Hex[];
  route?: RoutePoint[];
  harbor?: Hex;
  loot?: ResourceMap;
  /** Großflotte und Belagerung: Beutepool und bereits ausgezahlte Beute. */
  lootPool?: ResourceMap;
  paid?: ResourceMap;
  /** Großflotte: Sammelpunkt, Region, Ziele in Reihenfolge, nächster Index. */
  assembly?: Hex;
  region?: Hex & { radiusKm: number };
  targets?: ArmadaTarget[];
  next?: number;
  /** Belagerung: Name und Besitzer des Hafens, letzter Abzug. */
  baseName?: string;
  ownerId?: number;
  lastTickMs?: number;
  deducted?: ResourceMap;
}

export interface WorldEventRow {
  id: number;
  kind: WorldEventKind;
  status: "announced" | "active" | "ended";
  outcome: string | null;
  seasonId: number | null;
  col: number;
  row: number;
  targetBaseId: number | null;
  units: Counts;
  initialUnits: Counts;
  data: WorldEventData;
  startsAt: Date;
  activeAt: Date;
  endsAt: Date;
  winnerPlayerId: number | null;
  endedAt: Date | null;
}

export const KIND_TEXT: Record<WorldEventKind, string> = {
  schatzschiff: "Schatzschiff",
  grossflotte: "Großflotte",
  belagerung: "Belagerung",
};

export async function lockWorldEvent(tx: Tx, id: number): Promise<WorldEventRow | null> {
  const [r] = await tx.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, id)).for("update");
  return (r as WorldEventRow | undefined) ?? null;
}

export async function readWorldEvent(db: DbOrTx, id: number): Promise<WorldEventRow | null> {
  const [r] = await db.select().from(tables.worldEvent).where(eq(tables.worldEvent.id, id));
  return (r as WorldEventRow | undefined) ?? null;
}

export function isOpen(ev: Pick<WorldEventRow, "status">): boolean {
  return ev.status === "announced" || ev.status === "active";
}

/** Systemnachricht an mehrere Spieler. */
export async function systemMessage(tx: Tx, playerIds: number[], subject: string, body: string, atMs: number): Promise<void> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return;
  await tx.insert(tables.message).values(ids.map((id) => ({ fromPlayerId: null, toPlayerId: id, subject, body, createdAt: new Date(atMs) })));
}

/** Push- bzw. E-Mail-Auftrag (nach dem Commit verschickt). */
export function notice(playerId: number, kind: Notice["kind"], title: string, body: string): NoticeJob {
  return { playerId, notice: { kind, title, body, url: "/?tab=karte", tag: `weltereignis-${kind}` } };
}

/** Alle Spieler mit Hafen (Empfänger von Ankündigungen), je Spieler einmal mit seinem Heimathafen. */
export async function playersWithBase(tx: DbOrTx): Promise<{ playerId: number; baseId: number; col: number; row: number }[]> {
  return tx
    .select({ playerId: tables.base.playerId, baseId: tables.base.id, col: tables.base.col, row: tables.base.row })
    .from(tables.base)
    .where(eq(tables.base.isHome, true));
}

/** Beteiligte eines Ereignisses (Spieler mit Schaden). */
export async function contributors(tx: DbOrTx, eventId: number): Promise<number[]> {
  const rows = await tx.select({ id: tables.worldEventDamage.playerId }).from(tables.worldEventDamage).where(eq(tables.worldEventDamage.eventId, eventId));
  return rows.map((r) => r.id);
}

/** Beendet ein Ereignis (idempotent über den Status). */
export async function endWorldEvent(tx: Tx, ev: WorldEventRow, outcome: string, atMs: number, winner: number | null = null, patch: Partial<WorldEventRow> = {}): Promise<void> {
  await tx
    .update(tables.worldEvent)
    .set({ ...patch, status: "ended", outcome, endedAt: new Date(atMs), winnerPlayerId: winner })
    .where(eq(tables.worldEvent.id, ev.id));
  // Marktnachrichten: Wirkung endet jetzt und klingt ab (Schatzschiff: Nachricht zum Ausgang).
  await worldEventNews(tx, ev.id, atMs);
}

export function sumRes(m: ResourceMap | null | undefined): number {
  return Object.values(m ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function addRes(a: ResourceMap, b: ResourceMap): ResourceMap {
  const out: ResourceMap = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function resText(m: ResourceMap): string {
  const names: Record<string, string> = { stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant" };
  const parts = Object.entries(m).filter(([, v]) => v > 0).map(([r, v]) => `${Math.floor(v).toLocaleString("de-DE")} ${names[r] ?? r}`);
  return parts.length > 0 ? parts.join(", ") : "nichts";
}

// ---------------------------------------------------------------- Belagerung: Hook für Aufrufer

export interface SiegeEffects {
  eventId: number;
  /** Faktor der Gebäudeproduktion während der Belagerung (1 − productionPenalty). */
  productionFactor: number;
  /** Keine Börsenkäufe (Lieferungen) während der Belagerung. */
  marketBlocked: boolean;
  endsAtMs: number;
}

/**
 * Wirkung einer laufenden Belagerung auf einen Hafen, null ohne Belagerung. Aufrufer: trade (Kauf gesperrt),
 * world-events-run.ts (stündlicher Produktionsabzug), Lesemodell. Ein allgemeines Modifikator-System gibt es
 * noch nicht; sobald es eines gibt (z. B. Forschung), gehört productionFactor dort als Faktor auf
 * productionRates().buildingPerHour hinein und der stündliche Abzug entfällt.
 */
export async function siegeEffects(db: DbOrTx, baseId: number, nowMs: number): Promise<SiegeEffects | null> {
  const [s] = await db
    .select({ id: tables.worldEvent.id, endsAt: tables.worldEvent.endsAt, startsAt: tables.worldEvent.startsAt })
    .from(tables.worldEvent)
    .where(and(eq(tables.worldEvent.kind, "belagerung"), eq(tables.worldEvent.status, "active"), eq(tables.worldEvent.targetBaseId, baseId)))
    .limit(1);
  if (!s || nowMs < s.startsAt.getTime() || nowMs >= s.endsAt.getTime()) return null;
  return {
    eventId: s.id,
    productionFactor: 1 - worldEventsBalance(balance).belagerung.productionPenalty,
    marketBlocked: true,
    endsAtMs: s.endsAt.getTime(),
  };
}

// ---------------------------------------------------------------- Planer und Saisonende

async function runningSeasonRow(db: DbOrTx) {
  const [s] = await db.select().from(tables.season).where(eq(tables.season.status, "running")).limit(1);
  return s ?? null;
}

export { runningSeasonRow };

/**
 * Worker (beim Start und alle 10 Minuten): plant das nächste world_event_spawn, falls keines ansteht.
 * Erstes Ereignis frühestens firstSpawnAfterHours nach Saisonbeginn. Rückgabe: Zeitpunkt oder null.
 */
export async function ensureWorldEventPlanner(db: Db, nowMs: number): Promise<number | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340002)`);
    const season = await runningSeasonRow(tx);
    if (!season) return null;
    const [pending] = await tx
      .select({ id: tables.gameEvent.id })
      .from(tables.gameEvent)
      .where(and(eq(tables.gameEvent.type, "world_event_spawn"), eq(tables.gameEvent.status, "pending")))
      .limit(1);
    if (pending) return null;
    const w = worldEventsBalance(balance);
    const at = Math.max(nowMs, season.startsAt.getTime() + w.firstSpawnAfterHours * HOUR_MS);
    if (at > season.endsAt.getTime() - w.minSeasonHoursLeft * HOUR_MS) return null;
    const kind = pickKind(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296, balance);
    await scheduleEvent(tx, "world_event_spawn", at, { seasonId: season.id, kind }, null);
    return at;
  });
}

/** Saisonende: alle Ereignisse und Beiträge verfallen (geplante game_event löscht season.ts ohnehin). */
export async function clearWorldEvents(tx: Tx): Promise<void> {
  await tx.delete(tables.worldEventDamage);
  await tx.delete(tables.worldEvent);
}

/** Offene Ereignisse (für Lesemodell und Spawn-Prüfungen). */
export async function openWorldEvents(db: DbOrTx): Promise<WorldEventRow[]> {
  const rows = await db.select().from(tables.worldEvent).where(inArray(tables.worldEvent.status, ["announced", "active"]));
  return rows as WorldEventRow[];
}
