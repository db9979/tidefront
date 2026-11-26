// Konten ohne Konsole: Admins, Passwort ändern und zurücksetzen, Einladungscodes, Spielerliste, letzte Aktivität.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { tables, type Db, type DbOrTx } from "@tidefront/db";
import { GameError, type Engine } from "./context.ts";
import { createSession, hashPassword, verifyPassword } from "./auth.ts";
import { sendMail } from "./mail.ts";
import { publicUrl, sha256 } from "./settings.ts";

const RESET_HOURS = 24;
const MAIL_RESET_HOURS = 2;

/** ADMIN_NAMES="anna, bert" -> ["anna", "bert"] (klein). */
export function parseAdminNames(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * migrate: Mit ADMIN_NAMES ist genau diese Liste Admin. Ohne Liste bleibt es, wie es ist; gibt es noch
 * keinen Admin, wird der zuerst registrierte Spieler Admin.
 */
export async function applyAdminNames(db: Db, raw: string | undefined): Promise<{ admins: string[] }> {
  const names = parseAdminNames(raw);
  if (names.length > 0) {
    await db.update(tables.player).set({
      isAdmin: sql`lower(${tables.player.name}) in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
    });
  } else {
    await db.execute(sql`update player set is_admin = true
      where id = (select min(id) from player) and not exists (select 1 from player where is_admin)`);
  }
  const admins = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.isAdmin, true));
  return { admins: admins.map((a) => a.name) };
}

/** Bei der Registrierung (in deren Transaktion). */
export async function grantAdminOnRegister(tx: DbOrTx, playerId: number, name: string): Promise<void> {
  const names = parseAdminNames(process.env.ADMIN_NAMES);
  if (names.length > 0) {
    if (names.includes(name.trim().toLowerCase())) await tx.update(tables.player).set({ isAdmin: true }).where(eq(tables.player.id, playerId));
    return;
  }
  await tx.execute(sql`update player set is_admin = true
    where id = ${playerId} and not exists (select 1 from player where is_admin and id <> ${playerId})`);
}

const seenAt = new Map<number, number>();
/** Letzte Aktivität fortschreiben, höchstens alle 5 Minuten je Spieler und Prozess. */
export async function touchLastSeen(db: Db, playerId: number, nowMs = Date.now()): Promise<void> {
  if (nowMs - (seenAt.get(playerId) ?? 0) < 5 * 60000) return;
  seenAt.set(playerId, nowMs);
  await db.update(tables.player).set({ lastSeenAt: new Date(nowMs) }).where(eq(tables.player.id, playerId));
}

// ---------------------------------------------------------------- Passwort

/** Codes: bad_password. Beendet alle anderen Sitzungen. */
export async function changePassword(db: Db, playerId: number, currentToken: string | undefined, oldPw: string, newPw: string): Promise<void> {
  const [p] = await db.select({ passHash: tables.player.passHash }).from(tables.player).where(eq(tables.player.id, playerId));
  if (!p || !(await verifyPassword(oldPw, p.passHash))) throw new GameError("bad_password");
  const hash = await hashPassword(newPw);
  await db.transaction(async (tx) => {
    await tx.update(tables.player).set({ passHash: hash }).where(eq(tables.player.id, playerId));
    await tx
      .delete(tables.session)
      .where(and(eq(tables.session.playerId, playerId), currentToken ? ne(tables.session.token, currentToken) : sql`true`));
  });
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function readableCode(len = 12): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

function normCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Verwaltung: einmaliger Rücksetzcode, 24 h gültig; ältere offene Codes des Spielers verfallen. Code: no_player. */
export async function createResetCode(db: Db, adminId: number, playerId: number): Promise<{ code: string; expiresAt: Date; name: string }> {
  const [p] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, playerId));
  if (!p) throw new GameError("no_player");
  const code = readableCode();
  const expiresAt = new Date(Date.now() + RESET_HOURS * 3600000);
  await db.transaction(async (tx) => {
    await tx
      .update(tables.passwordReset)
      .set({ usedAt: new Date() })
      .where(and(eq(tables.passwordReset.playerId, playerId), isNull(tables.passwordReset.usedAt)));
    await tx.insert(tables.passwordReset).values({ playerId, codeHash: sha256(normCode(code)), via: "admin", createdBy: adminId, expiresAt });
  });
  return { code, expiresAt, name: p.name };
}

/**
 * Neues Passwort mit Rücksetzcode (Verwaltung) oder Link-Token (E-Mail). Der Name muss passen, wenn angegeben.
 * Beendet alle Sitzungen und meldet neu an. Code: bad_reset.
 */
export async function resetPassword(db: Db, input: { name?: string; code: string; password: string }): Promise<{ playerId: number; token: string }> {
  const raw = input.code.trim();
  const hash = sha256(/^[0-9a-f]{64}$/.test(raw) ? raw : normCode(raw));
  const hash2 = sha256(raw);
  const playerId = await db.transaction(async (tx) => {
    const [r] = await tx
      .select({ id: tables.passwordReset.id, playerId: tables.passwordReset.playerId, name: tables.player.name })
      .from(tables.passwordReset)
      .innerJoin(tables.player, eq(tables.player.id, tables.passwordReset.playerId))
      .where(and(
        sql`${tables.passwordReset.codeHash} in (${hash}, ${hash2})`,
        isNull(tables.passwordReset.usedAt),
        gt(tables.passwordReset.expiresAt, new Date()),
      ))
      .for("update");
    if (!r) throw new GameError("bad_reset");
    if (input.name && input.name.trim().toLowerCase() !== r.name.toLowerCase()) throw new GameError("bad_reset");
    await tx.update(tables.passwordReset).set({ usedAt: new Date() }).where(eq(tables.passwordReset.id, r.id));
    await tx.update(tables.player).set({ passHash: await hashPassword(input.password) }).where(eq(tables.player.id, r.playerId));
    await tx.delete(tables.session).where(eq(tables.session.playerId, r.playerId));
    return r.playerId;
  });
  return { playerId, token: await createSession(db, playerId) };
}

/** „Passwort vergessen“ per E-Mail: nur mit bestätigter Adresse; die Antwort verrät nichts darüber. */
export async function requestPasswordResetMail(engine: Engine, name: string): Promise<void> {
  const [r] = await engine.db
    .select({ id: tables.player.id, email: tables.playerEmail.email, verifiedAt: tables.playerEmail.verifiedAt })
    .from(tables.player)
    .innerJoin(tables.playerEmail, eq(tables.playerEmail.playerId, tables.player.id))
    .where(sql`lower(${tables.player.name}) = lower(${name.trim()})`);
  if (!r || !r.verifiedAt) return;
  const token = randomBytes(32).toString("hex");
  await engine.db.insert(tables.passwordReset).values({
    playerId: r.id, codeHash: sha256(token), via: "email", expiresAt: new Date(Date.now() + MAIL_RESET_HOURS * 3600000),
  });
  await sendMail(engine, r.email, {
    subject: "Passwort zurücksetzen",
    heading: "Neues Passwort festlegen",
    paragraphs: [`Für dein Konto wurde ein neues Passwort angefordert. Der Link gilt ${MAIL_RESET_HOURS} Stunden und nur einmal.`],
    button: { label: "Passwort neu setzen", url: `${publicUrl()}/?reset=${token}` },
    footerNote: "Wenn du das nicht warst, ignoriere diese Nachricht; dein Passwort bleibt unverändert.",
  });
}

// ---------------------------------------------------------------- Verwaltung

export async function listPlayers(db: Db) {
  return db
    .select({
      id: tables.player.id,
      name: tables.player.name,
      isAdmin: tables.player.isAdmin,
      createdAt: tables.player.createdAt,
      lastSeenAt: tables.player.lastSeenAt,
      baseName: tables.base.name,
      /** Mehrere Häfen: Anzahl der Häfen (baseName = Heimathafen). */
      baseCount: sql<number>`(select count(*)::int from base b2 where b2.player_id = ${tables.player.id})`,
      email: tables.playerEmail.email,
      emailVerified: sql<boolean>`${tables.playerEmail.verifiedAt} is not null`,
    })
    .from(tables.player)
    .leftJoin(tables.base, and(eq(tables.base.playerId, tables.player.id), eq(tables.base.isHome, true)))
    .leftJoin(tables.playerEmail, eq(tables.playerEmail.playerId, tables.player.id))
    .orderBy(asc(tables.player.id));
}

/** Allgemeine Codes; persönliche Einladungen von Spielern (player_invite) stehen in einer eigenen Liste. */
export async function listInvites(db: Db) {
  return db
    .select()
    .from(tables.inviteCode)
    .where(sql`not exists (select 1 from player_invite pi where pi.code = ${tables.inviteCode.code})`)
    .orderBy(desc(tables.inviteCode.createdAt));
}

/** Code frei oder zufällig. Codes: invite_exists, bad_code. */
export async function createInvite(db: Db, input: { code?: string; maxUses: number }): Promise<{ code: string }> {
  const code = (input.code?.trim() || readableCode(8).replace(/-/g, "")).toUpperCase();
  if (!/^[A-Z0-9_-]{3,64}$/.test(code)) throw new GameError("bad_code");
  // Codes gelten ohne Rücksicht auf Groß-/Kleinschreibung: auch „abc“ neben „ABC“ wäre doppelt.
  const [clash] = await db.select({ code: tables.inviteCode.code }).from(tables.inviteCode).where(sql`upper(${tables.inviteCode.code}) = ${code}`);
  if (clash) throw new GameError("invite_exists");
  const r = await db
    .insert(tables.inviteCode)
    .values({ code, maxUses: Math.max(1, Math.floor(input.maxUses)) })
    .onConflictDoNothing()
    .returning({ code: tables.inviteCode.code });
  if (r.length === 0) throw new GameError("invite_exists");
  return { code };
}

/** Deaktivierten Code wieder freigeben. */
export async function enableInvite(db: Db, code: string): Promise<boolean> {
  const r = await db
    .update(tables.inviteCode)
    .set({ disabledAt: null })
    .where(and(eq(tables.inviteCode.code, code), isNotNull(tables.inviteCode.disabledAt)))
    .returning({ code: tables.inviteCode.code });
  return r.length > 0;
}

export async function disableInvite(db: Db, code: string): Promise<boolean> {
  const r = await db
    .update(tables.inviteCode)
    .set({ disabledAt: new Date() })
    .where(and(eq(tables.inviteCode.code, code), isNull(tables.inviteCode.disabledAt)))
    .returning({ code: tables.inviteCode.code });
  return r.length > 0;
}
