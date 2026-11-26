import { test } from "node:test";
import assert from "node:assert/strict";
import type { AttackerInput, BattleReport, Counts, DefenderInput } from "../src/index.ts";
import { PHASE_NAMES, computeLoot, mulberry32, nestDefender, randomInt, resolveBattle } from "../src/index.ts";
import { approx, loadBalance } from "./helpers.ts";

const balance = loadBalance();

function fight(attacker: AttackerInput, defender: DefenderInput, seed = 1): BattleReport {
  const res = resolveBattle(attacker, defender, balance, seed);
  assert.ok(res.ok, "resolveBattle muss gelingen");
  return res.report;
}

function nest(level: number): DefenderInput {
  const d = nestDefender(level, balance);
  assert.ok(d.ok);
  return d.defender;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const strongFleet: Counts = { zerstoerer: 5, korvette: 4, landungsschiff: 2, kampfpanzer: 10, schuetzen: 80, pioniere: 20 };
const noDefender: DefenderInput = { units: {}, defenses: {} };
const zeroLoot = { stahl: 0, treibstoff: 0, elektronik: 0, proviant: 0 };

test("Determinismus: gleicher Seed, gleiche Eingabe, identischer Bericht", () => {
  const a = fight({ units: strongFleet }, nest(3), 12345);
  const b = fight({ units: { ...strongFleet } }, nest(3), 12345);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("anderer Seed darf abweichen", () => {
  const reference = JSON.stringify({ ...fight({ units: strongFleet }, nest(3), 1), seed: 0 });
  let different = 0;
  for (let seed = 2; seed <= 11; seed++) {
    if (JSON.stringify({ ...fight({ units: strongFleet }, nest(3), seed), seed: 0 }) !== reference) different++;
  }
  assert.ok(different > 0);
});

test("Eingaben bleiben unverändert", () => {
  const attacker: AttackerInput = { units: { ...strongFleet, jagdbomber: 3, abfangjaeger: 2 }, priorAttacksInWindow: 0 };
  const defender: DefenderInput = {
    units: { korvette: 6, schuetzen: 50, abfangjaeger: 2 },
    defenses: { kuestenbatterie: 2, flakstellung: 2, bunkerlinie: 1, minensperre: 2 },
    resources: { stahl: 5000, treibstoff: 5000, elektronik: 5000, proviant: 5000 },
    protectedPerResource: 300,
  };
  const balanceBefore = JSON.stringify(balance);
  const attackerBefore = JSON.stringify(attacker);
  const defenderBefore = JSON.stringify(defender);
  deepFreeze(attacker);
  deepFreeze(defender);
  const report = fight(attacker, defender, 99);
  assert.equal(JSON.stringify(attacker), attackerBefore);
  assert.equal(JSON.stringify(defender), defenderBefore);
  assert.equal(JSON.stringify(balance), balanceBefore);
  assert.deepEqual(report.attacker.before, attacker.units);
});

test("Bericht: vier Phasen in fester Reihenfolge mit Beständen und Schlüssel entscheidend", () => {
  const report = fight({ units: { ...strongFleet, jagdbomber: 3, abfangjaeger: 3 } }, {
    units: { korvette: 4, piratenmiliz: 30, abfangjaeger: 2 },
    defenses: { flakstellung: 1, kuestenbatterie: 1 },
  });
  assert.deepEqual(report.phases.map((p) => p.phase), [...PHASE_NAMES]);
  for (const phase of report.phases) {
    assert.ok("entscheidend" in phase);
    assert.equal(phase.skipped, false);
    assert.ok(phase.rounds >= 1 && phase.rounds <= balance.combat.maxRoundsPerPhase);
    assert.equal(typeof phase.entscheidend, "string");
  }
  // Phasen schließen lückenlos aneinander an
  for (let i = 1; i < report.phases.length; i++) {
    assert.deepEqual(report.phases[i].before, report.phases[i - 1].after);
  }
  assert.deepEqual(report.phases[0].before.attacker, report.attacker.before);
  assert.deepEqual(report.phases[3].after.attacker, report.attacker.survivors);
  assert.deepEqual(report.phases[3].after.defender, report.defender.survivors);
  assert.equal(report.phases[0].entscheidend, "abfangjaeger");
});

test("keine negativen Bestände, auch bei völliger Vernichtung", () => {
  const report = fight({ units: { korvette: 1, landungsschiff: 1, schuetzen: 5, jagdbomber: 1 } }, {
    units: { zerstoerer: 50, kampfpanzer: 50 },
    defenses: { kuestenbatterie: 50, flakstellung: 50, bunkerlinie: 10 },
  });
  for (const side of [report.attacker, report.defender]) {
    for (const group of [side.survivors, side.losses, side.returned, side.final]) {
      for (const n of Object.values(group)) assert.ok(Number.isInteger(n) && n >= 0);
    }
  }
  assert.equal(report.attacker.survivors.korvette, 0);
  assert.equal(report.attacker.survivors.landungsschiff, 0);
  assert.equal(report.attacker.survivors.schuetzen, 0);
  assert.equal(report.winner, "defender");
});

test("ein klar überlegener Verband gewinnt gegen Nest Stufe 1", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const report = fight({ units: strongFleet }, nest(1), seed);
    assert.equal(report.winner, "attacker");
    assert.equal(report.defender.survivors.piratenmiliz, 0);
    assert.equal(report.defender.survivors.schnellboot, 0);
    assert.equal(report.attacker.survivors.landungsschiff, 2);
    // 2 Landungsschiffe laden 8000, das Nest gibt 5400: volle feste Beute
    assert.deepEqual(report.loot, { stahl: 3000, treibstoff: 1200, elektronik: 400, proviant: 800 });
  }
});

test("ein Verband ohne Landungsschiffe erhält keine Beute", () => {
  const report = fight({ units: { zerstoerer: 8, korvette: 4 } }, nest(1));
  assert.equal(report.defender.survivors.schnellboot, 0);
  assert.equal(report.winner, "defender");
  assert.equal(report.landed, false);
  assert.deepEqual(report.loot, zeroLoot);
  assert.equal(report.phases[3].skipped, true);
  assert.equal(report.phases[3].skipReason, "no_landing_ships");
  assert.equal(report.phases[3].entscheidend, null);
});

test("Landungsschiffe ohne Truppen: keine Landung, kein Sieg", () => {
  const report = fight({ units: { zerstoerer: 8, landungsschiff: 2 } }, nest(1));
  assert.equal(report.phases[3].skipReason, "no_troops");
  assert.equal(report.winner, "defender");
  assert.deepEqual(report.loot, zeroLoot);
});

test("Beute durch Ladekapazität begrenzt und proportional gekürzt", () => {
  const report = fight({ units: { zerstoerer: 6, landungsschiff: 1, kampfpanzer: 10 } }, nest(1));
  assert.equal(report.winner, "attacker");
  assert.equal(report.attacker.survivors.landungsschiff, 1);
  // 5400 Beute auf 4000 Ladung: Faktor 4000 / 5400, abgerundet
  assert.deepEqual(report.loot, { stahl: 2222, treibstoff: 888, elektronik: 296, proviant: 592 });
  const sum = Object.values(report.loot).reduce((a, b) => a + b, 0);
  assert.ok(sum <= 4000);
});

test("Beute durch Bunkerschutz begrenzt (Anteil am ungeschützten Bestand)", () => {
  const defender: DefenderInput = {
    units: {},
    defenses: {},
    resources: { stahl: 10300, treibstoff: 200, elektronik: 1300, proviant: 300 },
    protectedPerResource: 300,
  };
  const report = fight({ units: { landungsschiff: 2, schuetzen: 50 } }, defender);
  assert.equal(report.winner, "attacker");
  assert.deepEqual(report.loot, { stahl: 3000, treibstoff: 0, elektronik: 300, proviant: 0 });
  // höherer Bunkerschutz, weniger Beute
  const bunkered = fight({ units: { landungsschiff: 2, schuetzen: 50 } }, { ...defender, protectedPerResource: 5300 });
  assert.deepEqual(bunkered.loot, { stahl: 1500, treibstoff: 0, elektronik: 0, proviant: 0 });
});

test("Wiederholungsfaktor nach Anzahl früherer Angriffe", () => {
  const defender: DefenderInput = {
    units: {},
    defenses: {},
    resources: { stahl: 10300, treibstoff: 300, elektronik: 300, proviant: 300 },
    protectedPerResource: 300,
  };
  const stahl = [0, 1, 2, 3, 9].map(
    (prior) => fight({ units: { landungsschiff: 2, schuetzen: 50 }, priorAttacksInWindow: prior }, defender).loot.stahl,
  );
  assert.deepEqual(stahl, [3000, 1500, 750, 0, 0]);
  // feste Nestbeute unterliegt dem Faktor nicht
  const nestLoot = fight({ units: strongFleet, priorAttacksInWindow: 3 }, nest(1)).loot;
  assert.equal(nestLoot.stahl, 3000);
});

test("computeLoot: Kürzung, Faktor und Grenzfälle", () => {
  const target = { resources: { stahl: 1000, treibstoff: 1000, elektronik: 1000, proviant: 1000 }, protectedPerResource: 0 };
  assert.deepEqual(computeLoot(target, 1e9, 0, balance), { stahl: 300, treibstoff: 300, elektronik: 300, proviant: 300 });
  assert.deepEqual(computeLoot(target, 600, 0, balance), { stahl: 150, treibstoff: 150, elektronik: 150, proviant: 150 });
  assert.deepEqual(computeLoot(target, 0, 0, balance), zeroLoot);
  assert.deepEqual(computeLoot(target, 1e9, 1, balance), { stahl: 150, treibstoff: 150, elektronik: 150, proviant: 150 });
  assert.deepEqual(computeLoot({ resources: { stahl: 100 }, protectedPerResource: 300 }, 1e9, 0, balance), zeroLoot);
  assert.deepEqual(computeLoot({}, 1e9, 0, balance), zeroLoot);
});

test("Luftkampf: Luftüberlegenheit nach verbliebenen Jäger-Lebenspunkten", () => {
  const strong = fight({ units: { abfangjaeger: 10 } }, { units: { abfangjaeger: 3 }, defenses: {} });
  assert.equal(strong.airSuperiority, "attacker");
  assert.equal(strong.phases[0].skipped, false);
  const weak = fight({ units: { abfangjaeger: 2 } }, { units: { abfangjaeger: 9 }, defenses: {} });
  assert.equal(weak.airSuperiority, "defender");
  const none = fight({ units: { korvette: 2 } }, { units: { korvette: 2 }, defenses: {} });
  assert.equal(none.airSuperiority, null);
  assert.equal(none.phases[0].skipped, true);
  assert.equal(none.phases[0].skipReason, "no_fighters");
  const unopposed = fight({ units: { abfangjaeger: 1 } }, noDefender);
  assert.equal(unopposed.airSuperiority, "attacker");
  assert.equal(unopposed.phases[0].skipReason, "no_opponent");
});

test("Luftschlag: Bonus mit, Malus gegen Luftüberlegenheit", () => {
  const target = { units: { korvette: 40 }, defenses: {} };
  const dmg = (units: Counts, def: DefenderInput) => fight({ units }, def, 5).phases[1].damage.attacker.jagdbomber;
  const neutral = dmg({ jagdbomber: 10 }, target);
  const bonus = dmg({ jagdbomber: 10, abfangjaeger: 1 }, target);
  assert.ok(approx(bonus / neutral, balance.combat.airSuperiorityBomberBonus, 1e-9));
  // Verteidiger hat Jäger: Malus. Jäger schießen im Luftschlag nicht auf Bomber.
  const malusReport = fight({ units: { jagdbomber: 10 } }, { units: { korvette: 40, abfangjaeger: 1 }, defenses: {} }, 5);
  assert.equal(malusReport.airSuperiority, "defender");
  // Schon der Schaden der ersten Runde entscheidet: Vergleich über Verluste des Ziels
  const neutralReport = fight({ units: { jagdbomber: 10 } }, target, 5);
  assert.ok(malusReport.defender.losses.korvette < neutralReport.defender.losses.korvette);
});

test("Luftschlag: Flak feuert zuerst; ohne Bomber wird die Phase übersprungen", () => {
  // 20 Flak: 950..1050 Schaden in Runde 1 -> 6 oder 7 von 10 Bombern fallen, bevor sie zuschlagen
  const report = fight({ units: { jagdbomber: 10 } }, { units: {}, defenses: { flakstellung: 20 } }, 3);
  const phase = report.phases[1];
  assert.equal(phase.skipped, false);
  assert.equal(phase.after.attacker.jagdbomber, 0);
  assert.equal(phase.rounds, 2);
  // Nur die höchstens 4 Überlebenden haben getroffen (ohne Flak-Vorrang wären es 10 * 90 = 900).
  assert.ok(phase.damage.attacker.jagdbomber > 0);
  assert.ok(phase.damage.attacker.jagdbomber <= 4 * 90 * 1.05 + 1e-9);
  assert.equal(phase.entscheidend, "flakstellung");
  assert.equal(phase.entscheidendSide, "defender");
  // beschädigte Flugzeuge kehren zurück: 30 % von 10
  assert.equal(report.attacker.returned.jagdbomber, 3);
  assert.equal(report.attacker.final.jagdbomber, 3);
  const noBombers = fight({ units: { korvette: 3 } }, { units: {}, defenses: { flakstellung: 2 } });
  assert.equal(noBombers.phases[1].skipped, true);
  assert.equal(noBombers.phases[1].skipReason, "no_bombers");
});

test("Seegefecht: Bonus gegen Zieltyp und Küstenbatterien feuern mit", () => {
  // 10 Korvetten gegen 10 Schnellboote: 10 * 40 * 1.5 = 600 je Runde (mal Zufall) -> 7 Boote
  const report = fight({ units: { korvette: 10 } }, { units: { schnellboot: 10 }, defenses: {} }, 2);
  const phase = report.phases[2];
  const perRound = phase.damage.attacker.korvette / phase.rounds;
  assert.ok(perRound >= 600 * 0.95 - 1e-9 && perRound <= 600 * 1.05 + 1e-9);
  assert.equal(phase.entscheidend, "korvette");
  // Küstenbatterien allein versenken Schiffe
  const coast = fight({ units: { korvette: 3 } }, { units: {}, defenses: { kuestenbatterie: 10 } }, 2);
  assert.equal(coast.phases[2].skipped, false);
  assert.equal(coast.phases[2].entscheidend, "kuestenbatterie");
  assert.equal(coast.attacker.survivors.korvette, 0);
  // Wracks: 30 % der Stahl- und Elektronikkosten von 3 Korvetten
  assert.deepEqual(coast.wreck, { stahl: 360, elektronik: 45 });
});

test("Schaden verteilt sich proportional zu den Lebenspunkten der Zieltypen", () => {
  // Ziel: 9 Zerstörer (4050 HP) und 3 Landungsschiffe (900 HP); 30 Zerstörer schießen 2100 je Runde.
  const report = fight({ units: { zerstoerer: 30 } }, { units: { zerstoerer: 9, landungsschiff: 3 }, defenses: {} }, 4);
  const phase = report.phases[2];
  assert.ok(phase.rounds >= 1);
  // In Runde 1: Anteil Zerstörer 4050/4950 -> rund 1718 -> 3 versenkt; Landungsschiffe 382 -> 1 versenkt.
  // Über die Runden hinweg bleiben die Verluste ganzzahlig und im Bestand.
  assert.ok(report.defender.losses.zerstoerer >= 3);
  assert.ok(report.defender.losses.landungsschiff >= 1);
});

test("Restschaden verfällt: zu wenig Schaden versenkt nichts", () => {
  // 4 Schnellboote: rund 72 Schaden je Runde gegen einen Zerstörer mit 450 HP;
  // der Zerstörer: rund 70 Schaden gegen Boote mit 80 HP. Schaden summiert sich nicht über Runden.
  const report = fight({ units: { schnellboot: 4 } }, { units: { zerstoerer: 1 }, defenses: {} });
  assert.equal(report.phases[2].rounds, 3);
  assert.ok(report.phases[2].damage.attacker.schnellboot > 200);
  assert.equal(report.defender.survivors.zerstoerer, 1);
  assert.equal(report.attacker.survivors.schnellboot, 4);
  assert.deepEqual(report.wreck, { stahl: 0, elektronik: 0 });
});

test("Landung: Truppen über der verbliebenen Kapazität gehen verloren", () => {
  const report = fight({ units: { landungsschiff: 4, schuetzen: 400 } }, {
    units: { zerstoerer: 6 },
    defenses: {},
  });
  const ships = report.attacker.survivors.landungsschiff;
  assert.ok(ships < 4);
  assert.ok(report.phases[3].after.attacker.schuetzen <= ships * 100);
  if (ships === 0) assert.equal(report.attacker.survivors.schuetzen, 0);
});

test("Minensperren wirken einmal, Pioniere halbieren den Schaden", () => {
  const mines: DefenderInput = { units: {}, defenses: { minensperre: 2 } };
  // 2 * 300 = 600 Schaden -> 30 Schützen
  const plain = fight({ units: { landungsschiff: 1, schuetzen: 50 } }, mines);
  assert.equal(plain.attacker.survivors.schuetzen, 20);
  assert.equal(plain.phases[3].entscheidend, "minensperre");
  assert.equal(plain.phases[3].rounds, 0);
  assert.equal(plain.phases[3].skipped, false);
  assert.equal(plain.winner, "attacker");
  assert.equal(plain.defender.survivors.minensperre, 2);
  // Lazarett des Angreifers bei Sieg: 20 % von 30
  assert.equal(plain.attacker.returned.schuetzen, 6);
  assert.equal(plain.attacker.final.schuetzen, 26);
  // mit Pionieren: 300 Schaden, nach HP verteilt (800 : 200) -> 12 Schützen, 3 Pioniere
  const eng = fight({ units: { landungsschiff: 1, schuetzen: 40, pioniere: 10 } }, mines);
  assert.equal(eng.attacker.survivors.schuetzen, 28);
  assert.equal(eng.attacker.survivors.pioniere, 7);
});

test("Sieg nur ohne verbliebene Bodentruppen und Bunkerlinie; Rückkehrer des Verteidigers", () => {
  const defender: DefenderInput = { units: { schuetzen: 30 }, defenses: { bunkerlinie: 1, flakstellung: 1 } };
  const win = fight({ units: { landungsschiff: 3, kampfpanzer: 20, pioniere: 100 } }, defender, 8);
  assert.equal(win.winner, "attacker");
  assert.equal(win.defender.survivors.schuetzen, 0);
  assert.equal(win.defender.survivors.bunkerlinie, 0);
  assert.equal(win.defender.survivors.flakstellung, 1); // Flak ist kein Ziel des Bodenkampfs
  // Lazarett 40 % von 30, Reparatur 60 % von 1 (abgerundet)
  assert.equal(win.defender.returned.schuetzen, 12);
  assert.equal(win.defender.returned.bunkerlinie, 0);
  assert.equal(win.defender.final.schuetzen, 12);

  const lose = fight({ units: { landungsschiff: 1, schuetzen: 20 } }, { units: { schuetzen: 60 }, defenses: { bunkerlinie: 5 } }, 8);
  assert.equal(lose.winner, "defender");
  assert.equal(lose.landed, true);
  assert.deepEqual(lose.loot, zeroLoot);
  // Angreifer-Lazarett nur bei Sieg
  assert.ok(lose.attacker.losses.schuetzen > 0);
  assert.equal(lose.attacker.returned.schuetzen, 0);
});

test("Reparatur der Anlagen: 60 % der zerstörten kehren zurück", () => {
  const report = fight({ units: { jagdbomber: 40 } }, { units: {}, defenses: { kuestenbatterie: 10 } }, 6);
  assert.equal(report.defender.survivors.kuestenbatterie, 0);
  assert.equal(report.defender.returned.kuestenbatterie, 6);
  assert.equal(report.defender.final.kuestenbatterie, 6);
});

test("Versorgungsmangel: Angriffswert der Einheiten mal 0,8, Anlagen unberührt", () => {
  const defender: DefenderInput = { units: { schnellboot: 30 }, defenses: { kuestenbatterie: 2 } };
  const normal = fight({ units: { korvette: 10 } }, defender, 77).phases[2];
  const starving = fight({ units: { korvette: 10 }, versorgungsmangel: true }, defender, 77).phases[2];
  // Vergleich der ersten Runde ist nicht direkt möglich; beide Kämpfe laufen aber bis Runde 1 identisch an.
  assert.ok(starving.damage.attacker.korvette < normal.damage.attacker.korvette);
  const one = (flag: boolean) =>
    fight({ units: { korvette: 1 }, versorgungsmangel: flag }, { units: { zerstoerer: 50 }, defenses: {} }, 77).phases[2];
  // Die einzelne Korvette überlebt Runde 1 nicht: genau eine Runde, Schaden exakt im Verhältnis 0,8.
  assert.equal(one(false).rounds, 1);
  assert.ok(approx(one(true).damage.attacker.korvette / one(false).damage.attacker.korvette, 0.8, 1e-9));
  const defStarving = fight({ units: { korvette: 1 } }, { units: {}, defenses: { kuestenbatterie: 20 }, versorgungsmangel: true }, 77);
  const defNormal = fight({ units: { korvette: 1 } }, { units: {}, defenses: { kuestenbatterie: 20 } }, 77);
  assert.equal(defStarving.phases[2].damage.defender.kuestenbatterie, defNormal.phases[2].damage.defender.kuestenbatterie);
});

test("höchstens maxRoundsPerPhase Runden je Phase", () => {
  const report = fight({ units: { zerstoerer: 100, landungsschiff: 10, schuetzen: 1000 } }, {
    units: { zerstoerer: 100, schuetzen: 1000 },
    defenses: { bunkerlinie: 20 },
  });
  for (const phase of report.phases) assert.ok(phase.rounds <= balance.combat.maxRoundsPerPhase);
  assert.equal(report.phases[2].rounds, 3);
});

test("ungültige Eingaben werden als Fehlercode gemeldet", () => {
  assert.deepEqual(resolveBattle({ units: { ufo: 1 } }, noDefender, balance, 1), { ok: false, code: "unknown_unit" });
  assert.deepEqual(resolveBattle({ units: { korvette: -1 } }, noDefender, balance, 1), { ok: false, code: "bad_count" });
  assert.deepEqual(resolveBattle({ units: { korvette: 1.5 } }, noDefender, balance, 1), { ok: false, code: "bad_count" });
  assert.deepEqual(resolveBattle({ units: {} }, { units: { flakstellung: 1 }, defenses: {} }, balance, 1), {
    ok: false,
    code: "unknown_unit",
  });
  assert.deepEqual(resolveBattle({ units: {} }, { units: {}, defenses: { korvette: 1 } }, balance, 1), {
    ok: false,
    code: "unknown_unit",
  });
  // Anlagen kann nur der Verteidiger führen
  assert.deepEqual(resolveBattle({ units: { flakstellung: 1 } }, noDefender, balance, 1), {
    ok: false,
    code: "unknown_unit",
  });
});

test("leere Verbände: alle Phasen sauber übersprungen", () => {
  const report = fight({ units: {} }, noDefender);
  assert.equal(report.phases.length, 4);
  for (const phase of report.phases) {
    assert.equal(phase.skipped, true);
    assert.equal(typeof phase.skipReason, "string");
    assert.equal(phase.rounds, 0);
    assert.equal(phase.entscheidend, null);
  }
  assert.equal(report.winner, "defender");
});

test("Eigenschaftstest: viele Seeds und zufällige Verbände", () => {
  const unitIds = [...Object.keys(balance.units), ...Object.keys(balance.npcUnits)];
  const defenseIds = Object.keys(balance.defenses);
  const gen = mulberry32(20261126);
  const randomCounts = (ids: string[], max: number): Counts => {
    const out: Counts = {};
    for (const id of ids) {
      // etwa die Hälfte der Typen fehlt, damit übersprungene Phasen vorkommen
      if (gen() < 0.5) out[id] = randomInt(gen, 0, max);
    }
    return out;
  };
  let skippedPhases = 0;
  let foughtPhases = 0;
  let attackerWins = 0;
  for (let i = 0; i < 1500; i++) {
    const scale = [3, 30, 300][i % 3];
    const attacker: AttackerInput = {
      units: randomCounts(unitIds, scale),
      versorgungsmangel: gen() < 0.2,
      priorAttacksInWindow: randomInt(gen, 0, 4),
    };
    const defender: DefenderInput = {
      units: randomCounts(unitIds, scale),
      defenses: randomCounts(defenseIds, Math.ceil(scale / 3)),
      versorgungsmangel: gen() < 0.2,
      resources: { stahl: randomInt(gen, 0, 50000), treibstoff: randomInt(gen, 0, 50000), elektronik: 0, proviant: 12345 },
      protectedPerResource: randomInt(gen, 0, 2000),
    };
    const attackerSnapshot = JSON.stringify(attacker);
    const defenderSnapshot = JSON.stringify(defender);
    const seed = randomInt(gen, 0, 0xffffffff);
    const res = resolveBattle(attacker, defender, balance, seed);
    assert.ok(res.ok);
    const report = res.report;
    const context = `Fall ${i}, Seed ${seed}`;
    assert.equal(JSON.stringify(attacker), attackerSnapshot, context);
    assert.equal(JSON.stringify(defender), defenderSnapshot, context);

    // Bericht immer mit vier Phasen in fester Reihenfolge
    assert.deepEqual(report.phases.map((p) => p.phase), [...PHASE_NAMES], context);
    let prev = { attacker: report.attacker.before, defender: report.defender.before };
    for (const phase of report.phases) {
      assert.deepEqual(phase.before, prev, context);
      assert.equal(typeof phase.skipped, "boolean", context);
      if (phase.skipped) {
        skippedPhases++;
        assert.equal(typeof phase.skipReason, "string", context);
        assert.equal(phase.rounds, 0, context);
        assert.equal(phase.entscheidend, null, context);
        // Übersprungene Phasen ändern nichts, außer dass bei der Landung Truppen ohne Transportraum verloren gehen.
        assert.deepEqual(phase.after.defender, phase.before.defender, context);
        if (phase.phase !== "landung") assert.deepEqual(phase.after.attacker, phase.before.attacker, context);
      } else {
        foughtPhases++;
        assert.equal(phase.skipReason, null, context);
        assert.ok(phase.rounds >= 0 && phase.rounds <= balance.combat.maxRoundsPerPhase, context);
      }
      if (phase.entscheidend !== null) {
        const side = phase.entscheidendSide;
        assert.ok(side === "attacker" || side === "defender", context);
        assert.ok(phase.damage[side][phase.entscheidend] > 0, context);
        assert.ok((phase.before[side][phase.entscheidend] ?? 0) > 0, context);
      }
      for (const side of ["attacker", "defender"] as const) {
        for (const [id, n] of Object.entries(phase.after[side])) {
          assert.ok(Number.isInteger(n) && n >= 0, `${context}: ${id} negativ`);
          assert.ok(n <= phase.before[side][id], `${context}: ${id} mehr als vorher`);
        }
        for (const d of Object.values(phase.damage[side])) assert.ok(Number.isFinite(d) && d > 0, context);
      }
      prev = phase.after;
    }

    for (const outcome of [report.attacker, report.defender]) {
      for (const [id, before] of Object.entries(outcome.before)) {
        const survivors = outcome.survivors[id];
        const final = outcome.final[id];
        assert.ok(Number.isInteger(survivors) && survivors >= 0 && survivors <= before, context);
        assert.ok(Number.isInteger(outcome.returned[id]) && outcome.returned[id] >= 0, context);
        assert.equal(outcome.losses[id], before - survivors, context);
        assert.equal(final, survivors + outcome.returned[id], context);
        assert.ok(final <= before, `${context}: ${id} nach Rückkehr mehr als vorher`);
      }
    }
    assert.deepEqual(report.phases[3].after.attacker, report.attacker.survivors, context);
    assert.deepEqual(report.phases[3].after.defender, report.defender.survivors, context);

    // Beute: nie negativ, nie über dem ungeschützten Bestand, nur bei Sieg, nie über der Ladekapazität
    let lootSum = 0;
    for (const r of balance.resources) {
      const amount = report.loot[r];
      assert.ok(Number.isInteger(amount) && amount >= 0, context);
      assert.ok(amount <= Math.max(0, (defender.resources?.[r] ?? 0) - (defender.protectedPerResource ?? 0)), context);
      lootSum += amount;
    }
    const cargo = (report.attacker.survivors.landungsschiff ?? 0) * (balance.units.landungsschiff.cargo ?? 0);
    assert.ok(lootSum <= cargo, context);
    if (report.winner === "attacker") {
      attackerWins++;
      assert.equal(report.landed, true, context);
    } else {
      assert.equal(lootSum, 0, context);
    }
    assert.ok(report.wreck.stahl >= 0 && report.wreck.elektronik >= 0, context);
  }
  // Der Test soll beide Fälle wirklich gesehen haben.
  assert.ok(skippedPhases > 100, `übersprungen: ${skippedPhases}`);
  assert.ok(foughtPhases > 1000, `ausgetragen: ${foughtPhases}`);
  assert.ok(attackerWins > 10, `Siege: ${attackerWins}`);
});
