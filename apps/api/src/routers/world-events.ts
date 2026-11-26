// Router für Weltereignisse des Kartells (Karte, Info-Blatt, Banner). Eingehängt in router.ts.
import { worldEventsView } from "@tidefront/engine";
import { authed, baseInput, t } from "../trpc.ts";

export const worldEventsRouter = t.router({
  list: authed.input(baseInput).query(({ ctx, input }) => worldEventsView(ctx.engine, ctx.player.id, input?.baseId)),
});
