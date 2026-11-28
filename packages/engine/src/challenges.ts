// Tagesbefehle, Datenbankseite: Vergabe (lazy, idempotent), Fortschritts-Schnittstelle trackProgress und
// die Auswertung von Ereignissen (Vorher/Nachher um den Handler, aufgerufen aus events.ts).
// Fehler hier dürfen Spielereignisse und Befehle nie blockieren: alles läuft in einem eigenen Savepoint.
import { and, asc, count, countDistinct, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { protectionStatus, settle, type Counts, type Mission, type ResourceMap, type TrainingOrder } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import type { EventRow } from "./events.ts";
import { baseOfPlayer, readBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { achievementsFromDaily } from "./achievements.ts"; // Erfolge
import {
  addDays,
  challengeReward,
  DERIVED_KINDS,
  dayKey,
  dayStartMs,
  drawDay,
  poolContext,
  STORM_MISSION_FROM,
  type PoolContext,
  type Tier,
} from "./challenge-pool.ts";

export type ChallengeRow = typeof tables.dailyChallenge.$inferSelect;
const dc = tables.dailyChallenge;

// ---------------------------------------------------------------- Vergabe

/** Kontext für die Auswahl aus dem Stützpunkt des Spielers; null ohne Hafen. */
export async function contextFor(tx: DbOrTx, playerId: number, atMs: number): Promise<PoolContext | null> {
  const b = await baseOfPlayer(tx, playerId); // Mehrere Häfen: bewusst Heimathafen (Auswahl nach Heimathafen)
  if (!b) return null;
  const mods = await modsOf(tx, b, atMs);
  const state = settle(b.state, atMs, balance, mods);
  const [o] = await tx.select({ n: countDistinct(tables.base.playerId) }).from(tables.base).where(ne(tables.base.playerId, playerId));
  const raidsPossible = protectionStatus(state.protection, atMs, balance).reason !== "anfaengerschutz";
  return poolContext(state, { others: (o?.n ?? 0) > 0, raidsPossible }, mods);
}

async function dayRows(tx: DbOrTx, playerId: number, day: string): Promise<ChallengeRow[]> {
  return tx.select().from(dc).where(and(eq(dc.playerId, playerId), eq(dc.day, day))).orderBy(asc(dc.slot));
}

/**
 * Vergibt die drei Befehle des Tages, falls noch nicht geschehen. Gleichzeitige Aufrufe sind harmlos:
 * die Auswahl ist deterministisch und der Unique-Index (Spieler, Tag, Slot) verhindert Doppelvergabe.
 */
export async function ensureAssigned(tx: DbOrTx, playerId: number, day: string, atMs: number): Promise<ChallengeRow[]> {
  const existing = await dayRows(tx, playerId, day);
  if (existing.length >= 3) return existing;
  const c = await contextFor(tx, playerId, atMs);
  if (!c) return existing;
  const draws = drawDay(c, `${playerId}|${day}`);
  await tx
    .insert(dc)
    .values(draws.map((d) => {
      const r = challengeReward(d.slot, c.stage);
      return { playerId, day, slot: d.slot, kind: d.kind, param: d.param, target: d.target, reward: r.reward, points: r.points };
    }))
    .onConflictDoNothing();
  return dayRows(tx, playerId, day);
}

// ---------------------------------------------------------------- Fortschritt

export interface TrackOptions {
  /** Zeitpunkt des Geschehens; bestimmt den Tag. */
  atMs: number;
  /** Nur Befehle mit genau diesem Zusatz (z. B. Gattung). */
  param?: string;
  /** Nur Befehle, deren Zusatz als Zahl höchstens so groß ist (z. B. Nest-Stufe ≥ Zusatz). */
  level?: number;
  /** add: aufsummieren (Vorgabe); max: höchsten Wert übernehmen (z. B. Länge der Bauschlange). */
  mode?: "add" | "max";
}

async function applyProgress(tx: DbOrTx, playerId: number, kind: string, amount: number, o: TrackOptions): Promise<number> {
  const day = dayKey(o.atMs);
  if (day === dayKey(Date.now())) await ensureAssigned(tx, playerId, day, o.atMs);
  const conds = [eq(dc.playerId, playerId), eq(dc.day, day), eq(dc.kind, kind), isNull(dc.completedAt)];
  if (o.param !== undefined) conds.push(eq(dc.param, o.param));
  if (o.level !== undefined) conds.push(sql`(${dc.param})::int <= ${o.level}`);
  const amt = Math.floor(amount);
  const next = o.mode === "max"
    ? sql`least(${dc.target}, greatest(${dc.progress}, ${amt}::int))`
    : sql`least(${dc.target}, ${dc.progress} + ${amt}::int)`;
  const at = new Date(o.atMs).toISOString();
  const done = await tx
    .update(dc)
    .set({ progress: next, completedAt: sql`case when ${next} >= ${dc.target} then ${at}::timestamptz else null end` })
    .where(and(...conds))
    .returning({ id: dc.id });
  return done.length;
}

/**
 * Fortschritts-Schnittstelle: zählt `amount` auf die offenen Befehle der Art `kind` des Tages von `atMs`.
 * Vergibt die Befehle des laufenden Tages bei Bedarf. Läuft in einem Savepoint und wirft nie: ein Fehler
 * hier verwirft nur den Fortschritt, nicht die auslösende Aktion. Rückgabe: Anzahl berührter Befehle.
 */
export async function trackProgress(tx: Tx, playerId: number, kind: string, amount: number, o: TrackOptions): Promise<number> {
  if (!(amount > 0)) return 0;
  // Erfolge und Wochenziele: dieselben Fortschritte (Ausbau, Handel, Forschung, Wrackgut, Anlagen) mitzählen.
  if (o.mode !== "max") await achievementsFromDaily(tx, playerId, kind, amount, o.atMs);
  try {
    return await tx.transaction((inner) => applyProgress(inner, playerId, kind, amount, o));
  } catch (err) {
    console.error("trackProgress", kind, String(err));
    return 0;
  }
}

/**
 * Befehle, deren Stand aus dem Zustand gelesen wird (Vorrat, Produktion, Nachrichten): beim Abruf und
 * vor dem Abholen fortschreiben. Nur der laufende Tag; ältere Tage bleiben, wie sie sind.
 */
export async function refreshDerived(tx: DbOrTx, playerId: number, rows: ChallengeRow[], nowMs: number): Promise<ChallengeRow[]> {
  const today = dayKey(nowMs);
  const open = rows.filter((r) => r.day === today && !r.completedAt && DERIVED_KINDS.has(r.kind));
  if (open.length === 0) return rows;
  const c = open.some((r) => r.kind !== "nachricht") ? await contextFor(tx, playerId, nowMs) : null;
  let sent = 0;
  if (open.some((r) => r.kind === "nachricht")) {
    const [m] = await tx
      .select({ n: count() })
      .from(tables.message)
      .where(and(
        eq(tables.message.fromPlayerId, playerId),
        gte(tables.message.createdAt, new Date(dayStartMs(today))),
        lt(tables.message.createdAt, new Date(dayStartMs(addDays(today, 1)))),
      ));
    sent = m?.n ?? 0;
  }
  const out = new Map(rows.map((r) => [r.id, r]));
  for (const r of open) {
    let value = 0;
    if (r.kind === "nachricht") value = sent;
    else if (c && r.kind === "lager") value = Math.floor(c.resources[r.param ?? ""] ?? 0);
    else if (c && r.kind === "produktion") value = Math.floor(c.production[r.param ?? ""] ?? 0);
    else if (c && r.kind === "kommando") value = c.stage;
    else if (c && r.kind === "speicherwerk") value = c.levels.speicherwerk ?? 0;
    else if (c && r.kind === "stromspeicher") value = Math.floor(c.power?.stored ?? 0);
    else if (c && r.kind === "windsolar") value = (c.levels.windpark ?? 0) + (c.levels.solarfeld ?? 0);
    else if (c && r.kind === "oekostrom") value = Math.floor(c.renewable?.now ?? 0);
    const progress = Math.min(r.target, Math.max(r.progress, value));
    if (progress === r.progress) continue;
    const completedAt = progress >= r.target ? new Date(nowMs) : null;
    await tx.update(dc).set({ progress, completedAt }).where(and(eq(dc.id, r.id), isNull(dc.completedAt)));
    out.set(r.id, { ...r, progress, completedAt });
  }
  return rows.map((r) => out.get(r.id)!);
}

/**
 * Takt (Worker, alle 10 Minuten) und Ereignisse: offene zustandsbasierte Befehle des laufenden Tages fortschreiben,
 * auch wenn der Spieler die Befehle nicht ansieht (Ökostrom, Stromspeicher und Vorrat schwanken; wer erst abends
 * nachsieht, soll den Höchststand vom Mittag behalten). Eine Abfrage über den Index, Arbeit nur für Spieler mit
 * offenen Befehlen dieser Art; Fehler eines Spielers halten die anderen nicht auf. playerId: nur dieser Spieler.
 */
export async function refreshDerivedOpen(db: DbOrTx, nowMs: number, playerId?: number): Promise<number> {
  const conds = [eq(dc.day, dayKey(nowMs)), isNull(dc.completedAt), inArray(dc.kind, [...DERIVED_KINDS])];
  if (playerId !== undefined) conds.push(eq(dc.playerId, playerId));
  const rows = await db.select().from(dc).where(and(...conds));
  const byPlayer = new Map<number, ChallengeRow[]>();
  for (const r of rows) byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r]);
  let done = 0;
  for (const [pid, list] of byPlayer) {
    try {
      const next = await refreshDerived(db, pid, list, nowMs);
      done += next.filter((r) => r.completedAt).length;
    } catch (err) {
      console.error("refreshDerivedOpen", pid, String(err));
    }
  }
  return done;
}

