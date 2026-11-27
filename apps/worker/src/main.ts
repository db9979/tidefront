// Worker: verarbeitet fällige Ereignisse, Prüflauf der Börse, Marktnachrichten, Aufräumen, Betriebsalarm, gebündelte E-Mails, KI-Spieler.
import { createServer } from "node:http";
import Valkey from "iovalkey";
import { createDb } from "@tidefront/db";
import {
  AlertMemory,
  auditLedger,
  backlogHealthy,
  balance,
  checkOps,
  cleanup,
  purgeIntel,
  ensureWorldEventPlanner,
  ensureFieldPlanner,
  flushAchievementNotices,
  flushMailDigests,
  noticeHook,
  cleanupNudges,
  processDue,
  recordMilestones,
  runReminders,
  runWinback,
  refreshDerivedOpen,
  runMarketNews,
  runMorningSummaries,
  runBotsDue,
  runEventWatchdog,
  rankSnapshot,
  type Engine,
  type OpsStatus,
} from "@tidefront/engine";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://tidefront:tidefront@localhost:5432/tidefront";
const VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379";
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8081);

const { db, client } = createDb(DATABASE_URL, 5);
const pub = new Valkey(VALKEY_URL, { maxRetriesPerRequest: 2 });
pub.on("error", () => {});
const log = (msg: string, data?: unknown) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, data }));

const engine: Engine = {
  db,
  notify: (ids, kind) => {
    const msg = JSON.stringify({ kind });
    if (ids === null) void pub.publish("tf:all", msg).catch(() => {});
    else for (const id of ids) void pub.publish(`tf:player:${id}`, msg).catch(() => {});
  },
  log,
};
engine.push = noticeHook(() => engine);

let lastLoop = Date.now();
let stopping = false;
let nextAudit = 0;
let nextOps = 0;
let ops: OpsStatus | null = null;
const alerts = new AlertMemory();

/** Ein Wartungsschritt: Fehler werden geloggt, die folgenden Schritte laufen trotzdem. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log(`maintenance ${name} failed`, String((err as Error)?.stack ?? err));
  }
}

/** Alle 10 Minuten: Prüflauf, Aufräumen, Wächter der Ereignis-Queue, Planer. Jeder Schritt einzeln abgesichert. */
async function maintenance(): Promise<void> {
  await step("audit", async () => {
    const audit = await auditLedger(engine);
    if (!audit.ok) log("AUDIT FAILED", audit);
  });
  // Wracks, Sitzungen, Befehlsprotokoll, erledigte Ereignisse, alte Prüfläufe (audit_run).
  await step("cleanup", () => cleanup(engine, Date.now(), balance.combat.wreckHours));
  // Lagebild: Wissen älter als forgetHours (72 h) löschen.
  await step("intel purge", () => purgeIntel(db, Date.now()));
  // Wächter: hängende Missionen und abgerissene Ketten (nach endgültig gescheiterten Ereignissen) neu einplanen.
  await step("event watchdog", async () => {
    const r = await runEventWatchdog(engine, Date.now());
    if (r.missions + r.sentHome + Object.keys(r.chains).length > 0) log("event watchdog", r);
  });
  // Weltereignisse: nächstes Ereignis planen, falls keines ansteht (auch nach Saisonwechsel).
  await step("world events planner", () => ensureWorldEventPlanner(db, Date.now()));
  // Felder: aktive Rohstofffelder und Lieferzyklus (auch nach Saisonwechsel).
  await step("fields planner", () => ensureFieldPlanner(db, Date.now()));
  // Marktnachrichten: Lage auswerten (täglich Knappheit), effektiven Richtwert fortschreiben, Push.
  await step("market news", () => runMarketNews(engine, Date.now()));
  // Tagesbefehle aus dem Zustand (Ökostrom, Vorrat, Produktion …) auch ohne Abruf durch den Spieler fortschreiben.
  await step("daily derived", () => refreshDerivedOpen(db, Date.now()));
  // Admin-Kennzahlen: Meilensteine aus den Hafen-Zuständen; Spielerbindung: alte Entprellungs-Einträge löschen.
  await step("milestones", () => recordMilestones(db, Date.now()));
  await step("nudge cleanup", () => cleanupNudges(db));
  // PvP: Rang-Momentaufnahme des Spieltags (Kopfgeld, Mutfaktor) bald nach Mitternacht festhalten.
  await step("pvp rank snapshot", () => rankSnapshot(db, Date.now()));
}

async function loop() {
  while (!stopping) {
    try {
      const n = await processDue(engine, Date.now(), 200);
      if (n > 0) log("events", { processed: n });
      if (Date.now() >= nextAudit) {
        nextAudit = Date.now() + 10 * 60000;
        await maintenance();
      }
      if (Date.now() >= nextOps) {
        // Jede Minute: Kennzahlen, Alarm an Admins, gebündelte E-Mails.
        nextOps = Date.now() + 60000;
        await step("ops check", async () => { ops = await checkOps(engine, alerts); });
        await step("digest mails", async () => {
          const mails = await flushMailDigests(engine, Date.now());
          if (mails > 0) log("digest mails", { sent: mails });
        });
        await step("morning summaries", async () => {
          const summaries = await runMorningSummaries(engine, Date.now());
          if (summaries > 0) log("morning summaries", { sent: summaries });
        });
        // Erfolge: Push für frisch freigeschaltete Abzeichen.
        await step("achievement notices", async () => {
          const badges = await flushAchievementNotices(engine);
          if (badges > 0) log("achievement notices", { sent: badges });
        });
        // Spielerbindung: Tagesbefehle bereit / Serie in Gefahr, Nest wieder besetzt, Rückhol-E-Mail.
        await step("reminders", async () => {
          const reminders = await runReminders(engine, Date.now());
          if (reminders > 0) log("reminders", { sent: reminders });
        });
        await step("winback mails", async () => {
          const winback = await runWinback(engine, Date.now());
          if (winback > 0) log("winback mails", { sent: winback });
        });
        // KI-Spieler: höchstens bots.turnsPerMinute fällige Bots reihum (abschaltbar: Server-Einstellung bots_enabled).
        if (process.env.BOTS_DISABLED !== "1") {
          try {
            const bots = await runBotsDue(engine, Date.now());
            if (bots.turns > 0) log("bot turns", bots);
          } catch (err) {
            log("bot tick failed", String(err));
          }
        }
      }
      lastLoop = Date.now();
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      log("loop error", String(err));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Gesundheit: die Schleife lief in den letzten 60 Sekunden und der Rückstau ist höchstens 10 Minuten alt.
createServer((_req, res) => {
  const alive = Date.now() - lastLoop < 60000;
  const ok = alive && backlogHealthy(ops);
  res.writeHead(ok ? 200 : 503).end(ok ? "ok" : alive ? "backlog" : "stalled");
}).listen(HEALTH_PORT, "127.0.0.1");

const stop = async () => {
  stopping = true;
  setTimeout(async () => {
    await client.end({ timeout: 5 });
    process.exit(0);
  }, 1500);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

log("worker started", { poll: POLL_MS });
void loop();
