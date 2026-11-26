// Felder: Rohstofffelder – Lesemodell und Rückruf der Besatzung (Missionen laufen über mission.launch mit fieldId).
// Eingehängt in router.ts.
import { z } from "zod";
import { fieldRecall, fieldsView } from "@tidefront/engine";
import { authed, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const fieldsRouter = t.router({
  /** Alle Felder (Besitzerfarbe, bekannte Besatzung, Zonen), eigene Felder mit Ertrag, Höchstzahl, nächste Lieferung. */
  view: authed.query(({ ctx }) => fieldsView(ctx.engine, ctx.player.id)),
  recall: authed
    .input(z.object({ key, fieldId: z.number().int().min(1) }))
    .mutation(({ ctx, input }) => fieldRecall(ctx.engine, ctx.player.id, input.key, input.fieldId)),
});
