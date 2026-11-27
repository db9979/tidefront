// Fehlermeldungen aus dem Spiel: speichern, an die Verwaltung mailen (Log und Screenshot als Anhang), Liste für Admins.
// Ohne eingerichteten E-Mail-Versand wird nur gespeichert; die Verwaltung sieht die Meldung im Admin-Menü.
import { and, count, desc, eq, gt, isNotNull } from "drizzle-orm";
import { tables, type Db } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { loadSmtp, mailReady, sendMail, type MailAttachment } from "./mail.ts";
import { getSetting, publicUrl, setSetting } from "./settings.ts";

/** Höchstens so viele Meldungen je Spieler und Stunde. */
export const BUG_REPORT_LIMIT_PER_HOUR = 5;
/** Größte Screenshot-Datei in Bytes (nach dem Dekodieren). */
export const BUG_SCREENSHOT_MAX_BYTES = 1_200_000;
export const BUG_REPORT_TO_KEY = "bug_report_to";
export const BUG_STATUSES = ["offen", "erledigt"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export interface BugReportInput {
  subject: string;
  text: string;
  meta: Record<string, string | number | boolean | null>;
  log: string;
  /** data:image/jpeg;base64,… (oder webp/png); null = ohne Screenshot. */
  screenshot: string | null;
}

const EMAIL_RE = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/;

/** Screenshot aus einer Data-URL; prüft Typ und Signatur der Datei. */
export function decodeScreenshot(dataUrl: string): { type: string; data: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const data = Buffer.from(m[2], "base64");
  if (data.length === 0 || data.length > BUG_SCREENSHOT_MAX_BYTES) return null;
  const ok = m[1] === "image/jpeg" ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : m[1] === "image/png" ? data.subarray(0, 4).toString("latin1") === "\x89PNG"
    : data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP";
  return ok ? { type: m[1], data } : null;
}

/** Empfänger: eingestellte Adresse(n), sonst die E-Mail-Adressen aller Admins, sonst der Absender des SMTP-Versands. */
export async function bugReportRecipients(db: Db): Promise<string[]> {
  const set = parseRecipients((await getSetting(db, BUG_REPORT_TO_KEY)) ?? "");
  if (set.length > 0) return set;
  const rows = await db
    .select({ email: tables.playerEmail.email })
    .from(tables.playerEmail)
    .innerJoin(tables.player, eq(tables.player.id, tables.playerEmail.playerId))
    .where(and(eq(tables.player.isAdmin, true), isNotNull(tables.playerEmail.verifiedAt)));
  if (rows.length > 0) return [...new Set(rows.map((r) => r.email))];
  const smtp = await loadSmtp(db);
  return smtp?.fromAddress ? [smtp.fromAddress] : [];
}

export function parseRecipients(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s)).slice(0, 5);
}

/** Einstellung der Verwaltung: Empfängeradresse(n); leer = alle Admins mit bestätigter Adresse. Code: bad_email. */
export async function setBugReportTo(db: Db, raw: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const good = parseRecipients(raw);
  if (parts.length !== good.length) return { ok: false, code: "bad_email" };
  await setSetting(db, BUG_REPORT_TO_KEY, good.join(", "));
  return { ok: true };
}

/**
 * Meldung speichern und an die Verwaltung mailen. Codes: rate (zu viele je Stunde), bad_screenshot.
 * mailed: E-Mail ging raus; sonst liegt die Meldung nur im Admin-Menü.
 */
