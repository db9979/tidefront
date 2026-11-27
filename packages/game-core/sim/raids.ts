// Kartell-Überfälle (v1.13, Fragen aus C5): Wie stark ist eine einzelne Bunkerlinie gegen die Miliz, und lockt eine
// Flotte daheim größere Überfälle an? Varianten: Angriff der Miliz auf Anlagen (`piratenmiliz.attack.anlage`) und
// Gewicht der Schiffe in der Überfallstärke (`pirates.raidHpWeights`). 400 Seeds je Fall; Stärke-Seed wie in simulate.ts.
import type { Balance, Counts, DefenderInput } from "../src/index.ts";
import { composeRaid, defenderFromBase, resolveBattle, trainingCost } from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

const SEEDS = 400;
const RAID_SEED_OFFSET = 100000;
/** Überfälle je Tag: alle 18 h, davon fallen Start oder Ankunft (1 h später) zu 9 / 24 in den Nachtschild (8 h). */
export const RAIDS_PER_DAY = (24 / 18) * (15 / 24);
const RES = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };

export interface RaidStats {
  win: number;
  /** Ø Beute des Kartells je Überfall (Stahl-Äquivalent, Niederlagen mit 0 gezählt). */
  loot: number;
  /** Ø bleibende Verluste des Verteidigers an Einheiten (ohne Lazarett) je Überfall. */
  loss: number;
  /** davon Schiffe. */
  shipLoss: number;
  /** Anteil der Überfälle, in denen mindestens eine Bunkerlinie fällt. */
  bunkerDown: number;
}

/** Balance mit anderer Miliz (Angriff auf Anlagen) und/oder anderen Gewichten der Überfallstärke. */
export function raidVariant(balance: Balance, v: { anlage?: number; weights?: Record<string, number> | null }): Balance {
  const mil = balance.npcUnits.piratenmiliz;
  const pirates = { ...balance.pirates };
  if (v.weights === null) delete pirates.raidHpWeights;
  else if (v.weights) pirates.raidHpWeights = v.weights;
  return {
    ...balance,
    pirates,
    npcUnits: { ...balance.npcUnits, piratenmiliz: { ...mil, attack: { ...mil.attack, anlage: v.anlage ?? mil.attack.anlage } } },
  };
}

