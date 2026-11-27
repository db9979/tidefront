// Prüfung Balance v1.24 (Wertung und Balance): Kartellstärke 0,55 → 0,40, Kommandopunkte über KZ 8 hinaus,
// Lagerwachstum 1,5 → 1,4 (nur geprüft), Wettervorhersage (minFactor ehrlich), Wertung nach Richtpreis.
import type { Balance, BaseState } from "../src/index.ts";
import { commandPoints, composeRaid, defenderFromBase, fleetTotals, productionRates, resolveBattle, storageCapacity, trainingCost } from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { runBot, value } from "./bot.ts";

const SEEDS = 200;
const RAID_SEED_OFFSET = 100000;

/** Kartell gegen den Hafen: Sieg % des Kartells, Ø Beute und Ø bleibender Verlust (Richtwert). */
function raid(base: BaseState, balance: Balance): { win: number; loot: number; loss: number } {
  let win = 0;
  let loot = 0;
  let loss = 0;
  const def = defenderFromBase(base, balance);
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle(composeRaid(base.units, base.defenses, balance, seed + RAID_SEED_OFFSET).attacker, def, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") win++;
    loot += value(r.report.loot, balance);
    for (const [id, n] of Object.entries(r.report.defender.losses)) {
      const gone = n - (r.report.defender.returned[id] ?? 0);
      if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
    }
  }
  return { win: win / SEEDS, loot: loot / SEEDS, loss: loss / SEEDS };
}

const prod = (b: BaseState, balance: Balance) => value(productionRates(b, balance).perHour, balance);
const k = (v: number) => `${Math.round(v / 1000)}k`;

function weekly(snaps: BotSnapshot[], balance: Balance): string {
  let prev: BotSnapshot | null = null;
  return snaps
    .map((s) => {
      const mil = prev ? s.spentMil - prev.spentMil : s.spentMil;
      const used = fleetTotals(s.base.units, balance).commandPointsUsed;
      prev = s;
      return `T${s.day} KZ ${s.base.buildings.kommandozentrale ?? 0} KP ${Math.round(used)}/${commandPoints(s.base, balance)} Rüstung ${k(mil)}`;
    })
    .join(" | ");
}

export function runV124Sim(balance: Balance): void {
  console.log(`\n=== Balance v1.24: Wertung und Balance ===`);

  // 1. Kartell: raidStrengthShareOfDefense alt 0,55 gegen neu.
  const old = { ...balance, pirates: { ...balance.pirates, raidStrengthShareOfDefense: 0.55 } };
  const snaps = runBot(balance, 28, [3, 7, 14, 21, 28]);
  console.log(`Kartell gegen den Bot-Hafen (45 % Rüstung, alles daheim): Sieg % / Ø Beute / Ø bleibender Verlust in h Produktion, ${SEEDS} Seeds`);
  console.log(`  Tag   Stärke 0,55                     Stärke ${balance.pirates.raidStrengthShareOfDefense.toFixed(2).replace(".", ",")}`);
  for (const s of snaps) {
    const p = prod(s.base, balance);
    const cell = (b: Balance) => {
      const r = raid(s.base, b);
      return `${String(Math.round(r.win * 100)).padStart(3)} % ${String(Math.round(r.loot)).padStart(6)} ${(r.loss / p).toFixed(1).padStart(5)} h`.padEnd(32);
    };
    console.log(`  ${String(s.day).padStart(3)}   ${cell(old)}${cell(balance)}`);
  }

  // 2. Kommandopunkte über KZ 8 hinaus: Spätspiel-Bot baut bei vollen KP die Kommandozentrale, bei knappem Proviant den Versorgungshof.
  const kz = balance.buildings.kommandozentrale;
  const flat: Balance = { ...balance, buildings: { ...balance.buildings, kommandozentrale: { ...kz, commandPointsLateFromLevel: undefined, commandPointsLatePerLevel: undefined } } };
  const marks = [7, 14, 21, 28, 35, 42];
  console.log(`\nKommandopunkte (KZ ab ${kz.commandPointsLateFromLevel ?? "-"} je ${kz.commandPointsLatePerLevel ?? "-"} statt ${kz.commandPointsPerLevel}): Rüstungsausgaben je Woche, 42 Tage`);
  console.log(`  Bot (Vorgabe, billigster Ausbau)        ${weekly(runBot(balance, 42, marks), balance)}`);
  console.log(`  Spätspiel-Bot, je Stufe ${kz.commandPointsPerLevel} (v1.23)      ${weekly(runBot(flat, 42, marks, undefined, undefined, undefined, {}, { lateGame: true }), flat)}`);
  const late = runBot(balance, 42, marks, undefined, undefined, undefined, {}, { lateGame: true });
  console.log(`  Spätspiel-Bot, v1.24                    ${weekly(late, balance)}`);
  const end = late[late.length - 1].base;
  const free = commandPoints(end, balance) - fleetTotals(end.units, balance).commandPointsUsed;
  console.log(`  Spätspiel-Bot v1.24, Tag 42: ${Math.round(free)} KP frei, Proviant netto ${productionRates(end, balance).perHour.proviant.toFixed(1)}/h, Versorgungshof ${end.buildings.versorgungshof ?? 0}`);

  // 3. Lagerkomplex: Wachstum 1,5 gegen 1,4 – Füllstand (höchste Ressource) des Wirtschafts- und des Rüstungs-Bots.
  const lager = (g: number): Balance => ({ ...balance, buildings: { ...balance.buildings, lagerkomplex: { ...balance.buildings.lagerkomplex, capacityGrowth: g } } });
  console.log(`\nLagerkomplex capacityGrowth: höchster Füllstand des Lagers an Tag ${marks.join("/")}`);
  for (const g of [1.5, 1.4]) {
    const b = lager(g);
    const fill = (ss: BotSnapshot[]) =>
      ss.map((s) => `${Math.round(Math.max(...b.resources.map((r) => (s.base.resources[r] ?? 0) / storageCapacity(s.base, b))) * 100)} %`).join(" ");
    console.log(`  ${g.toFixed(1)}: Rüstungs-Bot ${fill(runBot(b, 42, marks))} | Wirtschafts-Bot ${fill(runBot(b, 42, marks, 0))}`);
  }

  // 4. Wettervorhersage: bester erreichbarer Faktor gegen minFactor.
  const fb = balance.weather?.forecast;
  const tech = fb ? balance.research?.techs[fb.skillTech] : undefined;
  if (fb && tech) {
    const best = 1 - fb.skillPerLevel * (tech.maxLevel ?? 1) - fb.radarBonus;
    console.log(`\nWettervorhersage: bester Faktor 1 − ${fb.skillPerLevel} × ${tech.maxLevel} − ${fb.radarBonus} = ${best.toFixed(2)}, minFactor ${fb.minFactor} (${best <= fb.minFactor + 1e-9 ? "erreicht" : "nie erreicht"})`);
  }
}
