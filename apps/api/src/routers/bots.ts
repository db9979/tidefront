// Teil-Router der Verwaltung: KI-Spieler (nur Admins). Liste, anlegen, schalten, entfernen, Server-Einstellungen.
import { z } from "zod";
import { addBot, botsAdminView, ensureStartBots, removeBotStep, setBotsServer, updateBot } from "@tidefront/engine";
import { adminProc, t } from "../trpc.ts";

const id = z.number().int().min(1);

export const botsRouter = t.router({
  list: adminProc.query(({ ctx }) => botsAdminView(ctx.engine)),
  /** Startbesetzung: je Spielweise ein Bot, falls es noch keinen gibt (idempotent). */
  start: adminProc.mutation(async ({ ctx }) => ({ ok: true as const, ...(await ensureStartBots(ctx.engine)) })),
  add: adminProc
    .input(z.object({ profile: z.enum(["haendler", "festung", "freibeuter"]) }))
    .mutation(async ({ ctx, input }) => {
      const r = await addBot(ctx.engine, input.profile);
      if (r.ok) ctx.engine.log("bot added", { by: ctx.player.name, bot: r.name });
      return r;
    }),
  update: adminProc
    .input(z.object({ id, active: z.boolean().optional(), attackHumans: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await updateBot(ctx.engine.db, input.id, input);
      return ok ? { ok: true as const } : { ok: false as const, code: "no_bot" };
    }),
  /** Entfernen: räumt die Häfen (Rückruf, Aufgeben) und löscht den Bot, sobald nichts mehr unterwegs ist. */
  remove: adminProc
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const r = await removeBotStep(ctx.engine, input.id);
      ctx.engine.log("bot remove", { by: ctx.player.name, bot: input.id, ...r });
      return { ok: true as const, ...r };
    }),
  server: adminProc
    .input(z.object({ enabled: z.boolean().optional(), max: z.number().int().min(0).max(50).optional() }))
    .mutation(async ({ ctx, input }) => {
      await setBotsServer(ctx.engine.db, input);
      return { ok: true as const };
    }),
});
