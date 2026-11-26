// See: Minen, Blockade und Konvois – Minenverluste je Verband und Stärke, Blockade-Wirkung gegen den Bot-Hafen,
// Verlustquote von Konvois (Kartell) mit und ohne Geleitschutz. Seeds fest (1 … N), Ergebnis reproduzierbar.
import type { Balance, Counts } from "../src/index.ts";
import {
  blockadeOf, cargoValue, cartelChance, cartelConvoyForce, convoysOf, mineLayCost, minesOf, mineTransit, productionRates,
  resolveBattle, strandTroops, trainingCost,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

const SEEDS = 400;
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

function fleetValue(units: Counts, balance: Balance): number {
  let v = 0;
  for (const [id, n] of Object.entries(units)) if (n > 0) v += value(trainingCost(id, n, balance), balance);
  return v;
}

export function runNavalSim(balance: Balance, snaps: BotSnapshot[]): void {
  const m = minesOf(balance);
  const k = blockadeOf(balance);
  const c = convoysOf(balance);
  if (!m || !k || !c) return;

  // 1. Minen: Verlust (Wert der versenkten Einheiten / Wert des Verbands) je Stärke, Mittel über Seeds.
  const fleets: [string, Counts][] = [
    ["Überfall 20 Kv + 4 LS + 300 Schützen", { korvette: 20, landungsschiff: 4, schuetzen: 300 }],
    ["dazu 4 Minenräumer", { korvette: 20, landungsschiff: 4, schuetzen: 300, minenraeumer: 4 }],
    ["12 U-Boote", { uboot: 12 }],
    ["10 Zerstörer", { zerstoerer: 10 }],
  ];
  const strengths = [25, 50, 100, m.maxStrength];
  console.log(`\nSee: Minen – Ø Verlust (Wert) je Durchfahrt nach Feldstärke, ${SEEDS} Seeds`);
  console.log(`  ${"Verband".padEnd(38)}${strengths.map((s) => `Stärke ${s}`.padStart(12)).join("")}`);
  for (const [name, units] of fleets) {
    const total = fleetValue(units, balance);
    const cells = strengths.map((s) => {
      let lost = 0;
      for (let seed = 1; seed <= SEEDS; seed++) lost += fleetValue(mineTransit(units, s, balance, seed).losses, balance);
      return pct(lost / SEEDS / total).padStart(12);
    });
    console.log(`  ${name.padEnd(38)}${cells.join("")}`);
  }
  const layers = Math.ceil(m.maxStrength / (balance.units.minenleger.mineLayer ?? 25));
  const fieldCost = value(mineLayCost(m.maxStrength, balance), balance);
  let dmg = 0;
  for (let seed = 1; seed <= SEEDS; seed++) dmg += fleetValue(mineTransit(fleets[0][1], m.maxStrength, balance, seed).losses, balance);
  console.log(`  Volles Feld (Stärke ${m.maxStrength}, ${layers} Minenleger): Minen ${Math.round(fieldCost)} Stahl-Äq., Schiffe ${Math.round(fleetValue({ minenleger: layers }, balance))}; ein Überfall-Verband verliert Ø ${Math.round(dmg / SEEDS)}.`);

  // 2. Blockade: entgangene Gebäudeproduktion des Bot-Hafens je Haltezeit gegen Kosten des kleinsten Blockadeverbands.
  console.log(`\nSee: Blockade – Produktion × ${k.productionFactor}, Lieferungen zurückgehalten, Verkauf gesperrt`);
  const minFleet: Counts = { zerstoerer: Math.ceil(k.minCommandPoints / (balance.units.zerstoerer.commandPoints ?? 6)) };
  const upkeep = Object.entries(minFleet).reduce((s, [id, n]) => s + (balance.units[id].upkeepPerHour ?? 0) * n, 0);
  for (const day of [7, 14, 28]) {
    const s = snaps.find((x) => x.day === day) ?? snaps[snaps.length - 1];
    const perHour = value(productionRates(s.base, balance).buildingPerHour, balance);
    const loss = (h: number) => Math.round(perHour * (1 - k.productionFactor) * h);
    console.log(`  Tag ${String(day).padEnd(3)} Produktion ${Math.round(perHour)}/h → entgangen ${k.minHours} h: ${loss(k.minHours)}, ${k.maxHours} h: ${loss(k.maxHours)} (Stahl-Äq.); Blockierer: ${Math.round(fleetValue(minFleet, balance))} im Verband, Unterhalt ${Math.round(upkeep * k.maxHours)} Proviant über ${k.maxHours} h`);
  }
  // Brechen: Verteidiger mit 1,5-facher Schiffsstärke gegen den kleinsten Blockadeverband.
  for (const [name, atk] of [["6 Korvetten", { korvette: 6 }], ["12 Korvetten", { korvette: 12 }], ["6 Zerstörer", { zerstoerer: 6 }], ["4 Jagdbomber + 6 Korvetten", { jagdbomber: 4, korvette: 6 }]] as [string, Counts][]) {
    let broke = 0, sunk = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = resolveBattle({ units: atk }, { units: minFleet, defenses: {} }, balance, seed);
      if (!r.ok) continue;
      if (strandTroops(r.report, balance).destroyed) broke++;
      sunk += r.report.defender.losses.zerstoerer ?? 0;
    }
    console.log(`  ${name.padEnd(28)} gegen ${minFleet.zerstoerer} Zerstörer (kleinste Blockade): gebrochen ${pct(broke / SEEDS)}, Ø versenkt ${(sunk / SEEDS).toFixed(2)}`);
  }

  // 3. Konvois: Chance des Kartells und erwartete Verlustquote (Warenwert) ohne und mit Geleit.
  console.log(`\nSee: Konvois – Kartell fängt ab (Chance) und erwartete Verlustquote der Ladung; Handelsgebühr zum Vergleich`);
  const escorts: [string, Counts][] = [["ohne Geleit", {}], ["2 Korvetten", { korvette: 2 }], ["2 Zerstörer", { zerstoerer: 2 }]];
  console.log(`  ${"Strecke / Warenwert".padEnd(24)}${"Chance".padStart(9)}${escorts.map(([n]) => n.padStart(15)).join("")}`);
  for (const [km, cargo] of [[200, { stahl: 2000 }], [450, { stahl: 5000 }], [700, { elektronik: 3000 }], [900, { stahl: 20000 }]] as [number, Counts][]) {
    const v = cargoValue(cargo, balance);
    const p = cartelChance(km, v, balance);
    const force = cartelConvoyForce(v, balance);
    const cells = escorts.map(([, esc]) => {
      if (Object.keys(esc).length === 0) return pct(p * c.lossShareUnescorted).padStart(15);
      let held = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = resolveBattle({ units: force }, { units: esc, defenses: {} }, balance, seed);
        if (r.ok && !strandTroops(r.report, balance).destroyed) held++;
      }
      const lossIfRaided = (1 - held / SEEDS) * c.lossShareEscortBeaten;
      return `${pct(p * lossIfRaided)} (${Math.round((held / SEEDS) * 100)}%)`.padStart(15);
    });
    console.log(`  ${`${km} km / ${Math.round(v)}`.padEnd(24)}${pct(p).padStart(9)}${cells.join("")}`);
  }
  console.log(`  (Klammer: Geleit hält gegen den Kartellverband). Börsengebühr ${pct(balance.market.fee)}, Spielerhandel 2 %.`);
}
