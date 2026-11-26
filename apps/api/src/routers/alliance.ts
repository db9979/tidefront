// Router für Allianzen, Allianz-Chat und Diplomatie. Eingehängt in router.ts.
import { z } from "zod";
import {
  acceptPact,
  acceptRequest,
  allianceChatList,
  allianceDirectory,
  allianceView,
  cancelPact,
  CHAT_MAX,
  createAlliance,
  declareWar,
  declineRequest,
  DESCRIPTION_MAX,
  diplomacyView,
  dissolveAlliance,
  invitePlayer,
  kickMember,
  leaveAlliance,
  makePeace,
  proposePact,
  requestJoin,
  sendAllianceChat,
  setAllianceMaxSize,
  setMemberRole,
  updateAlliance,
} from "@tidefront/engine";
import { adminProc, authed, t, wrap } from "../trpc.ts";

/** Allianz-Chat je Spieler: höchstens so viele Zeilen in diesem Fenster. */
const CHAT_LIMIT = 20;
const CHAT_WINDOW_SEC = 60;

const id = z.number().int().min(1);
const party = z.string().regex(/^[ap]:\d{1,9}$/);

export const allianceRouter = t.router({
  get: authed.query(({ ctx }) => allianceView(ctx.engine, ctx.player.id)),
  directory: authed.query(({ ctx }) => allianceDirectory(ctx.engine, ctx.player.id)),
  create: authed
    .input(z.object({
      name: z.string().trim().min(3).max(32),
      tag: z.string().trim().min(2).max(4),
      description: z.string().max(DESCRIPTION_MAX).optional(),
    }))
    .mutation(({ ctx, input }) => wrap(() => createAlliance(ctx.engine, ctx.player.id, input))),
  update: authed
    .input(z.object({ description: z.string().max(DESCRIPTION_MAX) }))
    .mutation(({ ctx, input }) => wrap(() => updateAlliance(ctx.engine, ctx.player.id, input))),
  invite: authed
    .input(z.object({ playerId: id }))
    .mutation(({ ctx, input }) => wrap(() => invitePlayer(ctx.engine, ctx.player.id, input.playerId))),
  request: authed
    .input(z.object({ allianceId: id }))
    .mutation(({ ctx, input }) => wrap(() => requestJoin(ctx.engine, ctx.player.id, input.allianceId))),
  accept: authed
    .input(z.object({ requestId: id }))
    .mutation(({ ctx, input }) => wrap(() => acceptRequest(ctx.engine, ctx.player.id, input.requestId))),
  decline: authed
    .input(z.object({ requestId: id }))
    .mutation(({ ctx, input }) => wrap(() => declineRequest(ctx.engine, ctx.player.id, input.requestId))),
  leave: authed.mutation(({ ctx }) => wrap(() => leaveAlliance(ctx.engine, ctx.player.id))),
  kick: authed
    .input(z.object({ playerId: id }))
    .mutation(({ ctx, input }) => wrap(() => kickMember(ctx.engine, ctx.player.id, input.playerId))),
  setRole: authed
    .input(z.object({ playerId: id, role: z.enum(["fuehrung", "offizier", "mitglied"]) }))
    .mutation(({ ctx, input }) => wrap(() => setMemberRole(ctx.engine, ctx.player.id, input.playerId, input.role))),
  dissolve: authed.mutation(({ ctx }) => wrap(() => dissolveAlliance(ctx.engine, ctx.player.id))),

  chat: t.router({
    list: authed.query(({ ctx }) => allianceChatList(ctx.engine, ctx.player.id)),
    send: authed
      .input(z.object({ body: z.string().trim().min(1).max(CHAT_MAX) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await ctx.rateLimit(`achat:${ctx.player.id}`, CHAT_LIMIT, CHAT_WINDOW_SEC))) return { ok: false as const, code: "rate" };
        return wrap(() => sendAllianceChat(ctx.engine, ctx.player.id, input.body));
      }),
  }),

  diplomacy: t.router({
    get: authed.query(({ ctx }) => diplomacyView(ctx.engine, ctx.player.id)),
    proposePact: authed
      .input(z.object({ party }))
      .mutation(({ ctx, input }) => wrap(() => proposePact(ctx.engine, ctx.player.id, input.party))),
    acceptPact: authed
      .input(z.object({ id }))
      .mutation(({ ctx, input }) => wrap(() => acceptPact(ctx.engine, ctx.player.id, input.id))),
    cancelPact: authed
      .input(z.object({ id }))
      .mutation(({ ctx, input }) => wrap(() => cancelPact(ctx.engine, ctx.player.id, input.id))),
    declareWar: authed
      .input(z.object({ party }))
      .mutation(({ ctx, input }) => wrap(() => declareWar(ctx.engine, ctx.player.id, input.party))),
    peace: authed
      .input(z.object({ id }))
      .mutation(({ ctx, input }) => wrap(() => makePeace(ctx.engine, ctx.player.id, input.id))),
  }),

  /** Verwaltung: Höchstgröße einer Allianz (server_setting alliance_max_size). */
  setMaxSize: adminProc
    .input(z.object({ size: z.number().int().min(2).max(50) }))
    .mutation(({ ctx, input }) => setAllianceMaxSize(ctx.engine, input.size)),
});
