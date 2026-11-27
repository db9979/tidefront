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

async function loop() {
  while (!stopping) {
    try {
      const n = await processDue(engine, Date.now(), 200);
      if (n > 0) log("events", { processed: n });
      if (Date.now() >= nextAudit) {
        nextAudit = Date.now() + 10 * 60000;
        const audit = await auditLedger(engine);
        if (!audit.ok) log("AUDIT FAILED", audit);
        await cleanup(engine, Date.now(), balance.combat.wreckHours);
        // Lagebild: Wissen älter als forgetHours (72 h) löschen.
        await purgeIntel(db, Date.now()).catch((err) => log("intel purge", String(err)));
        // Weltereignisse: nächstes Ereignis planen, falls keines ansteht (auch nach Saisonwechsel).
        await ensureWorldEventPlanner(db, Date.now()).catch((err) => log("world events planner", String(err)));
        // Felder: aktive Rohstofffelder und Lieferzyklus (auch nach Saisonwechsel).
        await ensureFieldPlanner(db, Date.now()).catch((err) => log("fields planner", String(err)));
        // Marktnachrichten: Lage auswerten (täglich Knappheit), effektiven Richtwert fortschreiben, Push.
        await runMarketNews(engine, Date.now()).catch((err) => log("market news", String(err)));
        // Tagesbefehle aus dem Zustand (Ökostrom, Vorrat, Produktion …) auch ohne Abruf durch den Spieler fortschreiben.
        await refreshDerivedOpen(db, Date.now()).catch((err) => log("daily derived", String(err)));
        // Admin-Kennzahlen: Meilensteine aus den Hafen-Zuständen; Spielerbindung: alte Entprellungs-Einträge löschen.
        await recordMilestones(db, Date.now()).catch((err) => log("milestones", String(err)));
        await cleanupNudges(db).catch((err) => log("nudge cleanup", String(err)));
      }
      if (Date.now() >= nextOps) {
        // Jede Minute: Kennzahlen, Alarm an Admins, gebündelte E-Mails.
        nextOps = Date.now() + 60000;
        try {
          ops = await checkOps(engine, alerts);
          const mails = await flushMailDigests(engine, Date.now());
          if (mails > 0) log("digest mails", { sent: mails });
          const summaries = await runMorningSummaries(engine, Date.now());
          if (summaries > 0) log("morning summaries", { sent: summaries });
          // Erfolge: Push für frisch freigeschaltete Abzeichen.
          const badges = await flushAchievementNotices(engine);
          if (badges > 0) log("achievement notices", { sent: badges });
          // Spielerbindung: Tagesbefehle bereit / Serie in Gefahr, Nest wieder besetzt, Rückhol-E-Mail.
          const reminders = await runReminders(engine, Date.now());
          if (reminders > 0) log("reminders", { sent: reminders });
          const winback = await runWinback(engine, Date.now());
          if (winback > 0) log("winback mails", { sent: winback });
        } catch (err) {
          log("ops check failed", String(err));
        }
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
