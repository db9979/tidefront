// Spieler gegen Spieler – Ansichten: Hinweis beim Zielen (Kopfgeld, Mutfaktor, Paarbremse, Absprache, Ende des
// eigenen Anfängerschutzes), Kopfgeld-Kennzeichen der Rangliste und die Verwaltungsliste „Auffällige Paare“ mit
// „Bericht aus der Wertung nehmen“ (report.pvpExcluded).
import { and, eq, inArray, sql } from "drizzle-orm";
import { isBeginnerProtected, pairFactor, pairKey, pvpOf, pvpStamp, stampFactors, type BaseState, type Counts } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { colluded, rankSnapshot, snapshotEntry } from "./pvp.ts";
import { countsValue } from "./scoring.ts";
import { clearRankingCache } from "./social.ts";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** Spielerkämpfe zwischen a und b seit sinceMs (beide Richtungen, Sammelangriffe mit Beteiligung). */
async function pairFightCount(db: DbOrTx, a: number, b: number, sinceMs: number): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from battle_report
    where report ? 'battle' and created_at > ${new Date(sinceMs).toISOString()}::timestamptz and (
      (attacker_player_id = ${a} and defender_player_id = ${b}) or (attacker_player_id = ${b} and defender_player_id = ${a})
      or (defender_player_id = ${b} and report->'allianceRaid'->'participants' @> ${JSON.stringify([{ playerId: a }])}::jsonb)
      or (defender_player_id = ${a} and report->'allianceRaid'->'participants' @> ${JSON.stringify([{ playerId: b }])}::jsonb))`);
  return r?.n ?? 0;
}

/**
 * Was ein Überfall auf den Spielerhafen auf Feld col/row für die Wertung bedeutet (Stand jetzt): Kopfgeld, Mutfaktor,
 * Paarbremse, Absprache-Sperre und ob der eigene Anfängerschutz damit endet. target null: kein fremder Spielerhafen.
 */
export async function pvpTargetView(engine: Engine, playerId: number, input: { col: number; row: number }) {
  const nowMs = Date.now();
  const cfg = pvpOf(balance);
  const [t] = await engine.db
    .select({ playerId: tables.base.playerId, name: tables.player.name })
    .from(tables.base)
    .innerJoin(tables.player, eq(tables.player.id, tables.base.playerId))
    .where(and(eq(tables.base.col, input.col), eq(tables.base.row, input.row)));
  if (!cfg || !t || t.playerId === playerId) return { target: null };
  const snap = await rankSnapshot(engine.db, nowMs);
  const me = snapshotEntry(snap, playerId);
  const them = snapshotEntry(snap, t.playerId);
  const collusion = await colluded(engine.db, playerId, t.playerId, nowMs);
  const st = pvpStamp({ day: snap.day, attackerRank: me.rank, defenderRank: them.rank, attackerPoints: me.points, defenderPoints: them.points, collusion }, cfg);
  const f = stampFactors(st, cfg);
  const fights = await pairFightCount(engine.db, playerId, t.playerId, nowMs - cfg.pairWindowHours * HOUR_MS);
  const own = await engine.db.select({ state: tables.base.state }).from(tables.base).where(eq(tables.base.playerId, playerId));
  const beginner = own.some((b) => isBeginnerProtected((b.state as BaseState).protection, nowMs, balance));
  return {
    target: {
      playerId: t.playerId,
      name: t.name,
      ownRank: me.rank,
      targetRank: them.rank,
      /** Kopfgeld in Prozent (0: keins oder Absprache). */
      bountyPct: Math.round((st.bountyFactor - 1) * 100),
      /** Ziel trägt Kopfgeld, wegen Absprache aber nicht für dich. */
      bountyBlocked: st.bountyRank !== null && collusion,
      mut: st.mut,
      kampfFactor: f.kampf,
      beuteFactor: f.beute,
      pairFights: fights,
      pairFactor: pairFactor(fights, cfg),
      pairWindowHours: cfg.pairWindowHours,
      collusion,
      collusionDays: cfg.collusionDays,
      beginnerEnds: beginner && cfg.beginnerEndsOnPlayerRaid,
    },
  };
}

/**
 * Verwaltung: Paare mit mindestens suspiciousFights Spielerkämpfen in suspiciousDays Tagen oder mit Siegen ohne
 * Verluste des Verteidigers; je Paar die Berichte (neueste zuerst) mit Kennzeichen „aus der Wertung genommen“.
 */
export async function suspiciousPairs(db: DbOrTx, nowMs: number) {
  const cfg = pvpOf(balance);
  if (!cfg) return { days: 0, minFights: 0, pairs: [] };
  const since = new Date(nowMs - cfg.suspiciousDays * DAY_MS).toISOString();
  const rows = await db.execute<{
    id: number; at: string | Date; title: string; winner: string | null; a: number; d: number; dl: Counts | null; excluded: boolean | null; participants: number[] | null;
  }>(sql`
    select id, created_at as at, title, winner, attacker_player_id as a, defender_player_id as d,
      report->'battle'->'defender'->'losses' as dl, (report->>'pvpExcluded')::boolean as excluded,
      case when report ? 'allianceRaid' then jsonb_path_query_array(report, '$.allianceRaid.participants[*].playerId') end as participants
    from battle_report
    where report ? 'battle' and attacker_player_id is not null and defender_player_id is not null
      and attacker_player_id <> defender_player_id and created_at >= ${since}::timestamptz
    order by created_at desc, id desc`);
  const pairs = new Map<string, { a: number; b: number; fights: number; cleanWins: number; reports: { id: number; atMs: number; title: string; winner: string | null; clean: boolean; excluded: boolean }[] }>();
  for (const r of rows) {
    const clean = r.winner === "attacker" && countsValue(r.dl) === 0;
    for (const x of new Set([r.a, ...(r.participants ?? [])])) {
      if (x === r.d) continue;
      const key = pairKey(x, r.d);
      let p = pairs.get(key);
      if (!p) pairs.set(key, (p = { a: Math.min(x, r.d), b: Math.max(x, r.d), fights: 0, cleanWins: 0, reports: [] }));
      p.fights += 1;
      if (clean) p.cleanWins += 1;
      p.reports.push({ id: r.id, atMs: new Date(r.at).getTime(), title: r.title, winner: r.winner, clean, excluded: !!r.excluded });
    }
  }
  const list = [...pairs.values()].filter((p) => p.fights >= cfg.suspiciousFights || p.cleanWins > 0);
  const ids = [...new Set(list.flatMap((p) => [p.a, p.b]))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const ps = await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player).where(inArray(tables.player.id, ids));
    for (const p of ps) names.set(p.id, p.name);
  }
  return {
    days: cfg.suspiciousDays,
    minFights: cfg.suspiciousFights,
    pairs: list
      .sort((x, y) => y.fights - x.fights || y.cleanWins - x.cleanWins)
      .map((p) => ({ ...p, aName: names.get(p.a) ?? "?", bName: names.get(p.b) ?? "?" })),
  };
}

/** Verwaltung: Bericht aus der Wertung nehmen (excluded) oder wieder aufnehmen. Code no_report. */
export async function setReportExcluded(db: DbOrTx, reportId: number, excluded: boolean): Promise<{ ok: true }> {
  const r = await db.execute<{ id: number }>(sql`
    update battle_report set report = jsonb_set(report, '{pvpExcluded}', to_jsonb(${excluded}::boolean))
    where id = ${reportId} and report ? 'battle' and attacker_player_id is not null and defender_player_id is not null
    returning id`);
  if (r.length === 0) throw new GameError("no_report");
  clearRankingCache();
  return { ok: true };
}
