// Erfolge (Abzeichen), Datenbankseite: Zähler, Freischaltung, Meldung, Auswertung von Ereignissen.
//
// ERWEITERUNGSSTELLE für andere Systeme: recordAchievement(tx, playerId, counter, amount, opts). Ein Aufruf
// schreibt den dauerhaften Zähler fort, schaltet erreichte Stufen frei (Meldung, Push über den Worker) und zählt
// auf passende Wochenziele derselben Art. Neue Erfolge brauchen nur einen Eintrag in balance.json
// (achievements.list, Feld counter) und einen Aufruf an der Stelle, wo das Geschehen passiert.
//
// Vorhandene Ereignisse werden zentral ausgewertet, ohne fremde Handler anzufassen:
//  - Kampf-, Missions- und Spionageberichte (battle_report), die ein Ereignis erzeugt (achievementsAfter);
//  - Fortschritt der Tagesbefehle (trackProgress → achievementsFromDaily);
//  - Zustand (Prachtbauten, Forschung, Tagesbefehle-Serie, Saisonplatzierung) beim Abruf und nach Bau/Forschung.
// Fehler hier blockieren nie die auslösende Aktion: alles läuft in eigenen Savepoints.
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Counts, ResourceMap } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, type Engine, type NoticeJob } from "./context.ts";
import type { EventRow } from "./events.ts";
import { readBase } from "./store.ts";
import { advanceWeekly } from "./weekly.ts";
import {
  achievementById,
  achievementList,
  placementScore,
  baumeisterFrom,
  TIER_NAMES,
  tierFor,
  tierReward,
  tierText,
} from "./achievement-defs.ts";

const ac = tables.achievementCounter;
const at = tables.achievementTier;

export interface RecordOptions {
  /** Zeitpunkt des Geschehens (bestimmt die Woche der Wochenziele); Vorgabe jetzt. */
  atMs?: number;
  /** add: aufsummieren (Vorgabe); max: höchsten Wert übernehmen (Bestwerte wie Serie oder Platzierung). */
  mode?: "add" | "max";
  /** Stufe des Geschehens (z. B. Nest-Stufe) für Wochenziele mit Mindeststufe. */
  level?: number;
  /** false: Wochenziele nicht fortschreiben. Vorgabe: bei mode add ja. */
  weekly?: boolean;
}

/** Schaltet alle bis `value` erreichten Stufen frei (idempotent) und schreibt je neue Stufe eine Meldung. */
async function unlock(tx: DbOrTx, playerId: number, counter: string, value: number, atMs: number): Promise<number> {
  let n = 0;
  for (const a of achievementList()) {
    if (a.counter !== counter) continue;
    const reached = tierFor(value, a.thresholds);
    if (reached === 0) continue;
    const rows = Array.from({ length: reached }, (_, i) => ({
      playerId, achievementId: a.id, tier: i + 1, reward: tierReward(a, i + 1), unlockedAt: new Date(atMs),
    }));
    const added = await tx.insert(at).values(rows).onConflictDoNothing().returning({ tier: at.tier });
    for (const r of added) {
      n++;
      await tx.insert(tables.message).values({
        fromPlayerId: null, toPlayerId: playerId, createdAt: new Date(atMs),
        subject: `Erfolg: ${a.title} (${TIER_NAMES[r.tier - 1]})`,
        body: `Neues Abzeichen „${a.title}“ in ${TIER_NAMES[r.tier - 1]}: ${tierText(a, r.tier)}. ` +
          "Die Belohnung holst du unter Meldungen → Rangliste → Erfolge ab.",
      });
    }
  }
  return n;
}

