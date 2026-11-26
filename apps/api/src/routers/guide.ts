// Router für das Auftragsbuch: Ansicht, Belohnung eines Auftrags abholen, Abschlussbelohnung. Eingehängt in router.ts.
import { z } from "zod";
import { claimGuideFinal, claimGuideStep, guideView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const guideRouter = t.router({
  get: authed.query(({ ctx }) => guideView(ctx.engine, ctx.player.id)),
  claim: authed
    .input(z.object({ key, stepId: z.string().min(1).max(20) }))
    .mutation(({ ctx, input }) => claimGuideStep(ctx.engine, ctx.player.id, input.key, input.stepId)),
  claimFinal: authed
    .input(z.object({ key }))
    .mutation(({ ctx, input }) => claimGuideFinal(ctx.engine, ctx.player.id, input.key)),
});
