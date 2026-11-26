// tRPC-Grundlagen (Kontext, Prozeduren), getrennt vom Router, damit Teil-Router sie ohne Kreisimport nutzen.
import { initTRPC, TRPCError } from "@trpc/server";
import { GameError, inputErrorText, type Engine, type InputIssue } from "@tidefront/engine";

export interface Ctx {
  engine: Engine;
  player: { id: number; name: string; isAdmin: boolean } | null;
  token: string | undefined;
  setSession: (token: string | null) => void;
  rateLimit: (bucket: string, limit: number, windowSec: number) => Promise<boolean>;
  ip: string;
}

export const t = initTRPC.context<Ctx>().create({
  // Eingabefehler (Zod) als deutscher Kurztext, damit der Client mehr zeigen kann als „Keine Verbindung“.
  errorFormatter({ shape, error }) {
    const issues = (error.cause as { issues?: InputIssue[] } | undefined)?.issues;
    const inputError = error.code === "BAD_REQUEST" && Array.isArray(issues) ? inputErrorText(issues) : null;
    return { ...shape, data: { ...shape.data, inputError } };
  },
});

export const authed = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.player) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!(await ctx.rateLimit(`cmd:${ctx.player.id}`, 120, 60))) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
  return next({ ctx: { ...ctx, player: ctx.player } });
});

/** Nur für Admins; is_admin kommt bei jeder Anfrage frisch aus der Datenbank (Sitzung). */
export const adminProc = authed.use(async ({ ctx, next }) => {
  if (!ctx.player.isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

/** Fehler des Spiels als Rückgabewert statt Ausnahme. */
export async function wrap<T>(fn: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return { ok: false, code: err.code };
    throw err;
  }
}
