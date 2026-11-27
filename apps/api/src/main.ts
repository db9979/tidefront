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
import { bumpMapGeneration, enableMapCache, LiveHub, noticeHook, playerForToken, touchLastSeen, type ChangeKind, type Engine } from "@tidefront/engine";
import { appRouter, type AppRouter, type Ctx } from "./router.ts";
import { registerMailLinks } from "./routers/mail-links.ts";
import { registerBackupDownload } from "./routers/backup-download.ts";
import { registerBugReportBodyLimit } from "./routers/bug-report.ts";
import { createRateLimiter, parseTrustProxy } from "./rate-limit.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://tidefront:tidefront@localhost:5432/tidefront";
const VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379";
const WEB_DIR = resolve(process.env.WEB_DIR ?? "apps/web/dist");
const COOKIE = "tf_session";
/** auto: Secure, wenn die Anfrage per HTTPS kam (hinter dem Proxy über X-Forwarded-Proto, Proxy in TRUST_PROXY). */
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "auto").toLowerCase();

const { db } = createDb(DATABASE_URL, 10);
const pub = new Valkey(VALKEY_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
const sub = new Valkey(VALKEY_URL, { lazyConnect: false });
pub.on("error", () => {});
sub.on("error", () => {});

const BODY_LIMIT = 256 * 1024;
// maxParamLength: gebündelte tRPC-Abfragen stehen im Pfad (/trpc/a,b,c…); die Vorgabe 100 lieferte sonst 414.
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Nur Loopback und private Netze (Reverse-Proxy im Heimnetz) dürfen X-Forwarded-For/-Proto setzen; sonst könnte
  // jeder Aufrufer seine IP für die Login-Drosselung frei wählen. Anpassbar über TRUST_PROXY.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  bodyLimit: BODY_LIMIT,
  routerOptions: { maxParamLength: 1000 },
});

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

// Drosselung (rate-limit.ts): atomare Zähler je Schlüssel, Fehlversuche je Kontoname beim Login.
const { rateLimit, failures } = createRateLimiter(pub);

// ---------------------------------------------------------------- WebSocket: Änderungsmeldungen
// TE-04: LiveHub (engine/live-sockets.ts) – kein Leck beim Trennen während der Prüfung, Sitzung alle 10 min neu
// geprüft, höchstens 5 Sockets je Spieler.
const hub = new LiveHub({ validate: async (token) => (await playerForToken(db, token))?.id ?? null });
await sub.psubscribe("tf:*");
// world.map: geteilte Weltdaten 5 s zwischenspeichern (MAP_CACHE_MS, 0 = aus); jede Karten-/Saisonmeldung verwirft sie.
enableMapCache(Number(process.env.MAP_CACHE_MS ?? 5000));
sub.on("pmessage", (_p: string, channel: string, message: string) => {
  if (message.includes('"map"') || message.includes('"season"')) bumpMapGeneration();
  if (channel === "tf:all") hub.publish(null, message);
  else if (channel.startsWith("tf:player:")) hub.publish([Number(channel.slice(10))], message);
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 1024 } });

app.get("/ws", { websocket: true }, async (socket, req) => {
  await hub.attach(socket, req.cookies[COOKIE]);
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
        failures,
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