export function raidStats(def: DefenderInput, b: Balance, seeds = SEEDS): RaidStats {
  const s: RaidStats = { win: 0, loot: 0, loss: 0, shipLoss: 0, bunkerDown: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const raid = composeRaid(def.units, def.defenses ?? {}, b, seed + RAID_SEED_OFFSET);
    const r = resolveBattle(raid.attacker, def, b, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") s.win++;
    s.loot += value(r.report.loot, b);
    for (const [id, n] of Object.entries(r.report.defender.losses)) {
      const gone = n - (r.report.defender.returned[id] ?? 0);
      if (!b.units[id] || gone <= 0) continue;
      const v = value(trainingCost(id, gone, b), b);
      s.loss += v;
      if (b.units[id].branch === "see") s.shipLoss += v;
    }
    if ((def.defenses?.bunkerlinie ?? 0) > (r.report.defender.survivors.bunkerlinie ?? 0)) s.bunkerDown++;
  }
  return { win: s.win / seeds, loot: s.loot / seeds, loss: s.loss / seeds, shipLoss: s.shipLoss / seeds, bunkerDown: s.bunkerDown / seeds };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const home = (units: Counts, defenses: Counts = {}): DefenderInput => ({ units, defenses, resources: RES, protectedPerResource: 300 });
const withBunker = (d: DefenderInput, n = 1): DefenderInput => ({ ...d, defenses: { ...d.defenses, bunkerlinie: (d.defenses?.bunkerlinie ?? 0) + n } });

function botCases(snaps: BotSnapshot[], balance: Balance, days: number[]): [string, DefenderInput][] {
  return days.map((day) => {
    const s = snaps.find((x) => x.day === day)!;
    return [`Bot-Hafen Tag ${day} (ganzer Verband daheim)`, defenderFromBase(s.base, balance)];
  });
}

/** Frage 1: Bunkerlinie gegen die Miliz. */
function bunkerSection(balance: Balance, snaps: BotSnapshot[]): void {
  const anlagen = [1, 3, 5, 6, 8];
  const now = balance.npcUnits.piratenmiliz.attack.anlage;
  console.log(`\nKartell (v1.13): Bunkerlinie gegen die Miliz – Sieg % Kartell (Bunkerlinie fällt %) je Angriff der Miliz auf Anlagen`);
  console.log(`  (Schiffe nach raidHpWeights der aktuellen Balance; Bunkerlinie 460 Stahl-Äq. = 11 Schützen; aktuell anlage ${now})`);
  const groups: [string, DefenderInput][] = [
    ["11 Schützen (Kosten einer Bunkerlinie)", home({ schuetzen: 11 })],
    ["1 Bunkerlinie allein", home({}, { bunkerlinie: 1 })],
    ["20 Schützen", home({ schuetzen: 20 })],
    ["20 Schützen + 1 Bunkerlinie", home({ schuetzen: 20 }, { bunkerlinie: 1 })],
    ["31 Schützen (gleich teuer)", home({ schuetzen: 31 })],
    ["40 Schützen + 1 Bunkerlinie", home({ schuetzen: 40 }, { bunkerlinie: 1 })],
    ["50 Schützen, 3 Batterien", home({ schuetzen: 50 }, { kuestenbatterie: 3 })],
    ["50 Schützen, 3 Batterien + 1 Bunkerlinie", home({ schuetzen: 50 }, { kuestenbatterie: 3, bunkerlinie: 1 })],
    ["40 Schützen, 4 Batterien, 2 Flak", home({ schuetzen: 40 }, { kuestenbatterie: 4, flakstellung: 2 })],
    ["40 Schützen, 4 Batterien, 2 Flak + 1 Bunkerlinie", home({ schuetzen: 40 }, { kuestenbatterie: 4, flakstellung: 2, bunkerlinie: 1 })],
    ["stark: 3 Zerst., 2 Batt., 80 Sch.", home({ zerstoerer: 3, schuetzen: 80 }, { kuestenbatterie: 2 })],
    ["stark + 2 Bunkerlinien", home({ zerstoerer: 3, schuetzen: 80 }, { kuestenbatterie: 2, bunkerlinie: 2 })],
  ];
  for (const [label, d] of botCases(snaps, balance, [14, 28])) {
    groups.push([label, d]);
    groups.push([`${label.replace(" (ganzer Verband daheim)", "")} + 1 Bunkerlinie`, withBunker(d)]);
  }
  console.log(`  ${"".padEnd(52)}${anlagen.map((a) => `anlage ${a}`.padStart(14)).join("")}`);
  for (const [label, d] of groups) {
    const cells = anlagen.map((a) => {
      const r = raidStats(d, raidVariant(balance, { anlage: a }));
      const down = (d.defenses?.bunkerlinie ?? 0) > 0 ? ` (${Math.round(r.bunkerDown * 100)})` : "";
      return `${pct(r.win)}${down}`.padStart(14);
    });
    console.log(`  ${label.padEnd(52)}${cells.join("")}`);
  }

  // Kosten gegen Schutz: Ersparnis an Beute und Verlusten durch eine Bunkerlinie über 7/14/28 Tage.
  console.log(`\n  Kosten gegen Schutz einer Bunkerlinie (460 Stahl-Äq., Reparatur 40 % nach Zerstörung): ${RAIDS_PER_DAY.toFixed(2)} Überfälle je Tag`);
  console.log(`  Ersparnis = (Beute + bleibende Verluste) ohne − mit Bunkerlinie, je Überfall und über 7 / 14 / 28 Tage, abzüglich Kosten`);
  const bases: [string, DefenderInput][] = [
    ["Wache 20 Schützen", home({ schuetzen: 20 })],
    ["50 Schützen, 3 Batterien", home({ schuetzen: 50 }, { kuestenbatterie: 3 })],
    ["40 Schützen, 4 Batterien, 2 Flak", home({ schuetzen: 40 }, { kuestenbatterie: 4, flakstellung: 2 })],
  ];
  const bunkerCost = value(balance.defenses.bunkerlinie.cost, balance);
  for (const a of [1, 5]) {
    const b = raidVariant(balance, { anlage: a });
    for (const [label, d] of bases) {
      const r0 = raidStats(d, b);
      const r1 = raidStats(withBunker(d), b);
      const perRaid = r0.loot + r0.loss - (r1.loot + r1.loss) - r1.bunkerDown * bunkerCost * (1 - balance.combat.defenseRepairShare);
      const periods = [7, 14, 28].map((days) => Math.round(perRaid * RAIDS_PER_DAY * days - bunkerCost));
      console.log(
        `  anlage ${a}: ${label.padEnd(34)} Kartell ${pct(r0.win).padStart(5)} → ${pct(r1.win).padStart(5)}, je Überfall ${String(Math.round(perRaid)).padStart(5)}` +
          ` | 7 / 14 / 28 Tage: ${periods.map((p) => String(p).padStart(6)).join(" /")}`,
      );
    }
  }
}

/** Frage 2: Gewicht der Schiffe in der Überfallstärke. */
function shipSection(balance: Balance, snaps: BotSnapshot[]): void {
  const variants: [string, Record<string, number> | null][] = [
    ["v1.12 alle 1", null],
    ["See 0,75, Tr. 0", { see: 0.75, landungsschiff: 0, kolonieschiff: 0, minenleger: 0 }],
    ["See 0,5", { see: 0.5 }],
    ["See 0,5, Tr. 0", { see: 0.5, landungsschiff: 0, kolonieschiff: 0, minenleger: 0 }],
    ["See 0,25, Tr. 0", { see: 0.25, landungsschiff: 0, kolonieschiff: 0, minenleger: 0 }],
  ];
  console.log(`\nKartell (v1.13): Flotte daheim – Sieg % Kartell / Ø bleibender Schiffsverlust je Überfall nach Gewicht der Schiffe`);
  console.log(`  (Tr. = Transporter ohne Seekampfwert: Landungsschiff, Kolonieschiff, Minenleger; Miliz wie aktuelle Balance; „ohne Schiffe“ = Verband ohne Schiffe daheim)`);
  const cases: [string, DefenderInput][] = [
    ["20 Schützen", home({ schuetzen: 20 })],
    ["20 Schützen + 2 Korvetten", home({ schuetzen: 20, korvette: 2 })],
    ["20 Schützen + 1 Zerstörer", home({ schuetzen: 20, zerstoerer: 1 })],
    ["20 Schützen + 2 Landungsschiffe", home({ schuetzen: 20, landungsschiff: 2 })],
    ["40 Schützen", home({ schuetzen: 40 })],
    ["40 Schützen + 8 Korvetten", home({ schuetzen: 40, korvette: 8 })],
    ["40 Schützen + 4 Zerstörer", home({ schuetzen: 40, zerstoerer: 4 })],
    ["40 Schützen + 4 Landungsschiffe", home({ schuetzen: 40, landungsschiff: 4 })],
    ["40 Schützen + 4 U-Boote", home({ schuetzen: 40, uboot: 4 })],
    ["40 Schützen + 2 Minenleger", home({ schuetzen: 40, minenleger: 2 })],
    ["40 Schützen + 2 Minenräumer", home({ schuetzen: 40, minenraeumer: 2 })],
    ["80 Schützen, 2 Batterien + 8 Korvetten", home({ schuetzen: 80, korvette: 8 }, { kuestenbatterie: 2 })],
  ];
  for (const [label, d] of botCases(snaps, balance, [7, 14, 28])) {
    cases.push([label, d]);
    const ground = Object.fromEntries(Object.entries(d.units).filter(([id]) => balance.units[id]?.branch !== "see"));
    cases.push([`${label.replace(" (ganzer Verband daheim)", "")} ohne Schiffe`, { ...d, units: ground }]);
  }
  console.log(`  ${"".padEnd(44)}${variants.map(([l]) => l.padStart(17)).join("")}`);
  for (const [label, d] of cases) {
    const cells = variants.map(([, w]) => {
      const r = raidStats(d, raidVariant(balance, { weights: w }));
      return `${pct(r.win)} / ${Math.round(r.shipLoss)}`.padStart(17);
    });
    console.log(`  ${label.padEnd(44)}${cells.join("")}`);
  }
}

export function runRaidSim(balance: Balance, snaps: BotSnapshot[]): void {
  bunkerSection(balance, snaps);
  shipSection(balance, snaps);
}
