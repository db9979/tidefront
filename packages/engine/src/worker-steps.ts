// Worker-Schritte (Welle 2, TE-05/AN-12): die Wartung (alle 10 min) und die Minutenschritte als Liste, damit der Worker
// (apps/worker) und der Saisonlauf (sim/saison.ts) dieselben Schritte in derselben Reihenfolge ausführen. Jeder Schritt
// ist einzeln abgesichert, wird gemessen (StepStats → Tabelle worker_step_day) und ab SLOW_STEP_MS als langsam geloggt.
// Zwischen den Wartungsschritten darf der Aufrufer fällige Ereignisse abarbeiten (between), damit Kämpfe und
// Lieferungen nicht hinter der ganzen Wartung warten.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@tidefront/db";
import { tables } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { balance } from "./context.ts";
import { auditLedger, cleanup } from "./audit.ts";
import { purgeIntel } from "./intel-store.ts";
import { runEventWatchdog } from "./event-watchdog.ts";
import { ensureWorldEventPlanner } from "./world-events.ts";
import { ensureFieldPlanner } from "./fields-run.ts";
import { runMarketNews } from "./market-news-sources.ts";
import { refreshDerivedOpen } from "./challenges.ts";
import { cleanupNudges, recordMilestones } from "./activity.ts";
import { rankSnapshot } from "./pvp.ts";
import { runCatchUp } from "./catch-up.ts";
import { checkOps, type AlertMemory, type OpsStatus } from "./ops.ts";
import { flushMailDigests } from "./mail.ts";
import { runMorningSummaries } from "./summary.ts";
import { flushAchievementNotices } from "./achievements.ts";
import { runReminders } from "./retention.ts";
import { runWinback } from "./winback.ts";
import { recordUsage, snapshotBases } from "./metrics.ts";
import { dayKey } from "./challenge-pool.ts";

/** Ab dieser Dauer gilt ein Schritt als langsam (Log „slow step“, Zähler slow). */
export const SLOW_STEP_MS = 2000;

export interface WorkerStep {
  name: string;
  /** Rückgabe: optionale Kennzahlen für das Log (null/0 = nichts loggen). */
  run: (nowMs: number) => Promise<unknown>;
}

interface Acc { runs: number; totalMs: number; maxMs: number; slow: number; errors: number }

/** Schrittdauern im Speicher je Tag und Schritt; flush schreibt sie aufaddiert nach worker_step_day. */
export class StepStats {
  private acc = new Map<string, Acc>();

  record(day: string, step: string, ms: number, failed = false): void {
    const k = `${day}|${step}`;
    const a = this.acc.get(k) ?? { runs: 0, totalMs: 0, maxMs: 0, slow: 0, errors: 0 };
    a.runs++;
    a.totalMs += ms;
    a.maxMs = Math.max(a.maxMs, ms);
    if (ms >= SLOW_STEP_MS) a.slow++;
    if (failed) a.errors++;
    this.acc.set(k, a);
  }

  /** Gesammelte Werte (für Tests und den Saisonlauf). */
  entries(): { day: string; step: string; runs: number; totalMs: number; maxMs: number; slow: number; errors: number }[] {
    return [...this.acc].map(([k, a]) => {
      const [day, step] = k.split("|");
      return { day, step, ...a };
    });
  }

  /** Aufaddiert in worker_step_day schreiben und den Speicher leeren. */
  async flush(db: DbOrTx): Promise<number> {
    const rows = this.entries();
    this.acc.clear();
    if (rows.length === 0) return 0;
    const t = tables.workerStepDay;
    await db.insert(t).values(rows.map((r) => ({ ...r, totalMs: Math.round(r.totalMs * 10) / 10, maxMs: Math.round(r.maxMs * 10) / 10 })))
      .onConflictDoUpdate({
        target: [t.day, t.step],
        set: {
          runs: sql`${t.runs} + excluded.runs`,
          totalMs: sql`${t.totalMs} + excluded.total_ms`,
          maxMs: sql`greatest(${t.maxMs}, excluded.max_ms)`,
          slow: sql`${t.slow} + excluded.slow`,
          errors: sql`${t.errors} + excluded.errors`,
        },
      });
    return rows.length;
  }
}

/**
 * Einen Schritt ausführen: Fehler werden geloggt (die folgenden Schritte laufen trotzdem), Dauer gemessen und ab
 * SLOW_STEP_MS als „slow step“ geloggt. Rückgabe: Ergebnis des Schritts oder undefined bei Fehler.
 */
export async function runStep<T>(engine: Engine, stats: StepStats | null, name: string, nowMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = performance.now();
  let failed = false;
  try {
    return await fn();
  } catch (err) {
    failed = true;
    engine.log(`step ${name} failed`, String((err as Error)?.stack ?? err));
    return undefined;
  } finally {
    const ms = performance.now() - t0;
    stats?.record(dayKey(nowMs), name, ms, failed);
    if (ms >= SLOW_STEP_MS) engine.log("slow step", { step: name, ms: Math.round(ms) });
  }
}

