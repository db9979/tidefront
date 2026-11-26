// Router für Admirale: Ansicht, Ernennen, zweite Spezialisierung, Hafenkommandant, Lösegeld, Entlassen.
import { z } from "zod";
import { admiralView, appointAdmiral, chooseAdmiralSpec, dismissAdmiral, ransomAdmiral, stationAdmiral } from "@tidefront/engine";
import { authed, baseInput, baseRef, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const id = z.number().int().min(1);
const spec = z.string().min(1).max(40);

export const admiralRouter = t.router({
  get: authed.input(baseInput).query(({ ctx, input }) => admiralView(ctx.engine, ctx.player.id, input?.baseId)),
  appoint: authed
    .input(z.object({ key, name: z.string().min(1).max(60).nullable(), spec, ...baseRef }))
    .mutation(({ ctx, input }) => appointAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  spec: authed
    .input(z.object({ key, admiralId: id, spec, ...baseRef }))
    .mutation(({ ctx, input }) => chooseAdmiralSpec(ctx.engine, ctx.player.id, input.key, input)),
  station: authed
    .input(z.object({ key, admiralId: id.nullable(), ...baseRef }))
    .mutation(({ ctx, input }) => stationAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  ransom: authed
    .input(z.object({ key, admiralId: id, ...baseRef }))
    .mutation(({ ctx, input }) => ransomAdmiral(ctx.engine, ctx.player.id, input.key, input)),
  dismiss: authed
    .input(z.object({ key, admiralId: id, ...baseRef }))
    .mutation(({ ctx, input }) => dismissAdmiral(ctx.engine, ctx.player.id, input.key, input)),
});