async function apply(tx: DbOrTx, playerId: number, counter: string, amount: number, o: RecordOptions): Promise<void> {
  const atMs = o.atMs ?? Date.now();
  const amt = Math.floor(amount);
  const [row] = await tx.select({ value: ac.value }).from(ac).where(and(eq(ac.playerId, playerId), eq(ac.counter, counter))).for("update");
  const before = Number(row?.value ?? 0);
  const value = o.mode === "max" ? Math.max(before, amt) : before + amt;
  if (value !== before) {
    await tx
      .insert(ac)
      .values({ playerId, counter, value, updatedAt: new Date(atMs) })
      .onConflictDoUpdate({ target: [ac.playerId, ac.counter], set: { value, updatedAt: new Date(atMs) } });
    await unlock(tx, playerId, counter, value, atMs);
  }
  if (o.mode !== "max" && o.weekly !== false) await advanceWeekly(tx, playerId, counter, amt, atMs, o.level);
}

/**
 * Erweiterungsstelle: zählt `amount` auf den Erfolgszähler `counter` des Spielers (und auf passende
 * Wochenziele). Läuft in einem Savepoint und wirft nie. Bekannte Zähler: nester, ueberfaelle, abwehr,
 * abwehr_ohne_verluste, beute, handel, gebaeudestufen, forschung, anlagen, wrack, spionage, missionen,
 * weltereignisse, allianz_hilfe, wochenziele, oekostrom (refreshGreenCounter), prachtbau/forschung_voll/serie/saison (mode max).
 */
export async function recordAchievement(tx: DbOrTx, playerId: number, counter: string, amount: number, o: RecordOptions = {}): Promise<void> {
  if (!balance.achievements || !(amount > 0) || !Number.isFinite(amount)) return;
  try {
    await tx.transaction((inner) => apply(inner, playerId, counter, amount, o));
  } catch (err) {
    console.error("recordAchievement", counter, String(err));
  }
}

/** Tagesbefehle-Fortschritt, der auch für Erfolge und Wochenziele zählt (aufgerufen aus trackProgress). */
const FROM_DAILY: Record<string, (amount: number) => [string, number][]> = {
  ausbau: (n) => [["gebaeudestufen", n]],
  // Nur Geschäfte ab minCountedTradeCredits zählen (Wirtschaftsprüfung 0.24: Mini-Handel als Belohnungsquelle).
  handel: (credits) => (credits >= (balance.achievements?.minCountedTradeCredits ?? 0) ? [["handel", 1]] : []),
  forschung: (n) => [["forschung", n]],
  wrack: (n) => [["wrack", n]],
  anlagen: (n) => [["anlagen", n]],
};

/**
 * M-07 (Abschlussprüfung 0.38): Erfolg „Kaufmann“ zählt die an der Börse gezahlte Gebühr in ganzen Talern (Zähler
 * handel_gebuehr), nicht die Zahl der Geschäfte – Rundreise-Handel (kaufen, sofort verkaufen) bringt so keine billigen
 * Stufen mehr. Wie bisher nur Geschäfte ab minCountedTradeCredits; kein Wochenziel (das zählt weiter Geschäfte).
 */
export async function recordTradeFee(tx: DbOrTx, playerId: number, tradeCredits: number, feeCredits: number, atMs: number): Promise<void> {
  if (!(tradeCredits >= (balance.achievements?.minCountedTradeCredits ?? 0))) return;
  await recordAchievement(tx, playerId, "handel_gebuehr", feeCredits, { atMs, weekly: false });
}

export async function achievementsFromDaily(tx: DbOrTx, playerId: number, kind: string, amount: number, atMs: number): Promise<void> {
  for (const [counter, n] of FROM_DAILY[kind]?.(amount) ?? []) await recordAchievement(tx, playerId, counter, n, { atMs });
}

// ---------------------------------------------------------------- Zustand (Bestwerte)

/**
 * Ökostrom (v1.21): genutzter Ökostrom aller Häfen (state.powerLog.greenUsed, Saisonsumme) als Zuwachs auf den Zähler
 * oekostrom (Erfolg „Grüner Hafen“, Wochenziel). Der zuletzt gezählte Stand steht im Zähler oekostrom_stand; sinkt die
 * Summe (Saisonwechsel, Hafen aufgegeben), wird nur der Stand nachgeführt.
 */
