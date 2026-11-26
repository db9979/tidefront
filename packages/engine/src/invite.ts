// Freunde einladen: persönliche, einmalige Einladungscodes per E-Mail oder als geteilter Link.
// Der Code liegt in invite_code (max_uses 1), die Angaben zur Einladung in player_invite.
// Versand immer außerhalb von Transaktionen.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { tables, type Db, type DbOrTx } from "@tidefront/db";
import { GameError, type Engine, type Notice } from "./context.ts";
import { mailReady, sendMail } from "./mail.ts";
import { inviteMail } from "./invite-mail.ts";
import { deliverNotice } from "./notices.ts";
import { sendMessage } from "./social.ts";
import { getSetting, publicUrl, setSetting, sha256 } from "./settings.ts";

export const INVITE_DAYS = 14;
export const INVITE_MESSAGE_MAX = 500;
export const INVITE_NAME_MAX = 40;
/** Dieselbe Adresse höchstens einmal je so vielen Tagen (über alle Einladenden). */
export const INVITE_SAME_ADDRESS_DAYS = 7;
/** Erneut senden frühestens nach so vielen Stunden, höchstens so oft insgesamt. */
export const INVITE_RESEND_HOURS = 24;
export const INVITE_MAX_SENDS = 3;

export interface InviteSettings {
  /** false: nur Admins dürfen einladen. */
  enabled: boolean;
  /** Höchstens so viele offene Einladungen je Spieler. */
  maxOpen: number;
  /** Höchstens so viele neue Einladungen je Spieler in 7 Tagen. */
  maxWeek: number;
}

export const INVITE_DEFAULTS: InviteSettings = { enabled: true, maxOpen: 5, maxWeek: 10 };
const SETTING_KEY = "invite_settings";
const DAY = 86400000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
/** Zeitpunkt für rohe SQL-Vergleiche (postgres-js nimmt dort keine Date-Objekte). */
const iso = (ms: number) => new Date(ms).toISOString();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function inviteSettings(db: DbOrTx): Promise<InviteSettings> {
  const raw = await getSetting(db, SETTING_KEY);
  if (!raw) return { ...INVITE_DEFAULTS };
  try {
    return { ...INVITE_DEFAULTS, ...(JSON.parse(raw) as Partial<InviteSettings>) };
  } catch {
    return { ...INVITE_DEFAULTS };
  }
}

export async function saveInviteSettings(db: Db, s: InviteSettings): Promise<InviteSettings> {
  const clean: InviteSettings = {
    enabled: !!s.enabled,
    maxOpen: Math.max(1, Math.min(100, Math.floor(s.maxOpen))),
    maxWeek: Math.max(1, Math.min(500, Math.floor(s.maxWeek))),
  };
  await setSetting(db, SETTING_KEY, JSON.stringify(clean));
  return clean;
}

