// Lagebild Stufe 3: Bahn und Streifen der Satelliten, Wolken, Start-Prüfungen, Gegenmittel (Tarnnetz, Störsender,
// Tarnanstrich, Funkdisziplin) und die Voraussetzung der Startrampe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  camoActive, currentPass, jammerFactorAt, jammerReduction, liveLevelAt, missingRequirement, newSatellite, nextPass,
  paintFactor, satelliteCost, satelliteLaunchCheck, satelliteLimit, satPass, satPassCount, startUpgrade,
  type Balance, type BaseState, type SensorCircle,
} from "../src/index.ts";

const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
const sb = balance.intel!.satellite!;
const cb = balance.intel!.counter!;
const W = 9000;
const H = 3600000;

function base(over: Partial<BaseState> = {}): BaseState {
  return {
    resources: { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 }, resUpdatedAt: 0, buildings: {}, units: {}, unitsAway: {},
    defenses: {}, buildQueue: [], trainingQueue: [], versorgungsmangel: false, protection: { createdAtMs: 0 } as BaseState["protection"], ...over,
  };
}

test("Balance: Satellit und Gegenmittel wie im Regelwerk (5.6, 6)", () => {
  assert.deepEqual(sb.types.optisch.cost, { stahl: 5000, treibstoff: 2000, elektronik: 3500 });
  assert.deepEqual(sb.types.radar.cost, { stahl: 5500, treibstoff: 2200, elektronik: 4000 }); // v1.24 (vorher 6000/2500/4500)
  assert.equal(sb.lifetimeHours, 168);
  assert.equal(sb.periodHours, 6);
  assert.equal(sb.stripKm, 600);
  assert.equal(sb.shiftKm, 1400);
  assert.equal(sb.liveMinutes, 20);
  assert.equal(sb.types.optisch.cloudMax, 0.6);
  assert.equal(cb.jammerRadiusKm, 200);
  assert.equal(cb.jammerPerLevel, 0.25);
  assert.equal(cb.jammerMax, 0.5);
  assert.equal(cb.jammerRevealKm, 600);
  assert.equal(balance.buildings.stoersender.powerPerLevel, 10);
  assert.deepEqual(balance.buildings.stoersender.requires, { radarstation: 5 });
  assert.ok(balance.research!.branches.includes("raumfahrt"));
});

test("Bahn: alle 6 h ein Überflug, Streifen 600 km, je Überflug 1 400 km nach Westen, über den Rand zurück", () => {
  const s = newSatellite(1, "optisch", 5000, 0, sb);
  assert.equal(satPassCount(s), 27, "7 Tage: 27 Überflüge (der 28. fiele aufs Ende)");
  const p1 = satPass(s, 1, W)!;
  assert.equal(p1.startMs, 6 * H);
  assert.equal(p1.endMs - p1.startMs, 20 * 60000);
  assert.deepEqual([p1.x0, p1.x1], [4700, 5300], "erster Streifen über dem Starthafen");
  const p2 = satPass(s, 2, W)!;
  assert.deepEqual([p2.x0, p2.x1], [3300, 3900], "1 400 km nach Westen");
  const p5 = satPass(s, 5, W)!; // 5000 − 4·1400 = −600 → 8400
  assert.deepEqual([p5.x0, p5.x1], [8100, 8700], "über den Westrand zurück nach Osten");
  assert.equal(satPass(s, 28, W), null, "nach der Lebensdauer kein Überflug");
  const edge = satPass(newSatellite(2, "radar", 100, 0, sb), 1, W)!;
  assert.deepEqual([edge.x0, edge.x1], [0, 400], "am Kartenrand beschnitten");
  // Live und nächster Überflug
  assert.equal(currentPass(s, 6 * H + 10 * 60000, W)?.k, 1);
  assert.equal(currentPass(s, 6 * H + 25 * 60000, W), null);
  assert.equal(nextPass(s, 6 * H + 25 * 60000, W)?.k, 2);
  assert.equal(nextPass(s, 0, W)?.k, 1);
  assert.equal(nextPass(s, 168 * H - 1, W), null);
  // Nach etwa fünf Tagen (20 Überflüge) liegen rund 95 % der Karte mindestens einmal im Streifen.
  const covered = new Set<number>();
  for (let k = 1; k <= 20; k++) { const p = satPass(s, k, W)!; for (let x = 0; x < W; x += 50) if (x >= p.x0 && x <= p.x1) covered.add(x); }
  assert.ok(covered.size >= (W / 50) * 0.95, `erfasst ${covered.size} von ${W / 50}`);
});

