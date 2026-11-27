// Wettervorhersage (v1.18): Unsicherheit wächst mit dem Vorlauf, ist im Mittel unverzerrt, die Spannbreite deckt
// die meisten Fälle, Funkmesstechnik und Radar verbessern sie; das echte Wetter bleibt unverändert.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeoPoint, WeatherBalance } from "../src/index.ts";
import {
  forecastRange,
  forecastSkill,
  forecastSpread,
  forecastWeatherAt,
  integrateGrid,
  powerForecast,
  weatherAt,
} from "../src/index.ts";
import { HOUR, T0, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const wb = balance.weather!;
const PTS: GeoPoint[] = [
  { lat: 55, lon: 4 }, { lat: 39, lon: 4 }, { lat: 47, lon: -53 }, { lat: 50, lon: -4 }, { lat: 43, lon: 5 }, { lat: 60, lon: -20 },
];
const YEAR0 = Date.UTC(2026, 0, 1);

/** Simulation: mittlere absolute und mittlere vorzeichenbehaftete Abweichung bei `leadH` Stunden Vorlauf. */
function stats(leadH: number, factor = 1) {
  let n = 0, absWind = 0, biasWind = 0, absClouds = 0, biasClouds = 0, cover = 0;
  for (const p of PTS) {
    for (let i = 0; i < 300; i++) {
      const now = YEAR0 + i * 29 * HOUR + i * 7 * 60000;
      const t = now + leadH * HOUR;
      const f = forecastWeatherAt(p, t, now, wb, factor);
      const w = weatherAt(p, t, wb);
      absWind += Math.abs(f.wind - w.wind);
      biasWind += f.wind - w.wind;
      absClouds += Math.abs(f.clouds - w.clouds);
      biasClouds += f.clouds - w.clouds;
      const r = forecastRange(p, t, now, wb, factor);
      if (w.wind >= r.wind[0] - 1e-9 && w.wind <= r.wind[1] + 1e-9) cover++;
      n++;
    }
  }
  return { wind: absWind / n, windBias: biasWind / n, clouds: absClouds / n, cloudsBias: biasClouds / n, cover: cover / n };
}

test("Vorhersage: ohne Vorlauf und ohne Vorhersage-Block das echte Wetter", () => {
  const p = PTS[0];
  assert.deepEqual(forecastWeatherAt(p, T0, T0, wb), weatherAt(p, T0, wb));
  assert.deepEqual(forecastWeatherAt(p, T0 - HOUR, T0, wb), weatherAt(p, T0 - HOUR, wb));
  const plain: WeatherBalance = { ...wb, forecast: undefined };
  assert.deepEqual(forecastWeatherAt(p, T0 + 12 * HOUR, T0, plain), weatherAt(p, T0 + 12 * HOUR, plain));
  // Mit Vorlauf weicht sie ab (irgendwo auf 24 h), Tageslicht bleibt exakt.
  let differs = false;
  for (let h = 1; h <= 24; h++) {
    const f = forecastWeatherAt(p, T0 + h * HOUR, T0, wb);
    const w = weatherAt(p, T0 + h * HOUR, wb);
    if (Math.abs(f.wind - w.wind) > 1e-6) differs = true;
    assert.equal(f.daylight, w.daylight);
    assert.equal(f.storm, f.wind >= wb.stormFrom);
  }
  assert.ok(differs);
});

test("Vorhersage: Höchstabweichung nach Vorlauf (±5 % Wind je 3 h, höchstens ±30 %; Verschiebung bis ±3 h)", () => {
  const fb = wb.forecast!;
  assert.equal(forecastSpread(0, wb).wind, 0);
  assert.ok(Math.abs(forecastSpread(3, wb).wind - fb.windPer3h) < 1e-12);
  assert.ok(Math.abs(forecastSpread(12, wb).wind - 4 * fb.windPer3h) < 1e-12);
  assert.equal(forecastSpread(48, wb).wind, fb.windMax);
  assert.equal(forecastSpread(48, wb).shiftH, fb.shiftMaxHours);
  assert.equal(forecastSpread(48, wb).clouds, fb.cloudsMax);
  assert.ok(Math.abs(forecastSpread(48, wb, 0.6).wind - 0.6 * fb.windMax) < 1e-12);
});

test("Vorhersage: deterministisch und je Ausgabe fest (nichts flackert)", () => {
  const p = PTS[1];
  const issue = Math.floor(T0 / (3 * HOUR)) * 3 * HOUR;
  const t = issue + 15 * HOUR;
  const a = forecastWeatherAt(p, t, issue + 10 * 60000, wb);
  assert.deepEqual(a, forecastWeatherAt({ ...p }, t, issue + 10 * 60000, { ...wb }));
  // Zehn Minuten später (dieselbe Ausgabe): nur der Vorlauf ändert sich minimal.
  const b = forecastWeatherAt(p, t, issue + 20 * 60000, wb);
  assert.ok(Math.abs(a.wind - b.wind) < 0.02 && Math.abs(a.clouds - b.clouds) < 0.02);
});

test("Simulation: Abweichung wächst mit dem Vorlauf und ist im Mittel unverzerrt", () => {
  const s = [3, 6, 12, 18, 24].map((h) => stats(h));
  for (let i = 1; i < 4; i++) {
    assert.ok(s[i].wind > s[i - 1].wind * 1.3, `Wind ${i}: ${s[i].wind} > ${s[i - 1].wind}`);
    assert.ok(s[i].clouds > s[i - 1].clouds * 1.3, `Wolken ${i}: ${s[i].clouds} > ${s[i - 1].clouds}`);
  }
  assert.ok(s[4].wind >= s[3].wind * 0.9);
  for (const x of s) {
    // Im Mittel unverzerrt: Verzerrung klein gegen die mittlere Abweichung (Wolken leicht durch die Kappung bei 0/1).
    assert.ok(Math.abs(x.windBias) < 0.1 * x.wind + 0.002, `Wind-Verzerrung ${x.windBias} bei MAE ${x.wind}`);
    assert.ok(Math.abs(x.cloudsBias) < 0.15 * x.clouds + 0.002, `Wolken-Verzerrung ${x.cloudsBias} bei MAE ${x.clouds}`);
    // Spannbreite deckt die meisten Fälle.
    assert.ok(x.cover >= 0.75, `Abdeckung ${x.cover}`);
  }
  // Bei 24 h liegt der Wind im Mittel einige Prozentpunkte daneben, nach 3 h kaum.
  assert.ok(s[0].wind < 0.02 && s[4].wind > 0.04);
});

test("Funkmesstechnik und Radarstation verringern die Unsicherheit", () => {
  const plain = makeBase(balance);
  const radar = makeBase(balance, { buildings: { radarstation: 1 } });
  const best = makeBase(balance, { buildings: { radarstation: 3 }, research: { levels: { funkmesstechnik: 2 }, order: null } });
  assert.equal(forecastSkill(plain, wb), 1);
  assert.ok(Math.abs(forecastSkill(radar, wb) - 0.9) < 1e-12);
  // v1.24: 1 − 0,20 × 2 − 0,1 = 0,5 = minFactor (vorher 0,15 je Stufe: 0,6, minFactor nie erreicht).
  assert.ok(Math.abs(forecastSkill(best, wb) - 0.5) < 1e-12);
  assert.equal(forecastSkill(best, wb), wb.forecast!.minFactor);
  assert.equal(forecastSkill(best, { ...wb, forecast: { ...wb.forecast!, minFactor: 0.8 } }), 0.8);
  assert.equal(forecastSkill(best, { ...wb, forecast: undefined }), 1);
  const a = stats(24, 1);
  const b = stats(24, 0.6);
  assert.ok(b.wind < a.wind * 0.7 && b.clouds < a.clouds * 0.7, `${b.wind} < ${a.wind}`);
});

test("Stromkurve mit Vorhersage: echte Fortschreibung bleibt unverändert", () => {
  const base = makeBase(balance, {
    site: { lat: 55, lon: 4 },
    buildings: { kraftwerk: 2, windpark: 3, solarfeld: 2, speicherwerk: 1 },
    resUpdatedAt: T0,
  });
  const real = powerForecast(base, T0, 24, balance);
  const wx = (p: GeoPoint, ms: number) => forecastWeatherAt(p, ms, T0, wb);
  const fc = powerForecast(base, T0, 24, balance, undefined, wx);
  assert.equal(fc.length, 24);
  // Erste Stunde fast gleich, später Abweichungen im Wind.
  assert.ok(fc.some((h, i) => Math.abs(h.supply.wind - real[i].supply.wind) > 0.01));
  // Die echte Fortschreibung (settle) rechnet weiter mit dem echten Wetter.
  const a = integrateGrid(base, T0 + 12 * HOUR, balance);
  const b = integrateGrid(base, T0 + 12 * HOUR, balance, undefined, undefined, undefined);
  assert.deepEqual(a, b);
  assert.deepEqual(powerForecast(base, T0, 24, balance), real);
});
