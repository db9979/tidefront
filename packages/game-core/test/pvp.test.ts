// Spieler gegen Spieler (docs/VORLAGE-PVP.md): Kopfgeld, Mutfaktor, Paarbremse, Absprache-Sperre, Anfängerschutz-Ende.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bountyRankOf,
  createProtection,
  endBeginnerProtection,
  isBeginnerProtected,
  mutFactor,
  pairFactor,
  pairIndexes,
  pairKey,
  planMission,
  protectionStatus,
  pvpOf,
  pvpStamp,
  stampFactors,
  type MissionInput,
} from "../src/index.ts";
import { DAY, HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const b = pvpOf(balance)!;
const stamp = (attackerRank: number | null, defenderRank: number | null, attackerPoints: number, defenderPoints: number, collusion = false) =>
  pvpStamp({ day: "2026-11-27", attackerRank, defenderRank, attackerPoints, defenderPoints, collusion }, b);

test("Balance: Block pvp mit den freigegebenen Startwerten", () => {
  assert.deepEqual(b.bountyByRank, [0.5, 0.35, 0.2]);
  assert.equal(b.bountyDefenseFactor, 0.5);
  assert.equal(b.mutMin, 0.5);
  assert.equal(b.mutMax, 1.5);
  assert.equal(b.maxFactor, 2);
  assert.equal(b.pairWindowHours, 72);
  assert.deepEqual(b.pairFactors, [1, 0.5, 0.25, 0]);
  assert.equal(b.collusionDays, 7);
  assert.equal(b.beginnerEndsOnPlayerRaid, true);
});

test("Kopfgeld: Rang 1/2/3 +50/35/20 %, nur für schlechter Platzierte, nur auf Kampfpunkte", () => {
  assert.equal(stamp(5, 1, 3000, 3500).bountyFactor, 1.5);
  assert.equal(stamp(5, 2, 3000, 3500).bountyFactor, 1.35);
  assert.equal(stamp(5, 3, 3000, 3500).bountyFactor, 1.2);
  assert.equal(stamp(5, 4, 3000, 3500).bountyFactor, 1, "Rang 4 ohne Kopfgeld");
  assert.equal(stamp(null, 1, 0, 3500).bountyFactor, 1.5, "ohne Rang (neu) gilt als schlechter platziert");
  // Angreifer besser oder gleich platziert: kein Kopfgeld, keine halbe Abwehr.
  assert.equal(bountyRankOf(1, 2, 3000, b), null);
  assert.equal(bountyRankOf(2, 2, 3000, b), null);
  // Ziel ohne Punkte (Saisonbeginn, alle Rang 1): kein Kopfgeld.
  assert.equal(bountyRankOf(1, 1, 0, b), null);
  assert.equal(stamp(4, 1, 0, 0).bountyRank, null);
  // Faktoren: Kopfgeld × Mut auf Kampf, Beute nur × Mut, Verteidigung des Kopfgeld-Ziels × 0,5.
  const f = stampFactors(stamp(5, 1, 3500, 3500), b);
  assert.equal(f.kampf, 1.5);
  assert.equal(f.beute, 1);
  assert.equal(f.defense, 0.5);
  // Ohne Stempel (alter Bericht) oder ohne Balance-Block: alles 1.
  assert.deepEqual(stampFactors(null, b), { kampf: 1, beute: 1, defense: 1 });
  assert.deepEqual(stampFactors(stamp(5, 1, 3500, 3500), null), { kampf: 1, beute: 1, defense: 1 });
});

test("Mutfaktor √(Ziel/Angreifer), 0,5 … 1,5; zusammen mit Kopfgeld höchstens × 2", () => {
  assert.ok(approx(mutFactor(2000, 1000, b), Math.SQRT2));
  assert.ok(approx(mutFactor(500, 1000, b), Math.sqrt(0.5)));
  assert.equal(mutFactor(200, 1000, b), 0.5, "unter einem Viertel");
  assert.equal(mutFactor(9000, 1000, b), 1.5);
  assert.equal(mutFactor(1000, 1000, b), 1);
  assert.equal(mutFactor(1000, 0, b), 1.5, "Angreifer ohne Punkte");
  assert.equal(mutFactor(0, 0, b), 1);
  // Rang 1 und dreimal so stark: 1,5 × 1,5 = 2,25 → 2; Beute bleibt × 1,5.
  const f = stampFactors(stamp(9, 1, 1000, 3000), b);
  assert.equal(f.kampf, 2);
  assert.equal(f.beute, 1.5);
  // Vorlage, Tag 28: gleich starker Fehlschlag gegen Rang 1 – Angreifer 563 × 1,5 ≈ 845, Spitze 877 × 0,5 ≈ 439.
  const g = stampFactors(stamp(2, 1, 3430, 3430), b);
  assert.equal(Math.round(563 * g.kampf), 845);
  assert.equal(Math.round(877 * g.defense), 439);
});

test("Absprache-Sperre: kein Kopfgeld und Mutfaktor höchstens 1, halbe Abwehr der Spitze bleibt", () => {
  const s = stamp(5, 1, 1000, 4000, true);
  assert.equal(s.collusion, true);
  assert.equal(s.bountyFactor, 1);
  assert.equal(s.mut, 1, "Mut 2 → 1");
  assert.equal(s.bountyRank, 1, "Ziel bleibt Kopfgeld-Ziel: Verteidigung zählt halb (kein Punkteschieben zur Spitze)");
  const f = stampFactors(s, b);
  assert.deepEqual(f, { kampf: 1, beute: 1, defense: 0.5 });
  // Nach unten wirkt der Mutfaktor auch bei Absprache.
  assert.equal(stamp(1, 9, 4000, 250, true).mut, 0.5);
});

test("Paarbremse: 1 / 0,5 / 0,25 / 0 innerhalb 72 h, beide Richtungen, Fenster gleitet", () => {
  assert.deepEqual([0, 1, 2, 3, 7].map((n) => pairFactor(n, b)), [1, 0.5, 0.25, 0, 0]);
  assert.equal(pairFactor(5, null), 1);
  const k = pairKey(7, 3);
  assert.equal(k, pairKey(3, 7), "unabhängig von der Richtung");
  const fights = [
    { id: 1, atMs: T0, pairs: [k] },
    { id: 2, atMs: T0 + 10 * HOUR, pairs: [k] },
    { id: 3, atMs: T0 + 20 * HOUR, pairs: [k] },
    { id: 4, atMs: T0 + 30 * HOUR, pairs: [k] },
    { id: 5, atMs: T0 + 71 * HOUR, pairs: [k] },
    // Nach 72 h fallen die ersten Kämpfe aus dem Fenster.
    { id: 6, atMs: T0 + 95 * HOUR, pairs: [k] },
    { id: 7, atMs: T0 + 200 * HOUR, pairs: [k] },
    // Anderes Paar: eigene Zählung.
    { id: 8, atMs: T0 + 21 * HOUR, pairs: [pairKey(3, 9)] },
  ];
  const idx = pairIndexes(fights, b.pairWindowHours * HOUR);
  const n = (id: number, key = k) => idx.get(id)!.get(key)!;
  assert.deepEqual([1, 2, 3, 4, 5].map((id) => n(id)), [0, 1, 2, 3, 4]);
  assert.equal(n(6), 2, "95 h: nur die Kämpfe nach 23 h zählen (30 h, 71 h)");
  assert.equal(n(7), 0);
  assert.equal(n(8, pairKey(3, 9)), 0);
  assert.deepEqual([1, 2, 3, 4].map((id) => pairFactor(n(id), b)), [1, 0.5, 0.25, 0]);
  // Unsortierte Eingabe und gleiche Zeit: Reihenfolge nach id.
  const same = pairIndexes([{ id: 12, atMs: T0, pairs: [k] }, { id: 11, atMs: T0, pairs: [k] }], 72 * HOUR);
  assert.equal(same.get(11)!.get(k), 0);
  assert.equal(same.get(12)!.get(k), 1);
  // Höchstens 1 + 0,5 + 0,25 = 1,75 gewertete Überfälle je 72 h.
  const daily = pairIndexes([0, 1, 2, 3, 4, 5].map((i) => ({ id: i + 1, atMs: T0 + i * 12 * HOUR, pairs: [k] })), 72 * HOUR);
  const sum = [...daily.values()].reduce((s, m) => s + pairFactor(m.get(k)!, b), 0);
  assert.equal(sum, 1.75);
});

test("Anfängerschutz endet beim eigenen Überfall auf einen Spielerhafen (nicht bei Nestern), Kolonien erben das", () => {
  const p = createProtection(T0);
  assert.equal(isBeginnerProtected(p, T0 + DAY, balance), true);
  const ended = endBeginnerProtection(p, T0 + DAY, balance);
  assert.equal(ended.beginnerEndedAtMs, T0 + DAY);
  assert.equal(isBeginnerProtected(ended, T0 + DAY, balance), false);
  assert.equal(protectionStatus(ended, T0 + DAY, balance).reason === "anfaengerschutz", false);
  // Ohne laufenden Anfängerschutz bleibt alles, wie es ist.
  const old = createProtection(T0 - 30 * DAY);
  assert.equal(endBeginnerProtection(old, T0, balance).beginnerEndedAtMs, undefined);

  const base = makeBase(balance, { units: { korvette: 2 }, resources: { treibstoff: 1e6 } });
  base.protection = createProtection(T0);
  const input: MissionInput = { type: "ueberfall", units: { korvette: 1 }, origin: { lat: 0, lon: 0 }, target: { lat: 0, lon: 1 }, activeMissions: 0 };
  const nest = planMission(base, input, T0 + HOUR, balance);
  assert.ok(nest.ok);
  assert.equal(isBeginnerProtected(nest.base.protection, T0 + HOUR, balance), true, "Nest: Schutz bleibt");
  const target = createProtection(T0 - 30 * DAY);
  const raid = planMission(base, { ...input, targetProtection: target, playerHarbor: true }, T0 + HOUR, balance);
  assert.ok(raid.ok);
  assert.equal(raid.base.protection.beginnerEndedAtMs, T0 + HOUR);
  assert.equal(isBeginnerProtected(raid.base.protection, T0 + 2 * HOUR, balance), false);
  // Aufklärung eines Spielerhafens beendet nichts.
  const scout = planMission(base, { ...input, type: "aufklaerung", targetProtection: target, playerHarbor: true }, T0 + HOUR, balance);
  assert.ok(scout.ok);
  assert.equal(scout.base.protection.beginnerEndedAtMs, undefined);
});
