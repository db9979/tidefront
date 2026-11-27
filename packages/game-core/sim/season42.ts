// Saison von 42 statt 28 Tagen (v1.14-Prüfung): Läuft der Bot ab Tag 30–35 leer (Lager voll, nichts Neues)? Wann kommt
// Kommandozentrale 5 / 9 (2. / 3. Hafen), wie viele Felder darf er halten, was bringen Nest 5, Kartell, Weltereignisse
// (Saisonfortschritt) und Admirale in der verlängerten Saison? 200 Seeds je Kampffall.
import type { Balance, BaseState, Counts } from "../src/index.ts";
import {
  admiralXpGain,
  allowedBases,
  composeRaid,
  defenderFromBase,
  fuelCost,
  maxFieldsFor,
  nestDefender,
  productionRates,
  resolveBattle,
  storageCapacity,
  trainingCost,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { runBot, value } from "./bot.ts";

const SEEDS = 200;
const DAYS = 42;
const MARKS = [7, 14, 21, 28, 35, 42];

const lvl = (b: BaseState, id: string) => b.buildings[id] ?? 0;
const sumLevels = (b: BaseState) => Object.values(b.buildings).reduce((a, n) => a + n, 0);
const prodValue = (b: BaseState, balance: Balance) => value(productionRates(b, balance).perHour, balance);
const fleetOf = (b: BaseState): Counts => Object.fromEntries(Object.entries(b.units).filter(([, n]) => n > 0));

function nestStats(fleet: Counts, level: number, balance: Balance): { win: number; net: number; admiralXp: number } {
  const nest = nestDefender(level, balance);
  if (!nest.ok) throw new Error(nest.code);
  const fuel = fuelCost(fleet, 400, balance) * (balance.market.refPrice.treibstoff ?? 0);
  let win = 0;
  let net = 0;
  let xp = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle({ units: fleet }, nest.defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") win++;
    let loss = 0;
    for (const [id, n] of Object.entries(r.report.attacker.losses)) {
      const gone = n - (r.report.attacker.returned[id] ?? 0);
      if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
    }
    net += value(r.report.loot, balance) - loss - fuel;
    xp += admiralXpGain(r.report, "attacker", balance);
  }
  return { win: win / SEEDS, net: net / SEEDS, admiralXp: xp / SEEDS };
}

function raidStats(base: BaseState, balance: Balance): { win: number; loss: number } {
  let win = 0;
  let loss = 0;
  const def = defenderFromBase(base, balance);
  for (let seed = 1; seed <= SEEDS; seed++) {
    const raid = composeRaid(base.units, base.defenses, balance, seed + 100000);
    const r = resolveBattle(raid.attacker, def, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") win++;
    for (const [id, n] of Object.entries(r.report.defender.losses)) {
      const gone = n - (r.report.defender.returned[id] ?? 0);
      if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
    }
  }
  return { win: win / SEEDS, loss: loss / SEEDS };
}

function economy(label: string, snaps: BotSnapshot[], balance: Balance): void {
  console.log(`  ${label}`);
  console.log(`    Tag  KZ  HK  Werft  Stufen  Prod./h  Lager voll  Ausgaben je Woche (Ausbau/Rüstung)  Felder  Häfen`);
  let prev: BotSnapshot | null = null;
  for (const s of snaps.filter((x) => MARKS.includes(x.day))) {
    const b = s.base;
    const cap = storageCapacity(b, balance);
    const fill = Math.max(...balance.resources.map((r) => (b.resources[r] ?? 0) / cap));
    const wk = prev ? `${Math.round(s.spentBuild - prev.spentBuild)} / ${Math.round(s.spentMil - prev.spentMil)}` : `${Math.round(s.spentBuild)} / ${Math.round(s.spentMil)}`;
    console.log(
      `    ${String(s.day).padStart(3)} ${String(lvl(b, "kommandozentrale")).padStart(3)} ${String(lvl(b, "hafenkommandantur")).padStart(3)}` +
        ` ${String(lvl(b, "werft")).padStart(6)} ${String(sumLevels(b)).padStart(7)} ${String(Math.round(prodValue(b, balance))).padStart(8)}` +
        ` ${`${Math.round(fill * 100)} %`.padStart(11)}  ${wk.padStart(33)}  ${String(maxFieldsFor(lvl(b, "hafenkommandantur"), balance)).padStart(6)}  ${String(allowedBases(b, balance)).padStart(5)}`,
    );
    prev = s;
  }
  const first = (kz: number) => snaps.find((s) => lvl(s.base, "kommandozentrale") >= kz)?.day ?? "-";
  const firstHk = (hk: number) => snaps.find((s) => lvl(s.base, "hafenkommandantur") >= hk)?.day ?? "-";
  console.log(`    Kommandozentrale 5 (2. Hafen) ab Tag ${first(5)}, 9 (3. Hafen) ab Tag ${first(9)}; Hafenkommandantur 8 (3 Felder) ab Tag ${firstHk(8)}, 12 (4 Felder) ab Tag ${firstHk(12)}`);
}

export function runSeason42Sim(balance: Balance): void {
  const days = Array.from({ length: DAYS }, (_, i) => i + 1);
  const mil = runBot(balance, DAYS, days);
  const eco = runBot(balance, DAYS, days, 0);
  console.log(`\nSaison 42 Tage (Prüfung v1.14): Bot über ${DAYS} Tage, Werte zum Richtwert`);
  economy("Bot mit 45 % Rüstung", mil, balance);
  economy("Wirtschafts-Bot (ohne Rüstung)", eco, balance);

  console.log(`\n  Nest 5 und Kartell gegen den Bot (Verband des Tages), ${SEEDS} Seeds; Nestbeute in Stunden Produktion`);
  const loot5 = value(nestDefender(5, balance).ok ? (nestDefender(5, balance) as { defender: { fixedLoot?: Record<string, number> } }).defender.fixedLoot ?? {} : {}, balance);
  for (const day of [21, 28, 35, 42]) {
    const s = mil.find((x) => x.day === day)!;
    const n = nestStats(fleetOf(s.base), 5, balance);
    const r = raidStats(s.base, balance);
    const p = prodValue(s.base, balance);
    console.log(
      `    Tag ${day}: Nest 5 Sieg ${Math.round(n.win * 100)} %, Netto ${Math.round(n.net)} (Beute ${Math.round(loot5)} = ${(loot5 / p).toFixed(1)} h Produktion), ` +
        `Admiral-Erfahrung je Angriff ${n.admiralXp.toFixed(0)} | Kartell Sieg ${Math.round(r.win * 100)} %, bleibende Verluste ${Math.round(r.loss)} = ${(r.loss / p).toFixed(1)} h`,
    );
  }

  // Saisonfortschritt: Weltereignisse rechnen mit Anteil der Saison, nicht mit Tagen.
  const we = (balance as unknown as { worldEvents?: { seasonGrowth: number; schatzschiff: { loot: Record<string, number>; lootSeasonGrowth: number } } }).worldEvents;
  if (we) {
    const base = value(we.schatzschiff.loot, balance);
    console.log(`\n  Weltereignisse nach Saisonfortschritt: Schatzschiff-Beute (Grundwert ${Math.round(base)}) in Stunden Produktion des Bots, Stärkefaktor`);
    for (const day of [7, 14, 21, 28, 35, 42]) {
      const p = prodValue(mil.find((x) => x.day === day)!.base, balance);
      const cell = (len: number) => {
        if (day > len) return "–".padStart(26);
        const prog = day / len;
        const loot = base * (1 + we.schatzschiff.lootSeasonGrowth * prog);
        return `${Math.round(loot)} = ${(loot / p).toFixed(1)} h, ×${(1 + we.seasonGrowth * prog).toFixed(2)}`.padStart(26);
      };
      console.log(`    Tag ${String(day).padStart(2)} (Produktion ${Math.round(p)}/h): 28 Tage ${cell(28)} | 42 Tage ${cell(42)}`);
    }
  }

  // Vorschlag Nest 6 (nur Rechnung, nicht in der Balance): Nest 5 × k, k so, dass der Verband von Tag 35 rund 70 % siegt.
  const n5 = balance.pirates.nestLevels["5"];
  const scaled = (k: number): Balance => {
    const def: Record<string, unknown> = { loot: Object.fromEntries(Object.entries(n5.loot).map(([r, v]) => [r, Math.round(v * k)])) };
    for (const [id, v] of Object.entries(n5)) if (typeof v === "number") def[id] = Math.round(v * k);
    return { ...balance, pirates: { ...balance.pirates, nestLevels: { ...balance.pirates.nestLevels, "6": def as typeof n5 } } };
  };
  const cells: string[] = [];
  for (const k of [1.2, 1.3, 1.4, 1.5]) {
    const b6 = scaled(k);
    const w = [28, 35, 42].map((day) => `${Math.round(nestStats(fleetOf(mil.find((x) => x.day === day)!.base), 6, b6).win * 100)} %`);
    cells.push(`×${k}: Tag 28/35/42 ${w.join(" / ")}`);
  }
  console.log(`\n  Gedachtes Nest 6 = Nest 5 × k (Besatzung, Anlagen, Beute), Sieg des Bot-Verbands: ${cells.join(" | ")}`);

  // Admirale: Erfahrung bei täglichem Angriff auf das höchste Nest mit >= 70 % ab Tag 10 (Börse, Kredite).
  const ranks = balance.admirals?.ranks ?? [];
  let xp = 0;
  const reached: Record<string, number> = {};
  for (let day = 10; day <= DAYS; day++) {
    const fleet = fleetOf(mil.find((x) => x.day === day)!.base);
    for (let level = 5; level >= 1; level--) {
      const n = nestStats(fleet, level, balance);
      if (n.win >= 0.7) {
        xp += n.admiralXp;
        break;
      }
    }
    for (const r of ranks) if (xp >= r.minXp && reached[r.name] === undefined) reached[r.name] = day;
  }
  console.log(`\n  Admiral ab Tag 10, täglich das höchste Nest mit ≥ 70 %: ${ranks.map((r) => `${r.name} (${r.minXp}) Tag ${reached[r.name] ?? "-"}`).join(", ")}; Erfahrung Tag ${DAYS}: ${Math.round(xp)}`);
}
