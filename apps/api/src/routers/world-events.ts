// Router für Weltereignisse des Kartells (Karte, Info-Blatt, Banner). Eingehängt in router.ts.
import { worldEventsView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

export const worldEventsRouter = t.router({
  list: authed.query(({ ctx }) => worldEventsView(ctx.engine, ctx.player.id)),
});
