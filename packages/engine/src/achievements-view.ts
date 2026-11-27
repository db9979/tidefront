// Erfolge und Wochenziele für Spieler: Ansichten und Abholen der Belohnungen (genau einmal, Befehle mit
// Idempotenz-Schlüssel über runCommand). Taler laufen über das Journal (Konto „rewards“), damit die
// Prüfung von Journal und Talerständen stimmt; Ressourcen gehen in den Heimathafen bis zur Lagergrenze, der Rest
// verfällt und steht in `lost` der Antwort. Die Ansichten liefern dazu das Lager des Heimathafens (`storage`).
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { deliverToStorage } from "./guide.ts";
import { tables, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand } from "./commands.ts";
import { baseOfPlayer, lockBase, saveBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { addLost, rewardStorage } from "./reward-storage.ts";
import { recordAchievement, refreshAchievementState, refreshGreenCounter, topBadges } from "./achievements.ts";
import { ensureWeekly, refreshWeeklyDerived, weeklyContextFor, type WeeklyRow } from "./weekly.ts";
import {
  achievementById,
  achievementList,
  nextWeekStartMs,
  splitReward,
  TIER_NAMES,
  tierFor,
  tierText,
  weekKey,
  weeklyBonus,
  weeklyIcon,
  weeklyText,
} from "./achievement-defs.ts";

/** Belohnung in fester Reihenfolge: Ressourcen wie in der Balance, dann Taler (jsonb sortiert Schlüssel um). */
function ordered(r: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of [...balance.resources, "credits"]) if (r && (r[k] ?? 0) > 0) out[k] = r[k];
  return out;
}

function fail(code: string): never {
  throw new GameError(code);
}

/** Belohnung gutschreiben: Ressourcen in den Heimathafen (bis zur Lagergrenze), Taler über das Journal. Gibt den verfallenen Rest zurück. */
async function payReward(tx: Tx, playerId: number, reward: Record<string, number>, nowMs: number, tradeId: string): Promise<Record<string, number>> {
  const { credits, resources } = splitReward(reward);
  let lost: Record<string, number> = {};
  if (Object.keys(resources).length > 0) {
    const own = await baseOfPlayer(tx, playerId); // Mehrere Häfen: bewusst Heimathafen (Belohnung dorthin)
    if (!own) fail("no_base");
    const b = (await lockBase(tx, own.id))!;
    const mods = await modsOf(tx, b, nowMs);
    const d = deliverToStorage(b.state, resources, nowMs, mods); // bis zur Lagergrenze (wie Auftragsbuch)
    await saveBase(tx, b.id, d.state);
    lost = d.lost;
  }
  if (credits > 0) {
    const [p] = await tx.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId)).for("update");
    const trader = p.trader as { credits: number };
    const next = Math.round((trader.credits + credits) * 100) / 100;
    await tx.update(tables.player).set({ trader: { ...trader, credits: next } }).where(eq(tables.player.id, playerId));
    await tx.insert(tables.tradeLedger).values([
      { tradeId, tMs: nowMs, account: `player:${playerId}`, asset: "credits", amount: credits.toFixed(2) },
      { tradeId, tMs: nowMs, account: "rewards", asset: "credits", amount: (-credits).toFixed(2) },
    ]);
  }
  return lost;
}

// ---------------------------------------------------------------- Erfolge

