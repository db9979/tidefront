// Felder: Ertrag je Feld gegen Kosten (Unterhalt, Konvoiverluste, Risiko der Besatzung) im Vergleich zur Produktion
// des Bot-Hafens; Fallquote der Besatzung bei Kartellangriffen. Seeds fest (1 … N), Ergebnis reproduzierbar.
import type { Balance, Counts } from "../src/index.ts";
import {
  cargoValue, cartelChance, convoysOf, fieldBaseYield, fieldsOf, fieldUpkeep, guardOf, maxFieldsFor, productionRates, resolveBattle,
  strandTroops, trainingCost, yieldFactor,
} from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

const SEEDS = 400;
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
/** Typische Entfernung Feld → Heimathafen (km). */
const DIST_KM = 450;

function fleetValue(units: Counts, balance: Balance): number {
  let v = 0;
  for (const [id, n] of Object.entries(units)) if (n > 0) v += value(trainingCost(id, n, balance), balance);
  return v;
}

/** Chance, dass ein Verband `atk` die Verteidigung `def` vernichtet (Mittel über Seeds). */
function winRate(atk: Counts, def: Counts, balance: Balance): number {
  let w = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = resolveBattle({ units: atk }, { units: def, defenses: {} }, balance, seed);
    if (r.ok && strandTroops(r.report, balance).destroyed) w++;
  }
  return w / SEEDS;
}

export function runFieldsSim(balance: Balance, snaps: BotSnapshot[]): void {
  const f = fieldsOf(balance);
  const c = convoysOf(balance);
  if (!f) return;

  // 1. Wache und Kartellangriff gegen typische Besatzungen.
  const garrisons: [string, Counts][] = [["2 Korvetten (Mindest)", { korvette: 2 }], ["1 Zerstörer (Mindest)", { zerstoerer: 1 }], ["2 Zerstörer + 2 Korv.", { zerstoerer: 2, korvette: 2 }], ["5 Zerstörer", { zerstoerer: 5 }]];
  console.log(`\nFelder: Kartell-Angriff (Chance ${pct(f.cartelRaidChance)} je ${f.deliveryHours}-h-Zyklus) – Besatzung fällt, ${SEEDS} Seeds`);
  console.log(`  ${"Besatzung".padEnd(26)}${[1, 2, 3].map((t) => `Stufe ${t}`.padStart(11)).join("")}${"  Ø Tage bis Verlust (St. 2)".padStart(30)}`);
  const fall = new Map<string, number[]>();
  for (const [name, g] of garrisons) {
    const rates = [1, 2, 3].map((t) => winRate(f.cartelRaid[t - 1], g, balance));
    fall.set(name, rates);
    const perCycle = f.cartelRaidChance * rates[1];
    const days = perCycle > 0 ? (f.deliveryHours / perCycle) / 24 : Infinity;
    console.log(`  ${name.padEnd(26)}${rates.map((x) => pct(x).padStart(11)).join("")}${(Number.isFinite(days) ? days.toFixed(0) : "∞").padStart(30)}`);
  }
  console.log(`  Wache (Stufe 1/2/3): ${[1, 2, 3].map((t) => `${guardOf(t, balance).schnellboot ?? 0} Schnellboote`).join(" / ")}; ` +
    `Sieg mit 2 Zerstörern + 4 Korvetten: ${[1, 2, 3].map((t) => pct(1 - winRate(guardOf(t, balance), { zerstoerer: 2, korvette: 4 }, balance))).join(" / ")}`);

  // 2. Nettoertrag eines Felds (Stahl-Äq./h): Grundertrag − Unterhalt − Konvoiverlust − Risiko (Besatzung 2 Zerst. + 2 Korv.).
  const g: Counts = { zerstoerer: 2, korvette: 2 };
  const gValue = fleetValue(g, balance);
  const net = (kind: string, tier: number, rank: number) => {
    const y = fieldBaseYield(kind, tier, balance);
    const gross = cargoValue(y, balance) * yieldFactor(rank, balance);
    const cargo = gross * f.deliveryHours;
    const convoyLoss = c ? cartelChance(DIST_KM, cargo, balance) * c.lossShareUnescorted : 0;
    const upkeep = fieldUpkeep(tier, 1, balance) * (balance.market.refPrice.proviant ?? 0);
    const risk = (f.cartelRaidChance * (fall.get("2 Zerstörer + 2 Korv.")![tier - 1]) * gValue) / f.deliveryHours;
    return { gross, net: gross * (1 - convoyLoss) - upkeep - risk };
  };
  console.log(`\nFelder: Ertrag je Feld (Stahl-Äq./h, Rang 1), Konvoi ${DIST_KM} km ohne Geleit, Besatzung 2 Zerstörer + 2 Korvetten`);
  for (const kind of Object.keys(f.kinds)) {
    console.log(`  ${kind.padEnd(16)}${[1, 2, 3].map((t) => { const x = net(kind, t, 0); return `St.${t} ${Math.round(x.gross)} → ${Math.round(x.net)}`.padStart(18); }).join("")}`);
  }
  const avg = (tier: number, rank: number) => Object.keys(f.kinds).reduce((s, k) => s + net(k, tier, rank).net, 0) / Object.keys(f.kinds).length;

  // 3. Zusatzertrag gegenüber der Gebäudeproduktion des Bot-Hafens (Stufe 2 im Mittel der Arten).
  console.log(`\nFelder: Zusatzertrag (netto, Stufe 2, Mittel der Arten) im Verhältnis zur Produktion des Bot-Hafens`);
  for (const day of [14, 28]) {
    const s = snaps.find((x) => x.day === day) ?? snaps[snaps.length - 1];
    const prod = value(productionRates(s.base, balance).perHour, balance);
    const harbor = s.base.buildings.hafenkommandantur ?? 0;
    const cells: string[] = [];
    let sum = 0;
    for (let n = 1; n <= f.maxFields; n++) {
      sum += avg(2, n - 1);
      cells.push(`${n}: ${pct(sum / prod)}`);
    }
    console.log(`  Tag ${String(day).padEnd(3)} Produktion ${Math.round(prod)}/h, Hafenkommandantur ${harbor} (≤ ${maxFieldsFor(harbor, balance)} Felder) | ${cells.join("  ")}`);
  }
  console.log(`  Zonenbonus +${pct(f.zoneBonus)} je Feld ab ${f.zoneMinFields} verbundenen Allianzfeldern; Allianzwertung ${f.alliancePointsPerFieldDay} Punkte je Feld und Tag.`);
}
