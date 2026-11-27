import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySiegePenalty,
  armadaAttacker,
  armadaTargetHp,
  defenseHp,
  buildRoute,
  capLoot,
  composeArmada,
  composeSiege,
  composeTreasure,
  damageLoot,
  distanceKm,
  forceHp,
  interceptPoint,
  nextSpawn,
  pickKind,
  referenceHp,
  resolveBattle,
  routeLengthKm,
  routePosition,
  seasonProgress,
  strandTroops,
  strengthFactor,
  worldEventsBalance,
} from "../src/index.ts";
import { DAY, HOUR, T0, approx, loadBalance } from "./helpers.ts";

const balance = loadBalance();
const w = worldEventsBalance(balance);

test("Balance enthält den Block worldEvents", () => {
  assert.equal(w.grossflotte.announceHours, 12);
  assert.equal(w.belagerung.productionPenalty, 0.3);
  assert.deepEqual(w.schatzschiff.durationHours, [12, 24]);
});

test("Saisonfortschritt und Stärkefaktor", () => {
  assert.equal(seasonProgress(0, 100, 50), 0.5);
  assert.equal(seasonProgress(0, 100, -5), 0);
  assert.equal(seasonProgress(0, 100, 500), 1);
  assert.equal(strengthFactor(0, balance), 1);
  assert.equal(strengthFactor(1, balance), 1 + w.seasonGrowth);
});

test("Bezugsstärke: Median, mindestens minReferenceHp", () => {
  assert.equal(referenceHp([], balance), w.minReferenceHp);
  assert.equal(referenceHp([100, 200], balance), w.minReferenceHp);
  assert.equal(referenceHp([5000, 9000, 20000], balance), 9000);
  assert.equal(referenceHp([4000, 6000], balance), 5000);
});

test("Nächstes Ereignis: im Intervall, deterministisch, alle Arten möglich", () => {
  const a = nextSpawn(T0, 42, balance);
  const b = nextSpawn(T0, 42, balance);
  assert.deepEqual(a, b);
  for (let s = 1; s < 200; s++) {
    const n = nextSpawn(T0, s, balance);
    assert.ok(n.atMs >= T0 + w.spawnIntervalHours[0] * HOUR && n.atMs <= T0 + w.spawnIntervalHours[1] * HOUR);
  }
  assert.equal(pickKind(0, balance), "schatzschiff");
  assert.equal(pickKind(0.5, balance), "grossflotte");
  assert.equal(pickKind(0.99, balance), "belagerung");
});

test("Zusammensetzung wächst mit Saisonfortschritt und Spielerstärke", () => {
  const early = composeTreasure(5000, 0, balance);
  const late = composeTreasure(5000, 1, balance);
  assert.ok(late.units.schnellboot > early.units.schnellboot);
  assert.ok(late.loot.stahl > early.loot.stahl);
  assert.equal(early.loot.stahl, w.schatzschiff.loot.stahl);
  assert.ok(composeTreasure(1, 0, balance).units.schnellboot >= w.schatzschiff.minEscort);
  const weak = composeArmada(2000, 0.5, balance);
  const strong = composeArmada(20000, 0.5, balance);
  assert.ok(strong.units.schnellboot > weak.units.schnellboot);
  assert.equal(strong.units.piratenmiliz, strong.units.schnellboot * w.grossflotte.miliPerBoot);
  assert.ok(weak.units.schnellboot >= w.grossflotte.minSchnellboote);
  const siege = composeSiege(0, 0, balance);
  assert.ok(siege.units.schnellboot >= w.belagerung.minSchnellboote);
  assert.deepEqual(Object.keys(siege.lootPool).sort(), ["elektronik", "proviant", "stahl", "treibstoff"]);
});

test("Route: Zeit nach Strecke, Position zum Zeitpunkt", () => {
  const pts = [{ lat: 40, lon: -10 }, { lat: 40, lon: -8 }, { lat: 42, lon: -8 }];
  const route = buildRoute(pts, T0, T0 + 10 * HOUR);
  assert.equal(route[0].atMs, T0);
  assert.equal(route[2].atMs, T0 + 10 * HOUR);
  const len = routeLengthKm(pts);
  const leg1 = distanceKm(pts[0], pts[1]);
  assert.ok(approx(route[1].atMs, T0 + (10 * HOUR * leg1) / len, 1));
  assert.deepEqual(routePosition(route, T0 - HOUR), { lat: 40, lon: -10 });
  assert.deepEqual(routePosition(route, T0 + 20 * HOUR), { lat: 42, lon: -8 });
  const mid = routePosition(route, (T0 + route[1].atMs) / 2);
  assert.ok(approx(mid.lon, -9, 1e-6) && approx(mid.lat, 40, 1e-6));
});

test("Abfangpunkt: erreichbar, rechtzeitig, sonst null", () => {
  const route = buildRoute([{ lat: 45, lon: -20 }, { lat: 45, lon: -10 }], T0, T0 + 24 * HOUR);
  const origin = { lat: 47, lon: -15 };
  const hit = interceptPoint(route, origin, 60, T0);
  assert.ok(hit);
  // Fahrzeit bis zum Abfangpunkt passt in die verstrichene Zeit, eine Minute früher nicht.
  const need = (distanceKm(origin, hit.point) / 60) * HOUR;
  assert.ok(need <= hit.atMs - T0 + 1);
  const earlier = routePosition(route, hit.atMs - 120000);
  assert.ok((distanceKm(origin, earlier) / 60) * HOUR > hit.atMs - 120000 - T0);
  // Zu langsam oder zu spät: kein Abfangpunkt.
  assert.equal(interceptPoint(route, { lat: 60, lon: 20 }, 40, T0), null);
  assert.equal(interceptPoint(route, origin, 60, T0 + 30 * HOUR), null);
  // Startpunkt ist schon erreicht: sofort.
  const atStart = interceptPoint(route, { lat: 45, lon: -20 }, 50, T0);
  assert.equal(atStart?.atMs, T0);
});

