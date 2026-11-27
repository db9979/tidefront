// Mehrere Häfen: Ortsnamen der Karte für neue Kolonien (packages/world/src/places.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COAST_PLACES, LAT0, LAT1, LON0, LON1, PLACE_FAR_KM, PLACE_NEAR_KM, TRADE_PORTS, nearestPlace, placeNameAt } from "@tidefront/world";

test("Küstenorte liegen im Kartenausschnitt, Namen eindeutig, kurz und ohne Handelshäfen", () => {
  const names = new Set<string>();
  const ports = new Set(TRADE_PORTS.map(([, , n]) => n));
  for (const p of COAST_PLACES) {
    assert.ok(p.lon >= LON0 && p.lon <= LON1 && p.lat >= LAT0 && p.lat <= LAT1, p.name);
    assert.ok(!names.has(p.name), `doppelt: ${p.name}`);
    assert.ok(!ports.has(p.name), `Handelshafen: ${p.name}`);
    // „Küste bei <Ort> III“ passt in 32 Zeichen.
    assert.ok(`Küste bei ${p.name} III`.length <= 32, p.name);
    names.add(p.name);
  }
  assert.ok(COAST_PLACES.length >= 100);
});

test("placeNameAt: Ort in der Nähe, sonst „Küste bei …“, weit draußen „Posten <Meer>“", () => {
  assert.equal(placeNameAt({ lon: -4.5, lat: 48.4 }), "Brest");
  const near = nearestPlace({ lon: -4.5, lat: 48.4 });
  assert.ok(near.distanceKm < PLACE_NEAR_KM);
  // 2° nördlich von Bergen (gut 200 km): noch in Reichweite, aber nicht „am Ort“.
  const mid = { lon: 5.3, lat: 62.4 };
  const m = nearestPlace(mid);
  if (m.distanceKm > PLACE_NEAR_KM && m.distanceKm <= PLACE_FAR_KM) assert.equal(placeNameAt(mid), `Küste bei ${m.name}`);
  // Mitten im Atlantik: kein Ort im Umkreis.
  const far = placeNameAt({ lon: -40, lat: 45 });
  assert.ok(far?.startsWith("Posten "), far ?? "null");
  for (let lon = LON0; lon <= LON1; lon += 7) for (let lat = LAT0; lat <= LAT1; lat += 5) {
    const n = placeNameAt({ lon, lat });
    assert.ok(n && n.length <= 28, `${lon}/${lat}: ${n}`);
  }
});
