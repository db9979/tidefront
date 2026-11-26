// Router Allianz-Ops: Sammelangriffe (Übersicht, eröffnen, beitreten, zurückziehen, abbrechen) und Stationierung
// (Rückruf durch den Besitzer bzw. Heimschicken durch den Gastgeber). Auslaufen einer Stationierung: mission.launch
// mit type "stationierung".
import { z } from "zod";
import { allianceRaidsView, cancelRaid, joinRaid, openRaid, stationRelease, withdrawRaid } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const counts = z.record(z.string().max(40), z.number().int().min(0).max(1_000_000));
const id = z.number().int().min(1);

export const allianceOpsRouter = t.router({
  raids: authed.query(({ ctx }) => allianceRaidsView(ctx.engine, ctx.player.id)),
  open: authed
    .input(z.object({
      key,
      col: z.number().int().min(0).max(500),
      row: z.number().int().min(0).max(500),
      eventId: id.optional(),
      units: counts,
      joinMinutes: z.number().int().min(1).max(7 * 24 * 60),
      arriveMinutes: z.number().int().min(1).max(14 * 24 * 60),
    }))
    .mutation(({ ctx, input }) => openRaid(ctx.engine, ctx.player.id, input.key, input)),
  join: authed
    .input(z.object({ key, raidId: id, units: counts }))
    .mutation(({ ctx, input }) => joinRaid(ctx.engine, ctx.player.id, input.key, input)),
  withdraw: authed
    .input(z.object({ key, raidId: id }))
    .mutation(({ ctx, input }) => withdrawRaid(ctx.engine, ctx.player.id, input.key, input.raidId)),
  cancel: authed
    .input(z.object({ key, raidId: id }))
    .mutation(({ ctx, input }) => cancelRaid(ctx.engine, ctx.player.id, input.key, input.raidId)),
  stationRelease: authed
    .input(z.object({ key, missionId: id }))
    .mutation(({ ctx, input }) => stationRelease(ctx.engine, ctx.player.id, input.key, input.missionId)),
});
