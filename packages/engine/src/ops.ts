// Betrieb: Kennzahlen für Systemzustand und Worker-Alarm.
import { sql } from "drizzle-orm";
import type { Db } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { noticeToAdmins } from "./notices.ts";
import { getSettings } from "./settings.ts";

export const BACKLOG_GRACE_MS = 2 * 60000;
export const BACKLOG_UNHEALTHY_MS = 10 * 60000;
export const BACKUP_MAX_AGE_H = 26;

export interface OpsProblem {
  /** Vorfall-Schlüssel; derselbe Schlüssel wird höchstens einmal je Stunde gemeldet. */
  key: string;
  text: string;
}

export interface OpsStatus {
  at: string;
  backlog: { count: number; oldestOverdueSec: number };
  failed: { count: number; lastId: number | null; lastType: string | null; lastError: string | null };
  audit: { ok: boolean; at: string } | null;
  backup: { at: string; ageHours: number; file: string } | null;
  mail: { lastSentAt: string | null; lastError: { at: string; message: string } | null };
  problems: OpsProblem[];
}

export async function opsStatus(db: Db, nowMs = Date.now()): Promise<OpsStatus> {
  const overdueBefore = new Date(nowMs - BACKLOG_GRACE_MS).toISOString();
  const [bl] = await db.execute<{ n: number; oldest: number | null }>(sql`
    select count(*)::int as n, (extract(epoch from min(due_at)) * 1000)::float8 as oldest from game_event
    where status = 'pending' and due_at < ${overdueBefore}::timestamptz`);
  const [fc] = await db.execute<{ n: number }>(sql`select count(*)::int as n from game_event where status = 'failed'`);
  const [fl] = await db.execute<{ id: string; type: string; last_error: string | null }>(sql`
    select id::text, type, last_error from game_event where status = 'failed' order by id desc limit 1`);
  const [au] = await db.execute<{ id: number; ok: number; t: number }>(sql`
    select id, ok, (extract(epoch from created_at) * 1000)::float8 as t from audit_run order by id desc limit 1`);
  const [bk] = await db.execute<{ file: string; t: number }>(sql`
    select file, (extract(epoch from created_at) * 1000)::float8 as t from backup_run order by id desc limit 1`);
  const [first] = await db.execute<{ t: number | null }>(sql`select (extract(epoch from min(created_at)) * 1000)::float8 as t from player`);
  const s = await getSettings(db, ["mail_last_sent", "mail_last_error"]);

  const oldestMs = bl?.oldest ?? null;
  const status: OpsStatus = {
    at: new Date(nowMs).toISOString(),
    backlog: { count: bl?.n ?? 0, oldestOverdueSec: oldestMs ? Math.max(0, Math.round((nowMs - oldestMs) / 1000)) : 0 },
    failed: {
      count: fc?.n ?? 0,
      lastId: fl ? Number(fl.id) : null,
      lastType: fl?.type ?? null,
      lastError: fl?.last_error ? fl.last_error.split("\n")[0].slice(0, 300) : null,
    },
    audit: au ? { ok: au.ok === 1, at: new Date(au.t).toISOString() } : null,
    backup: bk ? { at: new Date(bk.t).toISOString(), ageHours: (nowMs - bk.t) / 3600000, file: bk.file } : null,
    mail: {
      lastSentAt: s.get("mail_last_sent") ?? null,
      lastError: s.get("mail_last_error") ? JSON.parse(s.get("mail_last_error")!) : null,
    },
    problems: [],
  };
  const p = status.problems;
  if (status.backlog.count > 0) {
    p.push({ key: "backlog", text: `Rückstau: ${status.backlog.count} Ereignisse überfällig (ältestes seit ${Math.round(status.backlog.oldestOverdueSec / 60)} Min.).` });
  }
  if (status.failed.count > 0) {
    p.push({ key: `failed:${status.failed.lastId}`, text: `${status.failed.count} fehlgeschlagene Ereignisse (zuletzt ${status.failed.lastType}).` });
  }
  if (status.audit && !status.audit.ok) {
    p.push({ key: `audit:${au!.id}`, text: "Der letzte Prüflauf der Börse ist fehlerhaft." });
  }
  if (status.backup && status.backup.ageHours > BACKUP_MAX_AGE_H) {
    p.push({ key: "backup", text: `Letzte Sicherung ist ${Math.round(status.backup.ageHours)} Stunden alt.` });
  } else if (!status.backup && first?.t && nowMs - first.t > BACKUP_MAX_AGE_H * 3600000) {
    p.push({ key: "backup", text: "Es ist noch keine Sicherung erfasst." });
  }
  return status;
}

/** Gesund, solange der älteste überfällige Rückstau höchstens 10 Minuten alt ist. */
export function backlogHealthy(s: OpsStatus | null): boolean {
  return !s || s.backlog.oldestOverdueSec * 1000 <= BACKLOG_UNHEALTHY_MS;
}

/** Merkt sich, wann welcher Vorfall gemeldet wurde (im Worker-Prozess). */
export class AlertMemory {
  private sent = new Map<string, number>();
  /** Neue Probleme, die noch nicht (oder vor über einer Stunde) gemeldet wurden. */
  due(problems: OpsProblem[], nowMs: number): OpsProblem[] {
    const out = problems.filter((p) => nowMs - (this.sent.get(p.key) ?? -Infinity) >= 3600000);
    for (const p of out) this.sent.set(p.key, nowMs);
    for (const [k, t] of this.sent) if (nowMs - t > 24 * 3600000) this.sent.delete(k);
    return out;
  }
}

/** Worker: Kennzahlen prüfen und neue Probleme an alle Admins melden. */
export async function checkOps(engine: Engine, memory: AlertMemory, nowMs = Date.now()): Promise<OpsStatus> {
  const status = await opsStatus(engine.db, nowMs);
  const fresh = memory.due(status.problems, nowMs);
  if (fresh.length > 0) {
    engine.log("ops alert", fresh);
    await noticeToAdmins(engine, {
      kind: "ops",
      title: fresh.length === 1 ? "Betrieb: Problem erkannt" : `Betrieb: ${fresh.length} Probleme erkannt`,
      body: fresh.map((p) => p.text).join(" "),
      url: "/?view=admin",
      tag: "ops",
    });
  }
  return status;
}
