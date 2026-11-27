// Lagebild Stufe 2 (v1.20): Kosten und Nutzen von Patrouille, Kampagne, Radarposten und Bordsicht, zum Richtwert der
// Börse in Stahl-Gegenwert und in Stunden Produktion des Wirtschafts-Bots (Tag 7/14/28). Abfangen von Drohnen.
import type { Balance, Counts } from "../src/index.ts";
import { dronesShot, fuelCost, interceptChance, productionRates, slowestSpeedKmh } from "../src/index.ts";
import type { BotSnapshot } from "./bot.ts";
import { value } from "./bot.ts";

const fmt = (n: number, d = 0) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });

export function runIntelSim(balance: Balance, snaps: BotSnapshot[]): void {
  const ib = balance.intel;
  if (!ib?.patrol || !ib.post || !ib.campaign) return;
  const pb = ib.patrol;
  const fuelValue = balance.market.refPrice.treibstoff ?? 1.8;
  const perHour = new Map(snaps.map((s) => [s.day, value(productionRates(s.base, balance).perHour, balance)]));
  const prod = (day: number) => perHour.get(day) ?? perHour.get([...perHour.keys()].sort((a, b) => Math.abs(a - day) - Math.abs(b - day))[0]) ?? 1;
  console.log("\n=== Lagebild Stufe 2 (v1.20) ===");
  console.log(`Produktion des Wirtschafts-Bots (Stahl-Gegenwert/h): ${[...perHour].map(([d, v]) => `Tag ${d} ${fmt(v)}`).join(", ")}`);

  // 1. Patrouille: Treibstoff (Hin/Rück 300 km + Station) und überwachte Fläche.
  console.log("\nPatrouille (Wegpunkte 300 km vor dem Hafen): Treibstoff (Hin/Rück + Station), Wert, überstrichene Fläche");
  const cases: [string, Counts, number][] = [
    ["2 Korvetten", { korvette: 2 }, pb.shipSightKm], ["1 Zerstörer", { zerstoerer: 1 }, pb.shipSightKm], ["2 Drohnen", { aufklaerungsdrohne: 2 }, pb.droneSightKm],
  ];
  for (const [name, units, sight] of cases) {
    const speed = slowestSpeedKmh(units, balance) ?? 1;
    for (const h of pb.hours) {
      if (units.aufklaerungsdrohne && h > pb.droneMaxHours) continue;
      const fuel = fuelCost(units, 300, balance) + fuelCost(units, speed * h, balance, undefined, 1);
      const area = (2 * sight * speed * h + Math.PI * sight * sight) / 1000;
      console.log(`  ${name.padEnd(12)} ${String(h).padStart(2)} h: ${fmt(fuel).padStart(5)} Treibstoff ≈ ${fmt(fuel * fuelValue).padStart(5)} Stahl-Gw. (${fmt((fuel * fuelValue) / prod(14), 2)} h Prod. Tag 14), überstrichen ${fmt(area)} Tsd. km²`);
    }
  }

  // 2. Abfangen: Verlust an Drohnen nach Abfangjägern im Hafen (10 000 Würfe).
  console.log("\nAbfangen von Drohnen (je Hafen einmal): erwarteter Verlust, alle verloren");
  for (const fighters of [1, 2, 3, 5, 8]) {
    const chance = interceptChance(fighters, pb);
    let lost = 0, all = 0;
    for (let s = 1; s <= 10000; s++) { const k = dronesShot(2, chance, s * 7919); lost += k; if (k === 2) all++; }
    console.log(`  ${fighters} Jäger: ${fmt(chance * 100)} % je Drohne, von 2 Drohnen verloren ⌀ ${fmt(lost / 10000, 2)}, beide ${fmt(all / 100, 1)} %; Drohne kostet ${fmt(value(balance.units.aufklaerungsdrohne.cost ?? {}, balance))} Stahl-Gw.`);
  }

  // 3. Kampagne gegen Einzelaufklärung: 4 Nester im Abstand 250 km, 500 km vor dem Hafen.
  const one = { korvette: 1 };
  const single = 4 * fuelCost(one, 500, balance);
  const campaign = fuelCost(one, 500 + 3 * 250 + 500, balance, undefined, 1);
  console.log(`\nKampagne (4 Ziele, 1 Korvette): ${fmt(campaign)} Treibstoff statt ${fmt(single)} für 4 Einzelfahrten (${fmt((1 - campaign / single) * 100)} % gespart), 1 Missionsplatz statt 4.`);
  const nest3 = balance.pirates.nestLevels["3"] as { loot: Record<string, number> };
  console.log(`  Bezug: Beute Nest 3 ≈ ${fmt(value(nest3.loot, balance))} Stahl-Gw.; eine Kampagne kostet ≈ ${fmt(campaign * fuelValue)} Stahl-Gw.`);

  // 4. Radarposten: Kosten, Betrieb, Rückerstattung, Amortisation gegen eine Radarstation-Stufe.
  const post = ib.post;
  const cost = value(post.cost, balance);
  const perDay = post.fuelPerHour * 24 * fuelValue;
  console.log(`\nRadarposten: Bau ${fmt(cost)} Stahl-Gw. (${fmt(cost / prod(7), 1)} h Prod. Tag 7, ${fmt(cost / prod(14), 1)} h Tag 14, ${fmt(cost / prod(28), 1)} h Tag 28), Betrieb ${fmt(perDay)} Stahl-Gw./Tag, Abbau zurück ${fmt(cost * post.refund)}`);
  console.log(`  Fläche ${fmt(Math.PI * post.rangeKm ** 2 / 1000)} Tsd. km² (Radarstation Stufe 3: ${fmt(Math.PI * (ib.radarBaseKm + 3 * ib.radarKmPerLevel) ** 2 / 1000)} Tsd. km²); Besatzung ${post.minCrew} Pioniere ≈ ${fmt(post.minCrew * value(balance.units.pioniere.cost ?? {}, balance))} Stahl-Gw.`);
  console.log(`  Eine Woche Betrieb mit Verlust beim Abbau: ${fmt(cost * (1 - post.refund) + 7 * perDay)} Stahl-Gw. ≈ ${fmt((cost * (1 - post.refund) + 7 * perDay) / value(nest3.loot, balance), 2)} Nest-3-Beuten`);

  // 5. Bordsicht: Fläche, die ein Überfall auf ein Ziel in 500 km nebenbei aufdeckt.
  const fs = ib.fleetSight;
  if (fs) console.log(`\nBordsicht (Überfall 500 km hin und zurück): Kriegsschiff ${fmt((2 * fs.warshipKm * 1000) / 1000)} Tsd. km² Streifen, Transporter ${fmt((2 * fs.transportKm * 1000) / 1000)}, Drohne ${fmt((2 * fs.droneKm * 1000) / 1000)}; Patrouille 2 Korvetten 4 h: ${fmt((2 * pb.shipSightKm * 60 * 4 + Math.PI * pb.shipSightKm ** 2) / 1000)}`);
}
