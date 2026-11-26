// Felder: Höchstzahl, abnehmender Ertrag, Besatzung, Zonen, Kartellwürfel, Kandidatenliste.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cartelFieldRaid, fieldUpkeep, fieldYield, fieldZones, fieldsOf, garrisonCheck, guardOf, maxFieldsFor, splitGarrison, yieldFactor,
} from "../src/index.ts";
import { fieldSites, hexDistanceKm, terrainAt } from "@tidefront/world";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const f = fieldsOf(balance)!;

test("Höchstzahl nach Hafenkommandantur: 0 ohne, 1 + 1 je 4 Stufen, höchstens 5", () => {
  assert.equal(maxFieldsFor(0, balance), 0);
  assert.equal(maxFieldsFor(1, balance), 1);
  assert.equal(maxFieldsFor(4, balance), 2);
  assert.equal(maxFieldsFor(10, balance), 3);
  assert.equal(maxFieldsFor(20, balance), 5);
});

test("Ertrag: Rang senkt, Zone hebt, Unterhalt je Stufe", () => {
  assert.equal(yieldFactor(0, balance), 1);
  assert.equal(yieldFactor(9, balance), f.yieldFactors[f.yieldFactors.length - 1]);
  const one = fieldYield("erzbucht", 1, 4, 0, false, balance).stahl!;
  assert.equal(one, f.kinds.erzbucht.yieldPerHour[0] * 4);
  assert.ok(fieldYield("erzbucht", 1, 4, 2, false, balance).stahl! < one);
  assert.equal(fieldYield("erzbucht", 1, 4, 0, true, balance).stahl, Math.floor(one * (1 + f.zoneBonus)));
  assert.equal(fieldUpkeep(2, 2, balance), f.upkeepProviantPerHour[1] * 2);
});

test("Besatzung: nur Schiffe, bewaffnet, Mindest-Kommandopunkte; Teilung lässt die kleinste Besatzung", () => {
  assert.equal(garrisonCheck({ korvette: 2, schuetzen: 5 }, balance).ok, false);
  assert.equal(garrisonCheck({ korvette: 1 }, balance).ok, false);
  assert.equal(garrisonCheck({ landungsschiff: 1 }, balance).ok, false);
  assert.equal(garrisonCheck({ korvette: 2 }, balance).ok, true);
  const s = splitGarrison({ zerstoerer: 4, korvette: 3, landungsschiff: 1 }, false, balance)!;
  assert.deepEqual(s.garrison, { korvette: 2 });
  assert.deepEqual(s.rest, { zerstoerer: 4, korvette: 1, landungsschiff: 1 });
  assert.deepEqual(splitGarrison({ zerstoerer: 4 }, true, balance)!.garrison, { zerstoerer: 4 });
  assert.equal(splitGarrison({ korvette: 1 }, false, balance), null);
});

test("Zonen: verbundene Felder derselben Allianz, Bonus ab zoneMinFields", () => {
  const p = (lon: number) => ({ lat: 50, lon });
  const z = fieldZones([
    { id: 1, allianceId: 7, at: p(0) }, { id: 2, allianceId: 7, at: p(4) }, { id: 3, allianceId: 7, at: p(8) },
    { id: 4, allianceId: 8, at: p(2) }, { id: 5, allianceId: 7, at: p(30) }, { id: 6, allianceId: null, at: p(1) },
  ], balance);
  assert.equal(z.get(3)!.zone, 1);
  assert.equal(z.get(1)!.bonus, true);
  assert.equal(z.get(5)!.size, 1);
  assert.equal(z.get(4)!.bonus, false);
  assert.equal(z.has(6), false);
});

test("Kartellwürfel deterministisch, Chance etwa wie in der Balance; Wache nach Stufe", () => {
  assert.deepEqual(cartelFieldRaid(2, 42, balance), cartelFieldRaid(2, 42, balance));
  let hits = 0;
  for (let s = 1; s <= 4000; s++) if (cartelFieldRaid(1, s, balance)) hits++;
  assert.ok(Math.abs(hits / 4000 - f.cartelRaidChance) < 0.02, String(hits));
  assert.ok((guardOf(3, balance).schnellboot ?? 0) > (guardOf(1, balance).schnellboot ?? 0));
});

test("Kandidaten: nur See, Abstand gewahrt, gleiche Liste bei gleichem Seed", () => {
  const kinds = Object.fromEntries(Object.entries(f.kinds).map(([k, v]) => [k, v.share]));
  const a = fieldSites(f.siteSeed, kinds, f.tierShares);
  assert.ok(a.length >= f.count * 2, String(a.length));
  for (const s of a.slice(0, 80)) assert.equal(terrainAt(s.col, s.row), "sea");
  for (let i = 0; i < 40; i++) for (let j = i + 1; j < 40; j++) assert.ok(hexDistanceKm(a[i], a[j]) >= 230);
  assert.deepEqual(fieldSites(f.siteSeed, { ...kinds }, [...f.tierShares]).slice(0, 5), a.slice(0, 5));
  assert.ok(new Set(a.map((s) => s.kind)).size === 4);
});
