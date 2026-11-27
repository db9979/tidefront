// Lagebild Stufe 3 (v1.23): Wert des Wissens gegen den Preis eines Satelliten (Regelwerk 11, Punkt 3).
// Der Bot-Verband (45 % Rüstung) des Tages 35 überfällt eine Woche lang Piratennester in bis zu 1 000 km um echte
// Hafenlagen (echte Nestplätze, echtes Wetter). Je Zug wählt er das Ziel mit dem besten erwarteten Netto je Stunde.
// Wissen: (a) nur Radar (Stufe 6, Ausguck) und eigene Kämpfe, (b) dazu täglich eine Aufklärungskampagne (4 Ziele,
// 1 Korvette), (c) dazu ein optischer Satellit (Überflüge alle 6 h, Streifen 600 km, nicht unter Wolken > 0,6).
// Wissen verfällt nach forgetHours. Andere Spieler leeren Nester zufällig (Poisson, 0,5 je Nest und Tag); ein Nest
// ist danach respawnHours leer. Ergebnis: Siege, Niederlagen, Leerfahrten, Netto je Woche (Richtwert der Börse).
// Aufruf: `node packages/game-core/sim/satellite.ts` oder in `npm run sim`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COLS, HEX_W, KM_PER_DEG_LAT, KM_PER_DEG_LON, LAT1, LON0, hexAtXY, hexCenter, hexCenterXY, hexDistanceKm, isCoast, nestSites } from "@tidefront/world";
import type { Balance, BaseState, Counts } from "../src/index.ts";
import {
  fuelCost, mulberry32, nestDefender, nestRespawnHours, newSatellite, productionRates, resolveBattle, satPass, satPassCount, slowestSpeedKmh,
  trainingCost, weatherAt,
} from "../src/index.ts";
import { runBot, value, type BotSnapshot } from "./bot.ts";

const H = 3600000;
const W = (COLS + 0.5) * HEX_W;
const HOMES: [string, number, number][] = [["Brest", 48.4, -4.5], ["Kiel", 54.3, 10.1], ["Halifax", 44.6, -63.6], ["Neapel", 40.8, 14.2], ["Reykjavík", 64.1, -21.9]];
const RANGE_KM = 1000;
const CLEAR_PER_DAY = 0.5;
const SEEDS = 30;
const fmt = (n: number, d = 0) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });

function coastNear(lat: number, lon: number) {
  const c = hexAtXY((lon - LON0) * KM_PER_DEG_LON, (LAT1 - lat) * KM_PER_DEG_LAT);
  for (let r = 0; r < 6; r++) for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) if (isCoast(c.col + dc, c.row + dr)) return { col: c.col + dc, row: c.row + dr };
  return c;
}

interface LevelStat { win: number; netWin: number; netLoss: number; mean: number }

/** Sieg und Netto (Beute − bleibende Verluste, ohne Treibstoff) je Nest-Stufe für den Verband. */
function levelStats(fleet: Counts, balance: Balance): Map<number, LevelStat> {
  const out = new Map<number, LevelStat>();
  for (const lvl of Object.keys(balance.pirates.nestLevels).map(Number)) {
    const nest = nestDefender(lvl, balance);
    if (!nest.ok) continue;
    let win = 0, sw = 0, sl = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const r = resolveBattle({ units: fleet }, nest.defender, balance, seed);
      if (!r.ok) continue;
      let loss = 0;
      for (const [id, n] of Object.entries(r.report.attacker.losses)) {
        const gone = n - (r.report.attacker.returned[id] ?? 0);
        if (gone > 0 && balance.units[id]) loss += value(trainingCost(id, gone, balance), balance);
      }
      const net = value(r.report.loot, balance) - loss;
      if (r.report.winner === "attacker") { win++; sw += net; } else sl += net;
    }
    const w = win / 120;
    out.set(lvl, { win: w, netWin: win ? sw / win : 0, netLoss: win < 120 ? sl / (120 - win) : 0, mean: (sw + sl) / 120 });
  }
  return out;
}

type Mode = "radar" | "kampagne" | "satellit";
interface Nest { col: number; row: number; level: number; d: number; x: number; emptyUntil: number; clears: number[] }
interface Known { at: number; occupied: boolean; until: number }

