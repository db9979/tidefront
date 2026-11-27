// Router für das Lagezentrum (Basis → Lage): get = ganze Lage aller eigenen Häfen, badge = nur die Zahl am
// Navigationszeichen „Meldungen“ (Angriffe, Nachfristen, leere Bauschlangen, abholbare Erfolge/Wochenziele).
import { lageView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

export const lageRouter = t.router({
  get: authed.query(({ ctx }) => lageView(ctx.engine, ctx.player.id)),
  badge: authed.query(async ({ ctx }) => (await lageView(ctx.engine, ctx.player.id, { brief: true })).urgent),
});
