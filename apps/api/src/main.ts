// API-Server: tRPC über HTTP, WebSocket für Änderungsmeldungen, Auslieferung der Oberfläche. Ein Port.
import { existsSync } from "node:fs";
import { APP_VERSION, BUILD_TIME } from "./version.ts";
import { resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { fastifyTRPCPlugin, type CreateFastifyContextOptions, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Valkey from "iovalkey";
import { sql } from "drizzle-orm";
import { createDb } from "@tidefront/db";
import { noticeHook, playerForToken, touchLastSeen, type ChangeKind, type Engine } from "@tidefront/engine";
import { appRouter, type AppRouter, type Ctx } from "./router.ts";
import { registerMailLinks } from "./routers/mail-links.ts";
import { registerBackupDownload } from "./routers/backup-download.ts";
import { registerBugReportBodyLimit } from "./routers/bug-report.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://tidefront:tidefront@localhost:5432/tidefront";
const VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379";
const WEB_DIR = resolve(process.env.WEB_DIR ?? "apps/web/dist");
const COOKIE = "tf_session";
/** auto: Secure, wenn die Anfrage per HTTPS kam (hinter dem Proxy über X-Forwarded-Proto, trustProxy ist an). */
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "auto").toLowerCase();

const { db } = createDb(DATABASE_URL, 10);
const pub = new Valkey(VALKEY_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
const sub = new Valkey(VALKEY_URL, { lazyConnect: false });
pub.on("error", () => {});
sub.on("error", () => {});

const BODY_LIMIT = 256 * 1024;
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true, bodyLimit: BODY_LIMIT });

const engine: Engine = {
  db,
  notify: (ids, kind) => {
    const msg = JSON.stringify({ kind });
    if (ids === null) void pub.publish("tf:all", msg).catch(() => {});
    else for (const id of ids) void pub.publish(`tf:player:${id}`, msg).catch(() => {});
  },
  log: (msg, data) => app.log.warn({ data }, msg),
};
engine.push = noticeHook(() => engine);

/** Feste Fenster je Schlüssel; ohne Valkey wird nicht begrenzt. */
async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const k = `tf:rl:${bucket}`;
    const n = await pub.incr(k);
    if (n === 1) await pub.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- WebSocket: Änderungsmeldungen
const sockets = new Map<number, Set<{ send: (s: string) => void }>>();
await sub.psubscribe("tf:*");
sub.on("pmessage", (_p: string, channel: string, message: string) => {
  if (channel === "tf:all") {
    for (const set of sockets.values()) for (const s of set) s.send(message);
  } else if (channel.startsWith("tf:player:")) {
    const id = Number(channel.slice(10));
    for (const s of sockets.get(id) ?? []) s.send(message);
  }
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 1024 } });

app.get("/ws", { websocket: true }, async (socket, req) => {
  const player = await playerForToken(db, req.cookies[COOKIE]);
  if (!player) {
    socket.close(4401, "unauthorized");
    return;
  }
  const entry = { send: (s: string) => socket.readyState === 1 && socket.send(s) };
  let set = sockets.get(player.id);
  if (!set) sockets.set(player.id, (set = new Set()));
  set.add(entry);
  entry.send(JSON.stringify({ kind: "hello", serverNow: Date.now() }));
  const ping = setInterval(() => entry.send(JSON.stringify({ kind: "ping", serverNow: Date.now() })), 25000);
  socket.on("close", () => {
    clearInterval(ping);
    set!.delete(entry);
    if (set!.size === 0) sockets.delete(player.id);
  });
});

// ---------------------------------------------------------------- tRPC
// Fehlermeldungen tragen einen Screenshot: nur bugReport.send darf größere Anfragen schicken.
registerBugReportBodyLimit(app, BODY_LIMIT);
await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext: async ({ req, res }: CreateFastifyContextOptions): Promise<Ctx> => {
      const token = req.cookies[COOKIE];
      const player = await playerForToken(db, token);
      if (player) void touchLastSeen(db, player.id).catch(() => {});
      return {
        engine,
        token,
        player,
        ip: req.ip,
        rateLimit,
        setSession: (t) => {
          const secure = COOKIE_SECURE === "true" || (COOKIE_SECURE !== "false" && req.protocol === "https");
          if (t === null) res.clearCookie(COOKIE, { path: "/" });
          else res.setCookie(COOKIE, t, { path: "/", httpOnly: true, sameSite: "lax", secure, maxAge: 30 * 86400 });
        },
      };
    },
    onError: ({ error, path }: { error: Error & { code?: string }; path?: string }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") app.log.error({ err: error, path }, "trpc error");
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
});

registerMailLinks(app, engine, rateLimit);
registerBackupDownload(app, engine, { cookieName: COOKIE, rateLimit });

// ---------------------------------------------------------------- Gesundheit und Oberfläche
app.get("/version", async () => ({ version: APP_VERSION, builtAt: BUILD_TIME }));

app.get("/healthz", async (_req, reply) => {
  try {
    await db.execute(sql`select 1`);
    return { ok: true };
  } catch {
    return reply.code(503).send({ ok: false });
  }
});

if (existsSync(WEB_DIR)) {
  await app.register(fastifyStatic, {
    root: WEB_DIR,
    setHeaders: (res, path) => {
      if (path.includes("/assets/")) res.header("cache-control", "public, max-age=31536000, immutable");
      else res.header("cache-control", "no-cache");
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/trpc") && !req.url.startsWith("/ws") && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not found" });
  });
}

const close = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: PORT, host: "0.0.0.0" });
export type { ChangeKind };
