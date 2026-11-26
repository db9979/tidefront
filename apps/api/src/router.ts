// tRPC-Router: der Client sendet nur Absichten, der Server entscheidet.
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  balance,
  baseView,
  cancelBuild,
  cancelTrain,
  chooseBase,
  GameError,
  launchMission,
  login,
  logout,
  mapView,
  marketQuote,
  marketView,
  missionPreview,
  register,
  reportGet,
  reportList,
  setNightShield,
  trade,
  train,
  upgrade,
  type Engine,
} from "@tidefront/engine";
import { seasonRouter, socialRouter } from "./routers/social.ts";

export interface Ctx {
  engine: Engine;
  player: { id: number; name: string } | null;
  token: string | undefined;
  setSession: (token: string | null) => void;
  rateLimit: (bucket: string, limit: number, windowSec: number) => Promise<boolean>;
  ip: string;
}

const t = initTRPC.context<Ctx>().create();

const authed = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.player) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!(await ctx.rateLimit(`cmd:${ctx.player.id}`, 120, 60))) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  return next({ ctx: { ...ctx, player: ctx.player } });
});

/** Fehler des Spiels als Rückgabewert statt Ausnahme. */
async function wrap<T>(fn: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return { ok: false, code: err.code };
    throw err;
  }
}

const key = z.string().min(8).max(80);
const counts = z.record(z.string().max(40), z.number().int().min(0).max(1_000_000));
const resources = z.record(z.string().max(20), z.number().int().min(0).max(100_000_000));
const field = { col: z.number().int().min(0).max(500), row: z.number().int().min(0).max(500) };

export const appRouter = t.router({
  meta: t.procedure.query(() => ({ balance, serverNow: Date.now() })),

  auth: t.router({
    me: t.procedure.query(({ ctx }) => ({ player: ctx.player })),
    register: t.procedure
      .input(z.object({
        inviteCode: z.string().min(1).max(64),
        name: z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N} _.-]+$/u),
        password: z.string().min(8).max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!(await ctx.rateLimit(`reg:${ctx.ip}`, 10, 3600))) return { ok: false as const, code: "rate" };
        return wrap(async () => {
          const r = await register(ctx.engine.db, input);
          ctx.setSession(r.token);
          return { ok: true as const };
        });
      }),
    login: t.procedure
      .input(z.object({ name: z.string().trim().min(1).max(24), password: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await ctx.rateLimit(`login:${ctx.ip}`, 20, 300))) return { ok: false as const, code: "rate" };
        return wrap(async () => {
          const r = await login(ctx.engine.db, input);
          ctx.setSession(r.token);
          return { ok: true as const };
        });
      }),
    logout: t.procedure.mutation(async ({ ctx }) => {
      if (ctx.token) await logout(ctx.engine.db, ctx.token);
      ctx.setSession(null);
      return { ok: true as const };
    }),
  }),

  world: t.router({
    map: authed.query(({ ctx }) => mapView(ctx.engine, ctx.player.id)),
  }),

  base: t.router({
    get: authed.query(({ ctx }) => baseView(ctx.engine, ctx.player.id)),
    choose: authed
      .input(z.object({
        key, ...field,
        name: z.string().trim().min(2).max(32),
        nightShieldStartHour: z.number().int().min(0).max(23).nullable(),
        tzOffsetMinutes: z.number().int().min(-840).max(840),
      }))
      .mutation(({ ctx, input }) => chooseBase(ctx.engine, ctx.player.id, input.key, input)),
    upgrade: authed
      .input(z.object({ key, buildingId: z.string().max(40) }))
      .mutation(({ ctx, input }) => upgrade(ctx.engine, ctx.player.id, input.key, input.buildingId)),
    cancelUpgrade: authed
      .input(z.object({ key }))
      .mutation(({ ctx, input }) => cancelBuild(ctx.engine, ctx.player.id, input.key)),
    train: authed
      .input(z.object({ key, id: z.string().max(40), count: z.number().int().min(1).max(10000) }))
      .mutation(({ ctx, input }) => train(ctx.engine, ctx.player.id, input.key, input.id, input.count)),
    cancelTraining: authed
      .input(z.object({ key, builtIn: z.string().max(40) }))
      .mutation(({ ctx, input }) => cancelTrain(ctx.engine, ctx.player.id, input.key, input.builtIn)),
    nightShield: authed
      .input(z.object({ key, startHour: z.number().int().min(0).max(23).nullable(), tzOffsetMinutes: z.number().int().min(-840).max(840) }))
      .mutation(({ ctx, input }) => setNightShield(ctx.engine, ctx.player.id, input.key, input.startHour, input.tzOffsetMinutes)),
  }),

  mission: t.router({
    preview: authed
      .input(z.object({ type: z.string().max(20), units: counts, ...field, cargo: resources.optional() }))
      .query(({ ctx, input }) => missionPreview(ctx.engine, ctx.player.id, input)),
    launch: authed
      .input(z.object({ key, type: z.string().max(20), units: counts, ...field, cargo: resources.optional() }))
      .mutation(({ ctx, input }) => launchMission(ctx.engine, ctx.player.id, input.key, input)),
  }),

  report: t.router({
    list: authed.query(({ ctx }) => reportList(ctx.engine, ctx.player.id)),
    get: authed
      .input(z.object({ id: z.number().int().min(1) }))
      .query(({ ctx, input }) => reportGet(ctx.engine, ctx.player.id, input.id)),
  }),

  market: t.router({
    get: authed.query(({ ctx }) => marketView(ctx.engine, ctx.player.id)),
    quote: authed
      .input(z.object({ side: z.enum(["buy", "sell"]), resource: z.string().max(20), qty: z.number().int().min(1).max(10_000_000) }))
      .query(({ ctx, input }) => marketQuote(ctx.engine, input)),
    trade: authed
      .input(z.object({
        key,
        side: z.enum(["buy", "sell"]),
        resource: z.string().max(20),
        qty: z.number().int().min(1).max(10_000_000),
        expectedPrice: z.number().positive(),
      }))
      .mutation(({ ctx, input }) => trade(ctx.engine, ctx.player.id, input.key, input)),
  }),

  social: socialRouter,
  season: seasonRouter,
});

export type AppRouter = typeof appRouter;
