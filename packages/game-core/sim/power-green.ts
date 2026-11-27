// Simulation Ökostrom, Elektrolyse, Seekabel (v1.21). Fragen:
// 1. Ist Ökostrom ein Muss? Wert des Bonus (+3 % Produktion) gegen die Kosten der Wind-/Sonnenstufen; Anteil der
//    Stunden mit Bonus je Lage und Ausbau; Kraftwerk allein bleibt ohne Bonus, aber voll versorgt.
// 2. Flutet die Elektrolyse die Treibstoff-Börse? Treibstoff aus Elektrolyse je Tag gegen die Raffinerie.
// 3. Seekabel: Energie bleibt erhalten (Verlust, keine Verdopplung); was nützt es dem Empfänger?
// 4. Wochenziel und Erfolg: erreichbare Ökostrom-Mengen je Woche und Saison.
// Aufruf: node packages/game-core/sim/power-green.ts (auch Teil von npm run sim).
import { readFileSync } from "node:fs";
import type { Balance, BaseState, GeoPoint } from "../src/index.ts";
import {
  cableDelivered, createBase, greenModifiers, greenShare, integrateGrid, isGreenHarbor, powerAt, transferCable, upgradeCost,
} from "../src/index.ts";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MARCH = Date.UTC(2026, 2, 1);
const NOV = Date.UTC(2026, 10, 1);
const PLACES: [string, GeoPoint][] = [["Nordsee", { lat: 55, lon: 4 }], ["Biskaya", { lat: 45, lon: -4 }], ["Mittelmeer", { lat: 39, lon: 4 }]];
const pad = (x: string | number, n: number) => String(x).padStart(n);

/** Mittlerer Hafen (Tag ~10–14): Bedarf 302 Strom (Stahlwerk 8, Raffinerie 8, Chipfabrik 6, Versorgungshof 6). */
const ECON = { stahlwerk: 8, raffinerie: 8, chipfabrik: 6, versorgungshof: 6, lagerkomplex: 8, kommandozentrale: 8 };

const VARIANTS: [string, Record<string, number>][] = [
  ["Kraftwerk 6", { kraftwerk: 6 }],
  ["KW 3 + Wind 4 + Sonne 2 + Speicher 2", { kraftwerk: 3, windpark: 4, solarfeld: 2, speicherwerk: 2 }],
  ["  … + Elektrolyse 3", { kraftwerk: 3, windpark: 4, solarfeld: 2, speicherwerk: 2, elektrolyse: 3 }],
  ["KW 1 + Wind 7 + Sonne 4 + Speicher 4 + Elektr. 5", { kraftwerk: 1, windpark: 7, solarfeld: 4, speicherwerk: 4, elektrolyse: 5 }],
];

function harbor(balance: Balance, site: GeoPoint, t0: number, plants: Record<string, number>): BaseState {
  const b = createBase(balance, t0, site);
  b.buildings = { ...b.buildings, ...ECON, ...plants };
  b.resources = { stahl: 20000, treibstoff: 20000, elektronik: 20000, proviant: 20000 };
  b.powerStored = 0;
  return b;
}

function value(balance: Balance, m: Record<string, number>): number {
  let v = 0;
  for (const [r, n] of Object.entries(m)) v += n * (balance.market.refPrice[r] ?? 0);
  return v;
}

/** Kostenwert (Richtpreis) der Stufen eines Gebäudes bis `level`. */
function levelsValue(balance: Balance, id: string, level: number): number {
  let v = 0;
  for (let l = 0; l < level; l++) v += value(balance, upgradeCost(id, l, balance));
  return v;
}

interface Run {
  greenHours: number;
  share: number;
  fuelElec: number;
  fuelRaff: number;
  fuelKw: number;
  served: number;
  wasted: number;
  greenUsed: number;
  prodValue: number;
}

