// Router für Rangliste, Spielerübersicht, Nachrichten und Saison. Eingehängt in router.ts.
import { z } from "zod";
import {
  GameError,
  hallOfFame,
  inbox,
  markRead,
  MESSAGE_MAX,
  rankingView,
  seasonView,
  sendMessage,
  sentMessages,
  SUBJECT_MAX,
  unreadCount,
} from "@tidefront/engine";
// Gemeinsames tRPC (errorFormatter mit deutschem Eingabefehler, Prozeduren mit Befehls-Drosselung).
import { authed, t } from "../trpc.ts";

/** Nachrichten je Spieler: höchstens so viele in diesem Fenster. */
const MSG_LIMIT = 10;
const MSG_WINDOW_SEC = 600;

export const socialRouter = t.router({
  ranking: authed.query(({ ctx }) => rankingView(ctx.engine, ctx.player.id)),
  messages: t.router({
    inbox: authed.query(({ ctx }) => inbox(ctx.engine, ctx.player.id)),
    sent: authed.query(({ ctx }) => sentMessages(ctx.engine, ctx.player.id)),
    unread: authed.query(async ({ ctx }) => ({ count: await unreadCount(ctx.engine, ctx.player.id) })),
    read: authed
      .input(z.object({ id: z.number().int().min(1) }))
      .mutation(({ ctx, input }) => markRead(ctx.engine, ctx.player.id, input.id)),
    send: authed
      .input(z.object({
        toPlayerId: z.number().int().min(1),
        subject: z.string().trim().max(SUBJECT_MAX).optional(),
        body: z.string().trim().min(1).max(MESSAGE_MAX),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!(await ctx.rateLimit(`msg:${ctx.player.id}`, MSG_LIMIT, MSG_WINDOW_SEC))) return { ok: false as const, code: "rate" };
        try {
          return await sendMessage(ctx.engine, ctx.player.id, input);
        } catch (err) {
          if (err instanceof GameError) return { ok: false as const, code: err.code };
          throw err;
        }
      }),
  }),
});

export const seasonRouter = t.router({
  current: authed.query(({ ctx }) => seasonView(ctx.engine.db, ctx.player.id)),
  hall: authed.query(({ ctx }) => hallOfFame(ctx.engine.db, ctx.player.id)),
});
