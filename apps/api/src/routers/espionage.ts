// Router für den Nachrichtendienst: Vorschau und Auslaufen von Spionageaufträgen, eigenes Lagebild.
import { z } from "zod";
import { intelOwnView, spyLaunch, spyPreview } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const spyInput = {
  kind: z.enum(["erkunden", "sabotage", "desinformation", "kartell"]),
  col: z.number().int().min(0).max(500).optional(),
  row: z.number().int().min(0).max(500).optional(),
  building: z.string().min(1).max(40).optional(),
};

export const espionageRouter = t.router({
  get: authed.query(({ ctx }) => intelOwnView(ctx.engine, ctx.player.id)),
  preview: authed
    .input(z.object(spyInput))
    .query(({ ctx, input }) => spyPreview(ctx.engine, ctx.player.id, input)),
  launch: authed
    .input(z.object({ key, ...spyInput }))
    .mutation(({ ctx, input }) => spyLaunch(ctx.engine, ctx.player.id, input.key, input)),
});
