// E-Mail per SMTP (nodemailer): Einstellungen, Versand, Benachrichtigungen mit Bündelung, Adressen bestätigen.
// Versand immer außerhalb von Transaktionen; Zustand (letzter Versand, letzter Fehler) in server_setting.
import { randomBytes } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { tables, type Db } from "@tidefront/db";
import { type Engine, type Notice, type NoticeKind } from "./context.ts";
import { renderMail, type MailContent } from "./mail-templates.ts";
import { cleanPrefs, wants, type Prefs } from "./push.ts";
import { decryptSecret, encryptSecret, getSetting, getSettings, publicUrl, secretAvailable, setSetting, sha256 } from "./settings.ts";

export type SmtpProvider = "icloud" | "google" | "custom";
export type SmtpSecurity = "ssl" | "starttls" | "none";

export interface SmtpConfig {
  enabled: boolean;
  provider: SmtpProvider;
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  fromName: string;
  fromAddress: string;
  /** AES-256-GCM, nie an den Client. */
  passEnc: string | null;
}

export const SMTP_PRESETS: Record<Exclude<SmtpProvider, "custom">, { host: string; port: number; security: SmtpSecurity }> = {
  icloud: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  google: { host: "smtp.gmail.com", port: 465, security: "ssl" },
};

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type MailSender = (cfg: SmtpConfig & { password: string }, mail: OutgoingMail) => Promise<void>;

const transports = new Map<string, Transporter>();
const defaultSender: MailSender = async (cfg, mail) => {
  const k = JSON.stringify([cfg.host, cfg.port, cfg.security, cfg.user, cfg.password]);
  let tr = transports.get(k);
  if (!tr) {
    transports.clear();
    tr = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.security === "ssl",
      requireTLS: cfg.security === "starttls",
      ignoreTLS: cfg.security === "none",
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    transports.set(k, tr);
  }
  await tr.sendMail({
    from: { name: cfg.fromName || "TIDEFRONT", address: cfg.fromAddress || cfg.user },
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: mail.headers,
  });
};

let sender: MailSender = defaultSender;
export function setMailSender(s: MailSender | null): void {
  sender = s ?? defaultSender;
}

/** Vorgaben je Art für E-Mail; Bau, Ausbildung, Verband, Lieferung nur gebündelt. */
export const EMAIL_DEFAULTS: Record<NoticeKind, boolean> = {
  attack: true, report: true, build: false, training: false, fleet: false, delivery: false, ops: true, test: true, market: false,
};
export const DIGEST_KINDS: NoticeKind[] = ["build", "training", "fleet", "delivery"];
export const DIGEST_INTERVAL_MS = 30 * 60000;

// ---------------------------------------------------------------- Einstellungen

export async function loadSmtp(db: Db): Promise<SmtpConfig | null> {
  const raw = await getSetting(db, "smtp");
  return raw ? (JSON.parse(raw) as SmtpConfig) : null;
}

/** Sicht für die Verwaltung: ohne Passwort, nur „gesetzt“. */
export async function smtpView(db: Db) {
  const cfg = await loadSmtp(db);
  const s = await getSettings(db, ["mail_last_sent", "mail_last_error"]);
  const { passEnc, ...rest } = cfg ?? { enabled: false, provider: "icloud" as SmtpProvider, ...SMTP_PRESETS.icloud, user: "", fromName: "TIDEFRONT", fromAddress: "", passEnc: null };
  return {
    secretAvailable: secretAvailable(),
    config: rest,
    passwordSet: !!passEnc,
    lastSentAt: s.get("mail_last_sent") ?? null,
    lastError: s.get("mail_last_error") ? (JSON.parse(s.get("mail_last_error")!) as { at: string; message: string }) : null,
  };
}

/** Speichert die SMTP-Einstellungen; password undefined = unverändert, "" = löschen. Code: no_secret. */
export async function saveSmtp(
  db: Db,
  input: Omit<SmtpConfig, "passEnc"> & { password?: string },
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!secretAvailable()) return { ok: false, code: "no_secret" };
  const prev = await loadSmtp(db);
  const preset = input.provider !== "custom" ? SMTP_PRESETS[input.provider] : null;
  const port = preset && input.provider === "icloud" ? preset.port : input.port;
  const security = preset && input.provider === "icloud" ? preset.security : input.security;
  const cfg: SmtpConfig = {
    enabled: input.enabled,
    provider: input.provider,
    host: preset ? preset.host : input.host.trim(),
    port,
    security,
    user: input.user.trim(),
    fromName: input.fromName.trim(),
    fromAddress: input.fromAddress.trim(),
    passEnc: input.password === undefined ? (prev?.passEnc ?? null) : input.password === "" ? null : encryptSecret(input.password),
  };
  await setSetting(db, "smtp", JSON.stringify(cfg));
  return { ok: true };
}

async function readyConfig(db: Db, ignoreEnabled = false): Promise<(SmtpConfig & { password: string }) | null> {
  const cfg = await loadSmtp(db);
  if (!cfg || (!cfg.enabled && !ignoreEnabled) || !secretAvailable() || !cfg.host) return null;
  let password = "";
  if (cfg.passEnc) {
    try {
      password = decryptSecret(cfg.passEnc);
    } catch {
      return null;
    }
  }
  return { ...cfg, password };
}