/** Eine Woche für einen Hafen, einen Seed und eine Wissensquelle. */
function week(home: { col: number; row: number }, sites: Nest[], mode: Mode, seed: number, t0: number, stats: Map<number, LevelStat>, fleet: Counts, balance: Balance) {
  const rng = mulberry32(seed * 7919 + 13);
  const ib = balance.intel!;
  const sb = ib.satellite!;
  const wb = balance.weather!;
  const radarKm = ib.radarBaseKm + 6 * ib.radarKmPerLevel;
  const speed = slowestSpeedKmh(fleet, balance) ?? 40;
  const refFuel = balance.market.refPrice.treibstoff ?? 1.8;
  // Fremde Räumungen je Nest vorab würfeln (gleich für alle Modi desselben Seeds).
  const nests = sites.map((n) => ({ ...n, emptyUntil: 0, clears: [] as number[] }));
  const r2 = mulberry32(seed * 104729 + 7);
  for (const n of nests) for (let t = t0 - 48 * H; t < t0 + 170 * H;) { t += (-Math.log(1 - r2()) / CLEAR_PER_DAY) * 24 * H; n.clears.push(t); }
  const respawn = (n: Nest) => nestRespawnHours(balance, n.level) * H;
  const emptyAt = (n: Nest, t: number) => n.emptyUntil > t || n.clears.some((c) => c <= t && t < c + respawn(n));
  const known = new Map<Nest, Known>();
  const see = (n: Nest, t: number) => known.set(n, { at: t, occupied: !emptyAt(n, t), until: Math.max(n.emptyUntil, ...n.clears.filter((c) => c <= t).map((c) => c + respawn(n))) });
  const sat = newSatellite(1, "optisch", hexCenterXY(home.col, home.row).x, t0, sb);
  let nextPassK = 1;
  let nextCampaign = t0;
  let t = t0;
  const out = { attacks: 0, wins: 0, losses: 0, empty: 0, net: 0, fuel: 0 };
  const end = t0 + 168 * H;
  const fuelTo = (d: number) => fuelCost(fleet, d, balance) * refFuel; // Hin und Rück
  while (t < end) {
    // Wissen bis jetzt: Radar live, Satellitenüberflüge, Kampagnen.
    for (const n of nests) if (n.d <= radarKm) see(n, t);
    if (mode === "satellit") {
      for (; nextPassK <= satPassCount(sat); nextPassK++) {
        const p = satPass(sat, nextPassK, W)!;
        if (p.startMs > t) break;
        for (const n of nests) if (n.x >= p.x0 && n.x <= p.x1 && weatherAt(hexCenter(n.col, n.row), p.startMs, wb).clouds <= (sb.types.optisch.cloudMax ?? 0.6)) see(n, p.startMs);
      }
    }
    if (mode === "kampagne" && t >= nextCampaign) {
      // 4 unbekannte bzw. älteste Nester, je Ziel Wissen bei Ankunft der Korvette (60 km/h); Treibstoff zählt mit.
      const pick = [...nests].sort((a, b) => (known.get(a)?.at ?? 0) - (known.get(b)?.at ?? 0) || a.d - b.d).slice(0, 4);
      let km = 0;
      let prev = home;
      for (const n of pick) { km += hexDistanceKm(prev, n); prev = n; const ta = t + (km / 60) * H; if (ta < end) see(n, ta); }
      const f = fuelCost({ korvette: 1 }, km + pick[pick.length - 1].d, balance, undefined, 1) * refFuel;
      out.net -= f;
      out.fuel += f;
      nextCampaign = t + 24 * H;
    }
    for (const [n, k] of known) if (t - k.at > ib.forgetHours * H) known.delete(n);
    // Prior für unbekannte Nester: Verteilung der Stufen in Reichweite, Leer-Anteil aus der Räumungsrate.
    const pEmpty = Math.min(0.9, (CLEAR_PER_DAY * 12) / 24);
    const prior = nests.reduce((a, n) => a + stats.get(n.level)!.mean, 0) / nests.length;
    let best: { n: Nest; score: number; ev: number } | null = null;
    for (const n of nests) {
      const cycle = (2 * n.d) / speed + 1;
      const arrive = t + (n.d / speed) * H;
      const k = known.get(n);
      const ev = (k ? (k.occupied || arrive >= k.until ? stats.get(n.level)!.mean : 0) : (1 - pEmpty) * prior) - fuelTo(n.d);
      const score = ev / cycle;
      if (!best || score > best.score) best = { n, score, ev };
    }
    if (!best || best.ev <= 0) { t += H; continue; }
    const n = best.n;
    const arrive = t + (n.d / speed) * H;
    if (arrive >= end) break;
    const fuel = fuelTo(n.d);
    out.attacks++;
    out.fuel += fuel;
    out.net -= fuel;
    if (emptyAt(n, arrive)) out.empty++;
    else {
      const s = stats.get(n.level)!;
      if (rng() < s.win) { out.wins++; out.net += s.netWin; n.emptyUntil = arrive + respawn(n); }
      else { out.losses++; out.net += s.netLoss; }
    }
    see(n, arrive); // Kampfbericht bzw. „verlassen“: Lagebild
    t += ((2 * n.d) / speed + 1) * H;
  }
  return out;
}

