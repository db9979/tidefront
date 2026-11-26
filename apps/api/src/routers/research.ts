// Router für die Forschung: Start, Abbruch, Wahl der Durchbruch-Belohnung. Der Stand kommt mit base.get.
import { z } from "zod";
import { researchCancel, researchChoose, researchStart } from "@tidefront/engine";
import { authed, baseRef, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const researchRouter = t.router({
  start: authed
    .input(z.object({ key, techId: z.string().min(1).max(40), ...baseRef }))
    .mutation(({ ctx, input }) => researchStart(ctx.engine, ctx.player.id, input.key, input.techId, input.baseId)),
  cancel: authed
    .input(z.object({ key, ...baseRef }))
    .mutation(({ ctx, input }) => researchCancel(ctx.engine, ctx.player.id, input.key, input.baseId)),
  choose: authed
    .input(z.object({ key, choice: z.enum(["level", "speed"]), ...baseRef }))
    .mutation(({ ctx, input }) => researchChoose(ctx.engine, ctx.player.id, input.key, input.choice, input.baseId)),
});
