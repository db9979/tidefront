// Lagebild (Stufe 1): Radarreichweite mit Strom, Nebel und Sabotage, Ausguck, Kenntnisstufen, Alter, Größenklassen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atLeast, fleetSize, headingDeg, intelAge, liveLevelAt, maxLevel, radarRangeKm, roundCounts, roundForRecognition,
  visibleUnitCount, type IntelBalance,
} from "../src/index.ts";
import balanceJson from "../../balance/v1/balance.json" with { type: "json" };

const ib = (balanceJson as unknown as { intel: IntelBalance }).intel;
const clear = { powerServed: 1, fogFactor: 1, sabotaged: false };

test("Balance v1.17: Block intel mit den Startwerten des Regelwerks", () => {
  assert.equal((balanceJson as { version: string }).version, "v1.17");
  assert.equal(ib.lookoutKm, 120);
  assert.equal(ib.radarBaseKm + 10 * ib.radarKmPerLevel, 550);
  assert.equal(ib.staleHours, 24);
  assert.equal(ib.forgetHours, 72);
  assert.equal(ib.fleetMemoryHours, 2);
});

test("Radar: 150 km + 40 km je Stufe, ohne Station keine Reichweite", () => {
  assert.equal(radarRangeKm(0, ib, clear), 0);
  assert.equal(radarRangeKm(1, ib, clear), 190);
  assert.equal(radarRangeKm(5, ib, clear), 350);
  assert.equal(radarRangeKm(10, ib, clear), 550);
});

test("Radar: Strommangel halbiert, Nebel kürzt bis −30 %, Sabotage schaltet ab", () => {
  assert.equal(radarRangeKm(5, ib, { ...clear, powerServed: 0.6 }), 175);
  assert.equal(radarRangeKm(5, ib, { ...clear, powerServed: 0 }), 175);
  assert.equal(Math.round(radarRangeKm(5, ib, { ...clear, fogFactor: 0.7 })), 245);
  assert.equal(Math.round(radarRangeKm(5, ib, { ...clear, powerServed: 0.5, fogFactor: 0.7 }) * 10), 1225);
  assert.equal(radarRangeKm(10, ib, { ...clear, sabotaged: true }), 0);
});

test("Sicht: Ausguck erkennt alles, Radar erkennt Objekte und sichtet Verbände", () => {
  const sensors = [
    { kind: "ausguck" as const, x: 0, y: 0, km: 120 },
    { kind: "radar" as const, x: 0, y: 0, km: 350 },
  ];
  assert.equal(liveLevelAt(sensors, 100, 0, "fleet"), "erkennung");
  assert.equal(liveLevelAt(sensors, 200, 0, "fleet"), "sichtung");
  assert.equal(liveLevelAt(sensors, 200, 0, "object"), "erkennung");
  assert.equal(liveLevelAt(sensors, 300, 200, "object"), null);
  assert.equal(liveLevelAt([], 0, 0, "object"), null);
});

test("Kenntnisstufen: Lagebild > Erkennung > Sichtung", () => {
  assert.equal(maxLevel("sichtung", "erkennung"), "erkennung");
  assert.equal(maxLevel(null, "lagebild"), "lagebild");
  assert.ok(atLeast("lagebild", "erkennung"));
  assert.ok(!atLeast("sichtung", "erkennung"));
  assert.ok(!atLeast(null, "sichtung"));
});

test("Alter: bekannt < 24 h, veraltet bis 72 h, danach vergessen", () => {
  const h = 3600000;
  assert.equal(intelAge(0, 5 * h, ib), "bekannt");
  assert.equal(intelAge(0, 30 * h, ib), "veraltet");
  assert.equal(intelAge(0, 72 * h, ib), null);
});

test("Größenklassen: klein bis 10, mittel bis 40, groß darüber; U-Boote und Spione zählen nicht", () => {
  assert.equal(fleetSize(10, ib), "klein");
  assert.equal(fleetSize(11, ib), "mittel");
  assert.equal(fleetSize(41, ib), "gross");
  const defs = { uboot: { submerged: true }, spion: { covert: true }, korvette: {} };
  assert.equal(visibleUnitCount({ uboot: 30, korvette: 4, spion: 2 }, defs), 4);
  assert.equal(visibleUnitCount({ uboot: 30 }, defs), 0);
});

test("Erkennung rundet auf 5 (Anlagen auf 2), Kurs in Grad", () => {
  assert.equal(roundForRecognition(12, 5), 10);
  assert.equal(roundForRecognition(1, 5), 5);
  assert.equal(roundForRecognition(0, 5), 0);
  assert.deepEqual(roundCounts({ korvette: 13, schuetzen: 0 }, 5), { korvette: 15 });
  assert.equal(headingDeg({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  assert.equal(headingDeg({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
  assert.equal(headingDeg({ x: 0, y: 0 }, { x: 0, y: 10 }), 180);
});
