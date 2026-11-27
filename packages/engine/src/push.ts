// Web-Push (VAPID): Schlüssel, Abos und Versand. Versand immer außerhalb von Transaktionen.
import { generateVAPIDKeys, sendNotification } from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import { tables, type Db } from "@tidefront/db";
import { NOTICE_KINDS, type Engine, type NoticeKind } from "./context.ts";
import { getSettings, publicUrl, setSetting } from "./settings.ts";
import { isBot } from "./bots-flag.ts";

export interface PushPayload {
  kind: NoticeKind;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sender; in Tests ersetzbar. Wirft bei Fehlern ein Objekt mit statusCode (wie web-push). */
export type PushSender = (sub: PushTarget, payload: string, vapid: Vapid, opts: { ttl: number; urgency: "high" | "normal" }) => Promise<void>;

const defaultSender: PushSender = async (sub, payload, vapid, opts) => {
  await sendNotification(sub, payload, {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: opts.ttl,
    urgency: opts.urgency,
  });
};

let sender: PushSender = defaultSender;
let vapidCache: Vapid | null = null;

export function setPushSender(s: PushSender | null): void {
  sender = s ?? defaultSender;
}

function subject(): string {
  return process.env.VAPID_SUBJECT || publicUrl();
}

/** migrate: Schlüssel erzeugen, falls weder Umgebung noch Datenbank welche haben. */
export async function ensureVapid(db: Db): Promise<{ created: boolean }> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { created: false };
  const s = await getSettings(db, ["vapid_public_key", "vapid_private_key"]);
  if (s.get("vapid_public_key") && s.get("vapid_private_key")) return { created: false };
  const keys = generateVAPIDKeys();
  await setSetting(db, "vapid_public_key", keys.publicKey);
  await setSetting(db, "vapid_private_key", keys.privateKey);
  return { created: true };
}

/** VAPID-Schlüssel: Umgebung vor Datenbank; null, wenn keine vorhanden. */
export async function loadVapid(db: Db): Promise<Vapid | null> {
  if (vapidCache) return vapidCache;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidCache = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: subject() };
    return vapidCache;
  }
  const s = await getSettings(db, ["vapid_public_key", "vapid_private_key"]);
  const pub = s.get("vapid_public_key");
  const priv = s.get("vapid_private_key");
  if (!pub || !priv) return null;
  vapidCache = { publicKey: pub, privateKey: priv, subject: subject() };
  return vapidCache;
}

export function resetVapidCache(): void {
  vapidCache = null;
}

export type Prefs = Partial<Record<NoticeKind, boolean>>;

/** Vorgaben je Art; fehlende Einträge gelten als Vorgabe. */
export const PUSH_DEFAULTS: Record<NoticeKind, boolean> = {
  attack: true, report: true, build: true, training: true, fleet: true, delivery: true, ops: true, test: true,
  // Marktnachricht: standardmäßig aus, in den Einstellungen schaltbar.
  market: false,
};

export function wants(prefs: Prefs | null | undefined, defaults: Record<NoticeKind, boolean>, kind: NoticeKind): boolean {
  if (kind === "test") return true;
  return prefs?.[kind] ?? defaults[kind];
}

export function cleanPrefs(input: Record<string, unknown>): Prefs {
  const out: Prefs = {};
  for (const k of NOTICE_KINDS) if (typeof input[k] === "boolean") out[k] = input[k] as boolean;
  return out;
}

/**
 * Sendet eine Benachrichtigung an alle Geräte eines Spielers, die diese Art nicht abgeschaltet haben.
 * Abgelaufene Abos (404/410) werden entfernt. Rückgabe: Anzahl erfolgreich zugestellter Nachrichten.
 */
export async function pushToPlayer(engine: Engine, playerId: number, msg: PushPayload): Promise<number> {
  if (await isBot(engine.db, playerId)) return 0; // KI-Spieler: kein Versand
  const vapid = await loadVapid(engine.db);
  if (!vapid) return 0;
  const subs = await engine.db.select().from(tables.pushSubscription).where(eq(tables.pushSubscription.playerId, playerId));
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? "/", tag: msg.tag, kind: msg.kind });
  const gone: number[] = [];
  let sent = 0;
  for (const s of subs) {
    if (!wants(s.prefs as Prefs, PUSH_DEFAULTS, msg.kind)) continue;
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid, {
        ttl: msg.kind === "attack" ? 3600 : 6 * 3600,
        urgency: msg.kind === "attack" || msg.kind === "ops" ? "high" : "normal",
      });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.id);
      else engine.log("push failed", { playerId, code, err: String((err as Error)?.message ?? err).slice(0, 300) });
    }
  }
  if (gone.length) await engine.db.delete(tables.pushSubscription).where(inArray(tables.pushSubscription.id, gone));
  return sent;
}

// ---------------------------------------------------------------- Abos verwalten

export async function pushSubscribe(db: Db, playerId: number, sub: PushTarget, prefs?: Prefs): Promise<void> {
  await db
    .insert(tables.pushSubscription)
    .values({ playerId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, prefs: prefs ?? {} })
    .onConflictDoUpdate({
      target: tables.pushSubscription.endpoint,
      set: { playerId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, ...(prefs ? { prefs } : {}) },
    });
}

export async function pushUnsubscribe(db: Db, playerId: number, endpoint: string): Promise<void> {
  await db
    .delete(tables.pushSubscription)
    .where(and(eq(tables.pushSubscription.playerId, playerId), eq(tables.pushSubscription.endpoint, endpoint)));
}

export async function pushStatus(db: Db, playerId: number, endpoint: string | null) {
  const vapid = await loadVapid(db);
  const subs = await db
    .select({ endpoint: tables.pushSubscription.endpoint, prefs: tables.pushSubscription.prefs })
    .from(tables.pushSubscription)
    .where(eq(tables.pushSubscription.playerId, playerId));
  const mine = endpoint ? subs.find((s) => s.endpoint === endpoint) : undefined;
  const prefs = { ...PUSH_DEFAULTS, ...((mine?.prefs as Prefs) ?? {}) };
  return { publicKey: vapid?.publicKey ?? null, subscribed: !!mine, devices: subs.length, prefs };
}

export async function pushSetPrefs(db: Db, playerId: number, endpoint: string, prefs: Prefs): Promise<boolean> {
  const r = await db
    .update(tables.pushSubscription)
    .set({ prefs })
    .where(and(eq(tables.pushSubscription.playerId, playerId), eq(tables.pushSubscription.endpoint, endpoint)))
    .returning({ id: tables.pushSubscription.id });
  return r.length > 0;
}
