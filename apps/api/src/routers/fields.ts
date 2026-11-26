// Felder: Rohstofffelder – Lesemodell und Rückruf der Besatzung (Missionen laufen über mission.launch mit fieldId).
// Eingehängt in router.ts.
import { z } from "zod";
import { fieldRecall, fieldsView } from "@tidefront/engine";
import { authed, baseInput, baseRef, t } from "../trpc.ts";

const key = z.string().min(8).max(80);

export const fieldsRouter = t.router({
  /** Alle Felder (Besitzerfarbe, bekannte Besatzung, Zonen), eigene Felder mit Ertrag, Höchstzahl, nächste Lieferung. */
  view: authed.input(baseInput).query(({ ctx, input }) => fieldsView(ctx.engine, ctx.player.id, input?.baseId)),
  recall: authed
    .input(z.object({ key, fieldId: z.number().int().min(1), ...baseRef }))
    .mutation(({ ctx, input }) => fieldRecall(ctx.engine, ctx.player.id, input.key, input.fieldId, input.baseId)),
});
