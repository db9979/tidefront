// Worker: verarbeitet fällige Ereignisse, Prüflauf der Börse, Marktnachrichten, Aufräumen, Betriebsalarm, gebündelte E-Mails, KI-Spieler.
// Die Schritte selbst stehen in engine/src/worker-steps.ts (dieselbe Liste nutzt der Saisonlauf npm run sim:saison).
import { createServer } from "node:http";
import Valkey from "iovalkey";
import { createDb } from "@tidefront/db";
import {
  AlertMemory,
  backlogHealthy,
  maintenanceSteps,
  minuteSteps,
  noticeHook,
  processDue,
  runBotsDue,
  runStep,
  runSteps,
  StepStats,
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

/** Schrittdauer je Tag (worker_step_day, Verwaltung → Welt & Worker); geschrieben nach jeder Wartungsrunde. */
const stats = new StepStats();
const maintenance = maintenanceSteps(engine);
const minutely = minuteSteps(engine, alerts, (o) => { ops = o; });
/** Zwischen den Wartungsschritten fällige Ereignisse abarbeiten (TE-05: Kämpfe warten nicht auf die ganze Wartung). */
const dueBetween = () => processDue(engine, Date.now(), 50);

async function loop() {
  while (!stopping) {
    try {
      const n = (await runStep(engine, stats, "events", Date.now(), () => processDue(engine, Date.now(), 200))) ?? 0;
      if (n > 0) log("events", { processed: n });
      if (Date.now() >= nextAudit) {
        nextAudit = Date.now() + 10 * 60000;
        await runSteps(engine, stats, maintenance, Date.now, dueBetween);
        await stats.flush(db).catch((err) => log("worker stats failed", String(err)));
      }
      if (Date.now() >= nextOps) {
        // Jede Minute: Kennzahlen, Alarm an Admins, gebündelte E-Mails.
        nextOps = Date.now() + 60000;
        await runSteps(engine, stats, minutely, Date.now);
        // KI-Spieler: höchstens bots.turnsPerMinute fällige Bots reihum (abschaltbar: Server-Einstellung bots_enabled).
        if (process.env.BOTS_DISABLED !== "1") {
          const bots = await runStep(engine, stats, "bot turns", Date.now(), () => runBotsDue(engine, Date.now()));
          if (bots && bots.turns > 0) log("bot turns", bots);
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