export async function refreshGreenCounter(tx: DbOrTx, playerId: number, nowMs: number): Promise<void> {
  if (!balance.achievements || !balance.power?.green) return;
  const rows = await tx.select({ state: tables.base.state }).from(tables.base).where(eq(tables.base.playerId, playerId));
  const sum = Math.floor(rows.reduce((a, r) => a + ((r.state as { powerLog?: { greenUsed?: number } }).powerLog?.greenUsed ?? 0), 0));
  const [row] = await tx.select({ value: ac.value }).from(ac).where(and(eq(ac.playerId, playerId), eq(ac.counter, "oekostrom_stand"))).for("update");
  const before = Number(row?.value ?? 0);
  if (sum === before) return;
  await tx.insert(ac).values({ playerId, counter: "oekostrom_stand", value: sum, updatedAt: new Date(nowMs) })
    .onConflictDoUpdate({ target: [ac.playerId, ac.counter], set: { value: sum, updatedAt: new Date(nowMs) } });
  if (sum > before) await recordAchievement(tx, playerId, "oekostrom", sum - before, { atMs: nowMs });
}

/** Bestwerte aus dem Zustand fortschreiben: Prachtbauten, vollständige Forschung, Serie, Saisonplatzierung, Ökostrom. */
export async function refreshAchievementState(tx: DbOrTx, playerId: number, nowMs: number): Promise<void> {
  if (!balance.achievements) return;
  await refreshGreenCounter(tx, playerId, nowMs);
  // Mehrere Häfen: Prachtbauten als Maximum über alle Häfen, Forschung aus dem Heimathafen.
  const rows = await tx.select({ state: tables.base.state, isHome: tables.base.isHome }).from(tables.base).where(eq(tables.base.playerId, playerId));
  if (rows.length > 0) {
    type S = { buildings?: Counts; research?: { levels?: Counts } };
    const from = baumeisterFrom(); // v1.35: Baumeister ab Stufe 12 (M-12)
    const pracht = Math.max(...rows.map((r) => Object.values((r.state as S).buildings ?? {}).filter((l) => l >= from).length));
    const home = (rows.find((r) => r.isHome) ?? rows[0]).state as S;
    const techs = balance.research?.techs ?? {};
    const full = Object.entries(home.research?.levels ?? {}).filter(([id, l]) => techs[id] && l >= techs[id].maxLevel).length;
    await recordAchievement(tx, playerId, "prachtbau", pracht, { atMs: nowMs, mode: "max" });
    await recordAchievement(tx, playerId, "forschung_voll", full, { atMs: nowMs, mode: "max" });
  }
  const [st] = await tx.select({ best: tables.dailyStreak.best }).from(tables.dailyStreak).where(eq(tables.dailyStreak.playerId, playerId));
  if (st) await recordAchievement(tx, playerId, "serie", st.best, { atMs: nowMs, mode: "max" });
  const results = await tx
    .select({ rank: tables.seasonResult.rank, total: tables.seasonResult.total })
    .from(tables.seasonResult)
    .where(eq(tables.seasonResult.playerId, playerId));
  const best = Math.max(0, ...results.map((r) => placementScore(r.rank, r.total)));
  await recordAchievement(tx, playerId, "saison", best, { atMs: nowMs, mode: "max" });
}

// ---------------------------------------------------------------- Ereignisse (Berichte)

export type AchievementSnapshot = { maxReportId: number; ownerId: number | null } | null;

const STATE_EVENTS = new Set(["build_complete", "research_complete"]);

