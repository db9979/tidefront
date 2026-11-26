// Router für Erfolge (Abzeichen) und Wochenziele: Ansichten und Abholen. Eingehängt in router.ts.
import { z } from "zod";
import { achievementsView, claimAchievement, claimWeekly, weeklyView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const achievementsRouter = t.router({
  get: authed.query(({ ctx }) => achievementsView(ctx.engine, ctx.player.id)),
  claim: authed
    .input(z.object({ key, id: z.string().min(1).max(40), tier: z.number().int().min(1).max(3) }))
    .mutation(({ ctx, input }) => claimAchievement(ctx.engine, ctx.player.id, input.key, input.id, input.tier)),
  weekly: authed.query(({ ctx }) => weeklyView(ctx.engine, ctx.player.id)),
  claimWeekly: authed
    .input(z.object({ key, id: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => claimWeekly(ctx.engine, ctx.player.id, input.key, input.id)),
});
