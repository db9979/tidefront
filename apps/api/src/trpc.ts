// tRPC-Grundlagen (Kontext, Prozeduren), getrennt vom Router, damit Teil-Router sie ohne Kreisimport nutzen.
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Failures } from "./rate-limit.ts";
import { GameError, inputErrorText, recordRpc, type Engine, type InputIssue } from "@tidefront/engine";

export interface Ctx {
  engine: Engine;
  player: { id: number; name: string; isAdmin: boolean } | null;
  token: string | undefined;
  setSession: (token: string | null) => void;
  rateLimit: (bucket: string, limit: number, windowSec: number) => Promise<boolean>;
  /** Fehlversuche zählen (Login je Kontoname, rate-limit.ts); fehlt nur in Tests ohne Valkey. */
  failures?: Failures;
  ip: string;
}

const root = initTRPC.context<Ctx>().create({
  // Eingabefehler (Zod) als deutscher Kurztext, damit der Client mehr zeigen kann als „Keine Verbindung“.
  errorFormatter({ shape, error }) {
    const issues = (error.cause as { issues?: InputIssue[] } | undefined)?.issues;
    const inputError = error.code === "BAD_REQUEST" && Array.isArray(issues) ? inputErrorText(issues) : null;
    return { ...shape, data: { ...shape.data, inputError } };
  },
});

/** Admin-Kennzahlen: Laufzeit jeder Prozedur (Ringpuffer im Speicher, rpc-timing.ts). */
const timed = root.procedure.use(async ({ path, next }) => {
  const t0 = performance.now();
  const r = await next();
  recordRpc(path, performance.now() - t0, r.ok);
  return r;
});

/** Wie die tRPC-Wurzel, aber jede Prozedur (auch authed/adminProc) wird gemessen. */
export const t = { ...root, procedure: timed } as unknown as typeof root;

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

/**
 * Mehrere Häfen: optionaler Hafen jeder hafenbezogenen Prozedur. Fehlt baseId, gilt der Heimathafen;
 * die Engine prüft den Besitz (fremd/unbekannt → "no_base").
 */
export const baseRef = { baseId: z.number().int().min(1).optional() };
/** Eingabe für Abfragen ohne weitere Parameter (Eingabe selbst optional, damit alte Aufrufe gültig bleiben). */
export const baseInput = z.object(baseRef).optional();

/** Fehler des Spiels als Rückgabewert statt Ausnahme. */
export async function wrap<T>(fn: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return { ok: false, code: err.code };
    throw err;
  }
}
