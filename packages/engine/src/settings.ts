// Server-Einstellungen (Tabelle server_setting) und Geheimnisse (AES-256-GCM mit APP_SECRET).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";

export async function getSetting(db: DbOrTx, key: string): Promise<string | null> {
  const [r] = await db.select({ value: tables.serverSetting.value }).from(tables.serverSetting).where(eq(tables.serverSetting.key, key));
  return r?.value ?? null;
}

export async function getSettings(db: DbOrTx, keys: string[]): Promise<Map<string, string>> {
  const rows = await db.select().from(tables.serverSetting).where(inArray(tables.serverSetting.key, keys));
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db: DbOrTx, key: string, value: string): Promise<void> {
  await db
    .insert(tables.serverSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: tables.serverSetting.key, set: { value, updatedAt: new Date() } });
}

/** Öffentliche Adresse der Instanz (Links in E-Mails, VAPID-Subject). */
export function publicUrl(): string {
  return (process.env.PUBLIC_URL || "https://tidefront.metaluna9.i234.me").replace(/\/+$/, "");
}

function secretKey(secret = process.env.APP_SECRET): Buffer | null {
  if (!secret || secret.trim().length < 16) return null;
  return createHash("sha256").update(secret.trim()).digest();
}

/** true, wenn APP_SECRET gesetzt ist (mindestens 16 Zeichen). */
export function secretAvailable(): boolean {
  return secretKey() !== null;
}

/** Verschlüsselt mit AES-256-GCM; Format v1:iv:tag:daten (base64). */
export function encryptSecret(plain: string, secret?: string): string {
  const key = secretKey(secret);
  if (!key) throw new Error("APP_SECRET fehlt");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(blob: string, secret?: string): string {
  const key = secretKey(secret);
  if (!key) throw new Error("APP_SECRET fehlt");
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("unbekanntes Format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
