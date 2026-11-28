// Messbarkeit (Welle 2, Abschlussprüfung 0.38): drei Abschnitte, die Wechselwirkungen je Tag statt je Ereignis ausweisen.
// - Kartellkosten je Tag (M-01): Überfälle je Tag × (Beute + bleibender Verlust) in % der Tagesproduktion des Bots.
// - Nest-6-Beute nach Laderaum (M-02/M-13): wie viel der festen Beute der Verband des Tages tatsächlich mitnimmt.
// - Punkteanteil je Quelle (M-03): Anteile von Ausbau, Militär, Kampf, Beute und Befehlen an den Saisonpunkten eines
//   Modell-Spielers mit festem Nestplan und Tagesbefehlen.
// Der echte Saisonlauf mit Worker-Schritten (npm run sim:saison, packages/engine/sim/saison.ts) misst dieselben Größen
// an den KI-Spielern. Aufruf: `node packages/game-core/sim/messung.ts` oder als Teil von `npm run sim`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Balance, BaseState, Counts } from "../src/index.ts";
import { composeRaid, defenderFromBase, nestDefender, productionRates, resolveBattle, trainingCost } from "../src/index.ts";
import { runBot, value, type BotSnapshot } from "./bot.ts";
import { RAIDS_PER_DAY } from "./raids.ts";

const SEEDS = 200;
const RAID_SEED_OFFSET = 100000;
const DAYS = 42;
/** Ziel der Nutzerentscheidung 2 (Abschlussprüfung 0.38): Kartell kostet höchstens so viel der Tagesproduktion. */
export const CARTEL_TARGET_SHARE = 0.1;
/** Ziel der Nutzerentscheidung 3: Kampf + Beute höchstens so viel der Saisonpunkte; Entscheidung 4: Befehle ≤ 5 %. */
export const FIGHT_LOOT_TARGET_SHARE = 0.5;
export const ORDERS_TARGET_SHARE = 0.05;
/** Punkte = Kostenwert / 100 (engine/src/scoring.ts POINT_DIVISOR). */
const POINT_DIVISOR = 100;
/** Fester Wert der NPC-Einheiten (engine/src/scoring.ts NPC_UNIT_VALUE). */
const NPC_VALUE: Record<string, number> = { schnellboot: 250, piratenmiliz: 40 };
/** Punkte der drei Tagesbefehle (engine/src/challenge-pool.ts TIER_POINTS) – Modell: alle drei an DAILY_DAYS der Tage. */
const DAILY_POINTS = 3 + 6 + 12;
const DAILY_DAYS = 0.6;

const prodPerHour = (b: BaseState, balance: Balance) => value(productionRates(b, balance).perHour, balance);
const fleetOf = (b: BaseState): Counts => Object.fromEntries(Object.entries(b.units).filter(([, n]) => n > 0));
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Kartell gegen den Hafen (ganzer Verband daheim): Sieg, Ø Beute und Ø bleibender Verlust je Überfall (Richtwert). */
export function cartelRaid(base: BaseState, balance: Balance, seeds = SEEDS): { win: number; loot: number; loss: number } {
  let win = 0, loot = 0, loss = 0;
  const def = defenderFromBase(base, balance);
  for (let seed = 1; seed <= seeds; seed++) {
    const r = resolveBattle(composeRaid(base.units, base.defenses, balance, seed + RAID_SEED_OFFSET).attacker, def, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner === "attacker") win++;
    loot += value(r.report.loot, balance);
    for (const [id, n] of Object.entries(r.report.defender.losses)) {
      const gone = n - (r.report.defender.returned[id] ?? 0);
      if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
    }
  }
  return { win: win / seeds, loot: loot / seeds, loss: loss / seeds };
}

/** Kartellkosten je Tag in Anteilen der Tagesproduktion (Überfälle je Tag × Kosten je Überfall). */
export function cartelDailyShare(base: BaseState, balance: Balance, seeds = SEEDS): { perRaid: number; perDay: number; share: number; win: number } {
  const r = cartelRaid(base, balance, seeds);
  const perRaid = r.loot + r.loss;
  const perDay = perRaid * RAIDS_PER_DAY;
  return { perRaid, perDay, share: perDay / Math.max(1, prodPerHour(base, balance) * 24), win: r.win };
}

