// Download einer Sicherung: GET /api/admin/backups/:name?t=<Token>.
// Drei Schlüssel: Sitzungs-Cookie, is_admin (frisch aus der Datenbank) und ein einmaliges Token (60 s, über tRPC
// angefordert, an Admin und Datei gebunden). Ein Link aus Protokoll oder Verlauf wirkt damit nicht ein zweites Mal.
import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { backupDir, backupFile, consumeDownloadToken, isBackupName, playerForToken, type Engine } from "@tidefront/engine";

export interface BackupDownloadOptions {
  cookieName: string;
  rateLimit: (bucket: string, limit: number, windowSec: number) => Promise<boolean>;
  /** Vorgabe: backupDir() (BACKUP_PATH oder /backups). */
  dir?: string;
}

export function registerBackupDownload(app: FastifyInstance, engine: Engine, opts: BackupDownloadOptions): void {
  app.get<{ Params: { name: string }; Querystring: { t?: string } }>("/api/admin/backups/:name", async (req, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer").header("x-content-type-options", "nosniff");
    if (!(await opts.rateLimit(`bdl:${req.ip}`, 30, 600))) return reply.code(429).send({ error: "rate" });
    const name = String(req.params.name ?? "");
    if (!isBackupName(name)) return reply.code(400).send({ error: "bad_name" });
    const player = await playerForToken(engine.db, req.cookies[opts.cookieName]);
    if (!player) return reply.code(401).send({ error: "unauthorized" });
    if (!player.isAdmin) return reply.code(403).send({ error: "forbidden" });
    if (!(await consumeDownloadToken(engine.db, String(req.query.t ?? ""), player.id, name))) {
      return reply.code(403).send({ error: "token" });
    }
    const file = await backupFile(opts.dir ?? backupDir(), name);
    if (!file) return reply.code(404).send({ error: "not_found" });
    engine.log("backup download", { player: player.name, file: name });
    return reply
      .type("application/octet-stream")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("content-length", String(file.bytes))
      .send(createReadStream(file.path));
  });
}
