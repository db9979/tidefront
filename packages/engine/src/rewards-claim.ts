// „Alle abholen“ (TST-09, Abschlussprüfung 0.38): alle abholbereiten Belohnungen – Auftragsbuch (Schritte und
// Abschluss), Tagesbefehle, Wochenziele, Erfolge – in EINER Transaktion statt je Belohnung ein Befehl mit acht
// Folgeabfragen. Jede Belohnung läuft in einem eigenen Savepoint über denselben Kern wie die Einzelabholung
// (claim…In); was nicht abholbar ist, fällt still weg. Lagergrenze: Würde bei einer Belohnung etwas verfallen,
// bleibt sie liegen (skipped) – außer allowLoss ist gesetzt (dann wie bisher bis zur Grenze, Rest in `lost`).
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ResourceMap } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { GameError, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { claimGuideFinalIn, claimGuideStepIn, GUIDE_STEPS } from "./guide.ts";
import { claimChallengeIn } from "./daily.ts";
import { claimAchievementIn, claimWeeklyIn } from "./achievements-view.ts";
import { addLost } from "./reward-storage.ts";

export type ClaimSource = "guide" | "daily" | "weekly" | "achievements";

export interface ClaimAllResult {
  ok: true;
  /** Abgeholte Belohnungen je Quelle und gesamt. */
  claimed: Record<ClaimSource, number> & { total: number };
  /** Gutgeschrieben (Ressourcen und credits), Boni eingerechnet. */
  rewards: ResourceMap;
  /** Verfallen wegen Lagergrenze (nur mit allowLoss). */
  lost: ResourceMap;
  /** Liegen gelassen, weil sonst etwas verfallen wäre (ohne allowLoss); später nach Lagerausbau abholen. */
  skipped: Record<ClaimSource, number> & { total: number };
}

/** Höchstzahl Zeilen je Quelle in einem Lauf (Rückkehrer mit vielen offenen Belohnungen). */
const MAX_PER_SOURCE = 40;

class WouldLose extends Error {}

const hasLoss = (lost: ResourceMap | undefined) => Object.values(lost ?? {}).some((n) => n > 0);

function addInto(into: ResourceMap, more: ResourceMap | null | undefined): void {
  for (const [r, n] of Object.entries(more ?? {})) if (n > 0) into[r] = (into[r] ?? 0) + n;
}

/** Codes: nothing (nichts abholbereit), storage_full (alles würde ganz oder teilweise verfallen). */
export function claimAllRewards(engine: Engine, playerId: number, key: string, opts: { allowLoss?: boolean } = {}) {
  return runCommand<ClaimAllResult>(engine, playerId, key, "rewardsClaimAll", (ctx) => claimAllIn(ctx, playerId, opts.allowLoss === true));
}

export async function claimAllIn(ctx: Ctx, playerId: number, allowLoss: boolean): Promise<ClaimAllResult | { ok: false; code: string }> {
  const zero = () => ({ guide: 0, daily: 0, weekly: 0, achievements: 0, total: 0 });
  const claimed = zero();
  const skipped = zero();
  const rewards: ResourceMap = {};
  const lost: ResourceMap = {};

  /** Eine Abholung im Savepoint; GameError (nicht fertig, schon abgeholt …) = nicht abholbar. */
  const attempt = async <R extends { lost: ResourceMap }>(src: ClaimSource, fn: (c: Ctx) => Promise<R>, gained: (r: R) => ResourceMap[]) => {
    try {
      const r = await ctx.tx.transaction(async (inner) => {
        const res = await fn({ ...ctx, tx: inner });
        if (!allowLoss && hasLoss(res.lost)) throw new WouldLose();
        return res;
      });
      claimed[src]++;
      claimed.total++;
      for (const g of gained(r)) addInto(rewards, g);
      addLost(lost, r.lost);
    } catch (err) {
      if (err instanceof WouldLose) {
        skipped[src]++;
        skipped.total++;
      } else if (!(err instanceof GameError)) throw err;
    }
  };

  // Auftragsbuch: Schritte in Reihenfolge, danach der Abschluss (braucht alle Schritte).
  for (const s of GUIDE_STEPS) await attempt("guide", (c) => claimGuideStepIn(c, playerId, s.id), (r) => [r.reward]);
  await attempt("guide", (c) => claimGuideFinalIn(c, playerId), (r) => [r.reward]);

  const dc = tables.dailyChallenge;
  const days = await ctx.tx.select({ id: dc.id }).from(dc).where(and(eq(dc.playerId, playerId), isNull(dc.claimedAt))).orderBy(asc(dc.id)).limit(MAX_PER_SOURCE);
  for (const d of days) await attempt("daily", (c) => claimChallengeIn(c, playerId, d.id), (r) => [r.reward, r.bonus?.reward ?? {}]);

  const wg = tables.weeklyGoal;
  const goals = await ctx.tx.select({ id: wg.id }).from(wg).where(and(eq(wg.playerId, playerId), isNull(wg.claimedAt))).orderBy(asc(wg.id)).limit(MAX_PER_SOURCE);
  for (const g of goals) await attempt("weekly", (c) => claimWeeklyIn(c, playerId, g.id), (r) => [r.reward, r.bonus ?? {}]);

  const at = tables.achievementTier;
  const tiers = await ctx.tx.select({ achievementId: at.achievementId, tier: at.tier }).from(at)
    .where(and(eq(at.playerId, playerId), isNull(at.claimedAt))).orderBy(asc(at.id)).limit(MAX_PER_SOURCE);
  for (const t of tiers) await attempt("achievements", (c) => claimAchievementIn(c, playerId, t.achievementId, t.tier), (r) => [r.reward]);

  if (claimed.total === 0) return { ok: false, code: skipped.total > 0 ? "storage_full" : "nothing" };
  ctx.notify.push([[playerId], "base"]);
  return { ok: true, claimed, rewards, lost, skipped };
}
