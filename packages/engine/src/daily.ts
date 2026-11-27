// Tagesbefehle für Spieler: Ansicht, Abholen der Belohnung (mit Serienbonus) und einmal täglich neu würfeln.
// Abholen und Würfeln sind Befehle mit Idempotenz-Schlüssel (runCommand).
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { type ResourceMap } from "@tidefront/game-core";
import { deliverToStorage } from "./guide.ts";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { baseOfPlayer, lockBase, saveBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import {
  addDays,
  challengeIcon,
  challengeText,
  dayKey,
  drawChallenge,
  nextDayStartMs,
  nextStreakMilestone,
  streakBonus,
  TIER_NAMES,
  type Tier,
} from "./challenge-pool.ts";
import { challengePoints, contextFor, ensureAssigned, refreshDerived, type ChallengeRow } from "./challenges.ts";
import { runningSeason } from "./season.ts";
import { addLost, rewardStorage } from "./reward-storage.ts";

const dc = tables.dailyChallenge;

function fail(code: string): never {
  throw new GameError(code);
}

function shape(r: ChallengeRow) {
  return {
    id: r.id,
    day: r.day,
    slot: r.slot,
    tier: TIER_NAMES[r.slot as Tier] ?? "leicht",
    kind: r.kind,
    icon: challengeIcon(r.kind),
    text: challengeText(r.kind, r.target, r.param),
    param: r.param,
    target: r.target,
    progress: r.progress,
    reward: r.reward as ResourceMap,
    points: r.points,
    bonusPoints: r.bonusPoints,
    rerolled: r.rerolled,
    done: r.completedAt !== null,
    claimed: r.claimedAt !== null,
  };
}

export type DailyChallenge = ReturnType<typeof shape>;

async function streakOf(db: DbOrTx, playerId: number, today: string) {
  const [s] = await db.select().from(tables.dailyStreak).where(eq(tables.dailyStreak.playerId, playerId));
  // Die Serie hält, solange gestern oder heute abgeschlossen wurde.
  const alive = !!s && (s.lastDay === today || s.lastDay === addDays(today, -1));
  const length = alive ? s!.length : 0;
  const todayDone = !!s && s.lastDay === today;
  return { length, best: s?.best ?? 0, todayDone, nextMilestone: nextStreakMilestone(length) };
}

/** Tagesbefehle des Spielers (vergibt sie beim ersten Abruf des Tages). */
export async function dailyView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const today = dayKey(nowMs);
  return engine.db.transaction(async (tx) => {
    const rows = await refreshDerived(tx, playerId, await ensureAssigned(tx, playerId, today, nowMs), nowMs);
    // Erledigt, aber noch nicht abgeholt, von früheren Tagen.
    const older = await tx
      .select()
      .from(dc)
      .where(and(eq(dc.playerId, playerId), lt(dc.day, today), isNotNull(dc.completedAt), isNull(dc.claimedAt)))
      .orderBy(desc(dc.day), asc(dc.slot))
      .limit(6);
    const s = await runningSeason(tx);
    const points = s ? (await challengePoints(tx, s.startsAt.getTime())).get(playerId) ?? 0 : 0;
    const streak = await streakOf(tx, playerId, today);
    const all = [...rows, ...older];
    return {
      serverNow: nowMs,
      day: today,
      nextDayAtMs: nextDayStartMs(nowMs),
      hasBase: rows.length > 0,
      challenges: rows.map(shape),
      older: older.map(shape),
      claimable: all.filter((r) => r.completedAt && !r.claimedAt).length,
      rerollAvailable: rows.length > 0 && !rows.some((r) => r.rerolled) && rows.some((r) => !r.completedAt),
      seasonPoints: points,
      streak: { ...streak, nextBonusPoints: streakBonus(streak.nextMilestone, 0)?.points ?? 0 },
      /** Lager des Heimathafens (Belohnungen gehen dorthin, bis zur Lagergrenze): Warnung vor dem Abholen. */
      storage: await rewardStorage(tx, playerId, nowMs),
    };
  });
}

/**
 * Belohnung eines erledigten Befehls abholen (genau einmal). Ressourcen gehen in den Heimathafen, bis zur
 * Lagergrenze; der Rest verfällt und steht in `lost` (Belohnung und Serienbonus zusammen). Sind danach alle drei Befehle dieses Tages abgeholt, wächst die Serie (Serienbonus).
 * Codes: no_base, no_challenge, not_done, already_claimed.
 */
export function claimChallenge(engine: Engine, playerId: number, key: string, challengeId: number) {
  return runCommand<{ ok: true; reward: ResourceMap; points: number; streak: number | null; bonus: { points: number; reward: ResourceMap } | null; lost: ResourceMap }>(
    engine, playerId, key, "dailyClaim", (ctx) => claimChallengeIn(ctx, playerId, challengeId));
}

