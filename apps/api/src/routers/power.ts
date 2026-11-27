// Seekabel / Stromverbund (v1.21): Kabel ansehen, anbieten, annehmen, Preis ändern, trennen. Eingehängt in router.ts.
import { z } from "zod";
import { cableAccept, cableCut, cableOffer, cableSetPrice, cablesView } from "@tidefront/engine";
import { authed, baseInput, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const id = z.number().int().min(1);
const price = z.number().min(0).max(1000);

export const powerRouter = t.router({
  /** Kabel des Hafens, offene Anfragen, mögliche Partner in Reichweite. */
  cables: authed.input(baseInput).query(({ ctx, input }) => cablesView(ctx.engine, ctx.player.id, input?.baseId)),
  offer: authed
    .input(z.object({ key, fromBaseId: id, toBaseId: id, price }))
    .mutation(({ ctx, input }) => cableOffer(ctx.engine, ctx.player.id, input.key, input)),
  accept: authed.input(z.object({ key, cableId: id })).mutation(({ ctx, input }) => cableAccept(ctx.engine, ctx.player.id, input.key, input.cableId)),
  price: authed
    .input(z.object({ key, cableId: id, price }))
    .mutation(({ ctx, input }) => cableSetPrice(ctx.engine, ctx.player.id, input.key, input.cableId, input.price)),
  cut: authed.input(z.object({ key, cableId: id })).mutation(({ ctx, input }) => cableCut(ctx.engine, ctx.player.id, input.key, input.cableId)),
});
