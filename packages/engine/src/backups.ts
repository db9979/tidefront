// Sicherungen in der Verwaltung: Liste aus dem (schreibgeschützt eingehängten) Sicherungsverzeichnis,
// einmalige Download-Tokens (60 s) und Aufträge „Jetzt sichern“ für den backup-Dienst.
import { randomBytes } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { tables, type Db } from "@tidefront/db";
import { sha256 } from "./settings.ts";

/** Verzeichnis im api-Container (docker-compose: ${BACKUP_DIR}:/backups:ro). */
export function backupDir(): string {
  return resolve(process.env.BACKUP_PATH ?? "/backups");
}

export const DOWNLOAD_TOKEN_MS = 60_000;
/** Ein offener Auftrag gilt nach dieser Zeit als verwaist (Sicherungsdienst läuft nicht). */
export const BACKUP_REQUEST_STALE_MS = 15 * 60_000;

/** Erlaubte Dateinamen: tidefront-<Zeichen ohne Punkt und Schrägstrich>.dump, sonst nichts. */
const NAME = /^tidefront-[A-Za-z0-9_-]{1,80}\.dump$/;

export function isBackupName(name: string): boolean {
  return typeof name === "string" && NAME.test(name) && basename(name) === name;
}

/**
 * Absoluter Pfad einer Sicherung oder null (falscher Name, außerhalb des Verzeichnisses, kein reguläre Datei,
 * symbolischer Link). Pfad-Traversal ist damit doppelt ausgeschlossen: Muster und Vergleich des Elternordners.
 */
export async function backupFile(dir: string, name: string): Promise<{ path: string; bytes: number; mtimeMs: number } | null> {
  if (!isBackupName(name)) return null;
  const root = resolve(dir);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep) || resolve(path, "..") !== root) return null;
  try {
    const st = await lstat(path);
    if (!st.isFile()) return null;
    return { path, bytes: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

export interface BackupFile {
  name: string;
  bytes: number;
  at: string;
  /** täglich (geplant) oder manuell (Verwaltung / Konsole mit Zusatz -manuell) */
  source: "taeglich" | "manuell";
}

/** Sicherungen im Verzeichnis, neueste zuerst. mounted=false: Verzeichnis fehlt (nicht eingehängt). */
export async function listBackups(dir = backupDir()): Promise<{ mounted: boolean; files: BackupFile[] }> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { mounted: false, files: [] };
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    const f = await backupFile(dir, name);
    if (!f) continue;
    files.push({ name, bytes: f.bytes, at: new Date(f.mtimeMs).toISOString(), source: name.endsWith("-manuell.dump") ? "manuell" : "taeglich" });
  }
  files.sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
  return { mounted: true, files };
}

// ---------------------------------------------------------------- Download-Token

/** Neues einmaliges Token für eine vorhandene Sicherung. Abgelaufene Tokens werden dabei entfernt. */
export async function createDownloadToken(db: Db, playerId: number, name: string, dir = backupDir(), nowMs = Date.now()): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; code: string }> {
  if (!(await backupFile(dir, name))) return { ok: false, code: "no_file" };
  await db.delete(tables.backupDownloadToken).where(lt(tables.backupDownloadToken.expiresAt, new Date(nowMs - 3600_000)));
  const token = randomBytes(24).toString("hex");
  const expiresAt = nowMs + DOWNLOAD_TOKEN_MS;
  await db.insert(tables.backupDownloadToken).values({ tokenHash: sha256(token), playerId, file: name, expiresAt: new Date(expiresAt), createdAt: new Date(nowMs) });
  return { ok: true, token, expiresAt };
}

/** Löst ein Token ein (atomar, genau einmal): nur für denselben Admin, dieselbe Datei und innerhalb der Frist. */
export async function consumeDownloadToken(db: Db, token: string, playerId: number, name: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const used = await db
    .update(tables.backupDownloadToken)
    .set({ usedAt: new Date(nowMs) })
    .where(and(
      eq(tables.backupDownloadToken.tokenHash, sha256(token)),
      isNull(tables.backupDownloadToken.usedAt),
      gt(tables.backupDownloadToken.expiresAt, new Date(nowMs)),
    ))
    .returning({ playerId: tables.backupDownloadToken.playerId, file: tables.backupDownloadToken.file });
  // Das Token ist in jedem Fall verbraucht, auch wenn Admin oder Datei nicht passen.
  return used.length === 1 && used[0].playerId === playerId && used[0].file === name;
}

