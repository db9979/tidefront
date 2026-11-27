// Kriegsglück (v1.4): Wie stark entscheidet der Würfel? Für drei Gefechte wird die Feuerkraft des Angreifers
// (Faktor auf alle Angriffswerte) so gesucht, dass er etwa 50 % gewinnt („ausgeglichen“). Dann: Sieg % bei
// ×1,08, ×1,15 (knapp überlegen), ×1,3 und ×1,5 (klar überlegen), jeweils ohne Würfel (wie v1.3) und mit Würfel.
import type { AttackerInput, Balance, BattleReport, Counts, DefenderInput, Modifiers } from "../src/index.ts";
import { luckFactor, luckMean, nestDefender, resolveBattle } from "../src/index.ts";
import { buildStats } from "../src/combat-stats.ts";

const SEEDS = 400;

interface Case {
  label: string;
  attacker: Counts;
  defender: DefenderInput;
  /** Sieg des Angreifers; Vorgabe: Kampfregel (Landung). */
  won?: (r: BattleReport, balance: Balance) => boolean;
}

function power(f: number): Modifiers {
  return { attack: { see: f, land: f, luft: f, anlage: f } };
}

/** Seegefecht ohne Landung: Sieg, wenn der Gegner anteilig mehr Lebenspunkte verloren hat. */
function seaWin(r: BattleReport, balance: Balance): boolean {
  const t = buildStats(balance);
  const hp = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + t.byId[id].hp * n, 0);
  const keepA = hp(r.attacker.survivors) / Math.max(1, hp(r.attacker.before));
  const keepD = hp(r.defender.survivors) / Math.max(1, hp(r.defender.before));
  return keepA > keepD;
}

function winRate(c: Case, f: number, balance: Balance): number {
  let wins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a: AttackerInput = { units: c.attacker, modifiers: power(f) };
    const r = resolveBattle(a, c.defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (c.won ? c.won(r.report, balance) : r.report.winner === "attacker") wins++;
  }
  return wins / SEEDS;
}

