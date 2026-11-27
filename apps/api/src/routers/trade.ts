// Router für den Handel zwischen Spielern (Angebote mit Treuhand). Eingehängt in router.ts als playerTrade.
import { z } from "zod";
import { acceptOffer, createOffer, OFFER_QTY_MAX, offersView, playerTradeStats, withdrawOffer } from "@tidefront/engine";
import { authed, baseInput, baseRef, t } from "../trpc.ts";

const key = z.string().min(8).max(80);
const asset = z.string().max(20);
const qty = z.number().int().min(1).max(OFFER_QTY_MAX);
const escortInput = z.record(z.string().max(40), z.number().int().min(0).max(100_000));

export const playerTradeRouter = t.router({
  list: authed.input(baseInput).query(({ ctx, input }) => offersView(ctx.engine, ctx.player.id, input?.baseId)),
  /** Abgeschlossene Spielergeschäfte der letzten 7 Tage je Paar (nur Anzeige, kurz zwischengespeichert). */
  stats: authed.query(({ ctx }) => playerTradeStats(ctx.engine)),
  create: authed
    // See: Konvoi – optionales Geleit des Anbieters für die ausgehende Ware (läuft bei Annahme aus).
    .input(z.object({ key, give: asset, giveQty: qty, want: asset, wantQty: qty, visibility: z.enum(["public", "alliance"]), escort: escortInput.optional(), ...baseRef }))
    .mutation(({ ctx, input }) => createOffer(ctx.engine, ctx.player.id, input.key, input)),
  accept: authed
    // See: Konvoi – optionaler Geleitschutz (eigene Schiffe) für die eingehende Ware.
    .input(z.object({ key, offerId: z.number().int().min(1), escort: escortInput.optional(), ...baseRef }))
    .mutation(({ ctx, input }) => acceptOffer(ctx.engine, ctx.player.id, input.key, input.offerId, input.escort, input.baseId)),
  withdraw: authed
    .input(z.object({ key, offerId: z.number().int().min(1), ...baseRef }))
    .mutation(({ ctx, input }) => withdrawOffer(ctx.engine, ctx.player.id, input.key, input.offerId, input.baseId)),
});
