// Teil-Router: Push, eigenes Konto (Passwort, E-Mail), Verwaltung (nur Admins), Passwort zurücksetzen.
import { z } from "zod";
import {
  cartelStrength,
  changePassword,
  cleanPrefs,
  createInvite,
  createResetCode,
  disableInvite,
  enableInvite,
  emailInfo,
  listInvites,
  listPlayers,
  opsStatus,
  pushSetPrefs,
  pushStatus,
  pushSubscribe,
  pushToPlayer,
  pushUnsubscribe,
  requestPasswordResetMail,
  resetPassword,
  saveSmtp,
  sendTestMail,
  setCartelStrength,
  setEmail,
  setEmailPrefs,
  smtpView,
} from "@tidefront/engine";
import { adminProc, authed, t, wrap } from "../trpc.ts";

const password = z.string().min(8).max(200);
const endpoint = z.string().url().max(1000);
const prefs = z.record(z.string().max(20), z.boolean());
const rate = { ok: false as const, code: "rate" };

/** Ergänzungen im auth-Router (ohne Anmeldung nutzbar). */
export const authExtras = {
  resetPassword: t.procedure
    .input(z.object({ name: z.string().trim().max(24).optional(), code: z.string().trim().min(6).max(80), password }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`reset:${ctx.ip}`, 10, 3600))) return rate;
      return wrap(async () => {
        const r = await resetPassword(ctx.engine.db, input);
        ctx.setSession(r.token);
        return { ok: true as const };
      });
    }),
  requestReset: t.procedure
    .input(z.object({ name: z.string().trim().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`resetmail:${ctx.ip}`, 5, 3600))) return rate;
      if (!(await ctx.rateLimit(`resetmail:n:${input.name.toLowerCase()}`, 3, 3600))) return rate;
      // Versand im Hintergrund; die Antwort verrät nicht, ob es eine Adresse gibt.
      void requestPasswordResetMail(ctx.engine, input.name).catch((err) => ctx.engine.log("reset mail", String(err)));
      return { ok: true as const };
    }),
};

export const pushRouter = t.router({
  status: authed
    .input(z.object({ endpoint: endpoint.nullable() }))
    .query(({ ctx, input }) => pushStatus(ctx.engine.db, ctx.player.id, input.endpoint)),
  subscribe: authed
    .input(z.object({
      endpoint,
      keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!/^https:\/\//.test(input.endpoint)) return { ok: false as const, code: "bad_endpoint" };
      await pushSubscribe(ctx.engine.db, ctx.player.id, input);
      return { ok: true as const };
    }),
  unsubscribe: authed
    .input(z.object({ endpoint }))
    .mutation(async ({ ctx, input }) => {
      await pushUnsubscribe(ctx.engine.db, ctx.player.id, input.endpoint);
      return { ok: true as const };
    }),
  setPrefs: authed
    .input(z.object({ endpoint, prefs }))
    .mutation(async ({ ctx, input }) => ({ ok: await pushSetPrefs(ctx.engine.db, ctx.player.id, input.endpoint, cleanPrefs(input.prefs)) })),
  test: authed.mutation(async ({ ctx }) => {
    if (!(await ctx.rateLimit(`pushtest:${ctx.player.id}`, 5, 600))) return { ...rate, sent: 0 };
    const sent = await pushToPlayer(ctx.engine, ctx.player.id, {
      kind: "test", title: "TIDEFRONT", body: "Testnachricht: Benachrichtigungen kommen an.", url: "/", tag: "test",
    });
    return { ok: sent > 0, sent, code: sent > 0 ? undefined : "push_none" };
  }),
});

export const accountRouter = t.router({
  get: authed.query(async ({ ctx }) => ({ player: ctx.player, email: await emailInfo(ctx.engine.db, ctx.player.id) })),
  changePassword: authed
    .input(z.object({ oldPassword: z.string().min(1).max(200), newPassword: password }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`pw:${ctx.player.id}`, 10, 3600))) return rate;
      return wrap(async () => {
        await changePassword(ctx.engine.db, ctx.player.id, ctx.token, input.oldPassword, input.newPassword);
        return { ok: true as const };
      });
    }),
  setEmail: authed
    .input(z.object({ email: z.string().trim().max(254).nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`email:${ctx.player.id}`, 5, 3600))) return rate;
      return setEmail(ctx.engine, ctx.player.id, input.email);
    }),
  setEmailPrefs: authed
    .input(z.object({ prefs }))
    .mutation(async ({ ctx, input }) => ({ ok: await setEmailPrefs(ctx.engine.db, ctx.player.id, input.prefs) })),
});

const smtpInput = z.object({
  enabled: z.boolean(),
  provider: z.enum(["icloud", "google", "custom"]),
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["ssl", "starttls", "none"]),
  user: z.string().trim().max(200),
  password: z.string().max(500).optional(),
  fromName: z.string().trim().max(80),
  fromAddress: z.string().trim().max(254),
});

export const adminRouter = t.router({
  overview: adminProc.query(async ({ ctx }) => ({
    players: await listPlayers(ctx.engine.db),
    invites: await listInvites(ctx.engine.db),
    status: await opsStatus(ctx.engine.db),
  })),
  /** Regler Kartell-Stärke in Prozent (server_setting cartel_strength, 25–300, Vorgabe 100). */
  cartelStrength: adminProc.query(async ({ ctx }) => ({ pct: await cartelStrength(ctx.engine.db) })),
  setCartelStrength: adminProc
    .input(z.object({ pct: z.number().int().min(25).max(300) }))
    .mutation(({ ctx, input }) => setCartelStrength(ctx.engine.db, input.pct)),
  createInvite: adminProc
    .input(z.object({ code: z.string().trim().max(64).optional(), maxUses: z.number().int().min(1).max(1000) }))
    .mutation(({ ctx, input }) => wrap(async () => ({ ok: true as const, ...(await createInvite(ctx.engine.db, input)) }))),
  disableInvite: adminProc
    .input(z.object({ code: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => ({ ok: await disableInvite(ctx.engine.db, input.code) })),
  enableInvite: adminProc
    .input(z.object({ code: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => ({ ok: await enableInvite(ctx.engine.db, input.code) })),
  createResetCode: adminProc
    .input(z.object({ playerId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) =>
      wrap(async () => {
        const r = await createResetCode(ctx.engine.db, ctx.player.id, input.playerId);
        return { ok: true as const, code: r.code, name: r.name, expiresAt: r.expiresAt.getTime() };
      })),
  mail: adminProc.query(({ ctx }) => smtpView(ctx.engine.db)),
  saveMail: adminProc
    .input(smtpInput)
    .mutation(({ ctx, input }) => saveSmtp(ctx.engine.db, input)),
  testMail: adminProc.mutation(async ({ ctx }) => {
    if (!(await ctx.rateLimit(`mailtest:${ctx.player.id}`, 10, 600))) return rate;
    return sendTestMail(ctx.engine, ctx.player.id);
  }),
});
