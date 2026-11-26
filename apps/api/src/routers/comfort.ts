// Teil-Router Komfort: Verbandsvorlagen, „Wiederholen“, letzte Aufklärung (für den Probekampf), Morgenbericht.
// Eingehängt in router.ts als `comfort`.
import { z } from "zod";
import {
  deleteTemplate,
  lastScout,
  listTemplates,
  MISSION_TYPES,
  recentMissions,
  repeatFromReport,
  saveTemplate,
  setSummarySettings,
  summarySettings,
  TEMPLATE_NAME_MAX,
} from "@tidefront/engine";
import { authed, baseInput, baseRef, t } from "../trpc.ts";

const counts = z.record(z.string().max(40), z.number().int().min(0).max(1_000_000));
const rate = { ok: false as const, code: "rate" };

export const comfortRouter = t.router({
  templates: authed.query(({ ctx }) => listTemplates(ctx.engine.db, ctx.player.id)),
  saveTemplate: authed
    .input(z.object({
      name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
      units: counts,
      missionType: z.enum(MISSION_TYPES).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`tpl:${ctx.player.id}`, 30, 600))) return rate;
      return saveTemplate(ctx.engine.db, ctx.player.id, input);
    }),
  deleteTemplate: authed
    .input(z.object({ id: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => ({ ok: await deleteTemplate(ctx.engine.db, ctx.player.id, input.id) })),

  repeat: authed
    .input(z.object({ reportId: z.number().int().min(1), ...baseRef }))
    .query(({ ctx, input }) => repeatFromReport(ctx.engine.db, ctx.player.id, input.reportId, input.baseId)),
  recentMissions: authed.input(baseInput).query(({ ctx, input }) => recentMissions(ctx.engine.db, ctx.player.id, undefined, input?.baseId)),

  scout: authed
    .input(z.object({ col: z.number().int().min(0).max(500), row: z.number().int().min(0).max(500) }))
    .query(({ ctx, input }) => lastScout(ctx.engine.db, ctx.player.id, input.col, input.row)),

  summary: authed.query(({ ctx }) => summarySettings(ctx.engine.db, ctx.player.id)),
  setSummary: authed
    .input(z.object({
      enabled: z.boolean(),
      minuteOfDay: z.number().int().min(0).max(1439),
      timeZone: z.string().min(1).max(64),
      push: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`summary:${ctx.player.id}`, 20, 600))) return rate;
      return setSummarySettings(ctx.engine.db, ctx.player.id, input);
    }),
});
