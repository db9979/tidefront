// Lebendige Nester (nest-living.ts, docs/VORLAGE-NESTER.md 4): Zielfenster mit der echten Umsetzung bestätigen. Der
// Bot-Verband (ganzer Bestand des Tages) gegen jede Stufe 1–6: Mitte (fest wie bis v1.30), Zufallsnest (Würfe aus der
// Verteilung, je ein Seed), ungünstigster Wurf; erster Prüftag mit ≥ 70 % Sieg. Dazu der Einstieg (Auftrags-Verband und
// Vorschlag gegen Stufe 1, fest) und der Vorschlag ohne Lagebild (Mittel über die Spanne ≥ 90 %).
// Aufruf: `node packages/game-core/sim/nest-living.ts` (auch in `npm run sim`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Balance, Counts, DefenderInput } from "../src/index.ts";
import { nestDefenders, raidPlanSeed, resolveBattle, smallestWinningRaid } from "../src/index.ts";
import { runBot } from "./bot.ts";

const RUNS = 400;
const MARKS = [1, 2, 3, 5, 7, 10, 14, 18, 21, 28, 31, 35, 38, 42];
const WINDOW: Record<number, string> = { 1: "1–2", 2: "3–5", 3: "7–10", 4: "14–18", 5: "21–28", 6: "35–38" };

function winRate(units: Counts, defs: DefenderInput[], balance: Balance, runs = RUNS): number {
  let w = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle({ units }, defs[i % defs.length], balance, raidPlanSeed(i));
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") w++;
  }
  return w / runs;
}

export function runNestLiving(balance: Balance): string[] {
  const out: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3) + " %";
  const snaps = runBot(balance, 42, MARKS);
  const first: Record<string, Record<number, number>> = { mitte: {}, zufall: {}, ungünstig: {} };
  out.push("Lebendige Nester: Bot-Verband gegen Stufe 1–6 (Mitte / Zufallsnest / ungünstigster Wurf)");
  for (const s of snaps) {
    const fleet = Object.fromEntries(Object.entries(s.base.units).filter(([, n]) => n > 0));
    const cells: string[] = [];
    for (let level = 1; level <= 6; level++) {
      const rates = { mitte: winRate(fleet, nestDefenders(level, balance, "mid"), balance), zufall: winRate(fleet, nestDefenders(level, balance, "range"), balance), ungünstig: winRate(fleet, nestDefenders(level, balance, "worst"), balance) };
      for (const [k, v] of Object.entries(rates)) if (v >= 0.7 && first[k][level] === undefined) first[k][level] = s.day;
      cells.push(`${pct(rates.mitte)}/${pct(rates.zufall)}/${pct(rates.ungünstig)}`);
    }
    out.push(`  Tag ${String(s.day).padStart(2)}  ${cells.join("  ")}`);
  }
  for (const k of Object.keys(first)) out.push(`  Erster Prüftag ≥ 70 % (${k}): ${[1, 2, 3, 4, 5, 6].map((l) => `S${l} T${first[k][l] ?? "-"} (Ziel ${WINDOW[l]})`).join(", ")}`);
  const goal = { korvette: 2, landungsschiff: 1, schuetzen: 30 };
  const plan = smallestWinningRaid(goal, 1, balance, { defenders: nestDefenders(1, balance, "range") });
  out.push(`Einstieg Stufe 1 (fest): Vorschlag ${JSON.stringify(plan.units)} Probe ${pct(plan.winRate ?? 0)}, Auftrags-Verband ${pct(winRate(goal, nestDefenders(1, balance, "mid"), balance))}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
  for (const l of runNestLiving(balance)) console.log(l);
}