test("Streifen: optisch Erkennung außer unter Wolken, Radarsatellit nur Sichtung (auch Verbände), U-Boote nie", () => {
  const cloudy = (x: number, y: number) => y > 1000;
  const opt: SensorCircle = { kind: "satellit", x: 0, y: 0, km: 0, strip: { x0: 1000, x1: 1600, blocked: cloudy } };
  const rad: SensorCircle = { kind: "radarsatellit", x: 0, y: 0, km: 0, strip: { x0: 1000, x1: 1600 } };
  assert.equal(liveLevelAt([opt], 1300, 500, "object"), "erkennung");
  assert.equal(liveLevelAt([opt], 1300, 500, "fleet"), "erkennung");
  assert.equal(liveLevelAt([opt], 1300, 1500, "object"), null, "Bewölkung > 0,6: verdeckt");
  assert.equal(liveLevelAt([opt], 900, 500, "object"), null, "außerhalb des Streifens");
  assert.equal(liveLevelAt([rad], 1300, 1500, "object"), "sichtung", "Radar sieht durch Wolken");
  assert.equal(liveLevelAt([rad], 1300, 1500, "fleet"), "sichtung");
  assert.equal(liveLevelAt([opt, rad], 1300, 1500, "submarine"), null);
});

test("Start: Startrampe, Technik, Höchstzahl (2 mit Radarsatellit), Kosten mit Rabatt der Rampe", () => {
  const s = base({ buildings: { startrampe: 1 } });
  assert.equal((satelliteLaunchCheck(base(), "optisch", {}, 0, balance) as { code: string }).code, "sat_pad");
  assert.equal((satelliteLaunchCheck(s, "optisch", {}, 0, balance) as { code: string }).code, "sat_tech");
  assert.equal((satelliteLaunchCheck(s, "mond", {}, 0, balance) as { code: string }).code, "sat_type");
  const techs = { optischer_satellit: 1 };
  assert.equal(satelliteLaunchCheck(s, "optisch", techs, 0, balance).ok, true);
  assert.equal((satelliteLaunchCheck(s, "optisch", techs, 1, balance) as { code: string }).code, "sat_limit");
  assert.equal(satelliteLimit(techs, sb), 1);
  assert.equal(satelliteLimit({ ...techs, radarsatellit: 1 }, sb), 2);
  assert.equal(satelliteLaunchCheck(s, "radar", { ...techs, radarsatellit: 1 }, 1, balance).ok, true);
  const poor = base({ buildings: { startrampe: 1 }, resources: { stahl: 100 } });
  assert.equal((satelliteLaunchCheck(poor, "optisch", techs, 0, balance) as { code: string }).code, "insufficient_resources");
  assert.deepEqual(satelliteCost(sb.types.optisch, 1, sb), sb.types.optisch.cost);
  // v1.24: Rampenrabatt −10 % je Stufe über 1 (vorher −4 %), höchstens −30 % (vorher −20 %).
  assert.equal(satelliteCost(sb.types.optisch, 3, sb).stahl, Math.ceil(5000 * 0.8));
  assert.equal(satelliteCost(sb.types.optisch, 4, sb).stahl, Math.ceil(5000 * 0.7));
  assert.equal(satelliteCost(sb.types.optisch, 20, sb).stahl, Math.ceil(5000 * 0.7), "höchstens −30 %");
});

test("Startrampe: Voraussetzungen über missingRequirement und startUpgrade", () => {
  const s = base({ buildings: { kommandozentrale: 8, forschungsamt: 5, radarstation: 5 } });
  assert.deepEqual(missingRequirement(s, "startrampe", balance), { id: "radarstation", level: 6 });
  assert.equal((startUpgrade(s, "startrampe", 0, balance) as { code: string }).code, "building_requires");
  s.buildings.radarstation = 6;
  assert.equal(missingRequirement(s, "startrampe", balance), null);
  assert.equal(startUpgrade(s, "startrampe", 0, balance).ok, true);
  assert.equal(missingRequirement(base(), "stahlwerk", balance), null, "ohne Voraussetzung");
});

