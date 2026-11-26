import { test } from "node:test";
import assert from "node:assert/strict";
import { EARTH_RADIUS_KM, distanceKm } from "../src/index.ts";

test("Entfernung null für denselben Punkt", () => {
  assert.equal(distanceKm({ lat: 53.5, lon: 10 }, { lat: 53.5, lon: 10 }), 0);
});

test("ein Grad Länge am Äquator sind etwa 111,19 km", () => {
  const d = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(d - (EARTH_RADIUS_KM * Math.PI) / 180) < 1e-9);
  assert.ok(Math.abs(d - 111.19) < 0.01);
});

test("Hamburg - München etwa 612 km, symmetrisch", () => {
  const hamburg = { lat: 53.5511, lon: 9.9937 };
  const muenchen = { lat: 48.1351, lon: 11.582 };
  const d = distanceKm(hamburg, muenchen);
  assert.ok(Math.abs(d - 612) < 3, String(d));
  assert.equal(distanceKm(muenchen, hamburg), d);
});

test("Antipoden: halber Erdumfang; über die Datumsgrenze kurz", () => {
  const d = distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
  assert.ok(Math.abs(d - Math.PI * EARTH_RADIUS_KM) < 1e-6);
  const short = distanceKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 });
  assert.ok(Math.abs(short - 111.19) < 0.01);
});