test("Kampf gegen einen Kartellverband auf See: Miliz ertrinkt mit den Booten", () => {
  const fleet = composeArmada(2000, 0, balance).units;
  const r = resolveBattle({ units: { zerstoerer: 60, korvette: 60 } }, { units: fleet, defenses: {} }, balance, 7);
  assert.ok(r.ok);
  assert.equal(r.report.winner, "defender"); // ohne Landung gewinnt nach den Kampfregeln nie der Angreifer
  const s = strandTroops(r.report, balance);
  assert.equal(s.destroyed, true);
  assert.equal(s.report.winner, "attacker");
  assert.equal(s.report.defender.final.piratenmiliz, 0);
  assert.equal(s.report.defender.losses.piratenmiliz, fleet.piratenmiliz);
  // Schwacher Angreifer: Verband bleibt, Miliz bleibt an Bord.
  const weak = resolveBattle({ units: { korvette: 1 } }, { units: fleet, defenses: {} }, balance, 7);
  assert.ok(weak.ok);
  const s2 = strandTroops(weak.report, balance);
  assert.equal(s2.destroyed, false);
  assert.equal(s2.report.defender.final.piratenmiliz, fleet.piratenmiliz);
});

test("Großflotte als Angreifer: Truppenraum auf den Booten, Beute ohne Laderaumgrenze", () => {
  const a = armadaAttacker({ schnellboot: 10, piratenmiliz: 80 }, balance);
  assert.equal(a.unlimitedCargo, true);
  assert.equal(a.troopSpaceBonus?.schnellboot, w.grossflotte.miliPerBoot);
});

test("Beute: Laderaum begrenzt, Schadensanteil, Rest des Pools", () => {
  assert.deepEqual(capLoot({ stahl: 3000, proviant: 1000 }, 2000), { stahl: 1500, proviant: 500 });
  assert.deepEqual(capLoot({ stahl: 300 }, 2000), { stahl: 300 });
  const pool = { stahl: 1000, treibstoff: 500 };
  assert.deepEqual(damageLoot(pool, {}, 250, 1000, 1e9), { stahl: 250, treibstoff: 125 });
  assert.deepEqual(damageLoot(pool, { stahl: 900 }, 500, 1000, 1e9), { stahl: 100, treibstoff: 250 });
  assert.deepEqual(damageLoot(pool, {}, 500, 1000, 0), { stahl: 0, treibstoff: 0 });
  assert.deepEqual(damageLoot(pool, {}, 5000, 1000, 1e9), pool);
  assert.equal(forceHp({ schnellboot: 2, piratenmiliz: 10 }, balance), 2 * 80 + 10 * 20);
});

test("Belagerung: 30 % der Gebäudeproduktion, nicht bei vollem Lager, nie negativ", () => {
  const res = { stahl: 1000, treibstoff: 5000, elektronik: 2, proviant: 100 };
  const rates = { stahl: 100, treibstoff: 100, elektronik: 100, proviant: 0 };
  const r = applySiegePenalty(res, rates, 5000, 2, balance);
  assert.ok(approx(r.resources.stahl, 1000 - 100 * 0.3 * 2));
  assert.equal(r.resources.treibstoff, 5000);
  assert.equal(r.resources.elektronik, 0);
  assert.equal(r.resources.proviant, 100);
  assert.ok(approx(r.deducted.stahl, 60));
});

test("Ereignisse sind in einer Saison mehrfach möglich (Abstand 2–4 Tage)", () => {
  assert.ok(w.spawnIntervalHours[0] >= 2 * 24 && w.spawnIntervalHours[1] <= 4 * 24);
  assert.ok(28 * DAY / (w.spawnIntervalHours[1] * HOUR) >= 7);
});

test("Großflotte (v1.16): Stärke-Bezug gewichtet Schiffe wie das Kartell, Landungsschiffe zählen nicht", () => {
  assert.equal(w.grossflotte.raidWeights, true);
  const troops = { schuetzen: 40 };
  const withShips = { schuetzen: 40, zerstoerer: 4 };
  assert.equal(armadaTargetHp(troops, {}, balance), defenseHp(troops, {}, balance), "ohne Schiffe unverändert");
  const z = balance.units.zerstoerer.hp * 4;
  assert.ok(approx(armadaTargetHp(withShips, {}, balance), defenseHp(troops, {}, balance) + z * 0.5, 1e-9), "Zerstörer halb");
  assert.equal(armadaTargetHp({ ...troops, landungsschiff: 4 }, {}, balance), defenseHp(troops, {}, balance), "Landungsschiffe 0");
  // Mehr Schnellboote nur durch Kampfwert, nicht durch die volle Flotte daheim.
  const ref = (u: Record<string, number>) => composeArmada(referenceHp([armadaTargetHp(u, {}, balance)], balance), 0.5, balance).units.schnellboot;
  assert.ok(ref(withShips) < composeArmada(referenceHp([defenseHp(withShips, {}, balance)], balance), 0.5, balance).units.schnellboot);
  // Ohne Schalter wie bis v1.15.
  const old = { ...balance, worldEvents: { ...w, grossflotte: { ...w.grossflotte, raidWeights: false } } };
  assert.equal(armadaTargetHp(withShips, {}, old as typeof balance), defenseHp(withShips, {}, balance));
});