/** Laderaum eines Verbands (Summe cargo je Einheit). */
export function cargoOf(units: Counts, balance: Balance): number {
  return Object.entries(units).reduce((a, [id, n]) => a + (balance.units[id]?.cargo ?? 0) * n, 0);
}

/** Nest-Beute nach Laderaum: angebotene Einheiten (× Wachstum), mitgenommene Einheiten im Mittel der Siege, Anteil. */
export function nestCargo(fleet: Counts, level: number, balance: Balance, growth = 1, seeds = SEEDS): { offered: number; taken: number; share: number; win: number; cargo: number } {
  const nest = nestDefender(level, balance);
  if (!nest.ok) throw new Error(nest.code);
  const fixed = Object.fromEntries(Object.entries(nest.defender.fixedLoot ?? {}).map(([r, v]) => [r, v * growth]));
  const offered = Object.values(fixed).reduce((a, b) => a + b, 0);
  let wins = 0, taken = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = resolveBattle({ units: fleet }, { ...nest.defender, fixedLoot: fixed }, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (r.report.winner !== "attacker") continue;
    wins++;
    taken += Object.values(r.report.loot).reduce((a, b) => a + b, 0);
  }
  const avg = wins ? taken / wins : 0;
  return { offered, taken: avg, share: offered > 0 ? avg / offered : 0, win: wins / seeds, cargo: cargoOf(fleet, balance) };
}

/** Modell-Nestplan (REGELN.md, Zielfenster): Stufe je Saisontag. */
export function plannedNest(day: number): number {
  if (day < 4) return 1;
  if (day < 7) return 2;
  if (day < 14) return 3;
  if (day < 21) return 4;
  if (day < 35) return 5;
  return 6;
}

/** Kampf- und Beutewert eines Nestüberfalls mit dem Verband (Mittel über Seeds; Niederlagen zählen mit 0 Beute). */
function nestScore(fleet: Counts, level: number, balance: Balance, seeds: number): { kampf: number; beute: number } {
  const nest = nestDefender(level, balance);
  if (!nest.ok) throw new Error(nest.code);
  let kampf = 0, beute = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = resolveBattle({ units: fleet }, nest.defender, balance, seed);
    if (!r.ok) throw new Error(r.code);
    for (const [id, n] of Object.entries(r.report.defender.losses)) {
      const def = balance.units[id] ?? balance.defenses[id];
      kampf += n * (def ? value(def.cost ?? {}, balance) : (NPC_VALUE[id] ?? 0));
    }
    beute += value(r.report.loot, balance);
  }
  return { kampf: kampf / seeds, beute: beute / seeds };
}

export interface ScoreShares { day: number; ausbau: number; militaer: number; kampf: number; beute: number; befehle: number; total: number }

/**
 * Punkteanteile des Modell-Spielers: Ausbau = Bauausgaben, Militär = Wert des Verbands, Kampf/Beute aus `raidsPerDay`
 * Nestüberfällen je Tag nach plannedNest (Verband des Tages), Befehle = DAILY_POINTS an DAILY_DAYS der Tage.
 */
export function scoreShares(snaps: BotSnapshot[], balance: Balance, raidsPerDay: number, seeds = 40): ScoreShares[] {
  const out: ScoreShares[] = [];
  let kampf = 0, beute = 0;
  for (const s of snaps) {
    const fleet = fleetOf(s.base);
    const n = nestScore(fleet, plannedNest(s.day), balance, seeds);
    const nf = balance.scoring?.nestFactor ?? 1; // v1.35: Nester zählen Kampf und Beute × nestFactor
    kampf += n.kampf * raidsPerDay * nf;
    beute += n.beute * raidsPerDay * nf;
    const mil = Object.entries(s.base.units).reduce((a, [id, c]) => a + c * value(balance.units[id]?.cost ?? {}, balance), 0);
    const row = {
      day: s.day,
      ausbau: Math.floor(s.spentBuild / POINT_DIVISOR),
      militaer: Math.floor(mil / POINT_DIVISOR),
      kampf: Math.floor(kampf / POINT_DIVISOR),
      beute: Math.floor(beute / POINT_DIVISOR),
      befehle: Math.floor(DAILY_POINTS * DAILY_DAYS * s.day),
    };
    // v1.35: Befehle höchstens scoring.ordersMaxShare des Gesamtrangs (wie engine/src/scoring.ts cappedOrders).
    const share = balance.scoring?.ordersMaxShare;
    if (share !== undefined && share < 1) row.befehle = Math.min(row.befehle, Math.floor((share / (1 - share)) * (row.ausbau + row.militaer + row.kampf + row.beute) + 1e-9));
    out.push({ ...row, total: row.ausbau + row.militaer + row.kampf + row.beute + row.befehle });
  }
  return out;
}

