// Router für Tagesbefehle: Ansicht, Abholen, neu würfeln. Eingehängt in router.ts.
import { z } from "zod";
import { claimChallenge, dailyView, rerollChallenge } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const dailyRouter = t.router({
  get: authed.query(({ ctx }) => dailyView(ctx.engine, ctx.player.id)),
  claim: authed
    .input(z.object({ key, id: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => claimChallenge(ctx.engine, ctx.player.id, input.key, input.id)),
  reroll: authed
    .input(z.object({ key, slot: z.number().int().min(0).max(2) }))
    .mutation(({ ctx, input }) => rerollChallenge(ctx.engine, ctx.player.id, input.key, input.slot)),
});
