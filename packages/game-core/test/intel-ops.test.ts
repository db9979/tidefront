// Lagebild Stufe 2 (intel-ops.ts): Patrouille, Runde, Sicht, Sonar, Abfangen, Radarposten, Kampagne, Desinformation,
// Bordsicht und die neuen Sensorarten in liveLevelAt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Balance } from "../src/index.ts";
import {
  campaignCheck, disinfoSize, dronesShot, fleetSightKm, interceptChance, liveLevelAt, loopLength, patrolCheck, patrolSightKm,
  pointOnLoop, postCrewCheck, postLimit, postRefund, sonarKm,
} from "../src/index.ts";

const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
const ib = balance.intel!;
const pb = ib.patrol!;
const defs = balance.units as unknown as Record<string, { branch?: string; submerged?: boolean; attack?: { uboot?: number } }>;

test("Balance v1.20: Stufe-2-Werte wie im Regelwerk", () => {
  assert.equal(balance.version, "v1.20");
  assert.deepEqual(pb.hours, [4, 8, 12]);
  assert.equal(pb.shipSightKm, 100);
  assert.equal(pb.droneSightKm, 200);
  assert.equal(ib.post!.rangeKm, 250);
  assert.equal(ib.campaign!.revealKm, 150);
  assert.equal(ib.sonar!.baseKm, 60);
  assert.equal(ib.fleetSight!.warshipKm, 80);
});

test("patrolCheck: Einheiten, Wegpunkte, Dauer, Drohnen", () => {
  assert.equal(patrolCheck({ korvette: 2 }, 4, 2, 300, defs, pb).ok, true);
  assert.equal(patrolCheck({ pioniere: 2 }, 4, 2, 300, defs, pb).ok === false && "patrol_units", "patrol_units");
  const c = (u: Record<string, number>, h: number, w: number, km: number) => { const r = patrolCheck(u, h, w, km, defs, pb); return r.ok ? "ok" : r.code; };
  assert.equal(c({ korvette: 1 }, 4, 1, 100), "patrol_waypoints");
  assert.equal(c({ korvette: 1 }, 4, 5, 100), "patrol_waypoints");
  assert.equal(c({ korvette: 1 }, 6, 2, 100), "patrol_hours");
  assert.equal(c({ aufklaerungsdrohne: 1 }, 8, 2, 100), "patrol_drone_hours");
  assert.equal(c({ aufklaerungsdrohne: 1 }, 4, 2, 801), "patrol_drone_range");
  assert.equal(c({ aufklaerungsdrohne: 1, uboot: 1 }, 4, 2, 500), "ok");
  assert.equal(c({}, 4, 2, 100), "empty_fleet");
  assert.equal(patrolCheck({ korvette: 1 }, 4, 2, 100, defs, null).ok, false);
});

test("Runde: Länge und Position wandern im Kreis", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.equal(loopLength(pts), 200);
  assert.deepEqual(pointOnLoop(pts, 50), { x: 50, y: 0 });
  assert.deepEqual(pointOnLoop(pts, 150), { x: 50, y: 0 });
  assert.deepEqual(pointOnLoop(pts, 250), { x: 50, y: 0 });
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const p = pointOnLoop(sq, 15);
  assert.equal(p.x, 10);
  assert.equal(p.y, 5);
});

test("Sicht und Sonar: Drohnen 200, Schiffe 100, U-Boote nur Sonar; U-Jagd 60 + 40 je Stufe", () => {
  assert.equal(patrolSightKm({ korvette: 1 }, defs, pb), 100);
  assert.equal(patrolSightKm({ korvette: 1, aufklaerungsdrohne: 1 }, defs, pb), 200);
  assert.equal(patrolSightKm({ uboot: 3 }, defs, pb), 0);
  assert.equal(sonarKm({ korvette: 1 }, defs, 0, ib.sonar, false), 60);
  assert.equal(sonarKm({ zerstoerer: 1 }, defs, 2, ib.sonar, true), 140);
  assert.equal(sonarKm({ uboot: 1 }, defs, 2, ib.sonar, true), 60, "U-Boote auf Patrouille: 60 km");
  assert.equal(sonarKm({ uboot: 1 }, defs, 2, ib.sonar, false), 0);
  assert.equal(sonarKm({ landungsschiff: 1 }, defs, 2, ib.sonar, true), 0);
});