/** Alle Erfolge des Spielers mit Zählerstand, Stufen, Belohnungen und Abholstatus. */
export async function achievementsView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  return engine.db.transaction(async (tx) => {
    await refreshAchievementState(tx, playerId, nowMs);
    const counters = await tx.select().from(tables.achievementCounter).where(eq(tables.achievementCounter.playerId, playerId));
    const tiers = await tx.select().from(tables.achievementTier).where(eq(tables.achievementTier.playerId, playerId));
    const value = new Map(counters.map((c) => [c.counter, Number(c.value)]));
    const list = achievementList().map((a) => {
      const v = value.get(a.counter) ?? 0;
      const tier = tierFor(v, a.thresholds);
      const next = tier < 3 ? a.thresholds[tier] : null;
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        value: v,
        tier,
        tierName: tier > 0 ? TIER_NAMES[tier - 1] : null,
        next,
        /** Fortschritt zur nächsten Stufe (0–1), von der letzten Schwelle aus. */
        share: next === null ? 1 : Math.min(1, v / next),
        placement: !!a.tierTexts,
        tiers: a.thresholds.map((threshold, i) => {
          const row = tiers.find((t) => t.achievementId === a.id && t.tier === i + 1);
          return {
            tier: i + 1,
            name: TIER_NAMES[i],
            threshold,
            text: tierText(a, i + 1),
            reward: ordered((row?.reward ?? a.rewards?.[i] ?? balance.achievements!.rewards[i]) as Record<string, number>),
            unlocked: !!row,
            claimed: !!row?.claimedAt,
            unlockedAtMs: row?.unlockedAt.getTime() ?? null,
          };
        }),
      };
    });
    const badges = (await topBadges(tx, [playerId])).get(playerId) ?? [];
    return {
      achievements: list,
      claimable: tiers.filter((t) => !t.claimedAt && achievementById(t.achievementId)).length,
      unlocked: tiers.length,
      total: list.length * 3,
      badges,
      /** Lager des Heimathafens: Warnung vor dem Abholen, wenn etwas verfiele. */
      storage: await rewardStorage(tx, playerId, nowMs),
    };
  });
}

/** Belohnung einer freigeschalteten Stufe abholen (genau einmal). Codes: no_base, not_unlocked, already_claimed. */
export function claimAchievement(engine: Engine, playerId: number, key: string, achievementId: string, tier: number) {
  return runCommand<{ ok: true; reward: Record<string, number>; lost: Record<string, number> }>(engine, playerId, key, "achievementClaim", async (ctx) => {
    const t = tables.achievementTier;
    const [row] = await ctx.tx.select().from(t)
      .where(and(eq(t.playerId, playerId), eq(t.achievementId, achievementId), eq(t.tier, tier)))
      .for("update");
    if (!row || !achievementById(achievementId)) fail("not_unlocked");
    if (row.claimedAt) fail("already_claimed");
    const reward = row.reward as Record<string, number>;
    const lost = await payReward(ctx.tx, playerId, reward, ctx.nowMs, `erfolg-${row.id}`);
    await ctx.tx.update(t).set({ claimedAt: new Date(ctx.nowMs) }).where(eq(t.id, row.id));
    ctx.notify.push([[playerId], "base"]);
    return { ok: true as const, reward, lost };
  });
}

// ---------------------------------------------------------------- Wochenziele

function shapeGoal(r: WeeklyRow) {
  return {
    id: r.id,
    week: r.week,
    slot: r.slot,
    kind: r.kind,
    icon: weeklyIcon(r.kind),
    text: weeklyText(r.kind, r.target, r.param),
    target: r.target,
    progress: r.progress,
    reward: ordered(r.reward as Record<string, number>),
    bonus: r.bonus ? ordered(r.bonus as Record<string, number>) : null,
    done: r.completedAt !== null,
    claimed: r.claimedAt !== null,
  };
}

export type WeeklyGoal = ReturnType<typeof shapeGoal>;

