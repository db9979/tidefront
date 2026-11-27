// Router für die Weltpolitik (docs/REGELN-WELTPOLITIK.md): Gezeit-Kalender und wirkende Regler, Seerat (Abstimmung),
// Ansehen je KI-Spieler, Gesuche (annehmen/ablehnen), Verwaltung (Not-Aus, Fenster absagen). Eingehängt in router.ts
// als politik. Die Oberfläche folgt nach dem Navigationsumbau.
import { z } from "zod";
import {
  acceptPact, cancelPact, isKiOffer,
  acceptGesuch, cancelPolitikWindow, declineGesuch, politikAdminView, politikKiView, politikOverview, seeratVote, setPolitikOff,
} from "@tidefront/engine";
import { adminProc, authed, baseRef, t, wrap } from "../trpc.ts";

const key = z.string().min(8).max(80);
const id = z.number().int().min(1);

export const politikRouter = t.router({
  /** Saisonkalender (Gezeit-Fenster, Wochenbeschlüsse), wirkende Regler als Zeilen, Sitzungen mit eigener Stimme. */
  overview: authed.query(({ ctx }) => politikOverview(ctx.engine, ctx.player.id)),
  /** Ansehen je KI-Spieler (Stufe, Wirkung, Verlauf) und eigene Gesuche der Saison. */
  ki: authed.query(({ ctx }) => politikKiView(ctx.engine, ctx.player.id)),
  /** Stimme abgeben oder ändern (geheim), solange die Sitzung offen ist. */
  vote: authed
    .input(z.object({ key, sitzungId: id, option: z.string().min(1).max(40) }))
    .mutation(({ ctx, input }) => seeratVote(ctx.engine, ctx.player.id, input.key, input)),
  /** Gesuch annehmen: schließt den Liefervertrag und belegt einen Tagesbefehl-Platz. */
  acceptGesuch: authed
    .input(z.object({ key, gesuchId: id, ...baseRef }))
    .mutation(({ ctx, input }) => wrap(() => acceptGesuch(ctx.engine, ctx.player.id, input.key, input.gesuchId, input.baseId))),
  declineGesuch: authed
    .input(z.object({ key, gesuchId: id }))
    .mutation(({ ctx, input }) => declineGesuch(ctx.engine, ctx.player.id, input.key, input.gesuchId)),
  /** Paktangebot eines KI-Spielers annehmen (ein Tippen) bzw. ablehnen. Code no_treaty, wenn es kein offenes KI-Angebot ist. */
  acceptPakt: authed
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => wrap(async () => ((await isKiOffer(ctx.engine.db, ctx.player.id, input.id)) ? acceptPact(ctx.engine, ctx.player.id, input.id) : { ok: false as const, code: "no_treaty" }))),
  declinePakt: authed
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => wrap(async () => ((await isKiOffer(ctx.engine.db, ctx.player.id, input.id)) ? cancelPact(ctx.engine, ctx.player.id, input.id) : { ok: false as const, code: "no_treaty" }))),
  admin: adminProc.query(({ ctx }) => politikAdminView(ctx.engine)),
  adminOff: adminProc
    .input(z.object({ part: z.enum(["gezeit", "seerat", "gesuche"]), off: z.boolean() }))
    .mutation(({ ctx, input }) => setPolitikOff(ctx.engine, input.part, input.off)),
  adminCancel: adminProc
    .input(z.object({ fensterId: id }))
    .mutation(({ ctx, input }) => wrap(() => cancelPolitikWindow(ctx.engine, input.fensterId))),
});