test("Abfangen: 15 % je Jäger, höchstens 75 %; Würfe deterministisch", () => {
  assert.equal(interceptChance(1, pb), 0.15);
  assert.equal(interceptChance(4, pb), 0.6);
  assert.equal(interceptChance(9, pb), 0.75);
  assert.equal(dronesShot(5, 0, 1), 0);
  assert.equal(dronesShot(5, 1, 1), 5);
  assert.equal(dronesShot(10, 0.5, 42), dronesShot(10, 0.5, 42));
  let total = 0;
  for (let s = 1; s <= 400; s++) total += dronesShot(10, 0.75, s);
  assert.ok(Math.abs(total / 4000 - 0.75) < 0.03, `Mittel ${total / 4000}`);
});

test("Radarposten: Besatzung, Höchstzahl, Rückerstattung; Kampagne bis 4 Ziele", () => {
  const post = ib.post!;
  assert.equal(postCrewCheck({ pioniere: 5, landungsschiff: 1 }, post).ok, true);
  assert.equal(postCrewCheck({ pioniere: 4, landungsschiff: 1 }, post).ok, false);
  assert.equal(postCrewCheck({ pioniere: 9 }, post).ok, false);
  assert.equal(postLimit(7, post), 2);
  assert.equal(postLimit(8, post), 3);
  assert.deepEqual(postRefund(post), { stahl: 750, elektronik: 500 });
  const t = (n: number) => Array.from({ length: n }, (_, i) => ({ col: i, row: 0 }));
  assert.equal(campaignCheck(t(4), ib.campaign!).ok, true);
  assert.equal(campaignCheck(t(5), ib.campaign!).ok, false);
  assert.equal(campaignCheck([{ col: 1, row: 1 }, { col: 1, row: 1 }], ib.campaign!).ok, false, "kein Ziel doppelt");
});

test("Desinformation: Größenklasse genau eine Stufe daneben", () => {
  assert.equal(disinfoSize("klein", 1), "mittel");
  assert.equal(disinfoSize("gross", 1), "mittel");
  assert.equal(disinfoSize("mittel", 2), "gross");
  assert.equal(disinfoSize("mittel", 3), "klein");
});

test("Bordsicht: beste Einheit zählt; Flugzeuge nur Sichtung von Verbänden", () => {
  const fs = ib.fleetSight;
  assert.deepEqual(fleetSightKm({ korvette: 1, landungsschiff: 2 }, defs, fs), { recognizeKm: 80, sightKm: 0 });
  assert.deepEqual(fleetSightKm({ landungsschiff: 2, schuetzen: 10 }, defs, fs), { recognizeKm: 40, sightKm: 0 });
  assert.deepEqual(fleetSightKm({ aufklaerungsdrohne: 1 }, defs, fs), { recognizeKm: 200, sightKm: 0 });
  assert.deepEqual(fleetSightKm({ jagdbomber: 4 }, defs, fs), { recognizeKm: 0, sightKm: 120 });
  assert.deepEqual(fleetSightKm({ uboot: 4 }, defs, fs), { recognizeKm: 0, sightKm: 0 });
  const sensors = [{ kind: "flug" as const, x: 0, y: 0, km: 120 }, { kind: "sonar" as const, x: 500, y: 0, km: 60 }];
  assert.equal(liveLevelAt(sensors, 50, 0, "fleet"), "sichtung");
  assert.equal(liveLevelAt(sensors, 50, 0, "object"), null, "Flug erfasst keine Objekte");
  assert.equal(liveLevelAt(sensors, 520, 0, "object"), null, "Sonar erfasst keine Objekte");
  assert.equal(liveLevelAt(sensors, 520, 0, "submarine"), "erkennung");
  assert.equal(liveLevelAt([{ kind: "posten", x: 0, y: 0, km: 250 }], 200, 0, "fleet"), "sichtung");
  assert.equal(liveLevelAt([{ kind: "verband", x: 0, y: 0, km: 80 }], 60, 0, "object"), "erkennung");
});
