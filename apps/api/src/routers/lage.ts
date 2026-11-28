// Router für das Lagezentrum (Basis → Lage): get = ganze Lage aller eigenen Häfen (mit Bauempfehlung je Hafen und
// nächstem lohnenden Besuch), badge = nur die Zahl am Navigationszeichen „Meldungen“ (Angriffe, Nachfristen, leere
// Bauschlangen, abholbare Erfolge/Wochenziele), since = Rückkehrkarte „Seit deinem letzten Besuch“, ack = Rückkehrkarte
// quittieren (UX 0.43); reminder/remind/remindCancel = Erinnerung „Nächster lohnender Besuch“ als Push (UX-0.43 B8).
import { z } from "zod";
import { lageAck, lageRemind, lageRemindCancel, lageReminder, lageSince, lageView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

export const lageRouter = t.router({
  get: authed.query(({ ctx }) => lageView(ctx.engine, ctx.player.id)),
  badge: authed.query(async ({ ctx }) => (await lageView(ctx.engine, ctx.player.id, { brief: true })).urgent),
  since: authed.query(({ ctx }) => lageSince(ctx.engine, ctx.player.id)),
  ack: authed.mutation(({ ctx }) => lageAck(ctx.engine, ctx.player.id)),
  reminder: authed.query(({ ctx }) => lageReminder(ctx.engine.db, ctx.player.id)),
  remind: authed
    .input(z.object({ atMs: z.number().int(), text: z.string().max(400) }))
    .mutation(({ ctx, input }) => lageRemind(ctx.engine, ctx.player.id, input)),
  remindCancel: authed.mutation(({ ctx }) => lageRemindCancel(ctx.engine.db, ctx.player.id)),
});
