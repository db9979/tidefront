// Spieler gegen Spieler (docs/VORLAGE-PVP.md): Rang-Momentaufnahme zum Tagesbeginn, Absprache-Prüfung (Handel,
// Transport, Stationierung, Allianz, Pakt in den letzten Tagen) und der Stempel report.pvp, den storeReport bzw.
// storeNavalReport jedem Kampfbericht zwischen zwei Spielern beim Kampf mitgibt. Die Wertung (scoring.ts) liest
// daraus Kopfgeld und Mutfaktor; die Paarbremse leitet sie aus der Reihenfolge der Berichte ab.
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { pvpOf, pvpStamp, type PvpStamp } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { dayKey } from "./challenge-pool.ts";
import { getSetting, setSetting } from "./settings.ts";
import { computeStandings } from "./scoring.ts";
import { runningSeason } from "./season.ts";
import { partyOf } from "./alliance-core.ts";
import { TIES_KEY } from "./pvp-ties.ts";

const DAY_MS = 86400000;
export const RANK_SNAPSHOT_KEY = "pvp_rank_snapshot";

/** Rang und Gesamtpunkte je Spieler zum Beginn des Spieltags (erste Abfrage des Tages). */
export interface RankSnapshot {
  day: string;
  seasonId: number | null;
  atMs: number;
  /** playerId → [Rang, Gesamtpunkte] */
  ranks: Record<string, [number, number]>;
}

/**
 * Momentaufnahme des laufenden Spieltags; die erste Abfrage nach Mitternacht (Wartungslauf des Workers alle 10 min,
 * sonst der erste Kampf oder die Rangliste) rechnet sie. Ein Bericht mit älterem Zeitpunkt (Nachzügler-Ereignis)
 * nimmt die vorhandene neuere Aufnahme, statt zurückzurechnen.
 */
export async function rankSnapshot(db: DbOrTx, nowMs: number): Promise<RankSnapshot> {
  const day = dayKey(nowMs);
  const s = await runningSeason(db);
  const seasonId = s?.id ?? null;
  const raw = await getSetting(db, RANK_SNAPSHOT_KEY);
  if (raw) {
    try {
      const snap = JSON.parse(raw) as RankSnapshot;
      if (snap.seasonId === seasonId && snap.day >= day) return snap;
    } catch {
      /* unlesbar: neu rechnen */
    }
  }
  const ranks: RankSnapshot["ranks"] = {};
  if (s) for (const r of await computeStandings(db, s.startsAt.getTime(), nowMs)) ranks[String(r.playerId)] = [r.rank, r.total];
  const snap: RankSnapshot = { day, seasonId, atMs: nowMs, ranks };
  await setSetting(db, RANK_SNAPSHOT_KEY, JSON.stringify(snap));
  return snap;
}

/** Für Tests und nach einem Saisonwechsel: Aufnahme verwerfen. */
export async function clearRankSnapshot(db: DbOrTx): Promise<void> {
  await db.delete(tables.serverSetting).where(eq(tables.serverSetting.key, RANK_SNAPSHOT_KEY));
}

export function snapshotEntry(snap: RankSnapshot, playerId: number): { rank: number | null; points: number } {
  const e = snap.ranks[String(playerId)];
  return e ? { rank: e[0], points: e[1] } : { rank: null, points: 0 };
}

/** Kopfgeld in Prozent je Spieler laut Momentaufnahme (Rang 1–3 mit Punkten), sonst nichts. */
export function bountyByPlayer(snap: RankSnapshot): Map<number, number> {
  const cfg = pvpOf(balance);
  const out = new Map<number, number>();
  if (!cfg) return out;
  for (const [id, [rank, total]] of Object.entries(snap.ranks)) {
    const b = cfg.bountyByRank[rank - 1];
    if (b !== undefined && total > 0) out.set(Number(id), Math.round(b * 100));
  }
  return out;
}