/** Hafen `days` Tage stündlich fortschreiben (mit Bonus, wenn grün), Kennzahlen je Tag. */
function run(balance: Balance, base0: BaseState, days: number): Run {
  let b = base0;
  const t0 = b.resUpdatedAt;
  let greenHours = 0;
  let served = 0;
  let raff = 0;
  let kw = 0;
  let prod = 0;
  let n = 0;
  for (let h = 1; h <= days * 24; h++) {
    const t = t0 + h * HOUR;
    const mods = greenModifiers(b, t - HOUR, balance);
    if (isGreenHarbor(b, t - HOUR, balance)) greenHours++;
    const g = powerAt(b, t - HOUR, balance, mods);
    served += g.served.production;
    raff += (g.buildingPerHour.treibstoff ?? 0) - g.fuelMade;
    kw += g.fuelPerHour;
    prod += value(balance, g.buildingPerHour) - g.fuelMade * (balance.market.refPrice.treibstoff ?? 0);
    n++;
    b = integrateGrid(b, t, balance, mods);
    // Lager nicht volllaufen lassen (der Spieler verbaut oder verkauft).
    for (const r of balance.resources) b.resources[r] = Math.min(b.resources[r], 20000);
  }
  const log = b.powerLog!;
  return {
    greenHours: greenHours / n, share: greenShare(b, b.resUpdatedAt, balance).share, fuelElec: log.fuelMade / days, fuelRaff: raff / days,
    fuelKw: kw / days, served: served / n, wasted: log.wasted / days, greenUsed: log.greenUsed / days, prodValue: prod / days,
  };
}

function greenTable(balance: Balance): void {
  console.log("  Mittlerer Hafen (Bedarf 302 Strom), 28 Tage stündlich, Grün-Bonus angewandt. Je Tag:");
  console.log("  Lage/Start        Ausbau                                          Bonus-Std  Anteil  Prod.  Elektr.  Raff.  Elektr./Raff.  KW-Verbr.  Ökostrom  verfällt");
  for (const [name, site] of PLACES) {
    for (const [start, t0] of [["März", MARCH], ["Nov.", NOV]] as const) {
      for (const [label, plants] of VARIANTS) {
        const r = run(balance, harbor(balance, site, t0, plants), 28);
        console.log(
          `  ${`${name} ${start}`.padEnd(17)} ${label.padEnd(47)} ${pad((r.greenHours * 100).toFixed(0), 6)} %  ${pad((r.share * 100).toFixed(0), 4)} %  ${pad((r.served * 100).toFixed(0), 3)} %  ` +
            `${pad(r.fuelElec.toFixed(0), 6)}  ${pad(r.fuelRaff.toFixed(0), 5)}  ${pad(((100 * r.fuelElec) / r.fuelRaff).toFixed(1), 9)} %  ${pad(r.fuelKw.toFixed(0), 8)}  ${pad(r.greenUsed.toFixed(0), 8)}  ${pad(r.wasted.toFixed(0), 7)}`,
        );
      }
    }
  }
}

/** Lohnt der Bonus? Wert +3 % gegen Kosten der Ökostrom-Stufen und den gesparten Kraftwerkstreibstoff. */
function worthTable(balance: Balance): void {
  console.log("\n  Ökostrom statt Kraftwerk, Nordsee ab März, 28 Tage (Richtpreis, Stahl = 1):");
  const site = PLACES[0][1];
  const base = run(balance, harbor(balance, site, MARCH, VARIANTS[0][1]), 28);
  for (const [label, plants] of VARIANTS.slice(1)) {
    const r = run(balance, harbor(balance, site, MARCH, plants), 28);
    const fuelPrice = balance.market.refPrice.treibstoff ?? 0;
    const invest = Object.entries(plants).reduce((a, [id, l]) => a + levelsValue(balance, id, l), 0) - levelsValue(balance, "kraftwerk", 6);
    const gain = (r.prodValue - base.prodValue) + (base.fuelKw - r.fuelKw) * fuelPrice + r.fuelElec * fuelPrice;
    console.log(
      `  ${label.padEnd(47)} Mehrkosten ${pad(Math.round(invest), 7)}  Vorteil/Tag ${pad(Math.round(gain), 5)} ` +
        `(Bonus+Versorgung ${pad(Math.round(r.prodValue - base.prodValue), 5)}, Kraftwerk gespart ${pad(Math.round((base.fuelKw - r.fuelKw) * fuelPrice), 4)}, Elektrolyse ${pad(Math.round(r.fuelElec * fuelPrice), 4)})  ` +
        `amortisiert nach ${gain > 0 ? (invest / gain).toFixed(0) : "–"} Tagen`,
    );
  }
  console.log(`  Bezug: Kraftwerk 6 versorgt ${(base.served * 100).toFixed(0)} %, Produktionswert ${Math.round(base.prodValue)}/Tag; der Bonus allein wäre ${Math.round(base.prodValue * 0.03)}/Tag.`);
}

