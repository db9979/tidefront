// Einstieg: kleinster siegreicher Verband gegen ein Nest (raid-plan.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAID_PLAN_TARGET, extraNeeded, nestWinRate, smallestWinningRaid, troopsFit } from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();

test("troopsFit: Bodentruppen brauchen Platz auf Landungsschiffen", () => {
  assert.equal(troopsFit({ schuetzen: 30 }, balance), false);
  assert.equal(troopsFit({ landungsschiff: 1, schuetzen: 30 }, balance), true);
  assert.equal(troopsFit({ korvette: 3 }, balance), true);
});

test("smallestWinningRaid: Teilmenge, erreicht das Ziel, Truppen passen; zu schwach → alles, nicht genug", () => {
  const full = { korvette: 6, landungsschiff: 3, schuetzen: 120 };
  const p = smallestWinningRaid(full, 1, balance);
  assert.equal(p.enough, true);
  assert.ok(p.winRate! >= RAID_PLAN_TARGET);
  assert.ok(troopsFit(p.units, balance));
  for (const [id, n] of Object.entries(p.units)) assert.ok(n <= full[id as keyof typeof full]);
  assert.ok((p.units.schuetzen ?? 0) < 120 && (p.units.landungsschiff ?? 0) <= 1);
  // Deterministisch: gleiche Eingabe, gleicher Vorschlag.
  assert.deepEqual(smallestWinningRaid(full, 1, balance), p);

  const weak = smallestWinningRaid({ landungsschiff: 1, schuetzen: 10 }, 1, balance);
  assert.equal(weak.enough, false);
  assert.deepEqual(weak.units, { landungsschiff: 1, schuetzen: 10 });
  assert.equal(smallestWinningRaid({}, 1, balance).winRate, null);
  assert.equal(nestWinRate({ korvette: 1 }, 99, balance), null);
});

test("extraNeeded: wie viele Schützen fehlen", () => {
  const extra = extraNeeded({ korvette: 2, landungsschiff: 1, schuetzen: 20 }, "schuetzen", 1, balance);
  assert.ok(extra !== null && extra >= 5 && extra <= 15, String(extra));
  // Ohne Landungsschiff passt nichts dazu.
  assert.equal(extraNeeded({ korvette: 2 }, "schuetzen", 1, balance), null);
});
