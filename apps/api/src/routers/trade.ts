// Router für den Handel zwischen Spielern (Angebote mit Treuhand). Eingehängt in router.ts als playerTrade.
import { z } from "zod";
import { acceptOffer, createOffer, OFFER_QTY_MAX, offersView, playerTradeStats, withdrawOffer } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const asset = z.string().max(20);
const qty = z.number().int().min(1).max(OFFER_QTY_MAX);

export const playerTradeRouter = t.router({
  list: authed.query(({ ctx }) => offersView(ctx.engine, ctx.player.id)),
  /** Abgeschlossene Spielergeschäfte der letzten 7 Tage je Paar (nur Anzeige, kurz zwischengespeichert). */
  stats: authed.query(({ ctx }) => playerTradeStats(ctx.engine)),
  create: authed
    .input(z.object({ key, give: asset, giveQty: qty, want: asset, wantQty: qty, visibility: z.enum(["public", "alliance"]) }))
    .mutation(({ ctx, input }) => createOffer(ctx.engine, ctx.player.id, input.key, input)),
  accept: authed
    // See: Konvoi – optionaler Geleitschutz (eigene Schiffe) für die eingehende Ware.
    .input(z.object({ key, offerId: z.number().int().min(1), escort: z.record(z.string().max(40), z.number().int().min(0).max(100_000)).optional() }))
    .mutation(({ ctx, input }) => acceptOffer(ctx.engine, ctx.player.id, input.key, input.offerId, input.escort)),
  withdraw: authed
    .input(z.object({ key, offerId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => withdrawOffer(ctx.engine, ctx.player.id, input.key, input.offerId)),
});