function newCode(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

const emailHash = (email: string) => sha256(email.trim().toLowerCase());
export const inviteUrl = (code: string) => `${publicUrl()}/?invite=${encodeURIComponent(code)}`;

export type InviteStatus = "sent" | "open" | "accepted" | "expired" | "revoked";

function statusOf(r: { channel: string; acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, nowMs: number): InviteStatus {
  if (r.acceptedAt) return "accepted";
  if (r.revokedAt) return "revoked";
  if (r.expiresAt.getTime() <= nowMs) return "expired";
  return r.channel === "email" ? "sent" : "open";
}

/** Offene Einladungen und neue in den letzten 7 Tagen eines Spielers. */
async function usage(db: DbOrTx, inviterId: number, nowMs: number): Promise<{ open: number; week: number }> {
  const pi = tables.playerInvite;
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${pi.acceptedAt} is null and ${pi.revokedAt} is null and ${pi.expiresAt} > ${iso(nowMs)})::int`,
      week: sql<number>`count(*) filter (where ${pi.createdAt} > ${iso(nowMs - 7 * DAY)})::int`,
    })
    .from(pi)
    .where(eq(pi.inviterId, inviterId));
  return { open: r?.open ?? 0, week: r?.week ?? 0 };
}

interface Inviter { id: number; name: string; isAdmin: boolean }

async function loadInviter(db: DbOrTx, playerId: number): Promise<Inviter> {
  const [p] = await db
    .select({ id: tables.player.id, name: tables.player.name, isAdmin: tables.player.isAdmin })
    .from(tables.player)
    .where(eq(tables.player.id, playerId));
  if (!p) throw new GameError("no_player");
  return p;
}

/** Prüft Abschaltung und Grenzen. Codes: invite_off, invite_open_limit, invite_week_limit. */
async function checkLimits(db: DbOrTx, inviter: Inviter, nowMs: number, countWeek = true): Promise<void> {
  const s = await inviteSettings(db);
  if (!s.enabled && !inviter.isAdmin) throw new GameError("invite_off");
  const u = await usage(db, inviter.id, nowMs);
  if (u.open >= s.maxOpen) throw new GameError("invite_open_limit");
  if (countWeek && u.week >= s.maxWeek) throw new GameError("invite_week_limit");
}

/** Prüft eine Adresse. Codes: bad_email, invite_blocked, invite_member, invite_recent. */
async function checkAddress(db: DbOrTx, email: string, nowMs: number, exceptInviteId?: number): Promise<void> {
  if (!EMAIL_RE.test(email) || email.length > 254) throw new GameError("bad_email");
  const lower = email.toLowerCase();
  const [blocked] = await db.select().from(tables.inviteBlock).where(eq(tables.inviteBlock.emailHash, emailHash(email)));
  if (blocked) throw new GameError("invite_blocked");
  const [member] = await db
    .select({ id: tables.playerEmail.playerId })
    .from(tables.playerEmail)
    .where(and(sql`lower(${tables.playerEmail.email}) = ${lower}`, isNotNull(tables.playerEmail.verifiedAt)));
  if (member) throw new GameError("invite_member");
  if (exceptInviteId !== undefined) return;
  const pi = tables.playerInvite;
  const [recent] = await db
    .select({ id: pi.id })
    .from(pi)
    .where(and(
      sql`lower(${pi.email}) = ${lower}`,
      sql`(${pi.createdAt} > ${iso(nowMs - INVITE_SAME_ADDRESS_DAYS * DAY)} or (${pi.acceptedAt} is null and ${pi.revokedAt} is null and ${pi.expiresAt} > ${iso(nowMs)}))`,
    ))
    .limit(1);
  if (recent) throw new GameError("invite_recent");
}

/** Legt Code und Einladung an (eine Transaktion). */
async function insertInvite(db: Db, inviter: Inviter, values: {
  channel: "email" | "link"; email: string | null; friendName: string | null; message: string | null;
}, nowMs: number) {
  return db.transaction(async (tx) => {
    // Grenzen je Spieler unter Sperre der Spielerzeile, damit parallele Anfragen sie nicht überschreiten.
    await tx.execute(sql`select id from player where id = ${inviter.id} for update`);
    await checkLimits(tx, inviter, nowMs);
    if (values.email) await checkAddress(tx, values.email, nowMs);
    const code = newCode();
    await tx.insert(tables.inviteCode).values({ code, maxUses: 1 });
    const [row] = await tx
      .insert(tables.playerInvite)
      .values({
        code,
        inviterId: inviter.id,
        ...values,
        blockToken: values.channel === "email" ? randomBytes(24).toString("hex") : null,
        createdAt: new Date(nowMs),
        expiresAt: new Date(nowMs + INVITE_DAYS * DAY),
      })
      .returning();
    return row;
  });
}

function clean(s: string | null | undefined, max: number): string | null {
  const v = (s ?? "").trim().slice(0, max);
  return v || null;
}

/**
 * Einladung per E-Mail. Codes: invite_off, invite_open_limit, invite_week_limit, bad_email, invite_blocked,
 * invite_member, invite_recent, mail_off, mail_failed.
 */
export async function inviteByEmail(
  engine: Engine,
  playerId: number,
  input: { email: string; name?: string | null; message?: string | null },
  nowMs = Date.now(),
): Promise<{ ok: true; id: number; code: string }> {
  const inviter = await loadInviter(engine.db, playerId);
  if (!(await mailReady(engine.db))) throw new GameError("mail_off");
  const email = input.email.trim();
  const row = await insertInvite(engine.db, inviter, {
    channel: "email", email, friendName: clean(input.name, INVITE_NAME_MAX), message: clean(input.message, INVITE_MESSAGE_MAX),
  }, nowMs);
  const r = await sendMail(engine, email, inviteMail({ ...row, inviterName: inviter.name }));
  if (!r.ok) {
    // Ohne Versand keine Einladung: Code und Eintrag wieder entfernen.
    await engine.db.delete(tables.inviteCode).where(eq(tables.inviteCode.code, row.code));
    throw new GameError("mail_failed");
  }
  await engine.db
    .update(tables.playerInvite)
    .set({ sentAt: new Date(nowMs), sendCount: 1 })
    .where(eq(tables.playerInvite.id, row.id));
  return { ok: true, id: row.id, code: row.code };
}

/** Persönlicher Link zum Teilen (ohne Mail). Codes: invite_off, invite_open_limit, invite_week_limit. */
export async function inviteLink(engine: Engine, playerId: number, input: { name?: string | null }, nowMs = Date.now()) {
  const inviter = await loadInviter(engine.db, playerId);
  const row = await insertInvite(engine.db, inviter, {
    channel: "link", email: null, friendName: clean(input.name, INVITE_NAME_MAX), message: null,
  }, nowMs);
  return { ok: true as const, id: row.id, code: row.code, url: inviteUrl(row.code), expiresAtMs: row.expiresAt.getTime() };
}

/** Zurückziehen einer offenen eigenen Einladung. Code: no_invite. */
export async function revokeInvite(db: Db, playerId: number, id: number, nowMs = Date.now()): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(tables.playerInvite)
      .where(and(eq(tables.playerInvite.id, id), eq(tables.playerInvite.inviterId, playerId)));
    if (!r || r.acceptedAt || r.revokedAt) throw new GameError("no_invite");
    // Sperrreihenfolge wie bei der Registrierung: erst invite_code, dann player_invite.
    await tx.update(tables.inviteCode).set({ disabledAt: new Date(nowMs) }).where(eq(tables.inviteCode.code, r.code));
    await tx.update(tables.playerInvite).set({ revokedAt: new Date(nowMs) }).where(eq(tables.playerInvite.id, id));
  });
  return { ok: true };
}

/**
 * Mail erneut senden (frühestens 24 h nach dem letzten Versand, höchstens dreimal); verlängert die Gültigkeit.
 * Codes: no_invite, invite_too_soon, invite_resend_max, invite_blocked, invite_member, invite_open_limit, mail_off, mail_failed.
 */
export async function resendInvite(engine: Engine, playerId: number, id: number, nowMs = Date.now()): Promise<{ ok: true }> {
  const inviter = await loadInviter(engine.db, playerId);
  const [r] = await engine.db
    .select()
    .from(tables.playerInvite)
    .where(and(eq(tables.playerInvite.id, id), eq(tables.playerInvite.inviterId, playerId)));
  if (!r || r.channel !== "email" || !r.email || r.acceptedAt || r.revokedAt) throw new GameError("no_invite");
  if (r.sentAt && nowMs - r.sentAt.getTime() < INVITE_RESEND_HOURS * 3600000) throw new GameError("invite_too_soon");
  if (r.sendCount >= INVITE_MAX_SENDS) throw new GameError("invite_resend_max");
  await checkAddress(engine.db, r.email, nowMs, r.id);
  // Eine abgelaufene Einladung wird wieder offen: dann zählt die Grenze offener Einladungen.
  if (r.expiresAt.getTime() <= nowMs) await checkLimits(engine.db, inviter, nowMs, false);
  if (!(await mailReady(engine.db))) throw new GameError("mail_off");
  const expiresAt = new Date(nowMs + INVITE_DAYS * DAY);
  const sent = await sendMail(engine, r.email, inviteMail({ ...r, expiresAt, inviterName: inviter.name }));
  if (!sent.ok) throw new GameError("mail_failed");
  await engine.db
    .update(tables.playerInvite)
    .set({ sentAt: new Date(nowMs), sendCount: r.sendCount + 1, expiresAt })
    .where(eq(tables.playerInvite.id, id));
  return { ok: true };
}

const invitee = alias(tables.player, "invitee");

/** Übersicht „Meine Einladungen“ mit Grenzen und Versandstatus. */
export async function myInvites(engine: Engine, playerId: number, nowMs = Date.now()) {
  const inviter = await loadInviter(engine.db, playerId);
  const s = await inviteSettings(engine.db);
  const pi = tables.playerInvite;
  const rows = await engine.db
    .select({
      id: pi.id, code: pi.code, channel: pi.channel, email: pi.email, friendName: pi.friendName, createdAt: pi.createdAt,
      expiresAt: pi.expiresAt, sentAt: pi.sentAt, sendCount: pi.sendCount, revokedAt: pi.revokedAt, acceptedAt: pi.acceptedAt,
      acceptedName: invitee.name,
    })
    .from(pi)
    .leftJoin(invitee, eq(invitee.id, pi.acceptedPlayerId))
    .where(eq(pi.inviterId, playerId))
    .orderBy(desc(pi.createdAt), desc(pi.id))
    .limit(50);
  return {
    serverNow: nowMs,
    allowed: s.enabled || inviter.isAdmin,
    limits: { maxOpen: s.maxOpen, maxWeek: s.maxWeek, days: INVITE_DAYS },
    usage: await usage(engine.db, playerId, nowMs),
    mailReady: await mailReady(engine.db),
    invites: rows.map((r) => {
      const status = statusOf(r, nowMs);
      const resendAtMs = r.sentAt ? r.sentAt.getTime() + INVITE_RESEND_HOURS * 3600000 : nowMs;
      return {
        id: r.id,
        channel: r.channel as "email" | "link",
        email: r.email,
        friendName: r.friendName,
        status,
        acceptedName: r.acceptedName ?? null,
        createdAtMs: r.createdAt.getTime(),
        expiresAtMs: r.expiresAt.getTime(),
        // Code und Link nur, solange sie nutzbar sind.
        code: status === "open" || status === "sent" ? r.code : null,
        url: status === "open" || status === "sent" ? inviteUrl(r.code) : null,
        canRevoke: status === "open" || status === "sent",
        canResend: r.channel === "email" && (status === "sent" || status === "expired") && r.sendCount < INVITE_MAX_SENDS && resendAtMs <= nowMs,
        resendAtMs: r.channel === "email" && r.sendCount < INVITE_MAX_SENDS ? resendAtMs : null,
      };
    }),
  };
}

/** Verwaltung: alle persönlichen Einladungen mit Einladendem (neueste zuerst, höchstens 200). */
export async function adminInvites(db: Db, nowMs = Date.now()) {
  const pi = tables.playerInvite;
  const rows = await db
    .select({
      id: pi.id, code: pi.code, channel: pi.channel, email: pi.email, friendName: pi.friendName, createdAt: pi.createdAt,
      expiresAt: pi.expiresAt, revokedAt: pi.revokedAt, acceptedAt: pi.acceptedAt, sendCount: pi.sendCount,
      inviterName: tables.player.name, acceptedName: invitee.name,
    })
    .from(pi)
    .innerJoin(tables.player, eq(tables.player.id, pi.inviterId))
    .leftJoin(invitee, eq(invitee.id, pi.acceptedPlayerId))
    .orderBy(desc(pi.createdAt), desc(pi.id))
    .limit(200);
  return rows.map((r) => ({
    id: r.id, code: r.code, channel: r.channel, email: r.email, friendName: r.friendName, inviterName: r.inviterName,
    acceptedName: r.acceptedName ?? null, status: statusOf(r, nowMs), sendCount: r.sendCount,
    createdAtMs: r.createdAt.getTime(), expiresAtMs: r.expiresAt.getTime(),
  }));
}

/** Öffentliche Abfrage für den Anmeldebildschirm: nur der Name des Einladenden, nur für nutzbare Codes. */
export async function inviterForCode(db: Db, code: string, nowMs = Date.now()): Promise<{ inviterName: string | null }> {
  const c = code.trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(c)) return { inviterName: null };
  const pi = tables.playerInvite;
  const [r] = await db
    .select({ name: tables.player.name })
    .from(pi)
    .innerJoin(tables.player, eq(tables.player.id, pi.inviterId))
    .innerJoin(tables.inviteCode, eq(tables.inviteCode.code, pi.code))
    .where(and(
      eq(pi.code, c),
      isNull(pi.acceptedAt),
      isNull(pi.revokedAt),
      gt(pi.expiresAt, new Date(nowMs)),
      isNull(tables.inviteCode.disabledAt),
      sql`${tables.inviteCode.uses} < ${tables.inviteCode.maxUses}`,
    ));
  return { inviterName: r?.name ?? null };
}

// ---------------------------------------------------------------- Registrierung (aus auth.register, in deren Transaktion)

/**
 * Vor dem Anlegen des Spielers: Ist der (schon verbrauchte) Code eine persönliche Einladung, muss sie noch gelten.
 * Rückgabe: id der Einladung oder null (allgemeiner Code). Code: invite_invalid.
 */
export async function claimPersonalInvite(tx: DbOrTx, code: string, nowMs = Date.now()): Promise<number | null> {
  const [r] = await tx
    .select({ id: tables.playerInvite.id, expiresAt: tables.playerInvite.expiresAt, revokedAt: tables.playerInvite.revokedAt, acceptedAt: tables.playerInvite.acceptedAt })
    .from(tables.playerInvite)
    .where(eq(tables.playerInvite.code, code))
    .for("update");
  if (!r) return null;
  if (r.revokedAt || r.acceptedAt || r.expiresAt.getTime() <= nowMs) throw new GameError("invite_invalid");
  return r.id;
}

/** Nach dem Anlegen des Spielers: Einladung als angenommen markieren. */
export async function markInviteAccepted(tx: DbOrTx, inviteId: number, playerId: number, nowMs = Date.now()): Promise<void> {
  await tx
    .update(tables.playerInvite)
    .set({ acceptedAt: new Date(nowMs), acceptedPlayerId: playerId })
    .where(eq(tables.playerInvite.id, inviteId));
}

/**
 * Nach erfolgreicher Registrierung: Einladenden benachrichtigen (Systemnachricht, Push und E-Mail über die
 * Art „report“). Rückgabe: id des Einladenden oder null.
 */
export async function notifyInviter(engine: Engine, newPlayerId: number): Promise<number | null> {
  const pi = tables.playerInvite;
  const [r] = await engine.db
    .select({ inviterId: pi.inviterId, name: invitee.name })
    .from(pi)
    .innerJoin(invitee, eq(invitee.id, pi.acceptedPlayerId))
    .where(eq(pi.acceptedPlayerId, newPlayerId));
  if (!r) return null;
  await sendMessage(engine, null, {
    toPlayerId: r.inviterId,
    subject: "Einladung angenommen",
    body: `${r.name} ist deiner Einladung gefolgt und hat sich bei TIDEFRONT angemeldet. Unter Meldungen → Rangliste findest du den neuen Mitspieler und kannst ihm eine Nachricht schreiben.`,
  });
  const notice: Notice = {
    kind: "report",
    title: "Einladung angenommen",
    body: `${r.name} ist deiner Einladung gefolgt.`,
    url: "/?tab=berichte",
    tag: `invite-${newPlayerId}`,
  };
  if (engine.push) engine.push([{ playerId: r.inviterId, notice }]);
  else await deliverNotice(engine, r.inviterId, notice);
  return r.inviterId;
}

// ---------------------------------------------------------------- Sperrlink „Keine Einladungen mehr an diese Adresse“

/** Sperrt die Adresse der Einladung zum Token und zieht alle offenen Einladungen an sie zurück. */
export async function blockInviteAddress(db: Db, token: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const [r] = await db.select({ email: tables.playerInvite.email }).from(tables.playerInvite).where(eq(tables.playerInvite.blockToken, token));
  if (!r?.email) return false;
  const lower = r.email.toLowerCase();
  await db.transaction(async (tx) => {
    await tx.insert(tables.inviteBlock).values({ emailHash: emailHash(lower) }).onConflictDoNothing();
    const open = await tx
      .update(tables.playerInvite)
      .set({ revokedAt: new Date(nowMs) })
      .where(and(sql`lower(${tables.playerInvite.email}) = ${lower}`, isNull(tables.playerInvite.acceptedAt), isNull(tables.playerInvite.revokedAt)))
      .returning({ code: tables.playerInvite.code });
    for (const o of open) await tx.update(tables.inviteCode).set({ disabledAt: new Date(nowMs) }).where(eq(tables.inviteCode.code, o.code));
  });
  return true;
}