/** Wochenziele der laufenden Woche (vergibt sie beim ersten Abruf) und noch nicht abgeholte der Vorwochen. */
export async function weeklyView(engine: Engine, playerId: number) {
  const nowMs = Date.now();
  const week = weekKey(nowMs);
  return engine.db.transaction(async (tx) => {
    await refreshGreenCounter(tx, playerId, nowMs); // Ökostrom (v1.21): Wochenziel vor dem Lesen fortschreiben
    const rows = await refreshWeeklyDerived(tx, playerId, await ensureWeekly(tx, playerId, week, nowMs), nowMs);
    const wg = tables.weeklyGoal;
    const older = await tx.select().from(wg)
      .where(and(eq(wg.playerId, playerId), lt(wg.week, week), isNotNull(wg.completedAt), isNull(wg.claimedAt)))
      .orderBy(desc(wg.week), asc(wg.slot))
      .limit(6);
    // Bestwerte (Serie, Prachtbau …) auch hier fortschreiben: die Basis fragt regelmäßig ab.
    await refreshAchievementState(tx, playerId, nowMs);
    const c = rows.length > 0 ? await weeklyContextFor(tx, playerId, nowMs) : null;
    const all = [...rows, ...older];
    return {
      serverNow: nowMs,
      week,
      nextWeekAtMs: nextWeekStartMs(nowMs),
      hasBase: rows.length > 0,
      goals: rows.map(shapeGoal),
      older: older.map(shapeGoal),
      claimable: all.filter((r) => r.completedAt && !r.claimedAt).length,
      bonus: { reward: ordered(weeklyBonus(c?.stage ?? 0)), paid: rows.some((r) => r.bonus !== null) },
      /** Lager des Heimathafens: Warnung vor dem Abholen (Ziel und ggf. Wochenbonus). */
      storage: rows.length > 0 ? await rewardStorage(tx, playerId, nowMs) : null,
    };
  });
}

/**
 * Belohnung eines erfüllten Wochenziels abholen (genau einmal). Sind danach alle drei Ziele dieser Woche
 * abgeholt, gibt es einmal den Wochenbonus. Codes: no_base, no_goal, not_done, already_claimed.
 */
export function claimWeekly(engine: Engine, playerId: number, key: string, goalId: number) {
  return runCommand<{ ok: true; reward: Record<string, number>; bonus: Record<string, number> | null; lost: Record<string, number> }>(
    engine, playerId, key, "weeklyClaim", async (ctx) => {
      const wg = tables.weeklyGoal;
      await refreshGreenCounter(ctx.tx, playerId, ctx.nowMs); // Ökostrom (v1.21)
      const [found] = await ctx.tx.select().from(wg).where(and(eq(wg.id, goalId), eq(wg.playerId, playerId))).for("update");
      if (!found) fail("no_goal");
      if (found.claimedAt) fail("already_claimed");
      const [row] = await refreshWeeklyDerived(ctx.tx, playerId, [found], ctx.nowMs);
      if (!row.completedAt) fail("not_done");
      const reward = row.reward as Record<string, number>;
      const lost = await payReward(ctx.tx, playerId, reward, ctx.nowMs, `woche-${row.id}`);
      await ctx.tx.update(wg).set({ claimedAt: new Date(ctx.nowMs) }).where(eq(wg.id, row.id));

      // Wochenbonus: alle drei Ziele der Woche abgeholt, noch kein Bonus gezahlt (Zeilen gesperrt).
      let bonus: Record<string, number> | null = null;
      const week = await ctx.tx.select().from(wg).where(and(eq(wg.playerId, playerId), eq(wg.week, row.week))).for("update");
      if (week.length >= 3 && week.every((r) => r.claimedAt !== null || r.id === row.id) && !week.some((r) => r.bonus !== null)) {
        const own = await baseOfPlayer(ctx.tx, playerId); // Mehrere Häfen: bewusst Heimathafen (Bonus nach dessen Kommandozentrale)
        bonus = weeklyBonus(own?.state.buildings.kommandozentrale ?? 0);
        addLost(lost, await payReward(ctx.tx, playerId, bonus, ctx.nowMs, `woche-${row.week}-bonus-${playerId}`));
        await ctx.tx.update(wg).set({ bonus }).where(eq(wg.id, row.id));
      }
      await recordAchievement(ctx.tx, playerId, "wochenziele", 1, { atMs: ctx.nowMs });
      ctx.notify.push([[playerId], "base"]);
      return { ok: true as const, reward, bonus, lost };
    },
  );
}
