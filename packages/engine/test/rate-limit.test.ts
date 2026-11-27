// API-Drosselung (apps/api/src/rate-limit.ts): trustProxy aus TRUST_PROXY, atomarer Zähler, Login-Sperre je Konto.
// Ohne Datenbank; Valkey durch einen Speicher im Arbeitsspeicher ersetzt (eval führt das INCR/EXPIRE-Skript nach).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_ACCOUNT_FAILS, LOGIN_ACCOUNT_WINDOW_SEC, TRUST_PROXY_DEFAULT, createRateLimiter, loginAccountBucket, parseTrustProxy, type RateStore,
} from "../../../apps/api/src/rate-limit.ts";

function memoryStore() {
  const data = new Map<string, { n: number; ttl: number }>();
  const store: RateStore & { data: typeof data; down: boolean } = {
    data,
    down: false,
    async eval(script, _numKeys, key, windowSec) {
      if (store.down) throw new Error("valkey weg");
      assert.match(script, /INCR/);
      assert.match(script, /EXPIRE/);
      const e = data.get(String(key)) ?? { n: 0, ttl: -1 };
      e.n++;
      if (e.n === 1 || e.ttl < 0) e.ttl = Number(windowSec);
      data.set(String(key), e);
      return e.n;
    },
    async get(key) {
      if (store.down) throw new Error("valkey weg");
      const e = data.get(key);
      return e ? String(e.n) : null;
    },
    async del(key) {
      return data.delete(key) ? 1 : 0;
    },
  };
  return store;
}

test("TRUST_PROXY: Vorgabe nur Loopback und private Netze, Liste, true/false", () => {
  assert.deepEqual(parseTrustProxy(undefined), ["loopback", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
  assert.deepEqual(parseTrustProxy(""), parseTrustProxy(TRUST_PROXY_DEFAULT));
  assert.deepEqual(parseTrustProxy(" 192.168.178.2 , loopback "), ["192.168.178.2", "loopback"]);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("TRUE"), true);
});

test("Rate-Limit: Zähler mit Ablauf im selben Schritt, ohne Valkey keine Sperre", async () => {
  const store = memoryStore();
  const { rateLimit } = createRateLimiter(store);
  for (let i = 0; i < 3; i++) assert.equal(await rateLimit("x", 3, 60), true);
  assert.equal(await rateLimit("x", 3, 60), false);
  assert.equal(store.data.get("tf:rl:x")?.ttl, 60);
  store.down = true;
  assert.equal(await rateLimit("x", 3, 60), true);
});

test("Login je Konto: nach 10 Fehlversuchen gesperrt, Erfolg setzt zurück, Groß/klein egal", async () => {
  const store = memoryStore();
  const { failures } = createRateLimiter(store);
  const acct = loginAccountBucket("  Kapitän ");
  assert.equal(acct, loginAccountBucket("kapitän"));
  for (let i = 0; i < LOGIN_ACCOUNT_FAILS - 1; i++) await failures.hit(acct, LOGIN_ACCOUNT_WINDOW_SEC);
  assert.equal(await failures.blocked(acct, LOGIN_ACCOUNT_FAILS), false);
  await failures.hit(acct, LOGIN_ACCOUNT_WINDOW_SEC);
  assert.equal(await failures.blocked(acct, LOGIN_ACCOUNT_FAILS), true);
  assert.equal(store.data.get(`tf:rl:${acct}`)?.ttl, 15 * 60);
  await failures.reset(acct);
  assert.equal(await failures.blocked(acct, LOGIN_ACCOUNT_FAILS), false);
});
