import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, randomFactor, randomInt } from "../src/index.ts";

test("gleicher Seed, gleiche Folge; anderer Seed, andere Folge", () => {
  const a = mulberry32(123);
  const b = mulberry32(123);
  const c = mulberry32(124);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  const seqC = Array.from({ length: 20 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test("bekannte Referenzwerte von mulberry32", () => {
  const r = mulberry32(1);
  assert.equal(r(), 0.6270739405881613);
  assert.equal(r(), 0.002735721180215478);
});

test("Werte in [0, 1), Faktor in [1-s, 1+s], Ganzzahlen im Bereich", () => {
  const r = mulberry32(99);
  let sum = 0;
  for (let i = 0; i < 5000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
    sum += v;
    const f = randomFactor(r, 0.05);
    assert.ok(f >= 0.95 && f <= 1.05);
    const n = randomInt(r, 3, 7);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 7);
  }
  assert.ok(Math.abs(sum / 5000 - 0.5) < 0.03);
  assert.equal(randomFactor(mulberry32(5), 0), 1);
});