/** Bestand eine Verbindung (Handel, Transport, Stationierung, Allianz, Pakt) zwischen a und b in den letzten Tagen? */
export async function colluded(db: DbOrTx, a: number, b: number, atMs: number): Promise<boolean> {
  const cfg = pvpOf(balance);
  if (!cfg || a === b) return false;
  const since = new Date(atMs - cfg.collusionDays * DAY_MS);
  const [pa, pb] = [await partyOf(db, a), await partyOf(db, b)];
  if (pa === pb) return true; // dieselbe Allianz (z. B. während der Anfahrt beigetreten)
  const [pact] = await db.select({ id: tables.diplomacy.id }).from(tables.diplomacy).where(and(
    eq(tables.diplomacy.kind, "pakt"), eq(tables.diplomacy.status, "aktiv"),
    or(and(eq(tables.diplomacy.partyA, pa), eq(tables.diplomacy.partyB, pb)), and(eq(tables.diplomacy.partyA, pb), eq(tables.diplomacy.partyB, pa))),
  ));
  if (pact) return true;
  const ties = await getSetting(db, TIES_KEY);
  if (ties) {
    try {
      const at = (JSON.parse(ties) as Record<string, number>)[a < b ? `${a}:${b}` : `${b}:${a}`];
      if (at !== undefined && at > since.getTime()) return true;
    } catch {
      /* unlesbar: ignorieren */
    }
  }
  const both = [a, b];
  const [offer] = await db.select({ id: tables.playerOffer.id }).from(tables.playerOffer).where(and(
    eq(tables.playerOffer.status, "accepted"), gte(tables.playerOffer.closedAt, since),
    inArray(tables.playerOffer.sellerId, both), inArray(tables.playerOffer.buyerId, both),
    sql`${tables.playerOffer.sellerId} <> ${tables.playerOffer.buyerId}`,
  )).limit(1);
  if (offer) return true;
  const [transport] = await db.select({ id: tables.battleReport.id }).from(tables.battleReport).where(and(
    eq(tables.battleReport.kind, "transport"), gte(tables.battleReport.createdAt, since),
    or(and(eq(tables.battleReport.attackerPlayerId, a), eq(tables.battleReport.defenderPlayerId, b)), and(eq(tables.battleReport.attackerPlayerId, b), eq(tables.battleReport.defenderPlayerId, a))),
  )).limit(1);
  if (transport) return true;
  // Stationierung (Allianz-Ops): Truppen des einen im Hafen des anderen, laufend oder in den letzten Tagen.
  const station = await db.execute<{ id: number }>(sql`
    select m.id from mission m join base t on t.id = m.target_id
    where m.type = 'stationierung' and m.target_kind = 'base'
      and ((m.player_id = ${a} and t.player_id = ${b}) or (m.player_id = ${b} and t.player_id = ${a}))
      and (m.created_at >= ${since.toISOString()}::timestamptz or m.status in ('outbound', 'stationed'))
    limit 1`);
  return station.length > 0;
}

/**
 * Stempel für einen neuen Bericht: nur Kampf (report.battle) zwischen zwei verschiedenen Spielern. Sammelangriff:
 * Absprache, wenn irgendein Teilnehmer mit dem Ziel verbunden war; Rang und Punkte des eingetragenen Angreifers.
 */
export async function pvpStampFor(
  tx: Tx,
  v: { attackerPlayerId: number | null; defenderPlayerId: number | null; report: unknown; atMs: number },
): Promise<PvpStamp | null> {
  const cfg = pvpOf(balance);
  const a = v.attackerPlayerId;
  const d = v.defenderPlayerId;
  if (!cfg || a === null || d === null || a === d) return null;
  const rep = v.report as { battle?: unknown; allianceRaid?: { participants?: { playerId: number }[] } } | null;
  if (!rep || typeof rep !== "object" || !rep.battle) return null;
  const snap = await rankSnapshot(tx, v.atMs);
  const ids = rep.allianceRaid?.participants?.map((p) => p.playerId) ?? [a];
  let collusion = false;
  for (const id of new Set([a, ...ids])) if (id !== d && (await colluded(tx, id, d, v.atMs))) { collusion = true; break; }
  const att = snapshotEntry(snap, a);
  const def = snapshotEntry(snap, d);
  const stamp = pvpStamp({ day: snap.day, attackerRank: att.rank, defenderRank: def.rank, attackerPoints: att.points, defenderPoints: def.points, collusion }, cfg);
  // Weltpolitik: Kopfgeld-Zuschlag für Angreifer eines Berüchtigten (nicht bei Absprache).
  const extra = collusion ? 0 : await (await import("./politik-ansehen.ts")).notoriousBounty(tx, d, v.atMs);
  return extra > 0 ? { ...stamp, bountyFactor: stamp.bountyFactor + extra } : stamp;
}

/** Bericht mit Stempel (unverändert, wenn kein Spielerkampf). */
export async function withPvpStamp<T extends { attackerPlayerId: number | null; defenderPlayerId: number | null; report: unknown; atMs: number }>(tx: Tx, v: T): Promise<T> {
  const pvp = await pvpStampFor(tx, v);
  return pvp ? { ...v, report: { ...(v.report as object), pvp } } : v;
}

/** PvP: Anfängerschutz aller übrigen Häfen des Spielers endet mit (Kolonien erben ihn vom Heimathafen). */
export async function endBeginnerElsewhere(tx: Tx, playerId: number, exceptBaseId: number, nowMs: number): Promise<void> {
  await tx.execute(sql`
    update base set state = jsonb_set(state, '{protection,beginnerEndedAtMs}', to_jsonb(${nowMs}::bigint))
    where player_id = ${playerId} and id <> ${exceptBaseId} and not (state->'protection' ? 'beginnerEndedAtMs')`);
}