/** Vor dem Handler: höchste Berichtsnummer (neue Berichte danach werten wir aus). Wirft nie. */
export async function achievementSnapshot(tx: Tx, ev: EventRow): Promise<AchievementSnapshot> {
  if (!balance.achievements) return null;
  try {
    return await tx.transaction(async (inner) => {
      const [m] = await inner.select({ id: sql<number>`coalesce(max(${tables.battleReport.id}), 0)::int` }).from(tables.battleReport);
      let ownerId: number | null = null;
      if (STATE_EVENTS.has(ev.type) && ev.baseId) ownerId = (await readBase(inner, ev.baseId))?.playerId ?? null;
      return { maxReportId: Number(m?.id ?? 0), ownerId };
    });
  } catch {
    return null;
  }
}

const sum = (m: Counts | ResourceMap | null | undefined) => Object.values(m ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);

type ReportRow = {
  id: number;
  kind: string;
  winner: string | null;
  attackerPlayerId: number | null;
  defenderPlayerId: number | null;
  nestId: number | null;
  report: unknown;
};
type ReportData = {
  battle?: { loot?: ResourceMap; defender?: { losses?: Counts } };
  worldEvent?: { destroyed?: boolean };
};

async function sameAlliance(tx: DbOrTx, a: number, b: number): Promise<boolean> {
  const rows = await tx.select({ id: tables.allianceMember.allianceId }).from(tables.allianceMember).where(inArray(tables.allianceMember.playerId, [a, b]));
  return rows.length === 2 && rows[0].id === rows[1].id;
}

/** Zähler aus einem Bericht (rein bis auf Nest-Stufe und Allianz). Rückgabe: [Spieler, Zähler, Menge, Stufe?]. */
async function signals(tx: DbOrTx, r: ReportRow): Promise<[number, string, number, number?][]> {
  const out: [number, string, number, number?][] = [];
  const d = (r.report ?? {}) as ReportData;
  const att = r.attackerPlayerId;
  const def = r.defenderPlayerId;
  const defended = () => {
    if (def === null || r.winner !== "defender") return;
    out.push([def, "abwehr", 1]);
    if (d.battle && sum(d.battle.defender?.losses) === 0) out.push([def, "abwehr_ohne_verluste", 1]);
  };
  if (r.kind === "ueberfall") {
    if (att !== null) {
      out.push([att, "beute", sum(d.battle?.loot)]);
      if (r.winner === "attacker") {
        out.push([att, "missionen", 1]);
        if (r.nestId !== null) {
          const [n] = await tx.select({ level: tables.nest.level }).from(tables.nest).where(eq(tables.nest.id, r.nestId));
          out.push([att, "nester", 1, n?.level]);
        } else out.push([att, "ueberfaelle", 1]);
      }
    }
    defended();
  } else if (r.kind === "kartell") {
    defended();
  } else if (r.kind === "weltereignis") {
    if (att !== null && r.winner === "attacker") out.push([att, "missionen", 1]);
    if (att !== null && d.worldEvent?.destroyed) out.push([att, "weltereignisse", 1]);
    defended();
  } else if (r.kind === "spionage") {
    if (att !== null && r.winner === "attacker") out.push([att, "spionage", 1], [att, "missionen", 1]);
  } else if (r.kind === "aufklaerung") {
    if (att !== null) out.push([att, "missionen", 1]);
  } else if (r.kind === "transport") {
    if (att !== null) {
      out.push([att, "missionen", 1]);
      if (def !== null && def !== att && (await sameAlliance(tx, att, def))) out.push([att, "allianz_hilfe", 1]);
    }
  }
  return out.filter(([, , n]) => n > 0);
}

async function afterEvent(tx: Tx, due: number, snap: NonNullable<AchievementSnapshot>): Promise<void> {
  // Neue Berichte genau einmal auswerten: Markierung „erfolge“ im Bericht (auch bei gleichzeitigen Workern).
  const br = tables.battleReport;
  const fresh = await tx
    .update(br)
    .set({ report: sql`${br.report} || '{"erfolge":true}'::jsonb` })
    .where(and(gt(br.id, snap.maxReportId), sql`not (${br.report} ? 'erfolge')`))
    .returning({ id: br.id, kind: br.kind, winner: br.winner, attackerPlayerId: br.attackerPlayerId, defenderPlayerId: br.defenderPlayerId, nestId: br.nestId, report: br.report });
  for (const r of fresh.sort((a, b) => a.id - b.id)) {
    for (const [pid, counter, n, level] of await signals(tx, r)) await recordAchievement(tx, pid, counter, n, { atMs: due, level });
  }
  if (snap.ownerId !== null) await refreshAchievementState(tx, snap.ownerId, due);
}