/** Wartung alle 10 Minuten: Prüflauf, Aufräumen, Wächter, Planer, Marktnachrichten, Kennzahlen, Aufholhilfe. */
export function maintenanceSteps(engine: Engine): WorkerStep[] {
  const db = engine.db;
  return [
    { name: "audit", run: async () => {
      const audit = await auditLedger(engine);
      if (!audit.ok) engine.log("AUDIT FAILED", audit);
      return null;
    } },
    // Wracks, Sitzungen, Befehlsprotokoll, erledigte Ereignisse, alte Prüfläufe (audit_run).
    { name: "cleanup", run: (now) => cleanup(engine, now, balance.combat.wreckHours) },
    // Lagebild: Wissen älter als forgetHours (72 h) löschen.
    { name: "intel purge", run: (now) => purgeIntel(db, now) },
    // Wächter: hängende Missionen und abgerissene Ketten neu einplanen.
    { name: "event watchdog", run: async (now) => {
      const r = await runEventWatchdog(engine, now);
      return r.missions + r.sentHome + Object.keys(r.chains).length > 0 ? r : null;
    } },
    // Weltereignisse: nächstes Ereignis planen, falls keines ansteht (auch nach Saisonwechsel).
    { name: "world events planner", run: (now) => ensureWorldEventPlanner(db, now) },
    // Felder: aktive Rohstofffelder und Lieferzyklus (auch nach Saisonwechsel).
    { name: "fields planner", run: (now) => ensureFieldPlanner(db, now) },
    // Marktnachrichten: Lage auswerten (täglich Knappheit), effektiven Richtwert fortschreiben, Push.
    { name: "market news", run: (now) => runMarketNews(engine, now) },
    // Tagesbefehle aus dem Zustand auch ohne Abruf durch den Spieler fortschreiben.
    { name: "daily derived", run: (now) => refreshDerivedOpen(db, now) },
    // Admin-Kennzahlen: Meilensteine, Tagesschnappschuss je Hafen, Nutzungszähler je System.
    { name: "milestones", run: (now) => recordMilestones(db, now) },
    { name: "base snapshot", run: (now) => snapshotBases(db, now) },
    { name: "usage", run: (now) => recordUsage(db, now) },
    { name: "nudge cleanup", run: () => cleanupNudges(db) },
    // PvP: Rang-Momentaufnahme des Spieltags bald nach Mitternacht festhalten.
    { name: "pvp rank snapshot", run: (now) => rankSnapshot(db, now) },
    // Aufholhilfe: einmal je Stunde Median der Ausbaupunkte, Rückstand und Zufluss der Baugutschrift.
    { name: "catch up", run: async (now) => {
      const n = await runCatchUp(engine, now);
      return n > 0 ? { bases: n } : null;
    } },
  ];
}

/** Jede Minute: Kennzahlen und Alarm, gebündelte E-Mails, Morgenberichte, Erfolge, Erinnerungen, Rückhol-Mails. */
export function minuteSteps(engine: Engine, alerts: AlertMemory, onOps?: (ops: OpsStatus) => void): WorkerStep[] {
  const counted = (fn: (now: number) => Promise<number>, key: string) => async (now: number) => {
    const n = await fn(now);
    return n > 0 ? { [key]: n } : null;
  };
  return [
    { name: "ops check", run: async (now) => {
      const ops = await checkOps(engine, alerts, now);
      onOps?.(ops);
      return null;
    } },
    { name: "digest mails", run: counted((now) => flushMailDigests(engine, now), "sent") },
    { name: "morning summaries", run: counted((now) => runMorningSummaries(engine, now), "sent") },
    // Erfolge: Push für frisch freigeschaltete Abzeichen.
    { name: "achievement notices", run: counted(() => flushAchievementNotices(engine), "sent") },
    // Spielerbindung: Tagesbefehle bereit / Serie in Gefahr, Nest wieder besetzt.
    { name: "reminders", run: counted((now) => runReminders(engine, now), "sent") },
    { name: "winback mails", run: counted((now) => runWinback(engine, now), "sent") },
  ];
}

/**
 * Schritte nacheinander ausführen (gemessen, einzeln abgesichert). `between` läuft nach jedem Schritt (Worker: fällige
 * Ereignisse abarbeiten). Kennzahlen eines Schritts (Rückgabe ≠ null/0/undefined) gehen ins Log.
 */
export async function runSteps(engine: Engine, stats: StepStats | null, steps: WorkerStep[], nowMs: () => number, between?: () => Promise<unknown>): Promise<void> {
  for (const s of steps) {
    const r = await runStep(engine, stats, s.name, nowMs(), () => s.run(nowMs()));
    if (r !== null && r !== undefined && r !== 0 && typeof r === "object") engine.log(s.name, r);
    if (between) await runStep(engine, stats, "events (between)", nowMs(), between);
  }
}
