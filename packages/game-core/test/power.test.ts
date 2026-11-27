import { test } from "node:test";
import assert from "node:assert/strict";
import type { BaseState, GeoPoint } from "../src/index.ts";
import {
  completeTraining,
  powerAt,
  powerForecast,
  productionRates,
  radarWarningMinutes,
  settle,
  startResearch,
  startTraining,
  sunshine,
  weatherAt,
} from "../src/index.ts";
import { DAY, HOUR, T0, approx, loadBalance, makeBase } from "./helpers.ts";

const balance = loadBalance();
const wb = balance.weather!;
const rich = { stahl: 1e7, treibstoff: 1e7, elektronik: 1e7, proviant: 1e7 };
const NORDSEE: GeoPoint = { lat: 55, lon: 4 };
const MITTELMEER: GeoPoint = { lat: 39, lon: 4 };
const stahl = (l: number) => 120 * 1.15 ** (l - 1);

test("Kraftwerk verbraucht Treibstoff je Stufe", () => {
  const base = makeBase(balance, { buildings: { kraftwerk: 3, stahlwerk: 1 } });
  const g = powerAt(base, T0, balance);
  // Volllast 180 Strom / 9 Treibstoff; Lastfolge: Bedarf 10 → 1/18 Auslastung.
  assert.ok(approx(g.throttle, 10 / 180));
  assert.ok(approx(g.fuelPerHour, 0.5));
  assert.ok(approx(g.supply.kraftwerk, 10));
  assert.ok(approx(g.perHour.treibstoff, 10 - 0.5));
  assert.equal(g.fuelLimited, false);
  assert.equal(g.served.production, 1);
});

test("Kraftwerk regelt nach: mehr Bedarf, mehr Brennstoff; nie über Volllast", () => {
  const small = powerAt(makeBase(balance, { buildings: { kraftwerk: 5, stahlwerk: 2 } }), T0, balance);
  const large = powerAt(makeBase(balance, { buildings: { kraftwerk: 5, stahlwerk: 5 } }), T0, balance);
  assert.ok(approx(small.fuelPerHour, 15 * 20 / 300));
  assert.ok(approx(large.fuelPerHour, 15 * 50 / 300));
  const over = powerAt(makeBase(balance, { buildings: { kraftwerk: 1, stahlwerk: 9 } }), T0, balance);
  assert.equal(over.throttle, 1);
  assert.ok(over.served.production < 1);
});

test("Kraftwerk ohne Treibstoff: verbrennt nur, was nachkommt; Bestand bleibt 0", () => {
  // Bedarf 5 * 10 = 50; Kraftwerk 5 (300 Strom, 15 Treibstoff/h), Lastfolge braucht 2,5/h. Zufluss nur 1/h.
  const low = { ...balance, baseTricklePerHour: { ...balance.baseTricklePerHour, treibstoff: 1 } };
  const base = makeBase(low, { buildings: { kraftwerk: 5, stahlwerk: 5 }, resources: { treibstoff: 0 } });
  const g = powerAt(base, T0, low);
  assert.ok(Math.abs(g.throttle - 1 / 15) < 1e-5, `${g.throttle}`);
  assert.equal(g.fuelLimited, true);
  assert.ok(g.perHour.treibstoff >= 0 && g.perHour.treibstoff < 1e-3);
  assert.ok(approx(g.served.production, 20 / 50, 1e-4));
  const later = settle(base, T0 + 10 * HOUR, low);
  assert.ok(later.resources.treibstoff < 0.01);
  // Mit 5 Treibstoff: netto −1,5/h, nach 3⅓ h leer, danach gedrosselt.
  const some = makeBase(low, { buildings: { kraftwerk: 5, stahlwerk: 5 }, resources: { treibstoff: 5 } });
  const s1 = settle(some, T0 + 0.5 * HOUR, low);
  assert.ok(approx(s1.resources.treibstoff, 5 - 0.75));
  const s2 = settle(some, T0 + 4 * HOUR, low);
  assert.ok(s2.resources.treibstoff < 0.01);
  // Ohne jeden Zufluss liefert es nichts: Stahl nur aus der Grundrate.
  const dry = makeBase(balance, { buildings: { kraftwerk: 5, stahlwerk: 5 }, resources: { treibstoff: 0 } });
  const noTrickle = { ...balance, baseTricklePerHour: { ...balance.baseTricklePerHour, treibstoff: 0 } };
  const d = powerAt(dry, T0, noTrickle);
  assert.equal(d.supply.kraftwerk, 0);
  assert.equal(d.served.production, 0);
  assert.equal(productionRates(dry, noTrickle).perHour.stahl, 20);
});

