// Saisonfinale „Leviathan“: Zeitplan, Stärke, Zusammensetzung, Abschnitt je Angriff, Probekampf, Beute.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterSector,
  boatHp,
  composeFinale,
  finaleBalance,
  finaleLoot,
  finaleProbe,
  finaleSchedule,
  finaleSector,
  finaleStrength,
  finaleSunk,
  finaleTreasure,
  finaleWarHp,
  finaleWarUnits,
  forceHp,
  damageSharePct,
} from "../src/index.ts";
import { DAY, HOUR, T0, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const f = finaleBalance(balance)!;
const value = (m: Record<string, number>) => Object.entries(m).reduce((s, [r, v]) => s + v * (balance.market.refPrice[r] ?? 1), 0);

/** Verbände wie in der Vorlage (Spätspiel-Bot an Tag 38): stark K = 13 840, schwach K ≈ 7 900, halber starker. */
const STRONG = { korvette: 40, zerstoerer: 8, jagdbomber: 16 };
const WEAK = { korvette: 25, zerstoerer: 3, jagdbomber: 11 };
const HALF = { korvette: 20, zerstoerer: 4, jagdbomber: 8 };

test("Zeitplan: Tag 36 12:00 Ankündigung, Tag 38 12:00 Erscheinen, 72 h; andere Saisonlänge proportional, Ende vor Saisonende", () => {
  const s = finaleSchedule(T0, T0 + 42 * DAY, balance);
  assert.equal(s.announceMs, T0 + 35 * DAY + 12 * HOUR);
  assert.equal(s.appearMs, T0 + 37 * DAY + 12 * HOUR);
  assert.equal(s.endMs, s.appearMs + 72 * HOUR);
  assert.ok(s.endMs < T0 + 42 * DAY);
  const half = finaleSchedule(T0, T0 + 21 * DAY, balance);
  assert.equal(half.announceMs - T0, (s.announceMs - T0) / 2);
  assert.equal(half.endMs - half.appearMs, 36 * HOUR);
  assert.ok(half.endMs < T0 + 21 * DAY);
});

test("Stärke: 4 × Σ K, mindestens 40 000 LP, mal Kartellstärke; 90 % Geschwader, 10 % Flaggschiff in Sektionen zu 1 000 LP", () => {
  assert.equal(finaleWarHp({ ...STRONG, landungsschiff: 5, schuetzen: 100, kolonieschiff: 1, minenleger: 2 }, balance), 13840);
  assert.deepEqual(finaleWarUnits({ korvette: 1, landungsschiff: 1, schuetzen: 3 }, balance), { korvette: 1 });
  assert.equal(finaleStrength(1000, 100, balance), f.minHp);
  assert.equal(finaleStrength(77000, 100, balance), 308000);
  assert.equal(finaleStrength(77000, 50, balance), 154000);
  assert.equal(boatHp(balance), 240);
  const u = composeFinale(308000, balance);
  assert.equal(u.schnellboot, Math.round((0.9 * 308000) / 240));
  assert.equal(u.piratenmiliz, u.schnellboot * 8);
  assert.equal(u.flaggschiff, 31);
  assert.ok(Math.abs(forceHp(u, balance) - 308000) < 1000);
});

test("Abschnitt: 0,5 × K des Verbands in Schnellbooten (mindestens 4, höchstens der Rest); ohne Geschwader das Flaggschiff", () => {
  const units = composeFinale(308000, balance);
  const s = finaleSector(units, 13840, balance);
  assert.equal(s.flagship, false);
  assert.equal(s.defender.schnellboot, Math.round((0.5 * 13840) / 80)); // 87 Boote ≈ 20 900 LP
  assert.equal(s.defender.piratenmiliz, 87 * 8);
  assert.equal(finaleSector(units, 100, balance).defender.schnellboot, 4, "mindestens 4");
  assert.deepEqual(finaleSector({ schnellboot: 10, piratenmiliz: 80, flaggschiff: 30 }, 13840, balance).defender, { schnellboot: 10, piratenmiliz: 80 });
  const flag = finaleSector({ flaggschiff: 30 }, 13840, balance);
  assert.deepEqual(flag, { defender: { flaggschiff: 30 }, flagship: true });
  // Rest nach dem Kampf: Verluste bleiben, Miliz ohne Boote verschwindet.
  assert.deepEqual(afterSector({ schnellboot: 100, piratenmiliz: 800, flaggschiff: 30 }, { schnellboot: 87, piratenmiliz: 696 }, {}), { schnellboot: 13, piratenmiliz: 104, flaggschiff: 30 });
  assert.deepEqual(afterSector({ schnellboot: 4, piratenmiliz: 32, flaggschiff: 3 }, { schnellboot: 4, piratenmiliz: 32 }, {}), { flaggschiff: 3 });
  assert.equal(finaleSunk({ flaggschiff: 1 }), false);
  assert.equal(finaleSunk({ piratenmiliz: 3 }), true);
});

test("Sieg auch für schwache und halbe Verbände: jeder gewinnt seinen Abschnitt in allen Probeläufen", () => {
  const units = composeFinale(400000, balance);
  for (const [name, force] of Object.entries({ STRONG, WEAK, HALF })) {
    const k = finaleWarHp(force, balance);
    const sector = finaleSector(units, k, balance).defender;
    const p = finaleProbe({ units: force }, sector, balance, 40);
    assert.equal(p.winRate, 1, `${name} (K ${k}) gegen ${sector.schnellboot} Boote`);
    // Schaden ≈ 1,5 × K (Boote mit Miliz).
    assert.ok(Math.abs(p.damageHp - 1.5 * k) < 0.05 * k, `${name}: Schaden ${p.damageHp} ≈ 1,5 × ${k}`);
  }
  // Das Flaggschiff (30 Sektionen) versenkt ein starker Verband allein nicht.
  assert.ok(finaleProbe({ units: STRONG }, { flaggschiff: 30 }, balance, 20).winRate < 0.5);
});

test("Beute: lootPerHp Richtwert je vernichtetem LP in der Mischung der Großflotte; Schatz 5 % von H; Anteil in Prozent", () => {
  const loot = finaleLoot(20000, balance);
  const perHp = (balance as unknown as { worldEvents: { finale: { lootPerHp: number } } }).worldEvents.finale.lootPerHp;
  assert.ok(Math.abs(value(loot) - perHp * 20000) < 10, `Wert ${value(loot)}`);
  assert.ok(Math.abs(loot.stahl / loot.treibstoff - 2) < 0.01, "Mischung 5000 : 2500");
  const t = finaleTreasure(300000, balance);
  assert.ok(Math.abs(value(t) - 0.05 * 300000) < 10);
  assert.equal(damageSharePct(150, 1000), 15);
  assert.equal(damageSharePct(1, 0), 0);
});
