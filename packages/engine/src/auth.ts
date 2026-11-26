// Konten: Anmeldung nur mit Einladungscode, Passwort mit scrypt, Sitzung als Zufallstoken.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables, type Db } from "@tidefront/db";
import { marketBalance, GameError, SESSION_DAYS } from "./context.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, saltHex, keyHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

async function createSession(db: Db, playerId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(tables.session).values({
    token,
    playerId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
  });
  return token;
}

/** Registrierung: Einladungscode wird im selben Commit verbraucht. Codes: invite_invalid, name_taken. */
export async function register(db: Db, input: { inviteCode: string; name: string; password: string }) {
  const nowMs = Date.now();
  const playerId = await db.transaction(async (tx) => {
    const used = await tx
      .update(tables.inviteCode)
      .set({ uses: sql`${tables.inviteCode.uses} + 1` })
      .where(and(eq(tables.inviteCode.code, input.inviteCode.trim()), lt(tables.inviteCode.uses, tables.inviteCode.maxUses)))
      .returning({ code: tables.inviteCode.code });
    if (used.length === 0) throw new GameError("invite_invalid");
    const [taken] = await tx
      .select({ id: tables.player.id })
      .from(tables.player)
      .where(sql`lower(${tables.player.name}) = lower(${input.name})`);
    if (taken) throw new GameError("name_taken");
    const trader = marketCore.createTraderState(marketBalance, 0, {}, nowMs);
    const { stock: _stock, ...rest } = trader;
    const [p] = await tx
      .insert(tables.player)
      .values({ name: input.name, passHash: await hashPassword(input.password), trader: rest })
      .returning({ id: tables.player.id });
    return p.id;
  });
  return { playerId, token: await createSession(db, playerId) };
}

/** Code: bad_login. */
export async function login(db: Db, input: { name: string; password: string }) {
  const [p] = await db
    .select()
    .from(tables.player)
    .where(sql`lower(${tables.player.name}) = lower(${input.name})`);
  if (!p || !(await verifyPassword(input.password, p.passHash))) throw new GameError("bad_login");
  return { playerId: p.id, token: await createSession(db, p.id) };
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.delete(tables.session).where(eq(tables.session.token, token));
}

export async function playerForToken(db: Db, token: string | undefined): Promise<{ id: number; name: string } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const [r] = await db
    .select({ id: tables.player.id, name: tables.player.name })
    .from(tables.session)
    .innerJoin(tables.player, eq(tables.player.id, tables.session.playerId))
    .where(and(eq(tables.session.token, token), gt(tables.session.expiresAt, new Date())));
  return r ?? null;
}