export function runSatelliteSim(balance: Balance, snaps?: BotSnapshot[]): void {
  if (!balance.intel?.satellite || !balance.weather) return;
  const mil = snaps ?? runBot(balance, 35, [28, 35]);
  for (const day of [28, 35]) weekReport(balance, mil.find((s) => s.day === day) ?? mil[mil.length - 1]);
}

function weekReport(balance: Balance, at: BotSnapshot): void {
  const sb = balance.intel!.satellite!;
  const fleet = Object.fromEntries(Object.entries((at.base as BaseState).units).filter(([, n]) => n > 0));
  const prod = value(productionRates(at.base, balance).perHour, balance);
  const stats = levelStats(fleet, balance);
  const optCost = value(sb.types.optisch.cost, balance);
  const radCost = value(sb.types.radar.cost, balance);
  console.log(`\n=== Lagebild Stufe 3 (${balance.version}): Satellit gegen Wert des Wissens ===`);
  console.log(`Bot-Verband Tag ${at.day}: ${Object.entries(fleet).map(([k, v]) => `${v} ${k}`).join(", ")}; Produktion ${fmt(prod)} Stahl-Gw./h`);
  console.log(`Nest-Stufen (Sieg, Netto ohne Treibstoff): ${[...stats].map(([l, s]) => `${l}: ${fmt(s.win * 100)} % ${fmt(s.mean)}`).join(" | ")}`);
  console.log(`Startkosten optisch ${fmt(optCost)} (${fmt(optCost / prod, 1)} h Produktion = ${fmt(optCost / prod / 7, 2)} h je Tag Laufzeit), Radar ${fmt(radCost)} (${fmt(radCost / prod, 1)} h = ${fmt(radCost / prod / 7, 2)} h/Tag)`);
  const all = nestSites();
  const sum: Record<Mode, { attacks: number; wins: number; losses: number; empty: number; net: number; fuel: number }> = {
    radar: { attacks: 0, wins: 0, losses: 0, empty: 0, net: 0, fuel: 0 }, kampagne: { attacks: 0, wins: 0, losses: 0, empty: 0, net: 0, fuel: 0 }, satellit: { attacks: 0, wins: 0, losses: 0, empty: 0, net: 0, fuel: 0 },
  };
  let runs = 0;
  for (const [name, lat, lon] of HOMES) {
    const home = coastNear(lat, lon);
    const sites: Nest[] = all.map((s) => ({ ...s, d: hexDistanceKm(home, s), x: hexCenterXY(s.col, s.row).x, emptyUntil: 0, clears: [] })).filter((s) => s.d <= RANGE_KM && s.d > 0);
    if (sites.length === 0) continue;
    const row: string[] = [];
    for (const mode of ["radar", "kampagne", "satellit"] as Mode[]) {
      const acc = { attacks: 0, wins: 0, losses: 0, empty: 0, net: 0, fuel: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = week(home, sites, mode, seed, Date.UTC(2026, 9, 1) + seed * 37 * H, stats, fleet, balance);
        for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r[k];
      }
      for (const k of Object.keys(acc) as (keyof typeof acc)[]) sum[mode][k] += acc[k];
      row.push(`${mode} ${fmt(acc.net / SEEDS)} (${fmt(acc.wins / SEEDS, 1)} S/${fmt(acc.losses / SEEDS, 1)} N/${fmt(acc.empty / SEEDS, 1)} leer)`);
    }
    runs += SEEDS;
    console.log(`  ${name.padEnd(9)} ${String(sites.length).padStart(2)} Nester ≤ ${RANGE_KM} km: ${row.join(" | ")}`);
  }
  const avg = (m: Mode) => sum[m];
  for (const m of ["radar", "kampagne", "satellit"] as Mode[]) {
    const s = avg(m);
    console.log(`  ⌀ ${m.padEnd(9)}: ${fmt(s.attacks / runs, 1)} Angriffe/Woche, ${fmt(s.wins / runs, 1)} Siege, ${fmt(s.losses / runs, 1)} Niederlagen, ${fmt(s.empty / runs, 1)} Leerfahrten, Netto ${fmt(s.net / runs)} (Treibstoff ${fmt(s.fuel / runs)})`);
  }
  const gainR = (sum.satellit.net - sum.radar.net) / runs;
  const gainK = (sum.satellit.net - sum.kampagne.net) / runs;
  console.log(`  Mehrwert optischer Satellit je Woche: +${fmt(gainR)} gegen nur Radar (${fmt(gainR / optCost, 2)} × Startkosten), ${gainK >= 0 ? "+" : ""}${fmt(gainK)} gegen tägliche Kampagne`);
  console.log(`  Ziel Regelwerk 11.3: 2–3 h Produktion je Tag Laufzeit = ${fmt(2 * 7 * prod)}–${fmt(3 * 7 * prod)} Stahl-Gw. je Satellit`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
  runSatelliteSim(balance);
}
