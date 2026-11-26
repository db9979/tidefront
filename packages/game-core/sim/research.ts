// Simulation v1.3: Wirkung voll erforschter Techniken. Ziel: Forschung verschiebt Ergebnisse spürbar,
// entscheidet aber kein Spiel (kein Bereich über +25 %, Siegquoten ändern sich nur am Rand).
import type { AttackerInput, Balance, Counts, DefenderInput, Modifiers } from "../src/index.ts";
import {
  composeRaid,
  defenderFromBase,
  fuelCost,
  nestDefender,
  productionRates,
  researchModifiers,
  resolveBattle,
  storageCapacity,
  travelSeconds,
  upgradeSeconds,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";

const SEEDS = 200;
const RAID_SEED_OFFSET = 100000;

function winRate(balance: Balance, attacker: (seed: number) => AttackerInput, defender: DefenderInput): number {
  let wins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle(attacker(seed), defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") wins++;
  }
  return wins / SEEDS;
}

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)} %`;
const signed = (f: number) => `${f >= 1 ? "+" : "−"}${Math.abs(Math.round((f - 1) * 100))} %`;

export function runResearchSim(balance: Balance, snaps: BotSnapshot[]): void {
  const techs = balance.research?.techs ?? {};
  const all: Counts = {};
  for (const [id, t] of Object.entries(techs)) all[id] = t.maxLevel;
  const full = researchModifiers(all, balance);

  console.log(`\nForschung (v1.3): ${Object.keys(techs).length} Techniken, voll erforscht – Faktor je Bereich`);
  const areas: string[] = [];
  for (const [k, v] of Object.entries(full)) {
    if (typeof v === "number") areas.push(`${k} ${signed(v)}`);
    else for (const [e, f] of Object.entries(v as Record<string, number>)) areas.push(`${k}.${e} ${signed(f)}`);
  }
  for (let i = 0; i < areas.length; i += 6) console.log(`  ${areas.slice(i, i + 6).join(" · ")}`);

  const nest = (level: number) => {
    const n = nestDefender(level, balance);
    if (!n.ok) throw new Error(n.code);
    return n.defender;
  };

  console.log("\n  Nester: Sieg % ohne / mit voller Forschung des Angreifers");
  const fleets: [string, Counts][] = [
    ["4 Korvetten, 2 L-Schiffe, 150 Schützen", { korvette: 4, landungsschiff: 2, schuetzen: 150 }],
    ["4 Zerstörer, 3 L-Schiffe, 5 Pz, 200 Sch.", { zerstoerer: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }],
    ["8 Zerst., 4 Jagdbomber, 5 L, 10 Pz, 300 Sch., 50 Pio.", { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }],
  ];
  for (const [label, units] of fleets) {
    const cells = [1, 2, 3, 4, 5].map((l) => {
      const a = winRate(balance, () => ({ units }), nest(l));
      const b = winRate(balance, () => ({ units, modifiers: full }), nest(l));
      return `${pct(a)}/${pct(b)}`.padStart(13);
    });
    console.log(`  ${label.padEnd(54)}${cells.join("")}`);
  }

  // Knappe Kämpfe kippen schon bei kleinen Vorteilen (Zufall nur ±5 %). Aussagekräftiger ist daher, wie viel
  // größer ein Verband ohne Forschung sein muss, um dasselbe zu erreichen (>= 70 % Sieg).
  console.log("\n  Nötige Verbandsgröße für >= 70 % Sieg (Vielfaches des Bot-Verbands, Schritt 5 %): keine / Angreifer / Verteidiger / beide erforscht");
  const scaled = (u: Counts, k: number): Counts => Object.fromEntries(Object.entries(u).map(([id, n]) => [id, Math.floor(n * k + 1e-9)]));
  const needed = (units: Counts, def: (md: Modifiers | undefined) => DefenderInput, ma: Modifiers | undefined, md: Modifiers | undefined): string => {
    for (let k = 0.5; k <= 3.0001; k += 0.05) {
      if (winRate(balance, () => ({ units: scaled(units, k), modifiers: ma }), def(md)) >= 0.7) return `×${k.toFixed(2)}`;
    }
    return "> ×3";
  };
  const cases: [Modifiers | undefined, Modifiers | undefined][] = [[undefined, undefined], [full, undefined], [undefined, full], [full, full]];
  for (const day of [14, 28]) {
    const s = snaps.find((x) => x.day === day);
    if (!s) continue;
    const units = Object.fromEntries(Object.entries(s.base.units).filter(([, n]) => n > 0));
    const rows: [string, (md: Modifiers | undefined) => DefenderInput][] = [
      [`Tag ${day}: gegen Nest Stufe ${day >= 28 ? 5 : 4}`, () => nest(day >= 28 ? 5 : 4)],
      [`Tag ${day}: gegen Bot-Hafen (ganzer Verband daheim)`, (md) => defenderFromBase(s.base, balance, md)],
    ];
    for (const [label, def] of rows) {
      const cells = cases.map(([ma, md]) => (label.includes("Nest") && md ? "–" : needed(units, def, ma, md)).padStart(9));
      console.log(`  ${label.padEnd(54)}${cells.join("")}`);
    }
  }

  console.log("\n  Kartell gegen den Bot-Hafen: Sieg % Kartell ohne / mit voller Forschung des Verteidigers");
  for (const day of [7, 28]) {
    const s = snaps.find((x) => x.day === day);
    if (!s) continue;
    const attacker = (seed: number) => composeRaid(s.base.units, s.base.defenses, balance, seed + RAID_SEED_OFFSET).attacker;
    const a = winRate(balance, attacker, defenderFromBase(s.base, balance));
    const b = winRate(balance, attacker, defenderFromBase(s.base, balance, full));
    console.log(`  Tag ${String(day).padStart(2)}: ${pct(a)} / ${pct(b)}`);
  }

  const s28 = snaps.find((x) => x.day === 28) ?? snaps[snaps.length - 1];
  const units = Object.fromEntries(Object.entries(s28.base.units).filter(([, n]) => n > 0));
  const p0 = productionRates(s28.base, balance).perHour;
  const p1 = productionRates(s28.base, balance, full).perHour;
  console.log(
    `\n  Wirtschaft Tag ${s28.day}: Stahl/h ${Math.round(p0.stahl)} → ${Math.round(p1.stahl)}, Lager ${Math.round(storageCapacity(s28.base, balance))} → ` +
      `${Math.round(storageCapacity(s28.base, balance, full))}, Bauzeit KZ ${Math.round(upgradeSeconds("kommandozentrale", 8, balance) / 60)} → ` +
      `${Math.round(upgradeSeconds("kommandozentrale", 8, balance, full) / 60)} min, Nest in 400 km: Reise ` +
      `${Math.round((travelSeconds(units, 400, balance) ?? 0) / 60)} → ${Math.round((travelSeconds(units, 400, balance, full) ?? 0) / 60)} min, ` +
      `Treibstoff ${fuelCost(units, 400, balance)} → ${fuelCost(units, 400, balance, full)}`,
  );

  // Gesamtaufwand der vollen Forschung (Forschungsamt Stufe 5, ohne Durchbrüche).
  let seconds = 0;
  const cost: Record<string, number> = {};
  const r = balance.research!;
  const speed = 1 + (balance.buildings[r.building]?.researchSpeedPerLevel ?? 0) * 4;
  for (const [id, t] of Object.entries(techs)) {
    for (let l = 0; l < t.maxLevel; l++) {
      seconds += (t.seconds * r.timeFactor ** l) / speed;
      for (const [res, v] of Object.entries(t.cost)) cost[res] = (cost[res] ?? 0) + Math.ceil(v * r.costFactor ** l);
    }
    void id;
  }
  console.log(
    `  Alles erforschen (Forschungsamt 5): ${(seconds / 86400).toFixed(1)} Tage reine Forschungszeit, Kosten ` +
      `${Object.entries(cost).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")}`,
  );
}