/** Nach dem Handler: neue Berichte und Zustand auswerten. Wirft nie. */
export async function achievementsAfter(tx: Tx, due: number, snap: AchievementSnapshot): Promise<void> {
  if (!snap) return;
  try {
    await tx.transaction((inner) => afterEvent(inner, due, snap));
  } catch (err) {
    console.error("achievementsAfter", String(err));
  }
}

// ---------------------------------------------------------------- Push und Rangliste

/** Push für frisch freigeschaltete Stufen (Worker, jede Minute). Rückgabe: Anzahl. */
export async function flushAchievementNotices(engine: Engine, limit = 200): Promise<number> {
  if (!balance.achievements) return 0;
  const jobs: NoticeJob[] = [];
  const ids = new Set<number>();
  await engine.db.transaction(async (tx) => {
    const rows = await tx.select().from(at).where(isNull(at.notifiedAt)).orderBy(at.id).limit(limit).for("update", { skipLocked: true });
    if (rows.length === 0) return;
    await tx.update(at).set({ notifiedAt: new Date() }).where(inArray(at.id, rows.map((r) => r.id)));
    for (const r of rows) {
      const a = achievementById(r.achievementId);
      if (!a) continue;
      ids.add(r.playerId);
      jobs.push({ playerId: r.playerId, notice: {
        kind: "report", url: "/?tab=berichte&sub=erfolge", tag: `erfolg-${r.achievementId}`,
        title: `Erfolg: ${a.title} (${TIER_NAMES[r.tier - 1]})`, body: `${tierText(a, r.tier)}. Belohnung abholen unter Meldungen → Rangliste → Erfolge.`,
        facts: [["Erfolg", a.title], ["Stufe", TIER_NAMES[r.tier - 1] ?? String(r.tier)], ["Erreicht", tierText(a, r.tier)]], // E-Mail
        mail: { subject: `Erfolg freigeschaltet: ${a.title} (${TIER_NAMES[r.tier - 1]})` },
      } });
    }
  });
  if (ids.size > 0) engine.notify([...ids], "messages");
  if (jobs.length > 0) engine.push?.(jobs);
  return jobs.length;
}

/** Höchste Abzeichen je Spieler (höchste Stufe zuerst, dann Reihenfolge der Balance), höchstens `max`. */
export interface Badge {
  id: string;
  tier: number;
  title: string;
}

export async function topBadges(db: DbOrTx, playerIds: number[], max = 3): Promise<Map<number, Badge[]>> {
  const out = new Map<number, Badge[]>();
  if (!balance.achievements || playerIds.length === 0) return out;
  const rows = await db
    .select({ playerId: at.playerId, id: at.achievementId, tier: sql<number>`max(${at.tier})::int` })
    .from(at)
    .where(inArray(at.playerId, playerIds))
    .groupBy(at.playerId, at.achievementId);
  const order = new Map(achievementList().map((a, i) => [a.id, i]));
  for (const r of rows) {
    if (!order.has(r.id)) continue;
    const list = out.get(r.playerId) ?? [];
    list.push({ id: r.id, tier: Number(r.tier), title: achievementById(r.id)!.title });
    out.set(r.playerId, list);
  }
  for (const [pid, list] of out) {
    list.sort((a, b) => b.tier - a.tier || order.get(a.id)! - order.get(b.id)!);
    out.set(pid, list.slice(0, max));
  }
  return out;
}
