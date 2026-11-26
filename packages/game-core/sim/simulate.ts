// Simulations-Runner für die Balance: Kampf-Matrix (Kartell, Nester) und ein gieriger Wirtschafts-Bot.
// Aufruf: npm run sim   (Ausgabe als Text; nichts wird gespeichert)
import { readFileSync } from "node:fs";
import type { Balance, BaseState, Counts } from "../src/index.ts";
import {
  composeRaid,
  completeTraining,
  completeUpgrade,
  createBase,
  defenderFromBase,
  maxAllowedLevel,
  nestDefender,
  productionRates,
  resolveBattle,
  settle,
  startTraining,
  startUpgrade,
  storageCapacity,
  upgradeCost,
} from "../src/index.ts";

const balance = JSON.parse(
  readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8"),
) as Balance;
const SEEDS = 200;
const HOUR = 3600000;

function rate(attacker: Parameters<typeof resolveBattle>[0], defender: Parameters<typeof resolveBattle>[1]) {
  let wins = 0;
  let lootSum = 0;
  let lostA = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle(attacker, defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") wins++;
    for (const v of Object.values(r.report.loot)) lootSum += v;
    for (const v of Object.values(r.report.attacker.losses)) lostA += v;
  }
  return { winRate: wins / SEEDS, avgLoot: Math.round(lootSum / SEEDS), avgLossesA: Math.round(lostA / SEEDS) };
}

function line(label: string, r: ReturnType<typeof rate>) {
  console.log(
    `  ${label.padEnd(46)} Sieg ${(r.winRate * 100).toFixed(0).padStart(3)} %  Beute ${String(r.avgLoot).padStart(6)}  Verluste A ${r.avgLossesA}`,
  );
}

console.log(`Balance ${balance.version}, ${SEEDS} Seeds je Fall\n`);

console.log("Kartell-Überfälle gegen typische Verteidigungen");
const defenses: [string, Counts, Counts][] = [
  ["nichts", {}, {}],
  ["20 Schützen", { schuetzen: 20 }, {}],
  ["40 Schützen, 1 Bunkerlinie", { schuetzen: 40 }, { bunkerlinie: 1 }],
  ["2 Korvetten, 30 Schützen", { korvette: 2, schuetzen: 30 }, {}],
  ["5 Korvetten, 3 Küstenbatterien, 50 Schützen", { korvette: 5, schuetzen: 50 }, { kuestenbatterie: 3 }],
  ["3 Zerstörer, 2 Batterien, 2 Bunker, 80 Schützen", { zerstoerer: 3, schuetzen: 80 }, { kuestenbatterie: 2, bunkerlinie: 2 }],
];
for (const [label, units, defs] of defenses) {
  const raid = composeRaid(units, defs, balance);
  const res = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };
  line(`${label} (${raid.units.schnellboot} Boote)`, rate(raid.attacker, { units, defenses: defs, resources: res, protectedPerResource: 300 }));
}

console.log("\nÜberfälle auf Piratennester");
const fleets: [string, Counts][] = [
  ["2 Korvetten, 1 Landungsschiff, 60 Schützen", { korvette: 2, landungsschiff: 1, schuetzen: 60 }],
  ["4 Korvetten, 2 Landungsschiffe, 120 Schützen", { korvette: 4, landungsschiff: 2, schuetzen: 120 }],
  ["4 Zerstörer, 3 Landungsschiffe, 5 Panzer, 200 Sch.", { zerstoerer: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }],
  ["8 Zerstörer, 4 Jagdbomber, 5 L-Schiffe, 10 Pz, 300 Sch.", { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }],
];
for (let level = 1; level <= 5; level++) {
  const nest = nestDefender(level, balance);
  if (!nest.ok) throw new Error(nest.code);
  console.log(` Nest Stufe ${level}`);
  for (const [label, units] of fleets) line(label, rate({ units }, nest.defender));
}

// ---------------------------------------------------------------- Wirtschafts-Bot

console.log("\nWirtschafts-Bot (gierig: billigster erlaubter Ausbau, Kraftwerk bei Strommangel), 7 Tage");
const order = ["stahlwerk", "raffinerie", "versorgungshof", "chipfabrik", "kraftwerk", "lagerkomplex", "kommandozentrale", "kaserne", "werft", "hafenkommandantur", "tiefbunker"];
let base: BaseState = createBase(balance, 0);
let t = 0;
const end = 7 * 24 * HOUR;
const step = 10 * 60000;
let nextReport = 24 * HOUR;
while (t <= end) {
  if (base.buildQueue[0] && base.buildQueue[0].finishesAt <= t) {
    const c = completeUpgrade(base, t, balance);
    if (c.ok) base = c.base;
  }
  if (base.trainingQueue.some((o) => o.finishesAt <= t)) {
    const c = completeTraining(base, t, balance);
    if (c.ok) base = c.base;
  }
  // Etwas Verteidigung: 10 Schützen, solange mehr als 300 Stahl übrig bleiben.
  if ((base.buildings.kaserne ?? 0) >= 1 && !base.trainingQueue.some((o) => o.builtIn === "kaserne")) {
    const r = startTraining(base, "schuetzen", 10, t, balance);
    if (r.ok && r.base.resources.stahl > 300 && (base.units.schuetzen ?? 0) < 60) base = r.base;
  }
  if (base.buildQueue.length === 0) {
    base = settle(base, t, balance);
    const rates = productionRates(base, balance);
    let candidates = order.filter((id) => (base.buildings[id] ?? 0) < maxAllowedLevel(base, id, balance));
    if (rates.powerFactor < 1) candidates = ["kraftwerk"];
    candidates.sort((a, b) => sum(upgradeCost(a, base.buildings[a], balance)) - sum(upgradeCost(b, base.buildings[b], balance)));
    for (const id of candidates) {
      const r = startUpgrade(base, id, t, balance);
      if (r.ok) {
        base = r.base;
        break;
      }
    }
  }
  if (t >= nextReport) {
    base = settle(base, t, balance);
    const rates = productionRates(base, balance);
    const lv = Object.entries(base.buildings).filter(([, l]) => l > 0).map(([id, l]) => `${id.slice(0, 5)}${l}`).join(" ");
    console.log(
      `  Tag ${t / (24 * HOUR)}: Rate/h ${fmt(rates.perHour)} | Lager ${Math.round(storageCapacity(base, balance))} | Schützen ${base.units.schuetzen ?? 0} | ${lv}`,
    );
    nextReport += 24 * HOUR;
  }
  t += step;
}

function sum(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}
function fmt(m: Record<string, number>): string {
  return Object.entries(m).map(([k, v]) => `${k.slice(0, 2)} ${Math.round(v)}`).join(" ");
}

// Kontrolle: der Stützpunkt des Bots als Ziel eines Kartell-Überfalls
const raid = composeRaid(base.units, base.defenses, balance);
line("Kartell gegen den Bot nach 7 Tagen", rate(raid.attacker, defenderFromBase(base, balance)));
