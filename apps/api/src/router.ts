// tRPC-Router: der Client sendet nur Absichten, der Server entscheidet.
import { z } from "zod";
import { APP_VERSION, BUILD_TIME } from "./version.ts";
import {
  abandonColony,
  abandonInfo,
  balance,
  baseView,
  battleStats,
  cancelBuild,
  cancelTrain,
  chooseBase,
  launchMission,
  login,
  logout,
  mapView,
  recallOwnMission,
  marketQuote,
  marketNewsView,
  marketChartView,
  marketView,
  missionPreview,
  register,
  renameBase,
  reportViewFor,
  reportList,
  setNightShield,
  trade,
  train,
  upgrade,
} from "@tidefront/engine";
import { seasonRouter, socialRouter } from "./routers/social.ts";
import { authed, baseInput, baseRef, t, wrap, type Ctx } from "./trpc.ts";
import { GameError } from "@tidefront/engine";
import { LOGIN_ACCOUNT_FAILS, LOGIN_ACCOUNT_WINDOW_SEC, loginAccountBucket } from "./rate-limit.ts";
import { accountRouter, adminRouter, authExtras, pushRouter } from "./routers/ops.ts";
import { afterRegister, inviteRouter } from "./routers/invite.ts";
import { dailyRouter } from "./routers/daily.ts";
import { adminStatsRouter } from "./routers/adminstats.ts";
import { comfortRouter } from "./routers/comfort.ts";
import { allianceRouter } from "./routers/alliance.ts";
import { playerTradeRouter } from "./routers/trade.ts";
import { contractsRouter } from "./routers/contracts.ts"; // Lieferverträge (v1.31)
import { worldEventsRouter } from "./routers/world-events.ts";
import { researchRouter } from "./routers/research.ts";
import { guideRouter } from "./routers/guide.ts";
import { espionageRouter } from "./routers/espionage.ts";
import { bugReportRouter } from "./routers/bug-report.ts";
import { admiralRouter } from "./routers/admirals.ts"; // Admirale
import { achievementsRouter } from "./routers/achievements.ts"; // Erfolge
import { allianceOpsRouter } from "./routers/alliance-ops.ts"; // Allianz-Ops
import { navalRouter } from "./routers/naval.ts"; // See: Minen/Blockade/Konvoi
import { fieldsRouter } from "./routers/fields.ts"; // Felder
import { botsRouter } from "./routers/bots.ts"; // KI-Spieler (Verwaltung)
import { powerRouter } from "./routers/power.ts"; // Seekabel (v1.21)
import { intelRouter } from "./routers/intel.ts"; // Lagebild Stufe 2

export type { Ctx };

const key = z.string().min(8).max(80);
const counts = z.record(z.string().max(40), z.number().int().min(0).max(1_000_000));
const resources = z.record(z.string().max(20), z.number().int().min(0).max(100_000_000));
const field = { col: z.number().int().min(0).max(500), row: z.number().int().min(0).max(500) };
// See: Minen/Blockade/Konvoi – Ziele und Haltezeit von Seemissionen.
const navalTarget = { blockadeId: z.number().int().min(1).optional(), convoyId: z.number().int().min(1).optional(), holdHours: z.number().int().min(0).max(48).optional(), fieldId: z.number().int().min(1).optional(), stayAll: z.boolean().optional() }; // Felder: fieldId, stayAll

/** IANA-Zeitzone des Browsers (z. B. "Europe/Berlin"), optional für ältere Clients; unbekannte Namen: fester Versatz. */
const tzName = z.string().max(64).optional();