/** Kern von claimChallenge in einer bestehenden Transaktion (auch für „Alle abholen“, rewards-claim.ts). */
export async function claimChallengeIn(ctx: Ctx, playerId: number, challengeId: number) {
  const own = await baseOfPlayer(ctx.tx, playerId); // Mehrere Häfen: bewusst Heimathafen (Belohnung dorthin)
  if (!own) fail("no_base");
  const b = await lockBase(ctx.tx, own.id);
  if (!b) fail("no_base");
  const [found] = await ctx.tx.select().from(dc).where(and(eq(dc.id, challengeId), eq(dc.playerId, playerId))).for("update");
  if (!found) fail("no_challenge");
  if (found.claimedAt) fail("already_claimed");
  const [row] = await refreshDerived(ctx.tx, playerId, [found], ctx.nowMs);
  if (!row.completedAt) fail("not_done");
  const reward = row.reward as ResourceMap;
  const mods = await modsOf(ctx.tx, b, ctx.nowMs);
  const first = deliverToStorage(b.state, reward, ctx.nowMs, mods); // bis zur Lagergrenze (wie Auftragsbuch)
  let state = first.state;
  const lost = addLost({}, first.lost);
  await ctx.tx.update(dc).set({ claimedAt: new Date(ctx.nowMs) }).where(eq(dc.id, row.id));

  // Tagesabschluss: alle drei Befehle des Tages abgeholt.
  let streak: number | null = null;
  let bonus: { points: number; reward: ResourceMap } | null = null;
  const day = await ctx.tx.select({ claimedAt: dc.claimedAt }).from(dc).where(and(eq(dc.playerId, playerId), eq(dc.day, row.day)));
  if (day.length >= 3 && day.every((r) => r.claimedAt !== null)) {
    const [s] = await ctx.tx.select().from(tables.dailyStreak).where(eq(tables.dailyStreak.playerId, playerId)).for("update");
    if (!s || s.lastDay < row.day) {
      streak = s && s.lastDay === addDays(row.day, -1) ? s.length + 1 : 1;
      const best = Math.max(streak, s?.best ?? 0);
      await ctx.tx
        .insert(tables.dailyStreak)
        .values({ playerId, lastDay: row.day, length: streak, best })
        .onConflictDoUpdate({ target: tables.dailyStreak.playerId, set: { lastDay: row.day, length: streak, best, updatedAt: new Date(ctx.nowMs) } });
      bonus = streakBonus(streak, b.state.buildings.kommandozentrale ?? 0);
      if (bonus) {
        const d = deliverToStorage(state, bonus.reward, ctx.nowMs, mods);
        state = d.state;
        addLost(lost, d.lost);
        await ctx.tx.update(dc).set({ bonusPoints: bonus.points }).where(eq(dc.id, row.id));
      }
    }
  }
  await saveBase(ctx.tx, b.id, state);
  ctx.notify.push([[playerId], "base"]);
  return { ok: true as const, reward, points: row.points, streak, bonus, lost };
}

/**
 * Einen noch nicht erledigten Befehl des Tages kostenlos neu würfeln, höchstens einmal je Tag.
 * Der neue Befehl hat dieselbe Stufe und eine andere Art; sein Fortschritt beginnt bei 0.
 * Codes: no_base, no_challenge, reroll_used, already_done, no_alternative.
 */
export function rerollChallenge(engine: Engine, playerId: number, key: string, slot: number) {
  return runCommand<{ ok: true; kind: string }>(engine, playerId, key, "dailyReroll", async (ctx) => {
    const today = dayKey(ctx.nowMs);
    const assigned = await ensureAssigned(ctx.tx, playerId, today, ctx.nowMs);
    if (assigned.length === 0) fail("no_base");
    const rows = await ctx.tx
      .select()
      .from(dc)
      .where(and(eq(dc.playerId, playerId), eq(dc.day, today)))
      .orderBy(asc(dc.slot))
      .for("update");
    if (rows.some((r) => r.rerolled)) fail("reroll_used");
    const row = rows.find((r) => r.slot === slot);
    if (!row) fail("no_challenge");
    if (row.completedAt) fail("already_done");
    if (row.kind === "gesuch") fail("already_done"); // Weltpolitik: ein angenommenes Gesuch belegt den Platz
    const c = await contextFor(ctx.tx, playerId, ctx.nowMs);
    if (!c) fail("no_base");
    const d = drawChallenge(c, slot as Tier, new Set(rows.map((r) => r.kind)), `${playerId}|${today}|${slot}|neu`);
    if (!d) fail("no_alternative");
    const [updated] = await ctx.tx
      .update(dc)
      .set({ kind: d.kind, param: d.param, target: d.target, progress: 0, rerolled: true })
      .where(eq(dc.id, row.id))
      .returning();
    await refreshDerived(ctx.tx, playerId, [updated], ctx.nowMs);
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, kind: d.kind };
  });
}
