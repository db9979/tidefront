// Mehrere Häfen: Kosten einer Kolonie (Kolonieschiff, Treibstoff) gegen den Ertrag des neuen Hafens. Der neue Hafen
// wird vom Wirtschafts-Bot ab dem Startbestand (expansion.startResources plus Ladung) ausgebaut; gemessen wird die
// aufsummierte Nettoproduktion zum Richtwert (v1.35: nach Unterhalt). Amortisation = Tage, bis sie die Kosten deckt (v1.35:
// Ziel deutlich über 2–3 Tage, Nutzerentscheid 12 – Kolonien sind eine Entscheidung, keine Pflicht).
import type { Balance, BaseState } from "../src/index.ts";
import { expansionOf, foundingFee, fuelCost, productionRates, trainingCost } from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { runBot, value } from "./bot.ts";

const STEP_H = 10 / 60;
/** Typische Entfernung Heimathafen → neuer Hafen (km). */
const DIST_KM = 600;
/** Kolonien bauen zuerst die Wirtschaft aus: geringerer Rüstungsanteil als der Heimathafen. */
const COLONY_MILITARY_SHARE = 0.2;

/** Nettoproduktion (Richtwert) eines neuen Hafens je Tag, aufsummiert über `days` Tage. */
function colonyIncome(balance: Balance, cargo: Record<string, number>, days: number): { cumulative: number[]; last: BaseState } {
  const e = expansionOf(balance)!;
  const start: Record<string, number> = {};
  for (const r of balance.resources) start[r] = (e.startResources[r] ?? 0) + (cargo[r] ?? 0);
  const b: Balance = { ...balance, start };
  let sum = 0;
  const cumulative: number[] = [];
  let lastDay = 0;
  let last: BaseState | null = null;
  runBot(b, days, [], COLONY_MILITARY_SHARE, undefined, (base0, t) => {
    const base = base0.colony ? base0 : { ...base0, colony: { foundedAtMs: 0 } }; // v1.35: Kolonie zahlt Unterhalt
    sum += value(productionRates(base, b).perHour, b) * STEP_H;
    const day = Math.floor(t / 86400000);
    if (day > lastDay) {
      cumulative.push(sum);
      lastDay = day;
    }
    last = base;
    return base;
  });
  return { cumulative, last: last! };
}

export function runExpansionSim(balance: Balance, snaps: BotSnapshot[]): void {
  const e = expansionOf(balance);
  if (!e) return;
  const shipDef = balance.units[e.colonyShip];
  const ship = value(trainingCost(e.colonyShip, 1, balance), balance);
  const fuel = fuelCost({ [e.colonyShip]: 1 }, DIST_KM, balance, undefined, 1) * (balance.market.refPrice.treibstoff ?? 0);
  const cost = ship + fuel;
  console.log(`\nMehrere Häfen: Kolonieschiff ${Math.round(ship)} (Richtwert), Treibstoff ${DIST_KM} km ${Math.round(fuel)}, ` +
    `Ladung bis ${shipDef.cargo ?? 0}, Bauzeit ${(((shipDef.seconds ?? 0) / (1 + (balance.buildings.werft.buildSpeedPerLevel ?? 0) * ((shipDef.requiresLevel ?? 1) - 1))) / 3600).toFixed(1)} h (Werft ${shipDef.requiresLevel})`);
  for (const day of [10, 14, 21]) {
    const s = snaps.find((x) => x.day === day);
    if (!s) continue;
    const prod = value(productionRates(s.base, balance).perHour, balance);
    console.log(`  Bot-Hafen Tag ${day}: KZ ${s.base.buildings.kommandozentrale}, HK ${s.base.buildings.hafenkommandantur}, Werft ${s.base.buildings.werft}, ` +
      `Produktion ${Math.round(prod)}/h → Kolonieschiff = ${(cost / prod).toFixed(1)} h Produktion`);
  }
  const cargoFull: Record<string, number> = {};
  const per = Math.floor((shipDef.cargo ?? 0) / balance.resources.length);
  for (const r of balance.resources) cargoFull[r] = per;
  const upkeep = e.colonyUpkeepPerDay ? value(e.colonyUpkeepPerDay, balance) : 0;
  console.log(`  v1.35: Unterhalt je Kolonie bis ${Math.round(upkeep)} Richtwert/Tag (höchstens die Gebäudeproduktion), Gründungsgebühr 3. Hafen ${Math.round(value(foundingFee(3, balance), balance))}`);
  for (const nth of [2, 3]) {
    const total = cost + value(foundingFee(nth, balance), balance);
    for (const [name, cargo] of [["ohne Ladung", {}], ["volle Ladung (gleich verteilt)", cargoFull]] as const) {
      const extra = value(cargo, balance);
      const { cumulative, last } = colonyIncome(balance, cargo, 14);
      const pay = cumulative.findIndex((c) => c >= total);
      const prod = value(productionRates(last, balance).perHour, balance);
      console.log(`  ${nth}. Hafen (Kosten ${Math.round(total)}), ${name}: Ertrag Tag 1/2/3/5/7 = ${[1, 2, 3, 5, 7].map((d) => Math.round(cumulative[d - 1] ?? 0)).join(" / ")}, ` +
        `Ladung ${Math.round(extra)} (verlegt, keine Kosten) → amortisiert nach ${pay < 0 ? "> 14" : pay + 1} Tagen; Tag 14: KZ ${last.buildings.kommandozentrale}, ${Math.round(prod)}/h netto`);
    }
  }
}