/** Feuerkraft-Faktor, bei dem der Angreifer etwa 50 % gewinnt (Bisektion). */
function evenFactor(c: Case, balance: Balance): number {
  let lo = 0.2;
  let hi = 5;
  for (let i = 0; i < 14; i++) {
    const mid = Math.sqrt(lo * hi);
    if (winRate(c, mid, balance) < 0.5) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

function luckCases(balance: Balance): Case[] {
  const nest = (level: number) => {
    const n = nestDefender(level, balance);
    if (!n.ok) throw new Error(n.code);
    return n.defender;
  };
  return [
    { label: "Seegefecht: 10 Korvetten gegen 4 Zerstörer", attacker: { korvette: 10 }, defender: { units: { zerstoerer: 4 }, defenses: {} }, won: seaWin },
    { label: "Landung: 3 L, 5 Pz, 200 Sch. gegen 150 Sch., 1 Bunker", attacker: { landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }, defender: { units: { schuetzen: 150 }, defenses: { bunkerlinie: 1 } } },
    { label: "Nest 3: 4 Zerst., 3 L, 5 Pz, 200 Sch.", attacker: { zerstoerer: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }, defender: nest(3) },
    { label: "Nest 5: 8 Zerst., 4 Jagdb., 5 L, 10 Pz, 300 Sch., 50 Pio.", attacker: { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }, defender: nest(5) },
  ];
}

/** Anteil der Seeds, in denen der Würfel den Ausgang gegenüber demselben Kampf ohne Würfel umdreht. */
function flipRate(c: Case, f: number, withLuck: Balance, noLuck: Balance): number {
  let flips = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a: AttackerInput = { units: c.attacker, modifiers: power(f) };
    const r0 = resolveBattle(a, c.defender, noLuck, seed);
    const r1 = resolveBattle(a, c.defender, withLuck, seed);
    if (!r0.ok || !r1.ok) throw new Error("battle");
    const w0 = c.won ? c.won(r0.report, noLuck) : r0.report.winner === "attacker";
    const w1 = c.won ? c.won(r1.report, withLuck) : r1.report.winner === "attacker";
    if (w0 !== w1) flips++;
  }
  return flips / SEEDS;
}

/**
 * Frage aus E2 (v1.7): Ist ±15 % (innen) zu zahm oder zu wild? Varianten des Würfels, gemessen an der Feuerkraft, bei der
 * der Angreifer OHNE Würfel 50 % gewinnt (fester Bezugspunkt für alle Varianten). Ziel: knapp überlegen (×1,08–×1,15)
 * 60–75 %, klar überlegen (×1,5) ≥ 95 %; dazu der Anteil der Kämpfe, die der Würfel kippt.
 */
export function runLuckVariants(balance: Balance): void {
  const luck = balance.combat.luck;
  if (!luck) return;
  const { luck: _drop, ...plainCombat } = balance.combat;
  const noLuck: Balance = { ...balance, combat: plainCombat };
  const variants: [string, NonNullable<Balance["combat"]["luck"]>][] = [
    ["±10 % (Rand ±15 %)", { ...luck, min: 0.85, max: 1.15, innerMin: 0.9, innerMax: 1.1 }],
    ["±15 % (Rand ±20 %) aktuell", { ...luck, min: 0.8, max: 1.2, innerMin: 0.85, innerMax: 1.15 }],
    ["±20 % (Rand ±25 %)", { ...luck, min: 0.75, max: 1.25, innerMin: 0.8, innerMax: 1.2 }],
    ["±25 % (Rand ±30 %)", { ...luck, min: 0.7, max: 1.3, innerMin: 0.75, innerMax: 1.25 }],
  ];
  const steps = [1, 1.05, 1.08, 1.1, 1.15, 1.2, 1.3, 1.5]; // v1.13: dazu 5 / 10 / 20 % Überlegenheit
  const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)} %`;
  console.log(`\n  Varianten des Würfels (v1.7): Sieg % / gekippte Kämpfe % bei Feuerkraft × (Bezug: ohne Würfel 50 %)`);
  console.log(`  ${"".padEnd(28)}${steps.map((s) => `×${s.toFixed(2)}`.padStart(13)).join("")}`);
  const cases = luckCases(balance);
  const bases = cases.map((c) => evenFactor(c, noLuck));
  for (const [label, v] of variants) {
    const b: Balance = { ...balance, combat: { ...balance.combat, luck: v } };
    const sums = steps.map(() => ({ win: [] as number[], flip: [] as number[] }));
    cases.forEach((c, i) => {
      steps.forEach((s, j) => {
        sums[j].win.push(winRate(c, bases[i] * s, b));
        sums[j].flip.push(flipRate(c, bases[i] * s, b, noLuck));
      });
    });
    const range = (xs: number[]) => {
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      return lo === hi ? pct(lo).trim() : `${Math.round(lo * 100)}–${pct(hi).trim()}`;
    };
    console.log(`  ${label.padEnd(28)}${sums.map((x) => range(x.win).padStart(13)).join("")}`);
    console.log(`  ${"  davon gekippt".padEnd(28)}${sums.map((x) => range(x.flip).padStart(13)).join("")}`);
  }
}

export function runLuckSim(balance: Balance): void {
  const luck = balance.combat.luck;
  console.log(`\nKriegsglück (v1.4): W${luck?.die ?? "-"} je Phase und Seite, ${SEEDS} Seeds je Fall`);
  if (!luck) {
    console.log("  combat.luck fehlt – kein Würfel.");
    return;
  }
  const faces = Array.from({ length: luck.die }, (_, i) => luckFactor(i + 1, luck));
  console.log(`  Faktoren 1…${luck.die}: ${faces.map((x) => x.toFixed(3)).join(" ")}`);
  console.log(`  Mittelwert ${luckMean(luck).toFixed(12)} (exakt 1: Summe ${faces.reduce((s, x) => s + x, 0).toFixed(12)} = ${luck.die})`);

  const cases = luckCases(balance);
  const { luck: _drop, ...plainCombat } = balance.combat;
  const noLuck: Balance = { ...balance, combat: plainCombat };
  const steps = [1, 1.08, 1.15, 1.3, 1.5];
  const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)} %`;
  console.log(`  Sieg % des Angreifers bei Feuerkraft × (ausgeglichen = 50 %): ohne Würfel (v1.3) / mit Würfel (v1.4)`);
  console.log(`  ${"".padEnd(58)} ${steps.map((s) => `×${s.toFixed(2)}`.padStart(13)).join("")}`);
  for (const c of cases) {
    const cells: string[] = [];
    // Ausgangspunkt je Variante: dort gewinnt der Angreifer etwa 50 %.
    const f0 = evenFactor(c, noLuck);
    const f1 = evenFactor(c, balance);
    for (const s of steps) cells.push(`${pct(winRate(c, f0 * s, noLuck))}/${pct(winRate(c, f1 * s, balance))}`.padStart(13));
    console.log(`  ${c.label.padEnd(58)} ${cells.join("")}`);
  }
  runLuckVariants(balance);
}