export async function submitBugReport(
  engine: Engine,
  playerId: number,
  input: BugReportInput,
): Promise<{ ok: true; id: number; mailed: boolean } | { ok: false; code: string }> {
  const since = new Date(Date.now() - 3600_000);
  const [{ n }] = await engine.db
    .select({ n: count() })
    .from(tables.bugReport)
    .where(and(eq(tables.bugReport.playerId, playerId), gt(tables.bugReport.createdAt, since)));
  if (n >= BUG_REPORT_LIMIT_PER_HOUR) return { ok: false, code: "rate" };

  const shot = input.screenshot ? decodeScreenshot(input.screenshot) : null;
  if (input.screenshot && !shot) return { ok: false, code: "bad_screenshot" };
  const [p] = await engine.db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
  // Spielername und Eingangszeit vom Server, nicht vom Client.
  const meta = { ...input.meta, spieler: p?.name ?? `#${playerId}`, spielerId: playerId, eingang: new Date().toISOString() };
  const subject = input.subject.trim() || "Fehlermeldung";
  const [row] = await engine.db
    .insert(tables.bugReport)
    .values({
      playerId,
      subject,
      text: input.text.trim(),
      meta,
      log: input.log,
      screenshot: shot?.data ?? null,
      screenshotType: shot?.type ?? null,
    })
    .returning({ id: tables.bugReport.id });

  const mailed = await mailBugReport(engine, row.id, { subject, text: input.text.trim(), meta, log: input.log, shot });
  if (mailed) await engine.db.update(tables.bugReport).set({ mailedAt: new Date() }).where(eq(tables.bugReport.id, row.id));
  return { ok: true, id: row.id, mailed };
}

async function mailBugReport(
  engine: Engine,
  id: number,
  r: { subject: string; text: string; meta: Record<string, unknown>; log: string; shot: { type: string; data: Buffer } | null },
): Promise<boolean> {
  if (!(await mailReady(engine.db))) return false;
  const to = await bugReportRecipients(engine.db);
  if (to.length === 0) return false;
  const attachments: MailAttachment[] = [{ filename: "bug-log.txt", content: r.log || "(leer)", contentType: "text/plain; charset=utf-8" }];
  if (r.shot) {
    const ext = r.shot.type === "image/jpeg" ? "jpg" : r.shot.type.slice(6);
    attachments.push({ filename: `screenshot.${ext}`, content: r.shot.data, contentType: r.shot.type });
  }
  const facts = Object.entries(r.meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 20)
    .map(([k, v]) => [k, String(v).slice(0, 200)] as [string, string]);
  let sent = false;
  for (const addr of to) {
    const res = await sendMail(engine, addr, {
      subject: `Fehlermeldung #${id}: ${r.subject}`.slice(0, 200),
      heading: `Fehlermeldung #${id}`,
      paragraphs: [r.subject, ...(r.text ? r.text.split(/\n{2,}/).slice(0, 20) : ["(ohne Beschreibung)"])],
      facts,
      button: { label: "In der Verwaltung öffnen", url: `${publicUrl()}/?view=admin` },
      footerNote: "Log und Screenshot hängen an. Die Meldung steht auch unter Einstellungen → Verwaltung → „Fehlermeldungen“.",
    }, { attachments });
    sent ||= res.ok;
  }
  return sent;
}

// ---------------------------------------------------------------- Verwaltung

export async function listBugReports(db: Db, limit = 100) {
  const rows = await db
    .select({
      id: tables.bugReport.id,
      playerId: tables.bugReport.playerId,
      playerName: tables.player.name,
      createdAt: tables.bugReport.createdAt,
      subject: tables.bugReport.subject,
      status: tables.bugReport.status,
      mailedAt: tables.bugReport.mailedAt,
      screenshotType: tables.bugReport.screenshotType,
    })
    .from(tables.bugReport)
    .leftJoin(tables.player, eq(tables.player.id, tables.bugReport.playerId))
    .orderBy(desc(tables.bugReport.id))
    .limit(limit);
  const to = (await getSetting(db, BUG_REPORT_TO_KEY)) ?? "";
  return {
    reports: rows.map(({ screenshotType, ...r }) => ({ ...r, hasScreenshot: !!screenshotType })),
    recipientsSetting: to,
    recipients: await bugReportRecipients(db),
    mailReady: await mailReady(db),
  };
}

export async function bugReportDetail(db: Db, id: number) {
  const [r] = await db.select().from(tables.bugReport).where(eq(tables.bugReport.id, id));
  if (!r) return null;
  return {
    id: r.id,
    text: r.text,
    meta: r.meta as Record<string, unknown>,
    log: r.log,
    screenshot: r.screenshot && r.screenshotType ? `data:${r.screenshotType};base64,${Buffer.from(r.screenshot).toString("base64")}` : null,
  };
}

export async function setBugReportStatus(db: Db, id: number, status: BugStatus): Promise<boolean> {
  const r = await db.update(tables.bugReport).set({ status }).where(eq(tables.bugReport.id, id)).returning({ id: tables.bugReport.id });
  return r.length > 0;
}
