// Drosselung über Valkey (feste Fenster je Schlüssel) und die Einstellung trustProxy.
// Zähler atomar per Lua (INCR und Ablauf in einem Schritt): ein Absturz zwischen INCR und EXPIRE kann keinen
// Schlüssel ohne Ablauf hinterlassen; ein solcher (alter) Schlüssel bekommt beim nächsten Treffer seinen Ablauf.
// Ohne Valkey wird nicht begrenzt (Spiel bleibt nutzbar).

/** Minimaler Teil des Valkey-Clients, den die Drosselung braucht (für Tests ersetzbar). */
export interface RateStore {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

const HIT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export interface Failures {
  /** true, wenn der Schlüssel bereits `limit` Fehlversuche im laufenden Fenster hat. */
  blocked(bucket: string, limit: number): Promise<boolean>;
  /** Fehlversuch zählen (Fenster windowSec ab dem ersten). */
  hit(bucket: string, windowSec: number): Promise<number>;
  /** Zähler löschen (z. B. nach erfolgreicher Anmeldung). */
  reset(bucket: string): Promise<void>;
}

export function createRateLimiter(store: RateStore) {
  const k = (bucket: string) => `tf:rl:${bucket}`;
  const hit = async (bucket: string, windowSec: number): Promise<number> => Number(await store.eval(HIT, 1, k(bucket), windowSec));
  /** Feste Fenster je Schlüssel: true, solange höchstens `limit` Anfragen im Fenster. */
  const rateLimit = async (bucket: string, limit: number, windowSec: number): Promise<boolean> => {
    try {
      return (await hit(bucket, windowSec)) <= limit;
    } catch {
      return true;
    }
  };
  const failures: Failures = {
    async blocked(bucket, limit) {
      try {
        return Number((await store.get(k(bucket))) ?? 0) >= limit;
      } catch {
        return false;
      }
    },
    async hit(bucket, windowSec) {
      try {
        return await hit(bucket, windowSec);
      } catch {
        return 0;
      }
    },
    async reset(bucket) {
      try {
        await store.del(k(bucket));
      } catch {
        /* ohne Valkey nichts zu tun */
      }
    },
  };
  return { rateLimit, failures };
}

/** Vorgabe: nur Loopback und private Netze (Reverse-Proxy im Heimnetz, Docker-Bridge) dürfen X-Forwarded-For setzen. */
export const TRUST_PROXY_DEFAULT = "loopback,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

/**
 * Wert für Fastifys trustProxy aus der Umgebung (TRUST_PROXY): "true"/"false" oder eine Liste von
 * Adressen/Netzen/Vorgaben von proxy-addr (loopback, linklocal, uniquelocal), durch Komma getrennt.
 */
export function parseTrustProxy(raw: string | undefined): boolean | string[] {
  const v = (raw ?? TRUST_PROXY_DEFAULT).trim();
  if (v === "") return parseTrustProxy(TRUST_PROXY_DEFAULT);
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  return v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Schlüssel der Anmeldesperre je Kontoname (Groß/klein egal wie beim Login). */
export function loginAccountBucket(name: string): string {
  return `loginfail:${name.trim().toLowerCase()}`;
}

/** Anmeldung je Konto: höchstens so viele Fehlversuche … */
export const LOGIN_ACCOUNT_FAILS = 10;
/** … im Fenster von 15 Minuten. */
export const LOGIN_ACCOUNT_WINDOW_SEC = 15 * 60;
