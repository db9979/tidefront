// End-to-End-Stack: frische Test-Datenbank (Postgres + Valkey in Docker, Daten nur im Arbeitsspeicher),
// Migration mit Einladungscode, dann api, worker und vite. Playwright startet dieses Skript als webServer
// und beendet es nach dem Lauf; dabei werden auch die Container entfernt.
// Von Hand: node apps/web/e2e/stack.ts  (Strg+C beendet alles)
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { E2E } from "./env.ts";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const children: ChildProcess[] = [];
let stopping = false;

function docker(args: string[], quiet = false): number {
  const r = spawnSync("docker", args, { stdio: quiet ? "ignore" : "inherit" });
  return r.status ?? 1;
}

function cleanup() {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  docker(["rm", "-f", E2E.pgContainer, E2E.valkeyContainer], true);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  cleanup();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const env = {
  ...process.env,
  DATABASE_URL: E2E.databaseUrl,
  VALKEY_URL: E2E.valkeyUrl,
  INVITE_CODES: `${E2E.invite}:500`,
  ADMIN_NAMES: E2E.adminName,
  COOKIE_SECURE: "false",
  LOG_LEVEL: "warn",
  TZ: "Europe/Berlin",
  PUBLIC_URL: E2E.webUrl,
};

function run(name: string, cmd: string, args: string[], extra: Record<string, string> = {}, cwd = root) {
  const c = spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (s: Buffer) => s.toString().split("\n").filter(Boolean).map((l) => `[${name}] ${l}`).join("\n");
  c.stdout!.on("data", (d: Buffer) => { if (process.env.E2E_VERBOSE || name !== "worker") console.log(tag(d)); });
  c.stderr!.on("data", (d: Buffer) => console.error(tag(d)));
  c.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${name}] beendet mit ${code}`);
      stop(1);
    }
  });
  children.push(c);
  return c;
}

// 1) Container frisch anlegen (alte Reste eines abgebrochenen Laufs entfernen).
docker(["rm", "-f", E2E.pgContainer, E2E.valkeyContainer], true);
if (docker(["run", "-d", "--rm", "--name", E2E.pgContainer, "-e", "POSTGRES_USER=tidefront", "-e", `POSTGRES_PASSWORD=${E2E.pgPassword}`,
  "-e", "POSTGRES_DB=tidefront", "-p", `127.0.0.1:${E2E.pgPort}:5432`, "--tmpfs", "/var/lib/postgresql/data",
  "postgres:17-alpine", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off"]) !== 0) stop(1);
if (docker(["run", "-d", "--rm", "--name", E2E.valkeyContainer, "-p", `127.0.0.1:${E2E.valkeyPort}:6379`,
  "valkey/valkey:8-alpine", "valkey-server", "--save", "", "--appendonly", "no"]) !== 0) stop(1);

// 2) Auf Postgres warten (pg_isready über TCP, damit der Init-Neustart des Containers abgewartet ist).
const deadline = Date.now() + 60000;
for (;;) {
  if (docker(["exec", E2E.pgContainer, "pg_isready", "-h", "127.0.0.1", "-U", "tidefront", "-d", "tidefront"], true) === 0) break;
  if (Date.now() > deadline) { console.error("Postgres startet nicht"); stop(1); }
  await new Promise((r) => setTimeout(r, 500));
}

// 3) Migration und Startdaten (Nester, Markt, Einladungscode, Admin).
const mig = spawnSync(process.execPath, ["apps/api/src/migrate.ts"], { cwd: root, env, stdio: "inherit" });
if (mig.status !== 0) { console.error("Migration fehlgeschlagen"); stop(1); }

// 4) Dienste.
run("api", process.execPath, ["apps/api/src/main.ts"], { PORT: String(E2E.apiPort) });
// Oberfläche erst, wenn die API antwortet (sonst meldet der Vite-Proxy beim Start ECONNREFUSED).
for (const end = Date.now() + 60000; ;) {
  const ok = await fetch(`http://127.0.0.1:${E2E.apiPort}/healthz`).then((r) => r.ok, () => false);
  if (ok) break;
  if (Date.now() > end) { console.error("API startet nicht"); stop(1); }
  await new Promise((r) => setTimeout(r, 250));
}
run("worker", process.execPath, ["apps/worker/src/main.ts"], { WORKER_HEALTH_PORT: String(E2E.workerPort), WORKER_POLL_MS: "250" });
run("web", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--port", String(E2E.webPort), "--strictPort", "--host", "127.0.0.1"], {
  TF_API: `http://127.0.0.1:${E2E.apiPort}`,
}, resolve(root, "apps/web"));
