// Simulation Wetter und Strom (v1.6): Bot-Entwicklung vorher/nachher, Stromquellen je Region, Wetter-Mittel und
// Sturmzuschlag auf typischen Routen. Ziel: Neue Häfen haben weiter genug Strom (Bot bis Tag 7/28 höchstens ±10 %
// gegenüber v1.4), Wind lohnt im Norden, Sonne im Süden.
import type { Balance, GeoPoint } from "../src/index.ts";
import { powerAt, productionRates, routeWeather, sunshine, weatherAt } from "../src/index.ts";
import { MILITARY_SHARE, runBot, type BotSnapshot } from "./bot.ts";

const HOUR = 3600000;
const START = Date.UTC(2026, 2, 1);
const WINTER = Date.UTC(2026, 10, 15);

/** Werte des Bots mit Balance v1.4 (npm run sim vor Wetter und Strom, Kraftwerk ohne Treibstoff). */
const BEFORE: Record<string, Record<number, { build: number; mil: number; levels: number }>> = {
  eco: { 7: { build: 64748, mil: 0, levels: 62 }, 28: { build: 380465, mil: 0, levels: 112 } },
  mil: { 7: { build: 31648, mil: 26759, levels: 46 }, 28: { build: 258468, mil: 74006, levels: 101 } },
};

const PLACES: [string, GeoPoint][] = [
  ["Nordsee", { lat: 55, lon: 4 }],
  ["Norwegen", { lat: 62, lon: 5 }],
  ["Irland", { lat: 53, lon: -10 }],
  ["Neufundland", { lat: 47, lon: -53 }],
  ["Biskaya", { lat: 45, lon: -4 }],
  ["Mittelmeer", { lat: 39, lon: 4 }],
  ["Ägäis", { lat: 37, lon: 25 }],
  ["Nordafrika", { lat: 33, lon: 0 }],
];

const levels = (s: BotSnapshot) => Object.values(s.base.buildings).reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b === 0 ? "   –  " : `${a >= b ? "+" : "−"}${(Math.abs(a / b - 1) * 100).toFixed(1).padStart(4)} %`);
const pad = (x: string | number, n: number) => String(x).padStart(n);

function botTable(balance: Balance): void {
  console.log("  Bot vorher (v1.4) und nachher (v1.6), Kraftwerk bei Strommangel (Ausgaben zum Richtwert):");
  console.log("                      Tag   Ausbau vorher  nachher  Δ        Rüstung vorher  nachher  Δ        Stufen  Kraftwerk  Treibstoff/h");
  for (const [key, share, label] of [["eco", 0, "Wirtschafts-Bot"], ["mil", MILITARY_SHARE, "Bot mit 45 % Rüstung"]] as const) {
    for (const s of runBot(balance, 28, [7, 28], share)) {
      const b = BEFORE[key][s.day];
      const tr = productionRates(s.base, balance).perHour.treibstoff;
      console.log(
        `  ${label.padEnd(20)}${pad(s.day, 3)}  ${pad(b.build, 13)} ${pad(Math.round(s.spentBuild), 8)}  ${pct(s.spentBuild, b.build)}  ` +
          `${pad(b.mil, 14)} ${pad(Math.round(s.spentMil), 8)}  ${pct(s.spentMil, b.mil)}  ${pad(levels(s), 3)}/${b.levels}  ${pad(s.base.buildings.kraftwerk, 6)}  ${pad(Math.round(tr), 10)}`,
      );
    }
  }
}

function sourceTable(balance: Balance): void {
  console.log("\n  Stromquelle des Bots (45 % Rüstung) je Lage, Start 1. März bzw. 15. November; Ausgaben gesamt gegenüber Kraftwerk:");
  const variants: [string, GeoPoint | undefined, string[], number][] = [
    ["Kraftwerk (Vorgabe)", undefined, ["kraftwerk"], START],
    ["Windpark + Speicher, Nordsee", PLACES[0][1], ["windpark", "speicherwerk"], START],
    ["Solarfeld + Speicher, Mittelmeer", PLACES[5][1], ["solarfeld", "speicherwerk"], START],
    ["Solarfeld + Speicher, Nordsee, Winter", PLACES[0][1], ["solarfeld", "speicherwerk"], WINTER],
    ["Windpark + Speicher, Mittelmeer", PLACES[5][1], ["windpark", "speicherwerk"], START],
    ["Kraftwerk + Solarfeld, Mittelmeer", PLACES[5][1], ["kraftwerk", "solarfeld"], START],
    ["Mix Kraftwerk/Wind/Sonne, Biskaya", PLACES[4][1], ["kraftwerk", "windpark", "solarfeld"], START],
  ];
  let ref: Record<number, number> = {};
  for (const [label, site, plants, startMs] of variants) {
    const snaps = runBot(balance, 28, [7, 28], MILITARY_SHARE, undefined, undefined, { site, plants, startMs });
    const total = (s: BotSnapshot) => s.spentBuild + s.spentMil;
    if (label === variants[0][0]) ref = Object.fromEntries(snaps.map((s) => [s.day, total(s)]));
    const cells = snaps.map((s) => {
      const g = powerAt(s.base, s.base.resUpdatedAt, balance);
      const p = plants.map((id) => `${id.slice(0, 4)} ${s.base.buildings[id] ?? 0}`).join(", ");
      return `Tag ${pad(s.day, 2)}: ${pad(Math.round(total(s)), 7)} (${pct(total(s), ref[s.day])}), Produktion ${pad(Math.round(g.served.production * 100), 3)} %, ${p}`;
    });
    console.log(`  ${label.padEnd(40)}${cells.join(" | ")}`);
  }
}

