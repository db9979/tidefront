// Worker: verarbeitet fällige Ereignisse, Prüflauf der Börse, Aufräumen.
import { createServer } from "node:http";
import Valkey from "iovalkey";
import { createDb } from "@tidefront/db";
import { auditLedger, balance, cleanup, processDue, type Engine } from "@tidefront/engine";

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

let lastLoop = Date.now();
let stopping = false;
let nextAudit = 0;

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
      }
      lastLoop = Date.now();
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      log("loop error", String(err));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Gesundheit: die Schleife lief in den letzten 60 Sekunden.
createServer((_req, res) => {
  const ok = Date.now() - lastLoop < 60000;
  res.writeHead(ok ? 200 : 503).end(ok ? "ok" : "stalled");
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
