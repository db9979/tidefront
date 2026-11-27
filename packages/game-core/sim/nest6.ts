// Nest Stufe 6 (v1.15): Spätspiel-Ziel für die Wochen 5–6 der 42-Tage-Saison. Der Bot-Verband (45 % Rüstung, Verband des
// Tages, alles daheim) greift Nest 5, Kandidaten „Nest 5 × k“ und das Nest 6 aus der Balance an. Ziel: Sieg ≥ 70 % um
// Tag 35–38, vor Tag 28 kaum zu schaffen. 400 Seeds je Fall. Aufruf: `node packages/game-core/sim/nest6.ts` oder `npm run sim`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Balance, BaseState, Counts, NestLevelDef } from "../src/index.ts";
import { fuelCost, nestDefender, productionRates, resolveBattle, trainingCost } from "../src/index.ts";
import { runBot, value, type BotSnapshot } from "./bot.ts";

const SEEDS = 400;
const DAYS = 42;
const MARKS = [21, 28, 31, 35, 38, 42];

const fleetOf = (b: BaseState): Counts => Object.fromEntries(Object.entries(b.units).filter(([, n]) => n > 0));
const prodValue = (b: BaseState, balance: Balance) => value(productionRates(b, balance).perHour, balance);

/** Sieg, Netto (Beute − bleibende Verluste − Treibstoff, Richtwert) je Angriff auf Nest `level`. */
export function nestRun(fleet: Counts, level: number, balance: Balance, seeds = SEEDS): { win: number; net: number; loss: number } {
  const nest = nestDefender(level, balance);
  if (!nest.ok) throw new Error(nest.code);
  const fuel = fuelCost(fleet, 400, balance) * (balance.market.refPrice.treibstoff ?? 0);
  let win = 0;
  let net = 0;
  let lossSum = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = resolveBattle({ units: fleet }, nest.defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") win++;
    let loss = 0;
    for (const [id, n] of Object.entries(r.report.attacker.losses)) {
      const gone = n - (r.report.attacker.returned[id] ?? 0);
      if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
    }
    lossSum += loss;
    net += value(r.report.loot, balance) - loss - fuel;
  }
  return { win: win / seeds, net: net / seeds, loss: lossSum / seeds };
}

/** Nest 5 × k (Besatzung, Anlagen, Beute; gerundet) als Stufe 6. */
function scaledBalance(balance: Balance, k: number): Balance {
  const n5 = balance.pirates.nestLevels["5"];
  const def: NestLevelDef = { loot: Object.fromEntries(Object.entries(n5.loot).map(([r, v]) => [r, Math.round(v * k)])) };
  for (const [id, v] of Object.entries(n5)) if (typeof v === "number") def[id] = Math.round(v * k);
  return { ...balance, pirates: { ...balance.pirates, nestLevels: { ...balance.pirates.nestLevels, "6": def } } };
}

export function runNest6Sim(balance: Balance, snaps?: BotSnapshot[]): void {
  const mil = snaps ?? runBot(balance, DAYS, Array.from({ length: DAYS }, (_, i) => i + 1));
  const at = (day: number) => mil.find((x) => x.day === day)!;
  console.log(`\nNest Stufe 6 (v1.15): Bot-Verband (45 % Rüstung) des Tages, ${SEEDS} Seeds je Fall`);
  /**
   * Verband des Tages, wahlweise mit 2 zusätzlichen Landungsschiffen (Puffer im Seegefecht, mehr Laderaum): „frei“ über
   * die Kommandopunkte hinaus (Forschung, Admiral), „KP“ mit gleich vielen Kommandopunkten (dafür weniger Schützen).
   */
  const cp = (id: string) => balance.units[id]?.commandPoints ?? 0;
  const fleet = (day: number, mode: "" | "frei" | "KP" = ""): Counts => {
    const f = fleetOf(at(day).base);
    if (mode === "") return f;
    f.landungsschiff = (f.landungsschiff ?? 0) + 2;
    if (mode === "KP") f.schuetzen = Math.max(0, (f.schuetzen ?? 0) - Math.ceil((2 * cp("landungsschiff")) / cp("schuetzen") - 1e-9));
    return f;
  };
  const row = (label: string, b: Balance, level: number) => {
    const cells = (mode: "" | "frei" | "KP") => MARKS.map((d) => `${String(Math.round(nestRun(fleet(d, mode), level, b).win * 100)).padStart(3)} %`).join(" ");
    console.log(`  ${label.padEnd(18)} Tag ${MARKS.join("/")}: ${cells("")} | +2 Landungsschiffe frei: ${cells("frei")} | gleiche KP: ${cells("KP")}`);
  };
  row("Nest 5", balance, 5);
  for (const k of [1.3, 1.35, 1.4, 1.45, 1.5]) row(`Nest 5 × ${k}`, scaledBalance(balance, k), 6);
  if (!balance.pirates.nestLevels["6"]) return;
  row("Nest 6 (Balance)", balance, 6);
  const loot6 = value(balance.pirates.nestLevels["6"].loot, balance);
  const loot5 = value(balance.pirates.nestLevels["5"].loot, balance);
  console.log(`  Beute Nest 5 ${Math.round(loot5)}, Nest 6 ${Math.round(loot6)} (Richtwert); Wiederkehr Nest 6 ${balance.pirates.nestLevels["6"].respawnHours ?? balance.pirates.nestRespawnHours} h`);
  for (const d of [28, 35, 38, 42]) {
    const s = at(d);
    const p = prodValue(s.base, balance);
    const n5 = nestRun(fleetOf(s.base), 5, balance);
    const n6 = nestRun(fleetOf(s.base), 6, balance);
    const n6m = nestRun(fleet(d, "KP"), 6, balance); // wer auf Nest 6 zielt, nimmt Laderaum mit
    console.log(
      `  Tag ${d} (Produktion ${Math.round(p)}/h): Nest 5 Netto ${Math.round(n5.net)} = ${(n5.net / p).toFixed(1)} h | ` +
        `Nest 6 Beute ${(loot6 / p).toFixed(1)} h, Verluste ${Math.round(n6.loss)}, Netto ${Math.round(n6.net)} = ${(n6.net / p).toFixed(1)} h | ` +
        `+2 Landungsschiffe (gleiche KP): Sieg ${Math.round(n6m.win * 100)} %, Netto ${Math.round(n6m.net)} = ${(n6m.net / p).toFixed(1)} h`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
  runNest6Sim(balance);
}