test("Tarnnetz: Ausguck und optischer Satellit erkennen nur Sichtung, Radar weiter Erkennung; Stufe 2 auch Felder", () => {
  const look: SensorCircle = { kind: "ausguck", x: 0, y: 0, km: 120 };
  const radar: SensorCircle = { kind: "radar", x: 0, y: 0, km: 300 };
  const opt: SensorCircle = { kind: "satellit", x: 0, y: 0, km: 0, strip: { x0: -300, x1: 300 } };
  assert.equal(liveLevelAt([look], 50, 0, "object", { camouflaged: true }), "sichtung");
  assert.equal(liveLevelAt([opt], 50, 0, "object", { camouflaged: true }), "sichtung");
  assert.equal(liveLevelAt([radar], 50, 0, "object", { camouflaged: true }), "erkennung");
  assert.equal(camoActive(1, "base", cb), true);
  assert.equal(camoActive(1, "field", cb), false);
  assert.equal(camoActive(2, "field", cb), true);
  assert.equal(camoActive(2, "post", cb), true);
  assert.equal(camoActive(0, "base", cb), false);
});

test("Störsender: −25 % je Stufe, höchstens 50 %, nur fremdes Radar im Umkreis 200 km, aus bei Strommangel", () => {
  assert.equal(jammerReduction(1, true, cb), 0.25);
  assert.equal(jammerReduction(2, true, cb), 0.5);
  assert.equal(jammerReduction(5, true, cb), 0.5);
  assert.equal(jammerReduction(2, false, cb), 0);
  const jammers = [{ x: 0, y: 0, playerId: 7, reduction: 0.5 }, { x: 100, y: 0, playerId: 8, reduction: 0.25 }];
  assert.equal(jammerFactorAt(50, 0, jammers, new Set([1]), cb), 0.5, "zusammen höchstens 50 %");
  assert.equal(jammerFactorAt(250, 0, jammers, new Set([1]), cb), 0.75, "nur der zweite im Umkreis");
  assert.equal(jammerFactorAt(50, 0, jammers, new Set([7]), cb), 0.75, "eigener Störsender stört das eigene Radar nicht");
  assert.equal(jammerFactorAt(500, 0, jammers, new Set([1]), cb), 1);
  const radar: SensorCircle = { kind: "radar", x: 0, y: 0, km: 300 };
  const look: SensorCircle = { kind: "ausguck", x: 0, y: 0, km: 120 };
  const rad: SensorCircle = { kind: "radarsatellit", x: 0, y: 0, km: 0, strip: { x0: -300, x1: 300 } };
  assert.equal(liveLevelAt([radar], 200, 0, "object", { radarFactor: 0.5 }), null, "Radar 300 km → 150 km");
  assert.equal(liveLevelAt([radar], 140, 0, "object", { radarFactor: 0.5 }), "erkennung");
  assert.equal(liveLevelAt([look], 100, 0, "object", { radarFactor: 0.5 }), "erkennung", "Ausguck ungestört");
  assert.equal(liveLevelAt([rad], 200, 0, "fleet", { radarFactor: 0.5 }), null, "Radarsatellit: Streifen um die Mitte schmaler");
  assert.equal(liveLevelAt([rad], 100, 0, "fleet", { radarFactor: 0.5 }), "sichtung");
});

test("Tarnanstrich und Funkdisziplin: Sichtweite auf Flugzeuge −20 % je Stufe, Admiral halbiert fremdes Radar", () => {
  assert.equal(paintFactor(0, cb), 1);
  assert.ok(Math.abs(paintFactor(2, cb) - 0.6) < 1e-9);
  const flug: SensorCircle = { kind: "verband", x: 0, y: 0, km: 100 };
  assert.equal(liveLevelAt([flug], 90, 0, "fleet", { sightFactor: paintFactor(1, cb) }), null, "100 km → 80 km");
  assert.equal(liveLevelAt([flug], 70, 0, "fleet", { sightFactor: paintFactor(1, cb) }), "erkennung");
  const radar: SensorCircle = { kind: "radar", x: 0, y: 0, km: 300 };
  assert.equal(liveLevelAt([radar], 200, 0, "fleet", { radarFactor: cb.admiralRadarFactor }), null, "Admiral: 300 → 150 km");
  assert.equal(liveLevelAt([radar], 200, 0, "fleet"), "sichtung");
});
