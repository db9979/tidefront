// Allianz-Ops: gemeinsame Streitmacht, Aufteilung nach Besitzer, Beute nach Kampfbeitrag.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allianceOpsOf,
  apportion,
  combatValue,
  combineForces,
  defenderFromBase,
  jointSchedule,
  resolveBattle,
  shareLoot,
  sharePercents,
  splitOutcome,
} from "../src/index.ts";
import { HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

test("Werte: allianceOps aus balance.json", () => {
  const o = allianceOpsOf(balance);
  assert.ok(o.station.maxPerBase >= 1);
  assert.ok(o.raid.minJoinMinutes > 0 && o.raid.maxJoinHours * 60 > o.raid.minJoinMinutes);
});

test("apportion: größte Reste, kleiner Index gewinnt den Gleichstand, Summe exakt", () => {
  assert.deepEqual(apportion(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(apportion(7, [2, 1]), [5, 2]);
  assert.deepEqual(apportion(0, [3, 4]), [0, 0]);
  assert.deepEqual(apportion(3, [0, 0]), [2, 1]);
  assert.equal(sum(Object.fromEntries(apportion(101, [3, 5, 7]).map((v, i) => [i, v]))), 101);
});

test("Beute nach Kampfbeitrag: Anteile nach Gewicht, Rundung deterministisch", () => {
  const loot = { stahl: 1000, treibstoff: 500, elektronik: 0, proviant: 1 };
  const r = shareLoot(loot, [3, 1], [1e9, 1e9], balance.resources);
  assert.equal(r[0].stahl, 750);
  assert.equal(r[1].stahl, 250);
  assert.equal(r[0].treibstoff + r[1].treibstoff, 500);
  // 1 Proviant: der größere Rest (Teilnehmer 0 mit 0,75) bekommt ihn.
  assert.equal(r[0].proviant, 1);
  assert.equal(r[1].proviant, 0);
  assert.deepEqual(shareLoot(loot, [3, 1], [1e9, 1e9], balance.resources), r);
});

test("Beute: Laderaumgrenze, Rest nach gleichem Schlüssel an die anderen", () => {
  const loot = { stahl: 6000, treibstoff: 0, elektronik: 0, proviant: 0 };
  // Gewichte 2:1:1, Teilnehmer 0 kann nur 1000 laden: die übrigen 5000 gehen je zur Hälfte an 1 und 2.
  const r = shareLoot(loot, [2, 1, 1], [1000, 1e9, 1e9], balance.resources);
  assert.deepEqual(r.map((x) => x.stahl), [1000, 2500, 2500]);
  // Alle voll: insgesamt höchstens die Summe der Laderäume.
  const full = shareLoot(loot, [2, 1, 1], [1000, 500, 700], balance.resources);
  assert.deepEqual(full.map((x) => x.stahl), [1000, 500, 700]);
  // Kein Laderaum: nichts.
  assert.equal(sum(shareLoot(loot, [1], [0], balance.resources)[0]), 0);
});

test("Beute: mehrere Ressourcen, nie über dem Laderaum, Summe nie über der Beute", () => {
  const loot = { stahl: 777, treibstoff: 333, elektronik: 101, proviant: 55 };
  for (const caps of [[100, 2000, 7], [1, 1, 1], [500, 500, 500], [1e9, 0, 3]]) {
    const r = shareLoot(loot, [5, 3, 2], caps, balance.resources);
    r.forEach((x, i) => assert.ok(sum(x) <= caps[i] + 1e-9, `cap ${i}`));
    for (const res of balance.resources) assert.ok(r.reduce((s, x) => s + (x[res] ?? 0), 0) <= (loot as Record<string, number>)[res]);
  }
  assert.deepEqual(sharePercents([1, 3]), [25, 75]);
});

test("Gemeinsamer Kampf: ein resolveBattle, Ergebnisse nach Besitzer exakt aufgeteilt", () => {
  const a = { units: { korvette: 3, landungsschiff: 1, schuetzen: 40 } };
  const b = { units: { korvette: 2, schuetzen: 20, landungsschiff: 1 }, modifiers: { attack: { see: 1.2 }, hp: { land: 1.1 } } };
  const joint = combineForces([a, b], balance);
  assert.deepEqual(joint.units, { korvette: 5, landungsschiff: 2, schuetzen: 60 });
  // Angriff je Typ nach Anzahl gemittelt: Korvetten 3×1 + 2×1,2 → 1,08.
  assert.ok(Math.abs((joint.modifiers!.attackUnit!.korvette ?? 0) - 1.08) < 1e-9);
  assert.equal(joint.unlimitedCargo, true);
  const base = makeBase(balance, {
    units: { schuetzen: 25, korvette: 1 },
    resources: { stahl: 20000, treibstoff: 9000, elektronik: 3000, proviant: 4000 },
    protection: { ...makeBase(balance).protection, createdAtMs: T0 - 30 * 24 * HOUR },
  });
  const res = resolveBattle(joint, defenderFromBase(base, balance), balance, 4242);
  assert.ok(res.ok);
  const parts = splitOutcome(res.report.attacker, [a.units, b.units]);
  for (const id of Object.keys(joint.units)) {
    assert.equal(parts[0].final[id] + (parts[1].final[id] ?? 0), res.report.attacker.final[id], id);
    assert.equal(parts[0].losses[id] + (parts[1].losses[id] ?? 0), res.report.attacker.losses[id], id);
    for (const p of parts) assert.ok((p.final[id] ?? 0) <= (p.before[id] ?? 0));
  }
  // Gleiche Eingabe, gleiches Ergebnis.
  const again = resolveBattle(combineForces([a, b], balance), defenderFromBase(base, balance), balance, 4242);
  assert.ok(again.ok);
  assert.deepEqual(again.report, res.report);
  // Beitrag: Kampfwert mit eigenen Modifikatoren.
  assert.ok(combatValue(b.units, balance, b.modifiers) > combatValue(b.units, balance));
});

test("Gleichzeitige Ankunft: langsamster bestimmt, nie vor Frist + Reise", () => {
  const s = jointSchedule(T0 + 2 * HOUR, T0 + HOUR, [30 * 60000, 3 * HOUR]);
  assert.equal(s.arriveAtMs, T0 + 4 * HOUR);
  assert.deepEqual(s.departAtMs, [T0 + 4 * HOUR - 30 * 60000, T0 + HOUR]);
  const t = jointSchedule(T0 + 10 * HOUR, T0 + HOUR, [HOUR]);
  assert.equal(t.arriveAtMs, T0 + 10 * HOUR);
});
