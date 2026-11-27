// TE-04: LiveHub – kein Leck, wenn der Client während der Sitzungsprüfung trennt; Neuprüfung; Obergrenze je Spieler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveHub, type LiveSocket } from "../src/live-sockets.ts";

class FakeSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closedWith: number | null = null;
  private onClose: (() => void)[] = [];
  send(s: string) { this.sent.push(s); }
  close(code?: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code ?? 1000;
    for (const f of this.onClose) f();
  }
  on(_e: "close", fn: () => void) { this.onClose.push(fn); }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("Trennen während der Sitzungsprüfung: nichts bleibt registriert", async () => {
  let release!: (id: number | null) => void;
  const hub = new LiveHub({ validate: () => new Promise((r) => { release = r; }) });
  const s = new FakeSocket();
  const p = hub.attach(s, "tok");
  s.close(1001); // Client geht, bevor die DB antwortet
  release(7);
  assert.equal(await p, false);
  assert.equal(hub.count(), 0);
  assert.equal(s.sent.length, 0);
});

test("Gültige Sitzung: hello, Meldungen, beim Schließen aufgeräumt", async () => {
  const hub = new LiveHub({ validate: async () => 7, pingMs: 60_000, recheckMs: 60_000 });
  const s = new FakeSocket();
  assert.equal(await hub.attach(s, "tok"), true);
  assert.equal(hub.count(7), 1);
  assert.match(s.sent[0], /"hello"/);
  hub.publish([7], "a");
  hub.publish([8], "b");
  hub.publish(null, "c");
  assert.deepEqual(s.sent.slice(1), ["a", "c"]);
  s.close();
  assert.equal(hub.count(), 0);
});

test("Ungültige Sitzung: 4401, nicht registriert", async () => {
  const hub = new LiveHub({ validate: async () => null });
  const s = new FakeSocket();
  assert.equal(await hub.attach(s, undefined), false);
  assert.equal(s.closedWith, 4401);
  assert.equal(hub.count(), 0);
});

test("Höchstens maxPerPlayer Sockets je Spieler: der älteste wird geschlossen", async () => {
  const hub = new LiveHub({ validate: async () => 3, maxPerPlayer: 2, pingMs: 60_000, recheckMs: 60_000 });
  const a = new FakeSocket(), b = new FakeSocket(), c = new FakeSocket();
  await hub.attach(a, "t");
  await hub.attach(b, "t");
  await hub.attach(c, "t");
  assert.equal(a.closedWith, 4408);
  assert.equal(hub.count(3), 2);
  for (const s of [b, c]) s.close();
  assert.equal(hub.count(), 0);
});

test("Neuprüfung: abgemeldete Sitzung wird getrennt; DB-Fehler trennt nicht", async () => {
  let valid: number | null | "err" = 5;
  const hub = new LiveHub({
    validate: async () => { if (valid === "err") throw new Error("db"); return valid; },
    pingMs: 60_000, recheckMs: 20,
  });
  const s = new FakeSocket();
  await hub.attach(s, "t");
  valid = "err";
  await tick(50);
  assert.equal(s.closedWith, null);
  valid = null;
  await tick(50);
  assert.equal(s.closedWith, 4401);
  assert.equal(hub.count(), 0);
});