export function runMessungSim(balance: Balance, snapsIn?: BotSnapshot[]): void {
  const snaps = snapsIn ?? runBot(balance, DAYS, Array.from({ length: DAYS }, (_, i) => i + 1));
  const at = (day: number) => snaps.find((x) => x.day === day)!;

  console.log(`\n=== Messbarkeit (Welle 2) ===`);
  console.log(`\nKartellkosten je Tag: Bot (45 % Rüstung, ganzer Verband daheim), ${RAIDS_PER_DAY.toFixed(2).replace(".", ",")} Überfälle/Tag, ${SEEDS} Seeds; Ziel ≤ ${pct(CARTEL_TARGET_SHARE)}`);
  console.log(`  Tag   Prod./Tag   Kartell-Sieg   je Überfall   je Tag    Anteil`);
  for (const day of [7, 14, 21, 28, 35, 42]) {
    const s = at(day);
    const c = cartelDailyShare(s.base, balance);
    const flag = c.share > CARTEL_TARGET_SHARE ? "  über Ziel" : "";
    console.log(`  ${String(day).padStart(3)}   ${String(Math.round(prodPerHour(s.base, balance) * 24)).padStart(9)}   ${pct(c.win).padStart(12)}   ${String(Math.round(c.perRaid)).padStart(11)}   ${String(Math.round(c.perDay)).padStart(6)}   ${pct(c.share).padStart(6)}${flag}`);
  }

  console.log(`\nNest-6-Beute nach Laderaum: Verband des Tages (alles daheim), ${SEEDS} Seeds; Beute im Mittel der Siege`);
  console.log(`  Tag   Laderaum   Wachstum   angeboten   mitgenommen   Anteil   Sieg`);
  for (const day of [28, 35, 38, 42]) {
    const fleet = fleetOf(at(day).base);
    for (const g of [1, balance.pirates.living?.lootMax ?? 1]) {
      const n = nestCargo(fleet, 6, balance, g);
      console.log(`  ${String(day).padStart(3)}   ${String(n.cargo).padStart(8)}   ${pct(g).padStart(8)}   ${String(Math.round(n.offered)).padStart(9)}   ${String(Math.round(n.taken)).padStart(11)}   ${pct(n.share).padStart(6)}   ${pct(n.win).padStart(4)}`);
    }
  }

  console.log(`\nPunkteanteil je Quelle: Modell-Spieler (Bot 45 % Rüstung), Nestplan Stufe 1–6 nach Zielfenster, Tagesbefehle 3/3 an ${pct(DAILY_DAYS)} der Tage`);
  console.log(`  Ziele: Kampf + Beute ≤ ${pct(FIGHT_LOOT_TARGET_SHARE)}, Befehle ≤ ${pct(ORDERS_TARGET_SHARE)}`);
  for (const raids of [1, 2]) {
    console.log(`  ${raids} ${raids === 1 ? "Nestüberfall" : "Nestüberfälle"} je Tag:`);
    const marks = new Set([7, 14, 21, 28, 35, 42]);
    for (const r of scoreShares(snaps.filter((s) => s.day <= DAYS), balance, raids).filter((x) => marks.has(x.day))) {
      const sh = (v: number) => pct(v / Math.max(1, r.total)).padStart(5);
      const fl = (r.kampf + r.beute) / Math.max(1, r.total);
      const flag = fl > FIGHT_LOOT_TARGET_SHARE || r.befehle / Math.max(1, r.total) > ORDERS_TARGET_SHARE ? "  über Ziel" : "";
      console.log(`    Tag ${String(r.day).padStart(2)}: ${String(r.total).padStart(6)} P | Ausbau ${sh(r.ausbau)} Militär ${sh(r.militaer)} Kampf ${sh(r.kampf)} Beute ${sh(r.beute)} Befehle ${sh(r.befehle)} | Kampf+Beute ${pct(fl)}${flag}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
  runMessungSim(balance);
}