// ---------------------------------------------------------------- Ereignisse (Vorher/Nachher)

export type ChallengeSnapshot =
  | { kind: "build"; playerId: number; buildings: Counts }
  | { kind: "training"; playerId: number; orders: TrainingOrder[] }
  | { kind: "mission"; status: string }
  | null;

const MISSION_EVENTS = new Set(["mission_arrive", "raid_arrive"]);

async function snapshot(tx: DbOrTx, ev: EventRow): Promise<ChallengeSnapshot> {
  if ((ev.type === "build_complete" || ev.type === "training_complete") && ev.baseId) {
    const b = await readBase(tx, ev.baseId);
    if (!b) return null;
    return ev.type === "build_complete"
      ? { kind: "build", playerId: b.playerId, buildings: { ...b.state.buildings } }
      : { kind: "training", playerId: b.playerId, orders: [...b.state.trainingQueue] };
  }
  if (MISSION_EVENTS.has(ev.type)) {
    const [m] = await tx.select({ status: tables.mission.status }).from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId)));
    return m ? { kind: "mission", status: m.status } : null;
  }
  return null;
}

/** Zustand vor dem Handler (nur lesend). Wirft nie. */
export async function challengeSnapshot(tx: Tx, ev: EventRow): Promise<ChallengeSnapshot> {
  try {
    return await tx.transaction((inner) => snapshot(inner, ev));
  } catch {
    return null;
  }
}

