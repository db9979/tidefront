// Großflotte (Weltereignis, L7): Bemisst sie ihre Stärke mit ungewichteten Lebenspunkten (`defenseHp`), locken Schiffe
// daheim eine größere Flotte samt Miliz an – wie beim Kartell vor v1.13 (L2). Vergleich mit der Gewichtung des Kartells
// (`pirates.raidHpWeights` über `raidDefenseHp`, ohne Forschung). Die Großflotte kämpft wie ein Kartell-Überfall:
// Seekampf gegen die Schiffe daheim, dann landet die Miliz (eigene Landungskapazität je Schnellboot).
// Bezug: Median der Zielhäfen; hier sind alle drei Ziele gleich (bzw. zwei Ziele ohne Schiffe, Spalte „Region“).
// 400 Seeds je Fall, erster Angriff mit voller Stärke.
import type { Balance, Counts, DefenderInput } from "../src/index.ts";
import {
  armadaAttacker, composeArmada, defenderFromBase, defenseHp, raidDefenseHp, referenceHp, resolveBattle, trainingCost,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

const SEEDS = 400;
const RES = { stahl: 8000, treibstoff: 4000, elektronik: 2000, proviant: 3000 };

interface ArmadaStats { win: number; loot: number; loss: number; shipLoss: number; boats: number }

type HpFn = (d: DefenderInput) => number;
const plain: HpFn = (d) => defenseHp(d.units, d.defenses ?? {}, BAL!);
const weighted: HpFn = (d) => raidDefenseHp(d.units, d.defenses ?? {}, BAL!);
let BAL: Balance | null = null;

/** Großflotte gegen einen Hafen; Bezug = Median der Zielhäfen (`refs`). */
export function armadaStats(def: DefenderInput, refs: DefenderInput[], hp: HpFn, progress: number, b: Balance, seeds = SEEDS): ArmadaStats {
  const comp = composeArmada(referenceHp(refs.map(hp), b), progress, b);
  const s: ArmadaStats = { win: 0, loot: 0, loss: 0, shipLoss: 0, boats: comp.units.schnellboot ?? 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const r = resolveBattle(armadaAttacker(comp.units, b), def, b, seed);
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
  }
  return { ...s, win: s.win / seeds, loot: s.loot / seeds, loss: s.loss / seeds, shipLoss: s.shipLoss / seeds };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const home = (units: Counts, defenses: Counts = {}): DefenderInput => ({ units, defenses, resources: RES, protectedPerResource: 300 });

export function runArmadaSim(balance: Balance, snaps: BotSnapshot[]): void {
  BAL = balance;
  const progress = 0.5;
  console.log(`\nGroßflotte (L7): Stärke ungewichtet (defenseHp, bisher) gegen gewichtet wie das Kartell (raidHpWeights)`);
  console.log(`  Sieg % Großflotte / Ø bleibender Schiffsverlust / Ø Verlust gesamt / Schnellboote; Saisonmitte (Fortschritt 0,5), ${SEEDS} Seeds`);
  console.log(`  Region: zwei weitere Ziele mit 40 Schützen (ohne Schiffe) – der Median dämpft die Wirkung der eigenen Flotte`);
  const cases: [string, DefenderInput, number][] = [
    ["20 Schützen", home({ schuetzen: 20 }), progress],
    ["20 Schützen + 1 Zerstörer", home({ schuetzen: 20, zerstoerer: 1 }), progress],
    ["20 Schützen + 2 Landungsschiffe", home({ schuetzen: 20, landungsschiff: 2 }), progress],
    ["40 Schützen", home({ schuetzen: 40 }), progress],
    ["40 Schützen + 8 Korvetten", home({ schuetzen: 40, korvette: 8 }), progress],
    ["40 Schützen + 4 Zerstörer", home({ schuetzen: 40, zerstoerer: 4 }), progress],
    ["40 Schützen + 4 Landungsschiffe", home({ schuetzen: 40, landungsschiff: 4 }), progress],
    ["40 Schützen + 4 U-Boote", home({ schuetzen: 40, uboot: 4 }), progress],
    ["80 Schützen, 2 Batterien", home({ schuetzen: 80 }, { kuestenbatterie: 2 }), progress],
    ["80 Schützen, 2 Batterien + 8 Korvetten", home({ schuetzen: 80, korvette: 8 }, { kuestenbatterie: 2 }), progress],
  ];
  for (const day of [7, 14, 28]) {
    const s = snaps.find((x) => x.day === day);
    if (!s) continue;
    const d = defenderFromBase(s.base, balance);
    const ground = Object.fromEntries(Object.entries(d.units).filter(([id]) => balance.units[id]?.branch !== "see"));
    cases.push([`Bot-Hafen Tag ${day}`, d, day / 42]);
    cases.push([`Bot-Hafen Tag ${day} ohne Schiffe`, { ...d, units: ground }, day / 42]);
  }
  const cols: [string, HpFn, boolean][] = [["ungewichtet", plain, false], ["gewichtet", weighted, false], ["Region ungew.", plain, true], ["Region gew.", weighted, true]];
  console.log(`  ${"".padEnd(42)}${cols.map(([l]) => l.padStart(30)).join("")}`);
  const other = home({ schuetzen: 40 });
  for (const [label, d, p] of cases) {
    const cells = cols.map(([, hp, region]) => {
      const r = armadaStats(d, region ? [d, other, other] : [d, d, d], hp, p, balance);
      return `${pct(r.win)} / ${Math.round(r.shipLoss)} / ${Math.round(r.loss)} / ${r.boats}`.padStart(30);
    });
    console.log(`  ${label.padEnd(42)}${cells.join("")}`);
  }
}
