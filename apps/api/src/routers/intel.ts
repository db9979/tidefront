// Lagebild Stufe 2/3: Patrouille, Aufklärungskampagne, Radarposten (errichten, angreifen, abbauen) und der Reiter
// „Lagebild“ unter Meldungen. Eingehängt in router.ts als `intel`.
import { z } from "zod";
import { dismantlePost, endPatrol, intelOverview, launchIntelOp, launchSatellite, previewIntelOp } from "@tidefront/engine";
import { authed, baseRef, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const hex = z.object({ col: z.number().int().min(0).max(500), row: z.number().int().min(0).max(500) });
const op = {
  op: z.enum(["patrouille", "kampagne", "radarposten", "postenangriff"]),
  units: z.record(z.string().max(40), z.number().int().min(0).max(1_000_000)),
  waypoints: z.array(hex).max(8).optional(),
  hours: z.number().int().min(1).max(48).optional(),
  targets: z.array(hex).max(8).optional(),
  col: z.number().int().min(0).max(500).optional(),
  row: z.number().int().min(0).max(500).optional(),
  postId: z.number().int().min(1).optional(),
  ...baseRef,
};

export const intelRouter = t.router({
  /** Lagebild-Reiter: letzte Sichtungen, fremde Patrouillen, eigene Sensoren und Posten. */
  overview: authed.query(({ ctx }) => intelOverview(ctx.engine, ctx.player.id)),
  preview: authed.input(z.object(op)).query(({ ctx, input }) => previewIntelOp(ctx.engine, ctx.player.id, input)),
  launch: authed.input(z.object({ key, ...op })).mutation(({ ctx, input }) => launchIntelOp(ctx.engine, ctx.player.id, input.key, input)),
  endPatrol: authed
    .input(z.object({ key, missionId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => endPatrol(ctx.engine, ctx.player.id, input.key, input.missionId)),
  dismantlePost: authed
    .input(z.object({ key, postId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => dismantlePost(ctx.engine, ctx.player.id, input.key, input.postId)),
  /** Stufe 3: Satellit von der Startrampe des Hafens starten (optisch oder Radar). */
  launchSatellite: authed
    .input(z.object({ key, type: z.enum(["optisch", "radar"]), ...baseRef }))
    .mutation(({ ctx, input }) => launchSatellite(ctx.engine, ctx.player.id, input.key, { type: input.type, baseId: input.baseId })),
});
