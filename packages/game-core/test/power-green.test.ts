// Ökostrom, Elektrolyse, Seekabel (v1.21): Elektrolyse nur aus Ökostrom, Kabelverlust, Grün-Anteil.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BaseState, Weather } from "../src/index.ts";
import {
  cableDelivered,
  greenModifiers,
  greenShare,
  integrateGrid,
  isGreenHarbor,
  transferCable,
  type PowerSnapshot,
} from "../src/index.ts";
import { HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const calm: Weather = { wind: 0, clouds: 0, fog: 0, daylight: 0, storm: false };
const breeze: Weather = { ...calm, wind: 0.5 };
const fixed = (w: Weather) => () => w;
const full = { stahl: 4000, treibstoff: 1000, elektronik: 1000, proviant: 1000 };

/** Erstes Stück der Fortschreibung bei festem Wetter. */
function first(base: BaseState, w: Weather): PowerSnapshot {
  let snap: PowerSnapshot | null = null;
  integrateGrid(base, base.resUpdatedAt + HOUR, balance, undefined, (s) => {
    snap = s;
    return true;
  }, fixed(w));
  return snap!;
}

test("Elektrolyse: nur Ökostrom-Überschuss wird Treibstoff; das Kraftwerk regelt nach", () => {
  // Kraftwerk 2 (120 Strom), Stahlwerk 1 (Bedarf 10), Elektrolyse 2 (80 Strom/h Aufnahme).
  const base = makeBase(balance, { buildings: { kraftwerk: 2, stahlwerk: 1, elektrolyse: 2 }, resources: full });
  const dark = first(base, calm);
  assert.equal(dark.fuelMade, 0);
  assert.equal(dark.surplus.fuel, 0);
  // Lastfolge: Das Kraftwerk deckt nur den Bedarf 10 von 120 → 1/12 von 6 Treibstoff/h, nichts verfällt.
  assert.ok(approx(dark.surplus.wasted, 0));
  assert.ok(approx(dark.throttle, 10 / 120));
  assert.ok(approx(dark.perHour.treibstoff, 10 - 0.5));
  // Windpark 2 bei Wind 0,5: 90 Ökostrom. Bedarf 10 aus Ökostrom, 80 in die Elektrolyse → 8 Treibstoff/h.
  const windy = makeBase(balance, { buildings: { kraftwerk: 2, stahlwerk: 1, elektrolyse: 2, windpark: 2 }, resources: full });
  const w = first(windy, breeze);
  assert.ok(approx(w.surplus.fuel, 80));
  assert.ok(approx(w.fuelMade, 8));
  assert.ok(approx(w.surplus.wasted, 0), `${w.surplus.wasted}`);
  assert.equal(w.supply.kraftwerk, 0); // Wind deckt den Bedarf, das Kraftwerk ruht
  assert.ok(approx(w.perHour.treibstoff, 10 + 8));
  const later = integrateGrid(windy, T0 + 2 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(approx(later.resources.treibstoff, 1000 + 2 * 18, 1e-6));
  assert.ok(approx(later.powerLog!.fuelMade, 16, 1e-6));
});

test("Elektrolyse kann das Kraftwerk ohne Treibstoff nicht antreiben (keine Endlosschleife)", () => {
  // Treibstoff 0, kein Zufluss: ohne Ökostrom läuft das Kraftwerk nicht an, auch mit Elektrolyse.
  const noTrickle = { ...balance, baseTricklePerHour: { ...balance.baseTricklePerHour, treibstoff: 0 } };
  const base = makeBase(noTrickle, { buildings: { kraftwerk: 5, stahlwerk: 5, elektrolyse: 5 }, resources: { ...full, treibstoff: 0 } });
  let snap: PowerSnapshot | null = null;
  integrateGrid(base, T0 + HOUR, noTrickle, undefined, (s) => { snap = s; return true; }, fixed(calm));
  assert.equal(snap!.supply.kraftwerk, 0);
  assert.equal(snap!.fuelMade, 0);
  // Mit Ökostrom: Elektrolyse liefert Treibstoff, das Kraftwerk verbrennt höchstens so viel (Rate ≥ 0).
  const windy = makeBase(noTrickle, { buildings: { kraftwerk: 5, stahlwerk: 5, elektrolyse: 5, windpark: 4 }, resources: { ...full, treibstoff: 0 } });
  const s2 = (() => {
    let x: PowerSnapshot | null = null;
    integrateGrid(windy, T0 + HOUR, noTrickle, undefined, (s) => { x = s; return true; }, fixed(breeze));
    return x!;
  })();
  assert.ok(s2.perHour.treibstoff >= -1e-6);
  assert.ok(s2.fuelMade <= 5 * 40 / 10 + 1e-9);
  // Mehr Kraftwerk ändert den Ökostrom-Überschuss nicht nach oben.
  assert.ok(s2.surplus.fuel <= 4 * 90 * 0.5 - 50 + 1e-6, `${s2.surplus.fuel}`);
});

test("Elektrolyse an der Lagergrenze: Treibstoff bleibt auf der Kapazität, der Rest verfällt", () => {
  const base = makeBase(balance, { buildings: { stahlwerk: 1, elektrolyse: 2, windpark: 2 }, resources: { ...full, treibstoff: 5000 } });
  const later = integrateGrid(base, T0 + 3 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(approx(later.resources.treibstoff, 5000, 1e-6));
  const s = first(base, breeze);
  assert.equal(s.fuelMade, 0);
  assert.ok(approx(s.surplus.wasted, 80));
});

test("Grün-Anteil: Wind deckt den Bedarf → Grüner Hafen (+3 %), Kraftwerk allein nicht", () => {
  const green = makeBase(balance, { buildings: { windpark: 2, stahlwerk: 3 }, resources: full });
  const g = integrateGrid(green, T0 + 24 * HOUR, balance, undefined, undefined, fixed(breeze));
  const s = greenShare(g, T0 + 24 * HOUR, balance);
  assert.ok(approx(s.share, 1));
  assert.ok(approx(s.total, 24 * 30, 1e-6));
  assert.ok(isGreenHarbor(g, T0 + 24 * HOUR, balance));
  assert.deepEqual(greenModifiers(g, T0 + 24 * HOUR, balance).production?.stahl, 1.03);
  assert.ok(approx(g.powerLog!.greenUsed, 24 * 30, 1e-6));
  const coal = makeBase(balance, { buildings: { kraftwerk: 1, stahlwerk: 3 }, resources: full });
  const c = integrateGrid(coal, T0 + 24 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.equal(greenShare(c, T0 + 24 * HOUR, balance).share, 0);
  assert.equal(isGreenHarbor(c, T0 + 24 * HOUR, balance), false);
  assert.deepEqual(greenModifiers(c, T0 + 24 * HOUR, balance), {});
  // Nach 30 h ohne Wind fällt der Hafen aus dem Fenster (Kraftwerk 1 deckt jetzt).
  const mixed = makeBase(balance, { buildings: { windpark: 2, kraftwerk: 1, stahlwerk: 3 }, resources: full });
  const m1 = integrateGrid(mixed, T0 + 24 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(isGreenHarbor(m1, T0 + 24 * HOUR, balance));
  const m2 = integrateGrid(m1, T0 + 54 * HOUR, balance, undefined, undefined, fixed(calm));
  assert.equal(isGreenHarbor(m2, T0 + 54 * HOUR, balance), false);
  assert.ok(m2.powerLog!.hours.length <= 25);
});

test("Speicher: aus Ökostrom geladen zählt beim Entladen als Ökostrom, aus dem Kraftwerk nicht", () => {
  // Tag: Wind lädt den Speicher (Bedarf 30, Wind 90, Speicherwerk 1: 200 / 40 je h). Nacht: Speicher deckt.
  const base = makeBase(balance, { buildings: { windpark: 2, speicherwerk: 1, stahlwerk: 3 }, resources: full, powerStored: 0 });
  const day = integrateGrid(base, T0 + 6 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(approx(day.powerStored!, 200, 1e-6));
  assert.ok(approx(day.powerLog!.storedGreen, 200, 1e-6));
  const night = integrateGrid(day, T0 + 8 * HOUR, balance, undefined, undefined, fixed(calm));
  const s = greenShare(night, T0 + 8 * HOUR, balance);
  assert.ok(approx(s.share, 1, 1e-9), `${s.share}`);
  // Lastfolge: Das Kraftwerk lädt den Speicher nicht (es deckt nur den Bedarf), es entsteht kein grauer Speicher.
  const coal = makeBase(balance, { buildings: { kraftwerk: 1, speicherwerk: 1, stahlwerk: 3 }, resources: full, powerStored: 0 });
  const c1 = integrateGrid(coal, T0 + 6 * HOUR, balance, undefined, undefined, fixed(calm));
  assert.ok(approx(c1.powerStored!, 0, 1e-6));
  assert.equal(c1.powerLog!.storedGreen, 0);
});

test("Seekabel: Abgebender schickt nur Ökostrom-Rest nach Elektrolyse bis zur Stationsleistung", () => {
  // Wind 90, Bedarf 10, Elektrolyse 1 (40) → Rest 40, Station 1 (30) → 30 ins Kabel, 10 verfällt.
  const out = makeBase(balance, { buildings: { windpark: 2, stahlwerk: 1, elektrolyse: 1, seekabel: 1, kraftwerk: 1 }, resources: full, cable: { id: 1, role: "out", sent: 0 } });
  const s = first(out, breeze);
  assert.ok(approx(s.surplus.fuel, 40));
  assert.ok(approx(s.surplus.cable, 30));
  assert.ok(approx(s.surplus.wasted, 10)); // Kraftwerk ruht (Lastfolge), nur Ökostrom-Rest verfällt
  const later = integrateGrid(out, T0 + 2 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(approx(later.cable!.sent!, 60, 1e-6));
  // Sabotage an der Station: nichts ins Kabel, bis sie endet.
  const sab = { ...out, intel: { sabotage: { target: "seekabel", fromMs: T0, untilMs: T0 + HOUR }, lastSabotageAtMs: T0 } };
  const s2 = integrateGrid(sab, T0 + 2 * HOUR, balance, undefined, undefined, fixed(breeze));
  assert.ok(approx(s2.cable!.sent!, 30, 1e-6), `${s2.cable!.sent}`);
});

test("Seekabel: Verlust je 100 km, Puffer, Kredite, Sabotage; Empfänger zieht bei Mangel", () => {
  assert.ok(approx(cableDelivered(300, balance), 0.7));
  assert.ok(approx(cableDelivered(600, balance), 0.4));
  const out = makeBase(balance, { buildings: { seekabel: 1 }, cable: { id: 1, role: "out", sent: 50 } });
  const inn = makeBase(balance, { buildings: { seekabel: 1, stahlwerk: 5 }, cable: { id: 1, role: "in", buffer: 0 } });
  const tr = transferCable(out, inn, 300, 0, 0, T0, balance);
  assert.ok(approx(tr.delivered, 35));
  assert.ok(approx(tr.lost, 15));
  assert.equal(tr.out.cable!.sent, 0);
  assert.ok(approx(tr.in.cable!.buffer!, 35));
  // Puffer: 30 je Stufe · 2 h = 60.
  const big = transferCable({ ...out, cable: { id: 1, role: "out", sent: 200 } }, inn, 0, 0, 0, T0, balance);
  assert.ok(approx(big.delivered, 60));
  // Preis 0,5: Empfänger mit 10 Krediten bekommt 20.
  const paid = transferCable(out, inn, 0, 0.5, 10, T0, balance);
  assert.ok(approx(paid.delivered, 20));
  assert.ok(approx(paid.cost, 10));
  // Sabotage am Empfänger: Sendung verloren.
  const sabIn = { ...inn, intel: { sabotage: { target: "seekabel", fromMs: T0 - 1, untilMs: T0 + HOUR } } };
  assert.equal(transferCable(out, sabIn, 0, 0, 0, T0, balance).delivered, 0);
  // Empfänger: Bedarf 50 ohne eigene Quelle, Puffer 35 → 30/h aus dem Kabel, nach 70 min leer.
  const got = integrateGrid(tr.in, T0 + 2 * HOUR, balance, undefined, undefined, fixed(calm));
  assert.ok(approx(got.cable!.buffer!, 0));
  assert.ok(approx(got.powerLog!.drawn, 35, 1e-6));
  const sh = greenShare(got, T0 + 2 * HOUR, balance);
  assert.ok(approx(sh.green, 35, 1e-6) && approx(sh.total, 35, 1e-6));
});

test("Fortschreibung in Teilen ergibt dasselbe wie am Stück (Ökostrom-Zähler, Speicher, Kabel)", () => {
  const base = makeBase(balance, {
    buildings: { windpark: 3, solarfeld: 2, speicherwerk: 2, elektrolyse: 2, seekabel: 1, kraftwerk: 1, stahlwerk: 4, raffinerie: 2 },
    resources: full, powerStored: 0, site: { lat: 55, lon: 4 }, cable: { id: 7, role: "out", sent: 0 },
  });
  const a = integrateGrid(base, T0 + 30 * HOUR, balance);
  let b = base;
  for (let h = 1; h <= 30; h++) b = integrateGrid(b, T0 + h * HOUR - 17 * 60000 * (h % 2), balance);
  b = integrateGrid(b, T0 + 30 * HOUR, balance);
  for (const r of balance.resources) assert.ok(approx(a.resources[r], b.resources[r], 1e-4), r);
  assert.ok(approx(a.powerStored!, b.powerStored!, 1e-4));
  assert.ok(approx(a.powerLog!.greenUsed, b.powerLog!.greenUsed, 1e-4));
  assert.ok(approx(a.powerLog!.storedGreen, b.powerLog!.storedGreen, 1e-4));
  assert.ok(approx(a.cable!.sent!, b.cable!.sent!, 1e-4));
});
