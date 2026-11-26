// See: Minen, Blockade und Konvois (naval.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockadeCheck,
  blockadeHours,
  cargoValue,
  cartelChance,
  cartelConvoyForce,
  cartelRoll,
  convoyPlunder,
  layStrength,
  mineLossShare,
  mineSeed,
  mineTransit,
  routeCrossesField,
  splitCargo,
  sweepPower,
  sweeperShield,
} from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();

test("Minen: Legen und Räumen nach Schiffstyp", () => {
  assert.equal(layStrength({ minenleger: 2, korvette: 3 }, balance), 2 * balance.units.minenleger.mineLayer!);
  assert.equal(sweepPower({ minenraeumer: 3 }, balance), 3 * balance.units.minenraeumer.mineSweeper!);
  assert.equal(sweeperShield({ korvette: 4 }, balance), 0);
  assert.ok(sweeperShield({ korvette: 4, minenraeumer: 1 }, balance) > 0);
  assert.ok(sweeperShield({ minenraeumer: 10 }, balance) <= balance.mines!.maxShield);
});

test("Minen: Verlustanteil steigt mit der Stärke, U-Boote und Räumer leiden weniger", () => {
  const k = mineLossShare("korvette", 50, 0, balance);
  assert.ok(k > 0 && k < mineLossShare("korvette", 100, 0, balance));
  assert.ok(mineLossShare("uboot", 100, 0, balance) < mineLossShare("korvette", 100, 0, balance));
  assert.ok(mineLossShare("minenraeumer", 100, 0, balance) < mineLossShare("korvette", 100, 0, balance));
  assert.equal(mineLossShare("korvette", 1e9, 0, balance), balance.mines!.maxLossShare);
  assert.ok(mineLossShare("korvette", 100, 0.5, balance) < k * 2.01);
});

test("Minen: Durchfahrt ist deterministisch, trifft nur Schiffe, Truppen ohne Platz gehen unter", () => {
  const units = { landungsschiff: 10, schuetzen: 1000, korvette: 20, jagdbomber: 5 };
  const a = mineTransit(units, 150, balance, 42);
  const b = mineTransit(units, 150, balance, 42);
  assert.deepEqual(a, b);
  assert.equal(a.survivors.jagdbomber, 5);
  assert.ok(a.hits > 0);
  assert.ok((a.losses.landungsschiff ?? 0) > 0);
  const space = (a.survivors.landungsschiff ?? 0) * balance.units.landungsschiff.troopSpace!;
  assert.ok((a.survivors.schuetzen ?? 0) <= space);
  assert.equal(a.consumed, a.hits * balance.mines!.strengthPerHit);
  // Mit Minenräumern weniger Verluste (Erwartung über viele Seeds).
  let plain = 0, swept = 0;
  for (let s = 1; s <= 200; s++) {
    plain += mineTransit({ korvette: 20 }, 100, balance, s).hits;
    swept += mineTransit({ korvette: 20, minenraeumer: 5 }, 100, balance, s).losses.korvette ?? 0;
  }
  assert.ok(swept < plain * 0.7, `${swept} < ${plain}`);
  assert.notEqual(mineSeed(1, 2), mineSeed(2, 1));
});

test("Minen: Route kreuzt Feld nur in der Nähe", () => {
  const a = { lat: 54, lon: 5 }, b = { lat: 54, lon: 10 };
  assert.ok(routeCrossesField(a, b, { lat: 54.1, lon: 7 }, balance));
  assert.ok(!routeCrossesField(a, b, { lat: 55.5, lon: 7 }, balance));
});

test("Blockade: nur bewaffnete Schiffe mit genug Kommandopunkten", () => {
  assert.equal(blockadeCheck({ korvette: 1 }, balance).ok, false);
  assert.deepEqual(blockadeCheck({ korvette: 4, schuetzen: 1 }, balance), { ok: false, code: "blockade_ships_only" });
  assert.equal(blockadeCheck({ korvette: 4 }, balance).ok, true);
  assert.equal(blockadeHours(100, balance), balance.blockade!.maxHours);
  assert.equal(blockadeHours(0, balance), balance.blockade!.minHours);
});

test("Konvois: Kartellchance begrenzt, Würfel deterministisch, Ladung teilen", () => {
  const c = balance.convoys!;
  assert.equal(cartelChance(50, 10000, balance), 0);
  assert.ok(cartelChance(400, 2000, balance) > 0);
  assert.equal(cartelChance(5000, 1e7, balance), c.cartelMaxChance);
  assert.deepEqual(cartelRoll(7, 600, 5000, balance), cartelRoll(7, 600, 5000, balance));
  let hits = 0;
  for (let s = 1; s <= 2000; s++) hits += cartelRoll(s, 600, 5000, balance).hit ? 1 : 0;
  const p = cartelChance(600, 5000, balance);
  assert.ok(Math.abs(hits / 2000 - p) < 0.03, `${hits / 2000} ~ ${p}`);
  assert.equal(cargoValue({ stahl: 1000, elektronik: 100 }, balance), 1000 * balance.market.refPrice.stahl + 100 * balance.market.refPrice.elektronik);
  assert.ok(cartelConvoyForce(0, balance).schnellboot === c.cartelMinBoats);
  assert.ok(cartelConvoyForce(1e9, balance).schnellboot === c.cartelMaxBoats);
  const s = splitCargo({ stahl: 1001 }, 0.3);
  assert.deepEqual(s, { lost: { stahl: 300 }, kept: { stahl: 701 } });
  assert.deepEqual(convoyPlunder({ stahl: 1000, proviant: 1000 }, 600, balance), { stahl: 300, proviant: 300 });
});