function weatherTable(balance: Balance): void {
  const wb = balance.weather!;
  const wind = balance.buildings.windpark;
  const sun = balance.buildings.solarfeld;
  console.log("\n  Wetter im Jahresmittel (alle 3 h) und Ertrag je Stufe (Strom; Kraftwerk: 60 je Stufe für 3 Treibstoff/h):");
  console.log("  (Sturm Winter: Dez–Feb; Nebel %: Anteil mit Nebel ab fogScoutFrom, Aufklärung unsicher; Sommer: Jun–Aug)");
  console.log("                  Wind  Wolken  Nebel  Sonne  Sturm %  Winter %  Nebel %  Sommer %  Windpark  Solarfeld");
  for (const [name, p] of PLACES) {
    let w = 0, c = 0, f = 0, s = 0, st = 0, wp = 0, n = 0, stW = 0, nW = 0, fg = 0, fgS = 0, nS = 0;
    for (let h = 0; h < 365 * 24; h += 3) {
      const t = Date.UTC(2026, 0, 1) + h * HOUR;
      const x = weatherAt(p, t, wb);
      w += x.wind; c += x.clouds; f += x.fog; s += sunshine(x, sun.cloudLoss ?? 0); st += x.storm ? 1 : 0; n++;
      wp += x.wind <= (wind.stormCutoff ?? 1) ? x.wind : 0;
      const m = new Date(t).getUTCMonth();
      const foggy = x.fog >= wb.fogScoutFrom ? 1 : 0;
      fg += foggy;
      if (m <= 1 || m === 11) { nW++; stW += x.storm ? 1 : 0; }
      if (m >= 5 && m <= 7) { nS++; fgS += foggy; }
    }
    const f2 = (v: number) => pad((v / n).toFixed(2), 5);
    const p1 = (a: number, b: number, k: number) => pad(((100 * a) / b).toFixed(1), k);
    console.log(
      `  ${name.padEnd(14)}${f2(w)}  ${f2(c)}  ${f2(f)}  ${f2(s)}  ${p1(st, n, 6)}  ${p1(stW, nW, 8)}  ${p1(fg, n, 7)}  ${p1(fgS, nS, 8)}  ${pad(((wind.windPowerPerLevel ?? 0) * wp / n).toFixed(1), 8)}  ${pad(((sun.solarPowerPerLevel ?? 0) * s / n).toFixed(1), 9)}`,
    );
  }
}

function routeTable(balance: Balance): void {
  const wb = balance.weather!;
  const routes: [string, GeoPoint, GeoPoint][] = [
    ["Nordsee → Norwegen", PLACES[0][1], PLACES[1][1]],
    ["Irland → Biskaya", PLACES[2][1], PLACES[4][1]],
    ["Neufundland → Irland", PLACES[3][1], PLACES[2][1]],
    ["Mittelmeer → Ägäis", PLACES[5][1], PLACES[6][1]],
  ];
  console.log("\n  Sturmzuschlag auf die Reisezeit der Schiffe (Abfahrt alle 6 h über ein Jahr) und Startverbot reiner Luftmissionen:");
  for (const [name, a, b] of routes) {
    let sum = 0, max = 1, over10 = 0, stormStart = 0, n = 0;
    for (let h = 0; h < 365 * 24; h += 6) {
      const r = routeWeather(a, b, Date.UTC(2026, 0, 1) + h * HOUR, wb);
      sum += r.shipFactor; max = Math.max(max, r.shipFactor); over10 += r.shipFactor > 1.1 ? 1 : 0; stormStart += r.stormAtOrigin ? 1 : 0; n++;
    }
    console.log(`  ${name.padEnd(22)} Ø +${((sum / n - 1) * 100).toFixed(1)} %, höchstens +${((max - 1) * 100).toFixed(0)} %, über +10 %: ${((100 * over10) / n).toFixed(0)} % der Abfahrten, Startverbot: ${((100 * stormStart) / n).toFixed(1)} %`);
  }
}

export function runPowerSim(balance: Balance): void {
  if (!balance.weather) return;
  console.log("\nWetter und Strom (v1.6, Wettermodell v1.9)");
  botTable(balance);
  sourceTable(balance);
  weatherTable(balance);
  routeTable(balance);
}
