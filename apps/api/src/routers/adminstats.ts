// Teil-Router der Verwaltung (nur Admins, adminProc prüft is_admin serverseitig bei jeder Anfrage):
// Statistik und Sicherungen (Liste, „Jetzt sichern“, Download-Token für die Fastify-Route backup-download.ts).
import { z } from "zod";
import {
  adminBalanceCached,
  adminKpiCached,
  adminStatsCached,
  rpcTimings,
  backupRequests,
  createDownloadToken,
  listBackups,
  pendingBackupDeletes,
  requestBackup,
  requestBackupDelete,
} from "@tidefront/engine";
import { adminProc, t } from "../trpc.ts";

export const adminStatsRouter = t.router({
  stats: adminProc
    .input(z.object({ days: z.union([z.literal(7), z.literal(28)]) }))
    .query(({ ctx, input }) => adminStatsCached(ctx.engine.db, input.days)),

  /** Spielerbindung: Menschen/KI, Retention, Meilensteine, Abschlussquoten, Laufzeiten je Prozedur (dieser Prozess). */
  kpi: adminProc
    .input(z.object({ days: z.union([z.literal(7), z.literal(28)]) }))
    .query(async ({ ctx, input }) => ({ ...(await adminKpiCached(ctx.engine.db, input.days)), rpc: rpcTimings() })),

  /** Balance live (Welle 2): Rohstoffbilanz, Zuflüsse, Welt & Worker, Nutzung je System. */
  balance: adminProc
    .input(z.object({ days: z.union([z.literal(7), z.literal(28)]) }))
    .query(({ ctx, input }) => adminBalanceCached(ctx.engine.db, input.days)),

  backups: adminProc.query(async ({ ctx }) => ({
    ...(await listBackups()),
    requests: await backupRequests(ctx.engine.db),
    deleting: await pendingBackupDeletes(ctx.engine.db),
  })),

  backupDelete: adminProc
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`backupdel:${ctx.player.id}`, 30, 600))) return { ok: false as const, code: "rate" };
      const r = await requestBackupDelete(ctx.engine.db, ctx.player.id, input.name);
      if (r.ok) ctx.engine.log("backup delete requested", { player: ctx.player.name, file: input.name });
      return r;
    }),

  backupNow: adminProc.mutation(async ({ ctx }) => {
    if (!(await ctx.rateLimit(`backupnow:${ctx.player.id}`, 6, 3600))) return { ok: false as const, code: "rate" };
    const r = await requestBackup(ctx.engine.db, ctx.player.id);
    return { ok: true as const, ...r };
  }),

  backupToken: adminProc
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.rateLimit(`backuptoken:${ctx.player.id}`, 30, 600))) return { ok: false as const, code: "rate" };
      return createDownloadToken(ctx.engine.db, ctx.player.id, input.name);
    }),
});