test("Rangfolge bei Mangel: Radar vor Produktion vor Ausbildung vor Forschung", () => {
  // Angebot 60. Radar 4 (20), Stahlwerk 5 (50), Kaserne 2 (6, läuft), Forschungsamt 1 (5, läuft).
  const base = makeBase(balance, { buildings: { kraftwerk: 1, radarstation: 4, stahlwerk: 5, kaserne: 2, forschungsamt: 1 }, resources: rich });
  const t = startTraining(base, "schuetzen", 10, T0, balance);
  assert.ok(t.ok);
  const g = powerAt(t.base, T0 + 1000, balance);
  assert.deepEqual(g.demand, { radar: 20, production: 50, training: 6, research: 0 });
  assert.equal(g.served.radar, 1);
  assert.ok(approx(g.served.production, 40 / 50));
  assert.equal(g.served.training, 0);
  assert.ok(approx(productionRates(t.base, balance, undefined, T0 + 1000).perHour.stahl, 20 + stahl(5) * 0.8));
  // Mehr Strom: Produktion voll, Ausbildung teilweise.
  const more = { ...t.base, buildings: { ...t.base.buildings, kraftwerk: 2, stahlwerk: 1 } };
  const g2 = powerAt(more, T0 + 1000, balance);
  assert.equal(g2.served.production, 1);
  assert.equal(g2.served.training, 1);
  const tight = { ...t.base, buildings: { ...t.base.buildings, stahlwerk: 4 } };
  const g3 = powerAt(tight, T0 + 1000, balance);
  assert.ok(approx(g3.served.production, 1));
  assert.ok(approx(g3.served.training, 0)); // 60 − 20 − 40 = 0
});

test("Radar ohne volle Versorgung: Vorwarnzeit anteilig, ohne Strom keine", () => {
  // Radar 20: Bedarf 100, Angebot 60 → 60 %.
  const half = makeBase(balance, { buildings: { radarstation: 20, kraftwerk: 1 } });
  assert.ok(approx(radarWarningMinutes(half, balance), (10 + 5 * 20) * 0.6));
  const none = makeBase(balance, { buildings: { radarstation: 3 } });
  assert.equal(radarWarningMinutes(none, balance), 0);
});

test("Speicherwerk lädt Überschuss und puffert Mangel", () => {
  const sp = balance.buildings.speicherwerk;
  const cap = sp.storagePerLevel!;
  const rate = sp.storageRatePerLevel!;
  // Lastfolge: Das Kraftwerk deckt nur den Bedarf und lädt den Speicher nicht (Laden nur aus Ökostrom, s. power-green).
  const base = makeBase(balance, { buildings: { kraftwerk: 1, stahlwerk: 2, speicherwerk: 1 } });
  assert.equal(settle(base, T0 + 2 * HOUR, balance).powerStored ?? 0, 0);
  // Voller Speicher ohne Kraftwerk: 20/h Entladung → cap/20 h volle Produktion, dann nichts.
  const stored: BaseState = { ...makeBase(balance, { buildings: { stahlwerk: 2, speicherwerk: 1 } }), powerStored: cap };
  const g = powerAt(stored, T0, balance);
  assert.equal(g.supply.storage, 20);
  assert.equal(g.served.production, 1);
  const hours = cap / 20 + 2;
  const after = settle(stored, T0 + hours * HOUR, balance);
  assert.equal(after.powerStored, 0);
  assert.ok(approx(after.resources.stahl, 2000 + 20 * hours + stahl(2) * (cap / 20), 1e-6));
  // Entladeleistung begrenzt: Bedarf 2 · rate.
  const big: BaseState = { ...makeBase(balance, { buildings: { stahlwerk: (2 * rate) / 10, speicherwerk: 1 } }), powerStored: cap };
  assert.ok(approx(powerAt(big, T0, balance).served.production, 0.5));
});

test("Windpark folgt dem Wind und schaltet im Sturm ab; Solarfeld folgt der Sonne", () => {
  const site = NORDSEE;
  let sawStorm = false;
  let sawWind = false;
  for (let h = 0; h < 60 * 24; h++) {
    const t = T0 + h * HOUR;
    const base: BaseState = { ...makeBase(balance, { buildings: { windpark: 2, solarfeld: 1 } }), site };
    const g = powerAt(base, t, balance);
    const w = g.weather!;
    if (w.wind > 0.95) {
      sawStorm = true;
      assert.equal(g.supply.wind, 0);
    } else {
      if (w.wind > 0.3) sawWind = true;
      assert.ok(approx(g.supply.wind, balance.buildings.windpark.windPowerPerLevel! * 2 * w.wind));
    }
    assert.ok(approx(g.supply.solar, balance.buildings.solarfeld.solarPowerPerLevel! * sunshine(w, 0.7)));
    if (w.daylight === 0) assert.equal(g.supply.solar, 0);
  }
  assert.ok(sawWind && sawStorm);
});

