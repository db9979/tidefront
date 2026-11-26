// Router für Admirale: Ansicht, Ernennen, zweite Spezialisierung, Hafenkommandant, Lösegeld, Entlassen.
import { z } from "zod";
import { admiralView, appointAdmiral, chooseAdmiralSpec, dismissAdmiral, ransomAdmiral, stationAdmiral } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const id = z.number().int().min(1);
const spec = z.string().min(1).max(40);

export const admiralRouter = t.router({
  get: authed.query(({ ctx }) => admiralView(ctx.engine, ctx.player.id)),
  appoint: authed
    .input(z.object({ key, name: z.string().min(1).max(60).nullable(), spec }))
    .mutation(({ ctx, input }) => appointAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  spec: authed
    .input(z.object({ key, admiralId: id, spec }))
    .mutation(({ ctx, input }) => chooseAdmiralSpec(ctx.engine, ctx.player.id, input.key, input)),
  station: authed
    .input(z.object({ key, admiralId: id.nullable() }))
    .mutation(({ ctx, input }) => stationAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  ransom: authed
    .input(z.object({ key, admiralId: id }))
    .mutation(({ ctx, input }) => ransomAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  dismiss: authed
    .input(z.object({ key, admiralId: id }))
    .mutation(({ ctx, input }) => dismissAdmiral(ctx.engine, ctx.player.id, input.key, input)),
});
