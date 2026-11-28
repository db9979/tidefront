// Router für das Lagezentrum (Basis → Lage): get = ganze Lage aller eigenen Häfen (mit Bauempfehlung je Hafen),
// badge = nur die Zahl am Navigationszeichen „Meldungen“ (Angriffe, Nachfristen, leere Bauschlangen, abholbare
// Erfolge/Wochenziele), since = Rückkehrkarte „Seit deinem letzten Besuch“, ack = Rückkehrkarte quittieren (UX 0.43).
import { lageAck, lageSince, lageView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

export const lageRouter = t.router({
  get: authed.query(({ ctx }) => lageView(ctx.engine, ctx.player.id)),
  badge: authed.query(async ({ ctx }) => (await lageView(ctx.engine, ctx.player.id, { brief: true })).urgent),
  since: authed.query(({ ctx }) => lageSince(ctx.engine, ctx.player.id)),
  ack: authed.mutation(({ ctx }) => lageAck(ctx.engine, ctx.player.id)),
});