test("Stromintegration: Fortschreibung in Teilen ergibt dasselbe wie in einem Stück", () => {
  const base: BaseState = {
    ...makeBase(balance, { buildings: { windpark: 2, solarfeld: 2, speicherwerk: 2, stahlwerk: 8, raffinerie: 4, kraftwerk: 1, radarstation: 2 }, resources: { treibstoff: 20 } }),
    site: NORDSEE,
  };
  const once = settle(base, T0 + 3 * DAY, balance);
  let step = base;
  for (const h of [1.3, 7, 7.25, 20, 33.9, 50, 71]) step = settle(step, T0 + h * HOUR, balance);
  step = settle(step, T0 + 3 * DAY, balance);
  for (const r of balance.resources) assert.ok(approx(once.resources[r], step.resources[r], 1e-6), `${r} ${once.resources[r]} ${step.resources[r]}`);
  assert.ok(approx(once.powerStored!, step.powerStored!, 1e-6));
  // Schwankendes Angebot: andere Produktion als mit dem Augenblickswert hochgerechnet.
  const naive = base.resources.stahl + productionRates(base, balance).perHour.stahl * 72;
  assert.ok(Math.abs(once.resources.stahl - naive) > 1);
});

test("Ort zählt: Windpark an der Nordsee, Solarfeld im Mittelmeer im Mittel stärker", () => {
  const avg = (site: GeoPoint, id: "windpark" | "solarfeld") => {
    let sum = 0;
    for (let h = 0; h < 120 * 24; h += 2) {
      const g = powerAt({ ...makeBase(balance, { buildings: { [id]: 1 } }), site }, T0 + h * HOUR, balance);
      sum += g.supply.wind + g.supply.solar;
    }
    return sum / (120 * 12);
  };
  assert.ok(avg(NORDSEE, "windpark") > 1.5 * avg(MITTELMEER, "windpark"));
  assert.ok(avg(MITTELMEER, "solarfeld") > 1.5 * avg(NORDSEE, "solarfeld"));
});

test("Ausbildung ohne Strom langsamer; Fertigstellung beim Start fest und konsistent", () => {
  const powered = makeBase(balance, { buildings: { kaserne: 1, kraftwerk: 1 }, resources: rich });
  const dark = makeBase(balance, { buildings: { kaserne: 1 }, resources: rich });
  const a = startTraining(powered, "schuetzen", 10, T0, balance);
  const b = startTraining(dark, "schuetzen", 10, T0, balance);
  assert.ok(a.ok && b.ok);
  assert.equal(a.order.finishesAt, T0 + 300 * 1000);
  // Ohne Strom: Mindesttempo power.minSpeed (0,25).
  assert.equal(b.order.finishesAt, T0 + 300 * 1000 / balance.power!.minSpeed);
  assert.deepEqual(completeTraining(b.base, b.order.finishesAt - 1, balance), { ok: false, code: "not_finished" });
  const done = completeTraining(b.base, b.order.finishesAt, balance);
  assert.ok(done.ok);
  assert.equal(done.base.units.schuetzen, 10);
  // Halbe Versorgung im Rang 3: Kraftwerk 1 (60) − Stahlwerk 6 (60) = 0, mit Stahlwerk 5 bleiben 10 für Bedarf 3·…
  const partial = makeBase(balance, { buildings: { kaserne: 2, kraftwerk: 1, stahlwerk: 5, radarstation: 1 }, resources: rich });
  // Angebot 60 − Radar 5 − Produktion 50 = 5 für Kaserne 2 (Bedarf 6) → 5/6.
  const c = startTraining(partial, "schuetzen", 10, T0, balance);
  assert.ok(c.ok);
  const work = Math.ceil((300 / 1.1) * 1000);
  assert.ok(Math.abs(c.order.finishesAt - (T0 + work / (5 / 6))) <= 2, `${c.order.finishesAt - T0}`);
});

test("Forschung ohne Strom langsamer (Rang 4)", () => {
  const powered = makeBase(balance, { buildings: { forschungsamt: 1, kraftwerk: 1 }, resources: rich });
  const dark = makeBase(balance, { buildings: { forschungsamt: 1 }, resources: rich });
  const a = startResearch(powered, "hochofen", T0, balance, undefined, 1);
  const b = startResearch(dark, "hochofen", T0, balance, undefined, 1);
  assert.ok(a.ok && b.ok);
  assert.equal(a.order.finishesAt, T0 + 7200 * 1000);
  assert.equal(b.order.finishesAt, T0 + (7200 * 1000) / balance.power!.minSpeed);
});

test("Stromkurve: 24 Stunden mit Angebot nach Quelle, Bedarf nach Rang und Speicher", () => {
  const base: BaseState = {
    ...makeBase(balance, { buildings: { windpark: 1, solarfeld: 1, speicherwerk: 1, stahlwerk: 3, radarstation: 1 } }),
    site: MITTELMEER,
  };
  const f = powerForecast(base, T0, 24, balance);
  assert.equal(f.length, 24);
  for (const h of f) {
    assert.ok(approx(h.demand.radar, 5) && approx(h.demand.production, 30));
    assert.ok(h.stored >= 0 && h.stored <= balance.buildings.speicherwerk.storagePerLevel!);
    const w = weatherAt(MITTELMEER, h.atMs, wb);
    if (w.daylight === 0 && weatherAt(MITTELMEER, h.atMs + 30 * 60000, wb).daylight === 0) assert.equal(h.supply.solar, 0);
  }
  // Mittags Sonne, nachts nicht.
  assert.ok(f.some((h) => h.supply.solar > 10) && f.some((h) => h.supply.solar === 0));
});