/** Seekabel: Nordsee-Windhafen (Überschuss) an einen Hafen ohne Kraftwerk in 300 km. */
function cableTable(balance: Balance): void {
  console.log("\n  Seekabel 300 km (Verlust 30 %), Station Stufe 3 (90 Strom/h), 14 Tage ab März, Abrechnung alle 10 min:");
  const north = PLACES[0][1];
  for (const [label, elec] of [["ohne Elektrolyse beim Abgebenden", 0], ["Abgebender mit Elektrolyse 3 (geht vor)", 3]] as const) {
    let out = harbor(balance, north, MARCH, { windpark: 8, solarfeld: 2, speicherwerk: 2, seekabel: 3, elektrolyse: elec });
    out.buildings = { ...out.buildings, stahlwerk: 4, raffinerie: 2, chipfabrik: 0, versorgungshof: 2 };
    out.cable = { id: 1, role: "out", sent: 0 };
    let inn = harbor(balance, { lat: 53, lon: 7 }, MARCH, { seekabel: 3, speicherwerk: 1 });
    inn.buildings = { ...inn.buildings, stahlwerk: 4, raffinerie: 2, chipfabrik: 0, versorgungshof: 2 };
    inn.cable = { id: 1, role: "in", buffer: 0 };
    let delivered = 0;
    let lost = 0;
    let served = 0;
    let n = 0;
    for (let t = MARCH + 10 * 60000; t <= MARCH + 14 * DAY; t += 10 * 60000) {
      out = integrateGrid(out, t, balance);
      inn = integrateGrid(inn, t, balance);
      const tr = transferCable(out, inn, 300, 0, 0, t, balance);
      out = tr.out;
      inn = tr.in;
      delivered += tr.delivered;
      lost += tr.lost;
      if (t % HOUR === 0) {
        served += powerAt(inn, t, balance).served.production;
        n++;
      }
    }
    const sent = out.powerLog!.sent;
    const drawn = inn.powerLog?.drawn ?? 0;
    console.log(
      `  ${label.padEnd(40)} gesendet ${pad(Math.round(sent), 6)}  angekommen ${pad(Math.round(delivered), 6)} (${((100 * delivered) / Math.max(1, sent)).toFixed(0)} %, höchstens ${(cableDelivered(300, balance) * 100).toFixed(0)} %)  ` +
        `genutzt ${pad(Math.round(drawn), 6)}  Puffer am Ende ${pad(Math.round(inn.cable?.buffer ?? 0), 3)}  ` +
        `Elektrolyse ${pad(Math.round(out.powerLog!.fuelMade), 5)} Treibstoff  Empfänger versorgt ${((100 * served) / n).toFixed(0)} %, grün ${(greenShare(inn, inn.resUpdatedAt, balance).share * 100).toFixed(0)} %`,
    );
    if (drawn > delivered + 1e-6 || delivered > sent * cableDelivered(300, balance) + 1e-6) throw new Error("Seekabel: Energie verdoppelt!");
  }
  console.log("  Prüfung: genutzt ≤ angekommen ≤ gesendet × (1 − Verlust); Kabelstrom wird weder gespeichert noch elektrolysiert.");
}

/** Wochenziel (Höchstwert × 30) und Erfolg (10 000 / 75 000 / 300 000) gegen erreichte Mengen. */
function goalTable(balance: Balance): void {
  console.log("\n  Wochenziel „Ökostrom“ (Ziel = Höchstwert Wind + Sonne × 30) und Saisonmenge (42 Tage) des Erfolgs (10 000 / 75 000 / 300 000):");
  for (const [name, site] of PLACES) {
    for (const [label, plants] of VARIANTS.slice(1)) {
      const peak = (balance.buildings.windpark.windPowerPerLevel ?? 0) * (plants.windpark ?? 0) + (balance.buildings.solarfeld.solarPowerPerLevel ?? 0) * (plants.solarfeld ?? 0);
      const target = Math.max(500, Math.round((peak * 30) / 500) * 500);
      const r = run(balance, harbor(balance, site, MARCH, plants), 7);
      console.log(`  ${name.padEnd(11)} ${label.padEnd(47)} Ziel ${pad(target, 6)}  erreicht in 7 Tagen ${pad(Math.round(r.greenUsed * 7), 6)} (${((100 * r.greenUsed * 7) / target).toFixed(0)} %)  Saison ≈ ${pad(Math.round(r.greenUsed * 42), 7)}`);
    }
  }
}

export function runPowerGreenSim(balance: Balance): void {
  if (!balance.power?.green || !balance.weather) return;
  console.log("\nÖkostrom, Elektrolyse, Seekabel (v1.21)");
  greenTable(balance);
  worthTable(balance);
  cableTable(balance);
  goalTable(balance);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPowerGreenSim(JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance);
}