// ---------------------------------------------------------------- Aufträge „Jetzt sichern“

export interface BackupRequestView {
  id: number;
  status: "pending" | "running" | "done" | "failed";
  file: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Legt einen Auftrag an; läuft schon einer (nicht verwaist), wird dieser zurückgegeben. */
export async function requestBackup(db: Db, playerId: number, nowMs = Date.now()): Promise<{ id: number; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table backup_request in share row exclusive mode`);
    // Verwaiste Aufträge (Sicherungsdienst lief nicht) abschließen, damit ein neuer möglich ist.
    await tx
      .update(tables.backupRequest)
      .set({ status: "failed", error: "Zeitüberschreitung: der Sicherungsdienst hat den Auftrag nicht abgeschlossen.", finishedAt: new Date(nowMs) })
      .where(and(inArray(tables.backupRequest.status, ["pending", "running"]), lt(tables.backupRequest.createdAt, new Date(nowMs - BACKUP_REQUEST_STALE_MS))));
    const [open] = await tx
      .select({ id: tables.backupRequest.id })
      .from(tables.backupRequest)
      .where(and(eq(tables.backupRequest.kind, "backup"), inArray(tables.backupRequest.status, ["pending", "running"])))
      .orderBy(desc(tables.backupRequest.id))
      .limit(1);
    if (open) return { id: open.id, created: false };
    const [r] = await tx
      .insert(tables.backupRequest)
      .values({ requestedBy: playerId, createdAt: new Date(nowMs) })
      .returning({ id: tables.backupRequest.id });
    return { id: r.id, created: true };
  });
}

/**
 * Auftrag „Sicherung löschen“ für den backup-Dienst (das Verzeichnis ist im api-Dienst schreibgeschützt).
 * Codes: no_file (Name ungültig oder Datei fehlt). Ein offener Löschauftrag für dieselbe Datei wird wiederverwendet.
 */
export async function requestBackupDelete(db: Db, playerId: number, name: string, dir = backupDir(), nowMs = Date.now()): Promise<{ ok: true; id: number } | { ok: false; code: string }> {
  if (!(await backupFile(dir, name))) return { ok: false, code: "no_file" };
  const [open] = await db
    .select({ id: tables.backupRequest.id })
    .from(tables.backupRequest)
    .where(and(eq(tables.backupRequest.kind, "delete"), eq(tables.backupRequest.file, name), inArray(tables.backupRequest.status, ["pending", "running"])))
    .limit(1);
  if (open) return { ok: true, id: open.id };
  const [r] = await db
    .insert(tables.backupRequest)
    .values({ kind: "delete", file: name, requestedBy: playerId, createdAt: new Date(nowMs) })
    .returning({ id: tables.backupRequest.id });
  return { ok: true, id: r.id };
}

/** Dateien mit offenem Löschauftrag (für „wird gelöscht …“ in der Liste). */
export async function pendingBackupDeletes(db: Db): Promise<string[]> {
  const rows = await db
    .select({ file: tables.backupRequest.file })
    .from(tables.backupRequest)
    .where(and(eq(tables.backupRequest.kind, "delete"), inArray(tables.backupRequest.status, ["pending", "running"])));
  return rows.map((r) => r.file).filter((f): f is string => !!f);
}

/** Letzte Aufträge „Jetzt sichern“, neueste zuerst (Löschaufträge nicht). */
export async function backupRequests(db: Db, limit = 5): Promise<BackupRequestView[]> {
  const rows = await db
    .select({
      id: tables.backupRequest.id,
      status: tables.backupRequest.status,
      file: tables.backupRequest.file,
      error: tables.backupRequest.error,
      requestedBy: tables.player.name,
      createdAt: tables.backupRequest.createdAt,
      startedAt: tables.backupRequest.startedAt,
      finishedAt: tables.backupRequest.finishedAt,
    })
    .from(tables.backupRequest)
    .leftJoin(tables.player, eq(tables.player.id, tables.backupRequest.requestedBy))
    .where(eq(tables.backupRequest.kind, "backup"))
    .orderBy(desc(tables.backupRequest.id))
    .limit(limit);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return rows.map((r) => ({
    ...r,
    status: r.status as BackupRequestView["status"],
    createdAt: r.createdAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
  }));
}