export async function mailReady(db: Db): Promise<boolean> {
  return (await readyConfig(db)) !== null;
}

/** Versand einer gerenderten Mail; Fehler werden protokolliert und als Zustand gespeichert. */
export async function sendMail(engine: Engine, to: string, content: MailContent, opts: { force?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await readyConfig(engine.db, opts.force);
  if (!cfg) return { ok: false, error: secretAvailable() ? "E-Mail ist nicht eingerichtet oder abgeschaltet." : "APP_SECRET fehlt." };
  const r = renderMail(content);
  const headers: Record<string, string> = {};
  if (content.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${content.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  try {
    await sender(cfg, { to, subject: r.subject, html: r.html, text: r.text, headers });
    await setSetting(engine.db, "mail_last_sent", new Date().toISOString());
    return { ok: true };
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 500);
    engine.log("mail failed", { to: to.replace(/^(.).*@/, "$1…@"), message });
    await setSetting(engine.db, "mail_last_error", JSON.stringify({ at: new Date().toISOString(), message })).catch(() => {});
    return { ok: false, error: message };
  }
}

const unsubUrl = (token: string) => `${publicUrl()}/api/mail/unsubscribe?t=${token}`;

function noticeMail(n: Notice, unsubscribeToken: string): MailContent {
  return {
    subject: n.title,
    heading: n.title,
    paragraphs: [n.body],
    facts: n.facts,
    button: { label: "Im Spiel öffnen", url: `${publicUrl()}${n.url ?? "/"}` },
    unsubscribeUrl: unsubUrl(unsubscribeToken),
  };
}

// ---------------------------------------------------------------- Benachrichtigungen

/** E-Mail zu einer Benachrichtigung: sofort (Angriff, Bericht, Betrieb) oder gebündelt. */
export async function mailNotice(engine: Engine, playerId: number, n: Notice): Promise<"sent" | "queued" | "skipped" | "failed"> {
  const [pe] = await engine.db.select().from(tables.playerEmail).where(eq(tables.playerEmail.playerId, playerId));
  if (!pe || !pe.verifiedAt || !wants(pe.prefs as Prefs, EMAIL_DEFAULTS, n.kind)) return "skipped";
  if (DIGEST_KINDS.includes(n.kind)) {
    await engine.db.insert(tables.mailDigest).values({ playerId, kind: n.kind, title: n.title, body: n.body });
    return "queued";
  }
  if (!(await mailReady(engine.db))) return "skipped";
  const r = await sendMail(engine, pe.email, noticeMail(n, pe.unsubscribeToken));
  return r.ok ? "sent" : "failed";
}

/**
 * Gebündelte Mails: je Spieler höchstens eine je DIGEST_INTERVAL_MS. Läuft im Worker jede Minute.
 * Rückgabe: Anzahl versandter Mails.
 */
export async function flushMailDigests(engine: Engine, nowMs: number): Promise<number> {
  await engine.db.execute(sql`delete from mail_digest where created_at < now() - interval '3 days'`);
  if (!(await mailReady(engine.db))) return 0;
  const cutoff = new Date(nowMs - DIGEST_INTERVAL_MS);
  const due = await engine.db
    .selectDistinct({ playerId: tables.mailDigest.playerId, email: tables.playerEmail.email, token: tables.playerEmail.unsubscribeToken })
    .from(tables.mailDigest)
    .innerJoin(tables.playerEmail, eq(tables.playerEmail.playerId, tables.mailDigest.playerId))
    .where(and(
      isNull(tables.mailDigest.sentAt),
      isNotNull(tables.playerEmail.verifiedAt),
      or(isNull(tables.playerEmail.lastDigestAt), lt(tables.playerEmail.lastDigestAt, cutoff)),
    ));
  let sent = 0;
  for (const p of due) {
    const rows = await engine.db
      .select()
      .from(tables.mailDigest)
      .where(and(eq(tables.mailDigest.playerId, p.playerId), isNull(tables.mailDigest.sentAt)))
      .orderBy(tables.mailDigest.id);
    if (rows.length === 0) continue;
    const content: MailContent = rows.length === 1
      ? noticeMail({ kind: rows[0].kind as NoticeKind, title: rows[0].title, body: rows[0].body }, p.token)
      : {
          subject: `${rows.length} Meldungen aus deinem Hafen`,
          heading: "Neues aus deinem Hafen",
          paragraphs: ["Seit der letzten Nachricht ist Folgendes passiert:"],
          items: rows.map((r) => `${r.title}: ${r.body}`),
          button: { label: "Im Spiel öffnen", url: `${publicUrl()}/` },
          unsubscribeUrl: unsubUrl(p.token),
        };
    const r = await sendMail(engine, p.email, content);
    if (!r.ok) break;
    sent++;
    await engine.db.update(tables.mailDigest).set({ sentAt: new Date(nowMs) }).where(inArray(tables.mailDigest.id, rows.map((x) => x.id)));
    await engine.db.update(tables.playerEmail).set({ lastDigestAt: new Date(nowMs) }).where(eq(tables.playerEmail.playerId, p.playerId));
  }
  return sent;
}

// ---------------------------------------------------------------- Adresse des Spielers

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function emailInfo(db: Db, playerId: number) {
  const [pe] = await db.select().from(tables.playerEmail).where(eq(tables.playerEmail.playerId, playerId));
  return {
    email: pe?.email ?? null,
    verified: !!pe?.verifiedAt,
    prefs: { ...EMAIL_DEFAULTS, ...((pe?.prefs as Prefs) ?? {}) },
    mailReady: await mailReady(db),
  };
}

/** Adresse setzen (null = entfernen) und Bestätigungslink senden. Codes: bad_email, mail_off. */
export async function setEmail(engine: Engine, playerId: number, email: string | null): Promise<{ ok: true; sent: boolean } | { ok: false; code: string }> {
  if (email === null || email.trim() === "") {
    await engine.db.delete(tables.playerEmail).where(eq(tables.playerEmail.playerId, playerId));
    return { ok: true, sent: false };
  }
  const addr = email.trim();
  if (!EMAIL_RE.test(addr) || addr.length > 254) return { ok: false, code: "bad_email" };
  if (!(await mailReady(engine.db))) return { ok: false, code: "mail_off" };
  const token = randomBytes(32).toString("hex");
  const values = {
    email: addr,
    verifiedAt: null,
    verifyHash: sha256(token),
    verifyExpiresAt: new Date(Date.now() + 24 * 3600000),
  };
  await engine.db
    .insert(tables.playerEmail)
    .values({ playerId, ...values, unsubscribeToken: randomBytes(24).toString("hex") })
    .onConflictDoUpdate({ target: tables.playerEmail.playerId, set: values });
  const r = await sendMail(engine, addr, {
    subject: "E-Mail-Adresse bestätigen",
    heading: "Bitte bestätige deine Adresse",
    paragraphs: ["Du hast diese Adresse für Benachrichtigungen aus TIDEFRONT hinterlegt. Der Link gilt 24 Stunden."],
    button: { label: "Adresse bestätigen", url: `${publicUrl()}/api/mail/verify?t=${token}` },
    footerNote: "Wenn du das nicht warst, ignoriere diese Nachricht.",
  });
  return { ok: true, sent: r.ok };
}

export async function verifyEmail(db: Db, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const r = await db
    .update(tables.playerEmail)
    .set({ verifiedAt: new Date(), verifyHash: null, verifyExpiresAt: null })
    .where(and(eq(tables.playerEmail.verifyHash, sha256(token)), gt(tables.playerEmail.verifyExpiresAt, new Date())))
    .returning({ id: tables.playerEmail.playerId });
  return r.length > 0;
}

/** Abmeldelink: schaltet alle E-Mail-Benachrichtigungen ab. */
export async function unsubscribeEmail(db: Db, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const off = Object.fromEntries(Object.keys(EMAIL_DEFAULTS).filter((k) => k !== "test").map((k) => [k, false]));
  const r = await db
    .update(tables.playerEmail)
    .set({ prefs: off })
    .where(eq(tables.playerEmail.unsubscribeToken, token))
    .returning({ id: tables.playerEmail.playerId });
  // Der Abmeldelink gilt auch für den Morgenbericht.
  if (r.length > 0) await db.update(tables.morningSummary).set({ enabled: false }).where(eq(tables.morningSummary.playerId, r[0].id));
  return r.length > 0;
}

export async function setEmailPrefs(db: Db, playerId: number, prefs: Record<string, unknown>): Promise<boolean> {
  const r = await db
    .update(tables.playerEmail)
    .set({ prefs: cleanPrefs(prefs) })
    .where(eq(tables.playerEmail.playerId, playerId))
    .returning({ id: tables.playerEmail.playerId });
  return r.length > 0;
}

/** Test-E-Mail der Verwaltung an die eigene Adresse. Codes: no_email. */
export async function sendTestMail(engine: Engine, playerId: number): Promise<{ ok: true } | { ok: false; code: string; error?: string }> {
  const [pe] = await engine.db.select().from(tables.playerEmail).where(eq(tables.playerEmail.playerId, playerId));
  if (!pe) return { ok: false, code: "no_email" };
  const r = await sendMail(engine, pe.email, {
    subject: "Test-E-Mail",
    heading: "Der E-Mail-Versand funktioniert",
    paragraphs: ["Diese Nachricht kommt aus der Verwaltung von TIDEFRONT."],
    facts: [["Server", publicUrl()], ["Gesendet", new Date().toLocaleString("de-DE", { timeZone: process.env.TZ || "Europe/Berlin" })]],
    button: { label: "Im Spiel öffnen", url: `${publicUrl()}/` },
    unsubscribeUrl: unsubUrl(pe.unsubscribeToken),
  }, { force: true });
  return r.ok ? { ok: true } : { ok: false, code: "mail_failed", error: r.error };
}
