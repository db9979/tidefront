// Simulations-Runner für die Balance: Kartell-Überfälle, Piratennester und ein Wirtschafts-Bot,
// der über eine Saison (28 Tage) einen Verband aufbaut und ihn gegen die Nester schickt.
// Aufruf: npm run sim   (Ausgabe als Text; nichts wird gespeichert)
// Werte (Beute, Verluste, Treibstoff) werden zum Richtwert der Börse in Stahl-Äquivalent bewertet.
import { readFileSync } from "node:fs";
import type { AttackerInput, Balance, Counts, DefenderInput } from "../src/index.ts";
import {
  commandPoints,
  composeRaid,
  defenderFromBase,
  fleetTotals,
  fuelCost,
  missionSlots,
  nestDefender,
  productionRates,
  resolveBattle,
  trainingCost,
  validateFleet,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { MILITARY_SHARE, UBOOT_DOCTRINE, UBOOT_HEAVY_DOCTRINE, runBot, value } from "./bot.ts";
import { runResearchSim } from "./research.ts";
import { runGuideSim } from "./guide.ts";
import { runLuckSim } from "./luck.ts";
import { runPowerSim } from "./power.ts";
import { runEspionageSim } from "./espionage.ts";

const balance = JSON.parse(
  readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"),
) as Balance;
const SEEDS = 200;
/** Angenommene Entfernung zum Nest (Nestplätze liegen mindestens 350 km auseinander). */
const NEST_DISTANCE_KM = 400;
/** Versatz, damit Zusammensetzung des Überfalls und Kampf nicht denselben Zufallsstrom nutzen. */
const RAID_SEED_OFFSET = 100000;
const CHECKPOINTS = [1, 2, 3, 5, 7, 10, 14, 18, 21, 28];
/** Zielfenster je Neststufe (Tage), ab dem ein bezahlbarer Verband mindestens 70 % siegt. */
const TARGET: Record<number, [number, number]> = { 1: [1, 2], 2: [3, 5], 3: [7, 10], 4: [14, 18], 5: [21, 28] };

interface Rate {
  winRate: number;
  avgLoot: number;
  avgLossValue: number;
  avgBoats: number;
  avgMiliz: number;
}

function lossValue(report: { attacker: { losses: Counts; returned: Counts } }): number {
  let v = 0;
  for (const [id, n] of Object.entries(report.attacker.losses)) {
    const gone = n - (report.attacker.returned[id] ?? 0);
    if (gone > 0 && balance.units[id]) v += value(trainingCost(id, gone, balance), balance);
  }
  return v;
}

function rate(attacker: (seed: number) => AttackerInput, defender: DefenderInput): Rate {
  let wins = 0;
  let loot = 0;
  let loss = 0;
  let boats = 0;
  let miliz = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = attacker(seed);
    boats += a.units.schnellboot ?? 0;
    miliz += a.units.piratenmiliz ?? 0;
    const r = resolveBattle(a, defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") wins++;
    loot += value(r.report.loot, balance);
    loss += lossValue(r.report);
  }
  return {
    winRate: wins / SEEDS,
    avgLoot: loot / SEEDS,
    avgLossValue: loss / SEEDS,
    avgBoats: boats / SEEDS,
    avgMiliz: miliz / SEEDS,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)} %`;
const num = (x: number, w = 6) => String(Math.round(x)).padStart(w);

console.log(`Balance ${balance.version}, ${SEEDS} Seeds je Fall\n`);

// ---------------------------------------------------------------- Kartell

console.log("Kartell-Überfälle gegen typische Verteidigungen (Stärke schwankt je Seed, Beute nach Bunkerschutz 300)");
const defenses: [string, Counts, Counts][] = [
  ["nichts", {}, {}],
  ["Wache: 20 Schützen", { schuetzen: 20 }, {}],
  ["30 Schützen", { schuetzen: 30 }, {}],
  ["2 Korvetten, 30 Schützen", { korvette: 2, schuetzen: 30 }, {}],
  ["v1.2: 2 U-Boote, 30 Schützen", { uboot: 2, schuetzen: 30 }, {}],
  ["v1.2: 4 U-Boote, 40 Schützen", { uboot: 4, schuetzen: 40 }, {}],
  ["40 Schützen, 1 Bunkerlinie", { schuetzen: 40 }, { bunkerlinie: 1 }],
  ["gut: 60 Schützen, 1 Bunker, 2 Batterien (+Radar)", { schuetzen: 60 }, { bunkerlinie: 1, kuestenbatterie: 2 }],
  ["5 Korvetten, 3 Batterien, 50 Schützen", { korvette: 5, schuetzen: 50 }, { kuestenbatterie: 3 }],
  ["stark: 3 Zerstörer, 2 Batt., 2 Bunker, 80 Sch.", { zerstoerer: 3, schuetzen: 80 }, { kuestenbatterie: 2, bunkerlinie: 2 }],
  ["sehr stark: 4 Zerst., 3 Batt., 2 Bunker, 120 Sch., 4 Pz", { zerstoerer: 4, schuetzen: 120, kampfpanzer: 4 }, { kuestenbatterie: 3, bunkerlinie: 2 }],
];
const raidRes = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };
for (const [label, units, defs] of defenses) {
  const r = rate((seed) => composeRaid(units, defs, balance, seed + RAID_SEED_OFFSET).attacker, {
    units,
    defenses: defs,
    resources: raidRes,
    protectedPerResource: 300,
  });
  const force = `Ø ${r.avgBoats.toFixed(1)} Boote, ${Math.round(r.avgMiliz)} Miliz`;
  console.log(`  ${label.padEnd(56)} ${force.padEnd(24)} Sieg ${pct(r.winRate)}  Beute ${num(r.avgLoot)}`);
}

// ---------------------------------------------------------------- Nester gegen feste Verbände

console.log("\nÜberfälle auf Piratennester mit festen Verbänden (Sieg %)");
const fleets: [string, Counts][] = [
  ["2 Korvetten, 1 Landungsschiff, 30 Schützen", { korvette: 2, landungsschiff: 1, schuetzen: 30 }],
  ["4 Korvetten, 2 Landungsschiffe, 150 Schützen", { korvette: 4, landungsschiff: 2, schuetzen: 150 }],
  ["v1.2: 2 U-Boote, 2 Landungsschiffe, 150 Schützen", { uboot: 2, landungsschiff: 2, schuetzen: 150 }],
  ["v1.2: 4 U-Boote, 2 Landungsschiffe, 150 Schützen", { uboot: 4, landungsschiff: 2, schuetzen: 150 }],
  ["4 Zerstörer, 3 Landungsschiffe, 5 Panzer, 200 Sch.", { zerstoerer: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }],
  ["v1.2: 4 U-Boote, 3 Landungsschiffe, 5 Panzer, 200 Sch.", { uboot: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }],
  ["v1.2: 8 U-Boote, 5 L-Schiffe, 10 Pz, 300 Sch., 50 Pio.", { uboot: 8, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }],
  ["8 Zerst., 4 Jagdbomber, 5 L-Schiffe, 10 Pz, 300 Sch., 50 Pio.", { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }],
];
console.log(`  ${"".padEnd(62)} ${[1, 2, 3, 4, 5].map((l) => `Stufe ${l}`.padStart(8)).join("")}`);
for (const [label, units] of fleets) {
  const cells = [1, 2, 3, 4, 5].map((level) => pct(rate(() => ({ units }), nest(level)).winRate).padStart(8));
  console.log(`  ${label.padEnd(62)} ${cells.join("")}`);
}

function nest(level: number): DefenderInput {
  const n = nestDefender(level, balance);
  if (!n.ok) throw new Error(n.code);
  return n.defender;
}

// ---------------------------------------------------------------- U-Boote im Seegefecht (v1.2)

console.log("\nU-Boote im Seegefecht (Spieler gegen Spieler, nur Schiffe): Ø Verlustwert und Ø versenkte U-Boote je Seite");
const unitValue = (losses: Counts) =>
  Object.entries(losses).reduce((v, [id, n]) => v + (balance.units[id] ? value(trainingCost(id, n, balance), balance) : 0), 0);
const fleetValue = (c: Counts) => unitValue(c);
const duels: [string, Counts, Counts][] = [
  ["4 U-Boote gegen 6 Landungsschiffe (ungeschützt)", { uboot: 4 }, { landungsschiff: 6 }],
  ["4 U-Boote gegen 4 Zerstörer", { uboot: 4 }, { zerstoerer: 4 }],
  ["4 U-Boote gegen 10 Korvetten", { uboot: 4 }, { korvette: 10 }],
  ["4 U-Boote gegen 4 Korvetten, 3 Landungsschiffe", { uboot: 4 }, { korvette: 4, landungsschiff: 3 }],
  ["4 U-Boote gegen 2 Batterien (Hafen ohne Schiffe)", { uboot: 4 }, {}],
  ["Bot-Flotte Tag 14 (13 Korv., 3 Zerst., 4 L) gegen 4 U-Boote", { korvette: 13, zerstoerer: 3, landungsschiff: 4 }, { uboot: 4 }],
  ["3 Zerstörer, 4 L-Schiffe gegen 4 U-Boote im Hafen", { zerstoerer: 3, landungsschiff: 4 }, { uboot: 4 }],
  ["6 Landungsschiffe gegen 4 U-Boote im Hafen", { landungsschiff: 6 }, { uboot: 4 }],
  ["10 Korvetten gegen 4 Zerstörer (Vergleich ohne U-Boote)", { korvette: 10 }, { zerstoerer: 4 }],
];
for (const [label, att, def] of duels) {
  let lossA = 0;
  let lossD = 0;
  let subsA = 0;
  let subsD = 0;
  const defenses: Counts = label.includes("Batterien") ? { kuestenbatterie: 2 } : {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle({ units: att }, { units: def, defenses }, balance, seed);
    if (!r.ok) throw new Error(r.code);
    lossA += unitValue(r.report.attacker.losses);
    lossD += unitValue(r.report.defender.losses);
    subsA += r.report.attacker.losses.uboot ?? 0;
    subsD += r.report.defender.losses.uboot ?? 0;
  }
  const cell = (loss: number, own: Counts, subs: number) =>
    `${num(loss / SEEDS)}/${num(fleetValue(own), 5)} (U ${(subs / SEEDS).toFixed(1)})`;
  console.log(`  ${label.padEnd(62)} Angreifer ${cell(lossA, att, subsA)}  Verteidiger ${cell(lossD, def, subsD)}`);
}

// ---------------------------------------------------------------- Wirtschafts-Bot mit Verband

console.log(
  `\nWirtschafts-Bot über 28 Tage: gieriger Ausbau, ${MILITARY_SHARE * 100} % der Ausgaben in einen Verband nach Doktrin ` +
    `(innerhalb der Kommandopunkte, Landungsschiffe nach Truppenbedarf). Nest in ${NEST_DISTANCE_KM} km.`,
);
const snaps = runBot(balance, 28, CHECKPOINTS);
for (const s of snaps) {
  const fleet = sentFleet(s);
  const check = validateFleet(s.base, fleet, NEST_DISTANCE_KM, balance);
  if (!check.ok) throw new Error(`Tag ${s.day}: ${check.code}`);
  const t = fleetTotals(fleet, balance);
  const rates = productionRates(s.base, balance).perHour;
  console.log(
    `  Tag ${String(s.day).padStart(2)}: KZ ${s.base.buildings.kommandozentrale}, KP ${t.commandPointsUsed.toFixed(0)}/${commandPoints(s.base, balance)}, ` +
      `Missionsplätze ${missionSlots(s.base, balance)}, Truppen ${t.troopSize}/${t.troopSpace}, Ladung ${t.cargoCapacity}, ` +
      `Treibstoff ${fuelCost(fleet, NEST_DISTANCE_KM, balance)} | Rate/h st ${Math.round(rates.stahl)} el ${Math.round(rates.elektronik)}`,
  );
  console.log(`          ${Object.entries(fleet).map(([id, n]) => `${n} ${id}`).join(", ")}`);
}

console.log(`\n  Sieg % und Netto-Ertrag (Beute - bleibende Verluste - Treibstoff) je Neststufe; * = Zielfenster`);
console.log(`  ${"".padEnd(7)}${[1, 2, 3, 4, 5].map((l) => `Stufe ${l}`.padEnd(18)).join("")}`);
const firstWin: Record<number, number | null> = {};
for (const s of snaps) {
  const fleet = sentFleet(s);
  const fuel = fuelCost(fleet, NEST_DISTANCE_KM, balance) * (balance.market.refPrice.treibstoff ?? 0);
  const cells: string[] = [];
  for (let level = 1; level <= 5; level++) {
    const r = rate(() => ({ units: fleet }), nest(level));
    const inWindow = s.day >= TARGET[level][0] && s.day <= TARGET[level][1] ? "*" : " ";
    if (r.winRate >= 0.7 && firstWin[level] === undefined) firstWin[level] = s.day;
    cells.push(`${pct(r.winRate)} ${num(r.avgLoot - r.avgLossValue - fuel, 7)}${inWindow}`.padEnd(18));
  }
  console.log(`  Tag ${String(s.day).padStart(2)} ${cells.join("")}`);
}
console.log(
  `  Erster Prüftag mit >= 70 %: ${[1, 2, 3, 4, 5].map((l) => `Stufe ${l} Tag ${firstWin[l] ?? "-"} (Ziel ${TARGET[l].join("–")})`).join(", ")}`,
);

// Empfindlichkeit: anderer Rüstungsanteil
for (const share of [0.3, 0.6]) {
  const alt = runBot(balance, 28, CHECKPOINTS, share);
  const first = [1, 2, 3, 4, 5].map((level) => {
    const hit = alt.find((s) => rate(() => ({ units: sentFleet(s) }), nest(level)).winRate >= 0.7);
    return `Stufe ${level} Tag ${hit?.day ?? "-"}`;
  });
  console.log(`  Rüstungsanteil ${share * 100} %: ${first.join(", ")}`);
}

// Gegenprobe v1.2: Bot mit U-Boot-Doktrin (U-Boote statt Zerstörern bzw. schwere U-Boot-Rüstung)
for (const [name, doctrine] of [["U-Boote statt Zerstörer", UBOOT_DOCTRINE], ["schwere U-Boot-Rüstung", UBOOT_HEAVY_DOCTRINE]] as const) {
  const alt = runBot(balance, 28, CHECKPOINTS, MILITARY_SHARE, doctrine);
  const first = [1, 2, 3, 4, 5].map((level) => {
    const hit = alt.find((s) => rate(() => ({ units: sentFleet(s) }), nest(level)).winRate >= 0.7);
    return `Stufe ${level} Tag ${hit?.day ?? "-"}`;
  });
  console.log(`  Doktrin ${name}: ${first.join(", ")}`);
  for (const day of [14, 28]) {
    const s = alt.find((x) => x.day === day)!;
    console.log(`          Tag ${day}: ${Object.entries(sentFleet(s)).map(([id, n]) => `${n} ${id}`).join(", ")}`);
  }
  for (const day of [7, 28]) {
    const s = alt.find((x) => x.day === day)!;
    const r = rate((seed) => composeRaid(s.base.units, s.base.defenses, balance, seed + RAID_SEED_OFFSET).attacker, defenderFromBase(s.base, balance));
    console.log(`  Kartell gegen den Bot (${name}) nach ${day} Tagen: Ø ${r.avgBoats.toFixed(1)} Boote, ${Math.round(r.avgMiliz)} Miliz, Sieg ${pct(r.winRate)}`);
  }
}

// Kontrolle: der Stützpunkt des Bots (alle Einheiten daheim) als Ziel des Kartells
for (const day of [7, 28]) {
  const s = snaps.find((x) => x.day === day)!;
  const r = rate((seed) => composeRaid(s.base.units, s.base.defenses, balance, seed + RAID_SEED_OFFSET).attacker, defenderFromBase(s.base, balance));
  console.log(`  Kartell gegen den Bot nach ${day} Tagen: Ø ${r.avgBoats.toFixed(1)} Boote, ${Math.round(r.avgMiliz)} Miliz, Sieg ${pct(r.winRate)}`);
}

// Forschung (v1.3): eigene Fälle, die bisherigen Zahlen oben bleiben unverändert.
runResearchSim(balance, snaps);

// Auftragsbuch: Belohnungen beschleunigen den Start, ohne Vorsprung über die Saison.
runGuideSim(balance);
// Kriegsglück (v1.4): Würfel gegen Überlegenheit.
runLuckSim(balance);
runPowerSim(balance);
// Nachrichtendienst (v1.7): Chancen über typische Spielverläufe, Sabotage, Desinformation.
runEspionageSim(balance, snaps);

/** Der Bot schickt alles, was daheim steht (die Doktrin hält ihn innerhalb der Kommandopunkte). */
function sentFleet(s: BotSnapshot): Counts {
  return Object.fromEntries(Object.entries(s.base.units).filter(([, n]) => n > 0));
}
