// Veteranen über eine Saison (v1.13, Frage aus E2): Wie schnell steigen die Ränge eines typischen Spielers?
// Der Verband des Wirtschafts-Bots (Stand des jeweiligen Tages) kämpft nach einem festen Fahrplan gegen Nester und
// wehrt Kartell-Überfälle ab. Erfahrung wie im Spiel (strengthRatio, nextXp), Verluste werden sofort durch Rekruten
// ersetzt (Verwässerung), ebenso der Zuwachs des Bots von Tag zu Tag. Die Ränge wirken im Kampf (veteranModifiers).
import type { Balance, BattleReport, Counts, Side, VeteranBalance } from "../src/index.ts";
import {
  composeRaid,
  defenderFromBase,
  diluteXp,
  nestDefender,
  nextXp,
  resolveBattle,
  strengthRatio,
  veteranModifiers,
  veteranRank,
  xpPerSurvivor,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { runBot } from "./bot.ts";

const SEEDS = 200;
const DAY_H = 24;
/** Nest-Mission: Abfahrt 12 Uhr, Rückkehr nach 20 h (400 km hin und zurück); daheim steht dann niemand. */
const NEST_HOUR = 12;
const NEST_TRIP_H = 20;
const TYPES = ["schuetzen", "korvette", "zerstoerer", "jagdbomber", "kampfpanzer"];
let SEASON = 28;
let MARKS = [7, 14, 21, 28];

type Vet = Record<string, number>;
interface Scenario {
  label: string;
  /** Nestangriff an diesem Tag? */
  nestDay: (day: number) => boolean;
}

/** Erfahrung einer Seite nach einem Kampf; Verluste werden ersetzt (Rekruten mit 0 Erfahrung). */
function gainXp(vet: Vet, report: BattleReport, side: Side, balance: Balance, cfg: VeteranBalance): void {
  const o = report[side];
  const per = xpPerSurvivor(report.winner === side, strengthRatio(report, side, balance), cfg);
  for (const [id, before] of Object.entries(o.before)) {
    if (!balance.units[id] || before <= 0) continue;
    const pool = o.final[id] ?? 0;
    const lost = Math.max(0, before - pool);
    const x = nextXp(vet[id] ?? 0, pool, lost, o.survivors[id] ?? 0, per, cfg);
    vet[id] = diluteXp(x, pool, lost);
  }
}

/** Zuwachs des Verbands (Ausbildung) verwässert die Erfahrung. */
function grow(vet: Vet, from: Counts, to: Counts): void {
  for (const [id, n] of Object.entries(to)) {
    const have = from[id] ?? 0;
    if (n > have && vet[id] !== undefined) vet[id] = diluteXp(vet[id], have, n - have);
  }
}

/** Kartell-Überfälle: alle 18 h ab Ende des Anfängerschutzes; Start oder Ankunft (1 h später) im Nachtschild 22–6 Uhr entfällt. */
function raidHours(balance: Balance, days: number): number[] {
  const out: number[] = [];
  const step = balance.pirates.raidIntervalHours;
  for (let t = balance.protection.beginnerDays * DAY_H; t < days * DAY_H; t += step) {
    const h = t % DAY_H;
    if (h >= 21 || h < 6) continue;
    out.push(t);
  }
  return out;
}

function season(balance: Balance, snaps: BotSnapshot[], best: number[], sc: Scenario, seed: number): Vet[] {
  const cfg = balance.veterans!;
  const vet: Vet = {};
  const marks: Vet[] = [];
  const raids = raidHours(balance, SEASON);
  let last: Counts = {};
  let awayUntil = -1;
  let k = 0;
  const army = (h: number) => snaps[Math.min(snaps.length - 1, Math.floor(h / DAY_H))].base;
  for (let h = 0; h < SEASON * DAY_H; h++) {
    const base = army(h);
    grow(vet, last, base.units);
    last = { ...base.units };
    const day = Math.floor(h / DAY_H) + 1;
    const mods = veteranModifiers(vet, balance);
    if (h % DAY_H === NEST_HOUR && sc.nestDay(day) && best[day] > 0) {
      const nest = nestDefender(best[day], balance);
      if (!nest.ok) throw new Error(nest.code);
      const r = resolveBattle({ units: base.units, modifiers: mods }, nest.defender, balance, seed * 1000 + k++);
      if (!r.ok) throw new Error(r.code);
      gainXp(vet, r.report, "attacker", balance, cfg);
      awayUntil = h + NEST_TRIP_H;
    }
    if (raids.includes(h) && h >= awayUntil) {
      const raid = composeRaid(base.units, base.defenses, balance, seed * 1000 + k++);
      const r = resolveBattle(raid.attacker, defenderFromBase(base, balance, mods), balance, seed * 1000 + k++);
      if (!r.ok) throw new Error(r.code);
      gainXp(vet, r.report, "defender", balance, cfg);
    }
    if ((h + 1) % DAY_H === 0 && MARKS.includes(day)) marks.push({ ...vet });
  }
  return marks;
}

/** Höchste Neststufe, die der Verband des Tages zu mindestens 70 % schlägt (ohne Erfahrung, 100 Seeds). */
function bestNests(balance: Balance, snaps: BotSnapshot[]): number[] {
  const best = [0];
  for (const s of snaps) {
    let lvl = 0;
    for (let level = 1; level <= 5; level++) {
      const nest = nestDefender(level, balance);
      if (!nest.ok) throw new Error(nest.code);
      let wins = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const r = resolveBattle({ units: s.base.units }, nest.defender, balance, seed);
        if (r.ok && r.report.winner === "attacker") wins++;
      }
      if (wins >= 70) lvl = level;
    }
    best.push(lvl);
  }
  return best;
}

