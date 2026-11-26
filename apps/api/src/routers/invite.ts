// Teil-Router „Freunde einladen“: Einladung per E-Mail oder Link, Übersicht, Zurückziehen, erneut senden,
// öffentliche Abfrage des Einladenden und Verwaltung (Grenzen, Abschalten, alle Einladungen). Eingehängt in router.ts.
import { z } from "zod";
import {
  adminInvites,
  INVITE_MESSAGE_MAX,
  INVITE_NAME_MAX,
  inviteByEmail,
  inviteLink,
  inviterForCode,
  inviteSettings,
  myInvites,
  notifyInviter,
  resendInvite,
  revokeInvite,
  saveInviteSettings,
  type Engine,
} from "@tidefront/engine";
import { adminProc, authed, t, wrap } from "../trpc.ts";

const rate = { ok: false as const, code: "rate" };
const name = z.string().trim().max(INVITE_NAME_MAX).optional();

export const inviteRouter = t.router({
  /** Öffentlich (Anmeldebildschirm): nur der Name des Einladenden zu einem nutzbaren Code. */
  lookup: t.procedure
    .input(z.object({ code: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`invlookup:${ctx.ip}`, 30, 3600))) return { inviterName: null };
      return inviterForCode(ctx.engine.db, input.code);
    }),
  mine: authed.query(({ ctx }) => myInvites(ctx.engine, ctx.player.id)),
  sendEmail: authed
    .input(z.object({ email: z.string().trim().min(3).max(254), name, message: z.string().trim().max(INVITE_MESSAGE_MAX).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`invite:${ctx.player.id}`, 10, 3600))) return rate;
      if (!(await ctx.rateLimit(`invite:ip:${ctx.ip}`, 30, 3600))) return rate;
      return wrap(() => inviteByEmail(ctx.engine, ctx.player.id, input));
    }),
  createLink: authed
    .input(z.object({ name }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`invite:${ctx.player.id}`, 10, 3600))) return rate;
      return wrap(() => inviteLink(ctx.engine, ctx.player.id, input));
    }),
  revoke: authed
    .input(z.object({ id: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => wrap(() => revokeInvite(ctx.engine.db, ctx.player.id, input.id))),
  resend: authed
    .input(z.object({ id: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`invite:${ctx.player.id}`, 10, 3600))) return rate;
      return wrap(() => resendInvite(ctx.engine, ctx.player.id, input.id));
    }),
  admin: t.router({
    list: adminProc.query(async ({ ctx }) => ({
      settings: await inviteSettings(ctx.engine.db),
      invites: await adminInvites(ctx.engine.db),
    })),
    save: adminProc
      .input(z.object({ enabled: z.boolean(), maxOpen: z.number().int().min(1).max(100), maxWeek: z.number().int().min(1).max(500) }))
      .mutation(async ({ ctx, input }) => ({ ok: true as const, settings: await saveInviteSettings(ctx.engine.db, input) })),
  }),
});

/** Nach erfolgreicher Registrierung (auth.register): Einladenden im Hintergrund benachrichtigen. */
export function afterRegister(engine: Engine, playerId: number): void {
  void notifyInviter(engine, playerId).catch((err) => engine.log("invite notify", String(err)));
}
