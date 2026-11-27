// Router „Alle abholen“ (TST-09): alle abholbereiten Belohnungen in einem Befehl. Eingehängt in router.ts als rewards.
import { z } from "zod";
import { claimAllRewards } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const rewardsRouter = t.router({
  /** allowLoss: auch Belohnungen abholen, bei denen wegen der Lagergrenze etwas verfällt (sonst bleiben sie liegen). */
  claimAll: authed
    .input(z.object({ key, allowLoss: z.boolean().optional() }))
    .mutation(({ ctx, input }) => claimAllRewards(ctx.engine, ctx.player.id, input.key, { allowLoss: input.allowLoss })),
});
