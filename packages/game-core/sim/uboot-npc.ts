// U-Jagd für Kartell und Nester? (v1.13, Frage aus C5): Kartell und Nester haben keine U-Jagd, U-Boote sind für sie
// unverwundbar. Vergleich der Bot-Doktrinen (Zerstörer / U-Boote statt Zerstörer / schwere U-Boot-Rüstung) gegen
// Nester 3–5 und im Kartell-Überfall, dazu als Gegenprobe Schnellboote mit U-Jagd. 200 Seeds je Fall.
import type { Balance, Counts, DefenderInput } from "../src/index.ts";
import { composeRaid, defenderFromBase, fuelCost, nestDefender, resolveBattle, trainingCost } from "../src/index.ts";
import type { Doctrine } from "./bot.ts";
import { DOCTRINE, MILITARY_SHARE, UBOOT_DOCTRINE, UBOOT_HEAVY_DOCTRINE, runBot, value } from "./bot.ts";

const SEEDS = 200;
const NEST_KM = 400;
const DAYS = [14, 21, 28];

interface Outcome {
  win: number;
  /** Beute − bleibende Verluste − Treibstoff (Angriff) bzw. bleibende Verluste (Abwehr), Stahl-Äquivalent. */
  net: number;
  /** bleibend verlorene U-Boote je Kampf. */
  subs: number;
}

function permanentLoss(o: { losses: Counts; returned: Counts }, b: Balance): number {
  let v = 0;
  for (const [id, n] of Object.entries(o.losses)) {
    const gone = n - (o.returned[id] ?? 0);
    if (gone > 0 && b.units[id]) v += value(trainingCost(id, gone, b), b);
  }
  return v;
}

function attackNest(fleet: Counts, level: number, b: Balance): Outcome {
  const nest = nestDefender(level, b);
  if (!nest.ok) throw new Error(nest.code);
  const fuel = fuelCost(fleet, NEST_KM, b) * (b.market.refPrice.treibstoff ?? 0);
  const o: Outcome = { win: 0, net: 0, subs: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle({ units: fleet }, nest.defender, b, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") o.win++;
    o.net += value(r.report.loot, b) - permanentLoss(r.report.attacker, b) - fuel;
    o.subs += (r.report.attacker.losses.uboot ?? 0) - (r.report.attacker.returned.uboot ?? 0);
  }
  return { win: o.win / SEEDS, net: o.net / SEEDS, subs: o.subs / SEEDS };
}

function defendRaid(def: DefenderInput, b: Balance): Outcome {
  const o: Outcome = { win: 0, net: 0, subs: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const raid = composeRaid(def.units, def.defenses ?? {}, b, seed + 100000);
    const r = resolveBattle(raid.attacker, def, b, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") o.win++;
    o.net += permanentLoss(r.report.defender, b);
    o.subs += (r.report.defender.losses.uboot ?? 0) - (r.report.defender.returned.uboot ?? 0);
  }
  return { win: o.win / SEEDS, net: o.net / SEEDS, subs: o.subs / SEEDS };
}

/** Gegenprobe: Schnellboote mit U-Jagd (betrifft Nester aller Stufen und das Kartell). */
function withSchnellbootAsw(b: Balance, uboot: number): Balance {
  const sb = b.npcUnits.schnellboot;
  return { ...b, npcUnits: { ...b.npcUnits, schnellboot: { ...sb, attack: { ...sb.attack, uboot } } } };
}

export function runUbootNpcSim(balance: Balance): void {
  const doctrines: [string, Doctrine][] = [["Zerstörer (Vorgabe)", DOCTRINE], ["U-Boote statt Zerstörer", UBOOT_DOCTRINE], ["schwere U-Boot-Rüstung", UBOOT_HEAVY_DOCTRINE]];
  const runs = doctrines.map(([label, d]) => [label, runBot(balance, 28, DAYS, MILITARY_SHARE, d)] as const);
  const variants: [string, Balance][] = [["ohne U-Jagd (aktuell)", balance], ["Schnellboot U-Jagd 10", withSchnellbootAsw(balance, 10)]];
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  console.log(`\nU-Boote gegen Nester und Kartell (v1.13): Bot-Doktrinen, ${SEEDS} Seeds; Nest: Sieg / Netto (Beute − Verluste − Treibstoff) / versenkte U-Boote`);
  for (const [vLabel, b] of variants) {
    console.log(`  ${vLabel}`);
    for (const [label, snaps] of runs) {
      for (const day of DAYS) {
        const s = snaps.find((x) => x.day === day)!;
        const fleet = Object.fromEntries(Object.entries(s.base.units).filter(([, n]) => n > 0));
        const nests = [3, 4, 5].map((level) => {
          const o = attackNest(fleet, level, b);
          return `St.${level} ${pct(o.win).padStart(5)} ${String(Math.round(o.net)).padStart(6)} ${o.subs.toFixed(1)}`;
        });
        const raid = defendRaid(defenderFromBase(s.base, b), b);
        console.log(
          `    ${label.padEnd(24)} Tag ${day}: ${nests.join(" | ")} | Kartell ${pct(raid.win).padStart(4)}, Verlust ${String(Math.round(raid.net)).padStart(6)}, U ${raid.subs.toFixed(1)}`,
        );
      }
    }
  }
}