const sumRes = (m: ResourceMap | null | undefined) => Object.values(m ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);

type BattleData = { battle?: { loot?: ResourceMap; attacker?: { losses?: Counts } } };

async function after(tx: Tx, ev: EventRow, due: number, snap: NonNullable<ChallengeSnapshot>): Promise<void> {
  const at = { atMs: due };
  if (snap.kind === "build") {
    const b = await readBase(tx, ev.baseId!);
    if (!b) return;
    let n = 0;
    for (const [id, level] of Object.entries(b.state.buildings)) n += Math.max(0, level - (snap.buildings[id] ?? 0));
    await trackProgress(tx, snap.playerId, "ausbau", n, at);
    // Neue Stufe: Produktion, Kommandozentrale, Speicherwerk, Wind/Solar sofort fortschreiben (zustandsbasiert).
    if (n > 0) await refreshDerivedOpen(tx, due, snap.playerId);
    return;
  }
  if (snap.kind === "training") {
    const b = await readBase(tx, ev.baseId!);
    if (!b) return;
    // Teillieferung (0.44): gezählt wird je Lieferung (done vorher → nachher; verschwundener Auftrag = vollständig).
    const key = (o: TrainingOrder) => `${o.builtIn}|${o.id}|${o.startedAt}`;
    const left = new Map(b.state.trainingQueue.map((o) => [key(o), o.done ?? 0]));
    const byKind = new Map<string, number>();
    for (const o of snap.orders) {
      const n = (left.get(key(o)) ?? (o.finishesAt <= due ? o.count : o.done ?? 0)) - (o.done ?? 0);
      if (n <= 0) continue;
      const kind = o.kind === "defense" ? "anlagen" : `ausbildung_${balance.units[o.id]?.branch ?? "?"}`;
      byKind.set(kind, (byKind.get(kind) ?? 0) + n);
    }
    for (const [kind, n] of byKind) await trackProgress(tx, snap.playerId, kind, n, at);
    return;
  }
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, Number(ev.payload.missionId)));
  if (!m || m.status === snap.status) return;
  const [r] = m.reportId ? await tx.select().from(tables.battleReport).where(eq(tables.battleReport.id, m.reportId)) : [];
  const data = (r?.report ?? {}) as BattleData;
  if (ev.type === "raid_arrive") {
    if (r?.kind === "kartell" && r.winner === "defender" && r.defenderPlayerId !== null) {
      await trackProgress(tx, r.defenderPlayerId, "kartell_abwehr", 1, at);
    }
    return;
  }
  if (m.playerId === null) return;
  const pid = m.playerId;
  const loot = sumRes(data.battle?.loot);
  // Wrackgut: Ladung der Heimfahrt ohne die Beute.
  await trackProgress(tx, pid, "wrack", sumRes(m.cargoHome as ResourceMap) - loot, at);
  if (!r) return;
  // Wetter: Mission trotz Sturm auf der Route erfolgreich (Sturmanteil bei Abfahrt).
  const storm = (m.plan as Mission | null)?.weather?.storminess ?? 0;
  const success = r.kind === "aufklaerung" || r.kind === "transport" || ((r.kind === "ueberfall" || r.kind === "weltereignis") && r.winner === "attacker");
  if (storm >= STORM_MISSION_FROM && success) await trackProgress(tx, pid, "sturmfahrt", 1, at);
  if (r.kind === "aufklaerung") await trackProgress(tx, pid, "aufklaerung", 1, at);
  else if (r.kind === "transport") await trackProgress(tx, pid, "transport", 1, at);
  else if (r.kind === "ueberfall") {
    await trackProgress(tx, pid, "beute", loot, at);
    if (r.winner !== "attacker") return;
    if (sumRes(data.battle?.attacker?.losses) === 0) await trackProgress(tx, pid, "sieg_ohne_verluste", 1, at);
    if (r.nestId !== null) {
      const [n] = await tx.select({ level: tables.nest.level }).from(tables.nest).where(eq(tables.nest.id, r.nestId));
      if (n) await trackProgress(tx, pid, "nest", 1, { ...at, level: n.level });
    }
  }
}

