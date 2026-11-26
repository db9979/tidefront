// See: Minen, Blockade und Konvois – Lesemodell und Befehle (Missionen selbst laufen über mission.launch). Eingehängt in router.ts.
import { z } from "zod";
import { liftBlockade, navalRouteMines, navalView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const navalRouter = t.router({
  /** Minenfelder (eigene, verbündete, bekannte), Blockaden, Konvois, eigene Blockade. */
  view: authed.query(({ ctx }) => navalView(ctx.engine, ctx.player.id)),
  /** Bekannte feindliche Minenfelder auf der Route vom eigenen Hafen zum Feld. */
  routeMines: authed
    .input(z.object({ col: z.number().int().min(0).max(500), row: z.number().int().min(0).max(500) }))
    .query(({ ctx, input }) => navalRouteMines(ctx.engine, ctx.player.id, input.col, input.row)),
  liftBlockade: authed
    .input(z.object({ key, blockadeId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => liftBlockade(ctx.engine, ctx.player.id, input.key, input.blockadeId)),
});
