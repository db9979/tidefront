// Konvois: Position entlang der Route über Wasser (convoyPosition, gemeinsam für Server und Karte), Abfangpunkt
// entlang der Route, Kartellchance und erwarteter Verlust der Börsen-/Vertragskonvois, Größenklasse der Ladung.
// Entscheidung „Konvois: Börse und Verträge auf See“ (ENTSCHEIDUNGEN-5.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexAtLonLat, hexAtXY, hexCenter, hexCenterXY, isNavigable, seaRoute } from "@tidefront/world";
import {
  buildRoute, cargoSizeClass, cartelChance, cartelExpectedLoss, convoyPosition, convoysOf, interceptPoint, routePosition,
} from "../src/index.ts";
import { loadBalance } from "./helpers.ts";

const balance = loadBalance();
const GENUA = hexAtLonLat(8.9, 44.4);
const VENEDIG = hexAtLonLat(12.3, 45.4);
const H = 3_600_000;

test("Konvoi: Position folgt der Route (Genua → Venedig um Italien), nicht der Geraden", () => {
  const route = seaRoute(GENUA, VENEDIG);
  assert.ok(route.hexes.length >= 3);
  const c = { route, from: GENUA, to: VENEDIG, departAtMs: 0, arriveAtMs: 40 * H };
  // Start und Ziel
  assert.deepEqual(hexAtXY(convoyPosition(c, 0).at.x, convoyPosition(c, 0).at.y), GENUA);
  assert.deepEqual(hexAtXY(convoyPosition(c, 40 * H).at.x, convoyPosition(c, 40 * H).at.y), VENEDIG);
  // Unterwegs immer auf befahrbarem Feld, und zur Hälfte weit weg von der Geraden (südlich um den Stiefel).
  for (let t = 0; t <= 40; t++) {
    const p = convoyPosition(c, t * H).at;
    const h = hexAtXY(p.x, p.y);
    assert.ok(isNavigable(h.col, h.row), `t=${t} h: ${h.col}/${h.row} befahrbar`);
  }
  const mid = convoyPosition(c, 20 * H).at;
  const a = hexCenterXY(GENUA.col, GENUA.row);
  const b = hexCenterXY(VENEDIG.col, VENEDIG.row);
  const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  assert.ok(Math.hypot(mid.x - straight.x, mid.y - straight.y) > 300, "Mitte der Fahrt liegt nicht auf der Geraden");
  // Ohne Route: gerade (alte Daten).
  const g = convoyPosition({ ...c, route: null }, 20 * H).at;
  assert.ok(Math.hypot(g.x - straight.x, g.y - straight.y) < 1);
});

test("Konvoi: Server-Route (Grad, buildRoute) und Kartenposition (convoyPosition) stimmen überein", () => {
  const route = seaRoute(GENUA, VENEDIG);
  const geo = buildRoute(route.hexes.map(([c, r]) => hexCenter(c, r)), 0, 40 * H);
  for (const t of [5, 13, 21, 34]) {
    const p = routePosition(geo, t * H);
    const s = hexAtLonLat(p.lon, p.lat);
    const m = convoyPosition({ route, from: GENUA, to: VENEDIG, departAtMs: 0, arriveAtMs: 40 * H }, t * H).at;
    const k = hexAtXY(m.x, m.y);
    assert.ok(Math.abs(s.col - k.col) <= 1 && Math.abs(s.row - k.row) <= 1, `t=${t} h: ${s.col}/${s.row} ≈ ${k.col}/${k.row}`);
  }
});

test("Konvoi: Abfangpunkt liegt auf der Route", () => {
  const route = seaRoute(GENUA, VENEDIG);
  const geo = buildRoute(route.hexes.map(([c, r]) => hexCenter(c, r)), 0, 40 * H);
  const hunter = hexCenter(hexAtLonLat(15.5, 38.5).col, hexAtLonLat(15.5, 38.5).row); // Messina
  const hit = interceptPoint(geo, hunter, 40, 0);
  assert.ok(hit);
  const onRoute = convoyPosition({ route, from: GENUA, to: VENEDIG, departAtMs: 0, arriveAtMs: 40 * H }, hit!.atMs).at;
  const h = hexAtLonLat(hit!.point.lon, hit!.point.lat);
  const k = hexAtXY(onRoute.x, onRoute.y);
  assert.ok(Math.abs(h.col - k.col) <= 1 && Math.abs(h.row - k.row) <= 1);
});

test("Börsen- und Vertragskonvois: Kartellchance gedämpft, erwarteter Verlust ohne Geleit höchstens 2,4 %", () => {
  const c = convoysOf(balance)!;
  assert.ok(c.marketChanceFactor! < 1 && c.marketMaxChance! <= c.cartelMaxChance);
  // Typischer Kauf: 400 km, 5.000 Stahl (Warenwert 5.000).
  const typical = cartelExpectedLoss(400, 5000, balance, true);
  assert.ok(typical > 0 && typical <= 0.015, `typisch ${(typical * 100).toFixed(2)} %`);
  // Ungünstigster Kauf: weit und wertvoll – Obergrenze.
  const worst = cartelExpectedLoss(3000, 60000, balance, true);
  assert.ok(Math.abs(worst - c.marketMaxChance! * c.lossShareUnescorted) < 1e-9);
  assert.ok(worst <= 0.03, `höchstens ${(worst * 100).toFixed(2)} %`);
  // Handelskonvois unverändert, unter der Mindeststrecke nie.
  assert.equal(cartelChance(400, 5000, balance), Math.min(c.cartelMaxChance, c.cartelBaseChance + 0.04 + 0.02));
  assert.equal(cartelChance(100, 5000, balance, true), 0);
});

test("Konvoi: Größenklasse der Ladung nach Warenwert", () => {
  assert.equal(cargoSizeClass({ stahl: 500 }, balance), "klein");
  assert.equal(cargoSizeClass({ elektronik: 2000 }, balance), "mittel");
  assert.equal(cargoSizeClass({ stahl: 40000 }, balance), "gross");
});