/** Fortschritt aus einem verarbeiteten Ereignis (Vergleich mit dem Zustand davor). Wirft nie. */
export async function challengesAfter(tx: Tx, ev: EventRow, due: number, snap: ChallengeSnapshot): Promise<void> {
  if (!snap) return;
  try {
    await tx.transaction((inner) => after(inner, ev, due, snap));
  } catch (err) {
    console.error("challengesAfter", ev.type, String(err));
  }
}

// ---------------------------------------------------------------- Wertung und Saison

/** Punkte der Kategorie Befehle je Spieler: abgeholte Befehle samt Serienbonus seit Saisonbeginn. */
export async function challengePoints(db: DbOrTx, sinceMs: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ playerId: dc.playerId, p: sql<number>`coalesce(sum(${dc.points} + ${dc.bonusPoints}), 0)::int` })
    .from(dc)
    .where(and(isNotNull(dc.claimedAt), gte(dc.claimedAt, new Date(sinceMs))))
    .groupBy(dc.playerId);
  return new Map(rows.map((r) => [r.playerId, Number(r.p)]));
}

/** Saisonende: Befehle und Serien verfallen. */
export async function resetChallenges(tx: DbOrTx): Promise<void> {
  await tx.delete(tables.dailyChallenge);
  await tx.delete(tables.dailyStreak);
}

export type { Tier };
