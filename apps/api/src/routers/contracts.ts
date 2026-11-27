// Router für Lieferverträge (v1.31): Angebote der KI-Spieler, Verträge zwischen Spielern, Kündigung. Eingehängt in
// router.ts als contracts.
import { z } from "zod";
import {
  acceptPlayerContract, cancelContract, contractBandView, contractsView, kiContractQuote, proposePlayerContract, signKiContract,
  withdrawPlayerContract,
} from "@tidefront/engine";
import { authed, baseInput, baseRef, t, wrap } from "../trpc.ts";

const key = z.string().min(8).max(80);
const side = z.enum(["buy", "sell"]);
const resource = z.string().max(20);
const qty = z.number().int().min(1).max(10_000_000);
const days = z.number().int().min(1).max(30);
const escort = z.record(z.string().max(40), z.number().int().min(0).max(100_000)).optional();
const kiDeal = { kiId: z.number().int().min(1), side, resource, qty, days, abo: z.boolean().optional() };

export const contractsRouter = t.router({
  list: authed.input(baseInput).query(({ ctx, input }) => contractsView(ctx.engine, ctx.player.id, input?.baseId)),
  /** Vorschau eines KI-Vertrags: Preis, Anzahlung, Tranchen, Börse zum Vergleich. */
  quote: authed.input(z.object({ ...kiDeal, ...baseRef })).query(({ ctx, input }) => wrap(() => kiContractQuote(ctx.engine, ctx.player.id, input))),
  /** Preisband für ein Angebot an Spieler. */
  band: authed.input(z.object({ resource, days })).query(({ ctx, input }) => wrap(async () => ({ ok: true as const, ...(await contractBandView(ctx.engine, input.resource, input.days)) }))),
  signKi: authed
    .input(z.object({ key, ...kiDeal, expectedPrice: z.number().positive(), escort, ...baseRef }))
    .mutation(({ ctx, input }) => signKiContract(ctx.engine, ctx.player.id, input.key, input)),
  propose: authed
    .input(z.object({ key, side, resource, qty, days, price: z.number().positive().max(1000), target: z.string().trim().max(24).nullable().optional(), escort, ...baseRef }))
    .mutation(({ ctx, input }) => proposePlayerContract(ctx.engine, ctx.player.id, input.key, input)),
  accept: authed
    .input(z.object({ key, contractId: z.number().int().min(1), escort, ...baseRef }))
    .mutation(({ ctx, input }) => acceptPlayerContract(ctx.engine, ctx.player.id, input.key, input.contractId, { baseId: input.baseId, escort: input.escort })),
  withdraw: authed
    .input(z.object({ key, contractId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => withdrawPlayerContract(ctx.engine, ctx.player.id, input.key, input.contractId)),
  cancel: authed
    .input(z.object({ key, contractId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => cancelContract(ctx.engine, ctx.player.id, input.key, input.contractId)),
});
