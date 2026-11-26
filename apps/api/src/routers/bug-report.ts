// Router „Fehler melden“: Meldung mit Log und Screenshot senden; Verwaltung: Liste, Einzelansicht, Status, Empfänger.
// Der Weg bugReport.send darf größere Anfragen schicken (BUG_REPORT_BODY_LIMIT, siehe main.ts); alle anderen nicht.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BUG_STATUSES,
  bugReportDetail,
  listBugReports,
  setBugReportStatus,
  setBugReportTo,
  submitBugReport,
} from "@tidefront/engine";
import { adminProc, authed, t } from "../trpc.ts";

/** Größte Anfrage für bugReport.send (Screenshot als Base64 plus Log). */
export const BUG_REPORT_BODY_LIMIT = 3 * 1024 * 1024;
export const BUG_REPORT_PATH = "bugReport.send";

/**
 * Vor dem tRPC-Plugin aufrufen: hebt die Grenze des tRPC-Wegs auf BUG_REPORT_BODY_LIMIT und weist alle anderen
 * tRPC-Anfragen über defaultLimit mit 413 ab (auch gebündelte, die bugReport.send enthalten: der Client schickt es einzeln).
 */
export function registerBugReportBodyLimit(app: FastifyInstance, defaultLimit: number): void {
  app.addHook("onRoute", (route) => {
    if (route.url === "/trpc/:path") route.bodyLimit = BUG_REPORT_BODY_LIMIT;
  });
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "POST" || !req.url.startsWith("/trpc/")) return;
    let path = req.url.slice(6).split("?")[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      // Unlesbarer Weg: wie jeder andere behandeln.
    }
    if (path === BUG_REPORT_PATH) return;
    const raw = req.headers["content-length"];
    const len = Number(raw);
    if ((raw !== undefined && (!Number.isFinite(len) || len > defaultLimit)) || (raw === undefined && req.headers["transfer-encoding"])) {
      return reply.code(413).send({ error: { message: "Request body is too large", code: -32600, data: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 } } });
    }
  });
}

const metaValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const bugReportInput = z.object({
  subject: z.string().trim().max(200),
  text: z.string().max(5000),
  meta: z.record(z.string().max(40), metaValue).refine((m) => Object.keys(m).length <= 30, "Zu viele Angaben."),
  log: z.string().max(200_000),
  // ~1,2 MB Datei als Base64 (4/3) plus Kopf.
  screenshot: z.string().max(1_700_000).nullable(),
});

export const bugReportRouter = t.router({
  send: authed
    .input(bugReportInput)
    .mutation(async ({ ctx, input }) => {
      // Zusätzlich zur Stundengrenze in der Datenbank: kurze Drossel gegen Doppelklicks.
      if (!(await ctx.rateLimit(`bug:${ctx.player.id}`, 3, 60))) return { ok: false as const, code: "rate" };
      return submitBugReport(ctx.engine, ctx.player.id, input);
    }),
  list: adminProc.query(({ ctx }) => listBugReports(ctx.engine.db)),
  get: adminProc
    .input(z.object({ id: z.number().int().min(1) }))
    .query(({ ctx, input }) => bugReportDetail(ctx.engine.db, input.id)),
  setStatus: adminProc
    .input(z.object({ id: z.number().int().min(1), status: z.enum(BUG_STATUSES) }))
    .mutation(async ({ ctx, input }) => ({ ok: await setBugReportStatus(ctx.engine.db, input.id, input.status) })),
  setRecipients: adminProc
    .input(z.object({ to: z.string().max(1000) }))
    .mutation(({ ctx, input }) => setBugReportTo(ctx.engine.db, input.to)),
});