export const appRouter = t.router({
  meta: t.procedure.query(() => ({ balance, serverNow: Date.now(), version: APP_VERSION, builtAt: BUILD_TIME })),

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
          afterRegister(ctx.engine, r.playerId);
          return { ok: true as const };
        });
      }),
    login: t.procedure
      .input(z.object({ name: z.string().trim().min(1).max(24), password: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await ctx.rateLimit(`login:${ctx.ip}`, 20, 300))) return { ok: false as const, code: "rate" };
        // Zusätzlich je Kontoname: höchstens 10 Fehlversuche in 15 Minuten (unabhängig von der IP).
        const acct = loginAccountBucket(input.name);
        if (await ctx.failures?.blocked(acct, LOGIN_ACCOUNT_FAILS)) return { ok: false as const, code: "rate" };
        return wrap(async () => {
          try {
            const r = await login(ctx.engine.db, input);
            await ctx.failures?.reset(acct);
            ctx.setSession(r.token);
            return { ok: true as const };
          } catch (err) {
            if (err instanceof GameError && err.code === "bad_login") await ctx.failures?.hit(acct, LOGIN_ACCOUNT_WINDOW_SEC);
            throw err;
          }
        });
      }),
    logout: t.procedure.mutation(async ({ ctx }) => {
      if (ctx.token) await logout(ctx.engine.db, ctx.token);
      ctx.setSession(null);
      return { ok: true as const };
    }),
    ...authExtras,
  }),

  push: pushRouter,
  account: accountRouter,
  admin: adminRouter,
  invite: inviteRouter,
  adminStats: adminStatsRouter,
  bots: botsRouter, // KI-Spieler (nur Admins)

  world: t.router({
    map: authed.query(({ ctx }) => mapView(ctx.engine, ctx.player.id)),
  }),

  base: t.router({
    get: authed.input(baseInput).query(({ ctx, input }) => baseView(ctx.engine, ctx.player.id, input?.baseId)),
    choose: authed
      .input(z.object({
        key, ...field,
        name: z.string().trim().min(2).max(32),
        nightShieldStartHour: z.number().int().min(0).max(23).nullable(),
        tzOffsetMinutes: z.number().int().min(-840).max(840),
        timeZone: tzName, // IANA-Zeitzone (Nachtschild mit Sommerzeit)
      }))
      .mutation(({ ctx, input }) => chooseBase(ctx.engine, ctx.player.id, input.key, input)),
    upgrade: authed
      .input(z.object({ key, buildingId: z.string().max(40), ...baseRef }))
      .mutation(({ ctx, input }) => upgrade(ctx.engine, ctx.player.id, input.key, input.buildingId, input.baseId)),
    cancelUpgrade: authed
      .input(z.object({ key, buildingId: z.string().max(40).optional(), targetLevel: z.number().int().min(1).max(100).optional(), ...baseRef }))
      .mutation(({ ctx, input }) =>
        cancelBuild(
          ctx.engine,
          ctx.player.id,
          input.key,
          input.buildingId !== undefined && input.targetLevel !== undefined
            ? { buildingId: input.buildingId, targetLevel: input.targetLevel }
            : undefined,
          input.baseId,
        )),
    train: authed
      .input(z.object({ key, id: z.string().max(40), count: z.number().int().min(1).max(10000), ...baseRef }))
      .mutation(({ ctx, input }) => train(ctx.engine, ctx.player.id, input.key, input.id, input.count, input.baseId)),
    cancelTraining: authed
      .input(z.object({ key, builtIn: z.string().max(40), ...baseRef }))
      .mutation(({ ctx, input }) => cancelTrain(ctx.engine, ctx.player.id, input.key, input.builtIn, input.baseId)),
    nightShield: authed
      .input(z.object({ key, startHour: z.number().int().min(0).max(23).nullable(), tzOffsetMinutes: z.number().int().min(-840).max(840), timeZone: tzName, ...baseRef }))
      .mutation(({ ctx, input }) => setNightShield(ctx.engine, ctx.player.id, input.key, input.startHour, input.tzOffsetMinutes, input.baseId, input.timeZone ?? null)),
    // Mehrere Häfen: umbenennen (eigene Häfen) und Kolonie aufgeben (nie der Heimathafen; baseId Pflicht).
    rename: authed
      .input(z.object({ key, name: z.string().trim().min(2).max(32), ...baseRef }))
      .mutation(({ ctx, input }) => renameBase(ctx.engine, ctx.player.id, input.key, input.baseId, input.name)),
    abandonInfo: authed.input(baseInput).query(({ ctx, input }) => abandonInfo(ctx.engine, ctx.player.id, input?.baseId)),
    abandon: authed
      .input(z.object({ key, baseId: z.number().int().min(1) }))
      .mutation(({ ctx, input }) => abandonColony(ctx.engine, ctx.player.id, input.key, input.baseId)),
  }),

  mission: t.router({
    preview: authed
      .input(z.object({ type: z.string().max(20), units: counts, ...field, cargo: resources.optional(), eventId: z.number().int().min(1).optional(), admiralId: z.number().int().min(1).optional(), ...navalTarget, ...baseRef }))
      .query(({ ctx, input }) => missionPreview(ctx.engine, ctx.player.id, input)),
    launch: authed
      .input(z.object({ key, type: z.string().max(20), units: counts, ...field, cargo: resources.optional(), eventId: z.number().int().min(1).optional(), admiralId: z.number().int().min(1).optional(), ...navalTarget, ...baseRef }))
      .mutation(({ ctx, input }) => launchMission(ctx.engine, ctx.player.id, input.key, input)),
    recall: authed
      .input(z.object({ key, missionId: z.number().int().min(1), ...baseRef })) // Rückruf über die Mission (baseId ohne Wirkung)
      .mutation(({ ctx, input }) => recallOwnMission(ctx.engine, ctx.player.id, input.key, input.missionId)),
  }),

  report: t.router({
    list: authed.query(({ ctx }) => reportList(ctx.engine, ctx.player.id)),
    get: authed
      .input(z.object({ id: z.number().int().min(1) }))
      .query(({ ctx, input }) => reportViewFor(ctx.engine, ctx.player.id, input.id)), // mit Bausteinen wie die E-Mail
    /** Persönliche Kampfbilanz der Saison (kurz zwischengespeichert). */
    stats: authed.query(({ ctx }) => battleStats(ctx.engine, ctx.player.id)),
  }),

  market: t.router({
    get: authed.input(baseInput).query(({ ctx, input }) => marketView(ctx.engine, ctx.player.id, input?.baseId)),
    quote: authed
      .input(z.object({ side: z.enum(["buy", "sell"]), resource: z.string().max(20), qty: z.number().int().min(1).max(10_000_000) }))
      .query(({ ctx, input }) => marketQuote(ctx.engine, input)),
    /** Marktnachrichten: wirkende und die der letzten 24 Stunden, dazu Grund- und effektiver Richtwert. */
    news: authed.query(({ ctx }) => marketNewsView(ctx.engine.db)),
    /** Saisonchart: Stundenschlusskurse einer Ressource mit effektivem Richtwert (ganze Saison). */
    chart: authed
      .input(z.object({ resource: z.string().max(20) }))
      .query(({ ctx, input }) => marketChartView(ctx.engine.db, input.resource)),
    trade: authed
      .input(z.object({
        key,
        side: z.enum(["buy", "sell"]),
        resource: z.string().max(20),
        qty: z.number().int().min(1).max(10_000_000),
        expectedPrice: z.number().positive(),
        escort: z.record(z.string().max(40), z.number().int().min(0).max(100_000)).optional(), // See: Geleit für den Börsenkonvoi
        ...baseRef,
      }))
      .mutation(({ ctx, input }) => trade(ctx.engine, ctx.player.id, input.key, input)),
  }),

  social: socialRouter,
  admiral: admiralRouter, // Admirale
  season: seasonRouter,
  daily: dailyRouter,
  comfort: comfortRouter,
  alliance: allianceRouter,
  playerTrade: playerTradeRouter,
  contracts: contractsRouter, // Lieferverträge (v1.31)
  worldEvents: worldEventsRouter,
  research: researchRouter,
  guide: guideRouter,
  espionage: espionageRouter,
  bugReport: bugReportRouter,
  achievements: achievementsRouter, // Erfolge und Wochenziele
  allianceOps: allianceOpsRouter, // Allianz-Ops: Sammelangriff, Stationierung
  naval: navalRouter, // See: Minen/Blockade/Konvoi
  fields: fieldsRouter, // Felder
  power: powerRouter, // Seekabel / Stromverbund (v1.21)
  intel: intelRouter, // Lagebild Stufe 2: Patrouille, Kampagne, Radarposten, Übersicht
});

export type AppRouter = typeof appRouter;