export function runVeteranSim(balance: Balance, days = 28): void {
  SEASON = days;
  MARKS = Array.from({ length: days / 7 }, (_, i) => 7 * (i + 1));
  if (!balance.veterans) return;
  const snaps = runBot(balance, SEASON, Array.from({ length: SEASON }, (_, i) => i + 1));
  const best = bestNests(balance, snaps);
  const scenarios: Scenario[] = [
    { label: "nur Kartell-Abwehr", nestDay: () => false },
    { label: "Nest alle 2 Tage", nestDay: (d) => d % 2 === 0 },
    { label: "Nest täglich", nestDay: () => true },
  ];
  const v = balance.veterans;
  // Gegenproben: mehr Erfahrung je Kampf bzw. niedrigere Schwellen.
  const all: [string, VeteranBalance][] = [
    ["aktuell", v],
    ["Gegenprobe xpWin 15", { ...v, xpWin: 15, xpLoss: 6 }],
    ["Gegenprobe Schwellen 10/30/60", { ...v, ranks: v.ranks.map((r, i) => ({ ...r, minXp: [0, 10, 30, 60][i] ?? r.minXp })) }],
  ];
  console.log(`\nVeteranen über eine Saison (v1.13): Ø Erfahrung (Rang) je Typ an Tag ${MARKS.join(" / ")}, ${SEEDS} Seeds`);
  console.log(`  Nest: höchste Stufe mit ≥ 70 % (Tag 1–${SEASON}: ${best.slice(1).join("")}), Rückkehr nach ${NEST_TRIP_H} h; Kartell alle 18 h ab Tag ` +
    `${balance.protection.beginnerDays + 1} (${raidHours(balance, SEASON).length} Überfälle, ohne Nachtschild 22–6 Uhr), nur wenn der Verband daheim ist`);
  const short = (xp: number, b: Balance) => `${xp.toFixed(0).padStart(3)} ${(veteranRank(xp, b)?.name ?? "-").slice(0, 3)}`;
  for (const [vLabel, cfg] of all) {
    const b: Balance = { ...balance, veterans: cfg };
    const ranks = cfg.ranks.map((r) => `${r.name} ${r.minXp}`).join(", ");
    console.log(`  ${vLabel}: Ränge ${ranks}; xpWin ${cfg.xpWin}, xpLoss ${cfg.xpLoss}, lossPenalty ${cfg.lossPenalty}`);
    console.log(`  ${"".padEnd(22)}${TYPES.map((t) => t.padEnd(34)).join("")}`);
    for (const sc of scenarios) {
      const sum = MARKS.map(() => ({} as Vet));
      for (let seed = 1; seed <= SEEDS; seed++) {
        season(b, snaps, best, sc, seed).forEach((v, i) => {
          for (const t of TYPES) sum[i][t] = (sum[i][t] ?? 0) + (v[t] ?? 0);
        });
      }
      const cells = TYPES.map((t) => MARKS.map((_, i) => short(sum[i][t] / SEEDS, b).trim()).join(" / ").padEnd(34));
      console.log(`  ${sc.label.padEnd(22)}${cells.join("")}`);
    }
  }
}
