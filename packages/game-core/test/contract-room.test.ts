// TST-03: Vertragsgrenze vorab – contractWindowRoom liefert genau die größte Menge, die maxWindowLoad ≤ limit lässt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { market, mulberry32 } from "../src/index.ts";

const H = 3_600_000;

test("contractWindowRoom: leer = ganze Grenze, abgerundet", () => {
  assert.equal(market.contractWindowRoom([], 10 * H, 1687.5), 1687);
});

test("contractWindowRoom: nur Lieferungen im selben 24-h-Fenster zählen", () => {
  const pts = [{ atMs: 0, qty: 1000 }, { atMs: 30 * H, qty: 500 }];
  assert.equal(market.contractWindowRoom(pts, 10 * H, 1687), 687); // Fenster ab 0 h enthält 1000
  assert.equal(market.contractWindowRoom(pts, 25 * H, 1687), 1187); // Fenster ab 25 h enthält 500 (30 h)
  assert.equal(market.contractWindowRoom(pts, 50 * H, 1687), 1187); // Fenster ab 30 h enthält 500
  assert.equal(market.contractWindowRoom(pts, 60 * H, 1687), 1687);
});

test("contractWindowRoom stimmt mit maxWindowLoad überein (Zufallsprobe)", () => {
  const rnd = mulberry32(42);
  for (let i = 0; i < 300; i++) {
    const pts = Array.from({ length: Math.floor(rnd() * 6) }, () => ({ atMs: Math.floor(rnd() * 72) * H + Math.floor(rnd() * H), qty: Math.floor(rnd() * 900) }));
    const at = Math.floor(rnd() * 80 * H);
    const limit = 500 + rnd() * 2000;
    const room = market.contractWindowRoom(pts, at, limit);
    if (room > 0) assert.ok(market.maxWindowLoad(pts, [{ atMs: at, qty: room }]) <= limit, `room ${room} passt`);
    assert.ok(market.maxWindowLoad(pts, [{ atMs: at, qty: room + 1 }]) > limit, `room+1 passt nicht`);
  }
});
