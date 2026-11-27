// Aufholhilfe (Balance-Block catchUp): Wie weit kommt ein Spät-Einsteiger (Start an Saisontag s) mit Baugutschrift?
// Bezug „Median“ = Referenz-Bot (Spätspiel, 45 % Rüstung) ab Tag 0. Die Gutschrift fließt stündlich nach Rückstand der
// Ausbaupunkte (Kurve wie catchUpBonus, Hysterese, Höchstbestand storeHours) in BaseState.catchUp; der Bot verbraucht sie
// über startUpgrade automatisch (nur Gebäude). Startpaket: latePackShare × Median-Ausbauwert am Starttag (ab latePackFromDay).
// Aufruf: node packages/game-core/sim/aufholhilfe.ts
import { readFileSync } from "node:fs";
import type { Balance, BaseState, CatchUpBalance } from "../src/index.ts";
import { accrueCatchUp, catchUpBonus, emptyCatchUp, productionRates, upgradeCost } from "../src/index.ts";
import { runBot, value } from "./bot.ts";

const balance = JSON.parse(readFileSync(new URL("../../balance/v1/balance.json", import.meta.url), "utf8")) as Balance;
const DAY = 86400000;
const HOUR = 3600000;
const SEASON = 42;
const DAYS = Array.from({ length: SEASON }, (_, i) => i + 1);

const build = (b: BaseState) => {
  let s = 0;
  for (const [id, l] of Object.entries(b.buildings)) for (let i = 0; i < l; i++) s += value(upgradeCost(id, i, balance), balance);
  return s;
};

const ref = runBot(balance, SEASON, DAYS, 0.45, undefined, undefined, {}, { lateGame: true });
const refBuild = [0, ...ref.map((s) => build(s.base))];
// „Spitze“: Wirtschaftsspieler mit 25 % Rüstung ab Tag 0 (baut am meisten aus).
const top = runBot(balance, SEASON, DAYS, 0.25, undefined, undefined, {}, { lateGame: true });
const topBuild = [0, ...top.map((s) => build(s.base))];
const refBuildAt = (dayF: number) => {
  const d = Math.max(0, Math.min(SEASON, dayF));
  const i = Math.floor(d);
  const j = Math.min(SEASON, i + 1);
  return Math.max(1, refBuild[i] + (refBuild[j] - refBuild[i]) * (d - i));
};

interface Variant { label: string; cap: number; pack: number }

function late(startDay: number, v: Variant, cu0: CatchUpBalance) {
  const cu: CatchUpBalance = { ...cu0, cap: v.cap };
  const days = SEASON - startDay;
  const marks = [...[3, 7, 10, 14, 21].filter((d) => d < days), days];
  let lastHour = -1;
  let total = 0;
  let first = true;
  const onStep = (b: BaseState, t: number): BaseState => {
    if (first) {
      first = false;
      // Startpaket: Saisontag (1 = erster Tag) des Einstiegs ab latePackFromDay.
      const pack = startDay + 1 >= cu.latePackFromDay ? v.pack * refBuild[startDay] : 0;
      total += pack;
      return { ...b, catchUp: { ...emptyCatchUp(t), credit: pack, pack } };
    }
    const hour = Math.floor(t / HOUR);
    if (hour === lastHour || v.cap <= 0) return b;
    lastHour = hour;
    const dayG = startDay + t / DAY;
    const prev = b.catchUp ?? emptyCatchUp(t);
    // Median zählt erst Spieler mit Hafen ≥ minBaseAgeDays; der Referenz-Bot ist von Anfang an dabei.
    const ratio = build(b) / refBuildAt(dayG);
    const perHour = value(productionRates(b, balance).buildingPerHour, balance);
    const acc = accrueCatchUp(prev, perHour, t, cu, Math.floor(dayG) + 1 < cu.stopDay);
    total += acc.earned - prev.earned;
    const { bonus, active } = catchUpBonus(ratio, cu, b.catchUp ? prev : null);
    return { ...b, catchUp: { ...acc, bonus, active, ratio } };
  };
  const snaps = runBot(balance, days, marks, 0.45, undefined, onStep, {}, { lateGame: true });
  return { snaps, total, days };
}

const cu = balance.catchUp!;
const variants: Variant[] = [
  { label: "ohne Hilfe", cap: 0, pack: 0 },
  { label: "Paket 15 % allein", cap: 0, pack: cu.latePackShare },
  { label: `Bonus bis +${Math.round(cu.cap * 100)} % allein`, cap: cu.cap, pack: 0 },
  { label: `Paket 15 % + Bonus bis +${Math.round(cu.cap * 100)} % (gewählt)`, cap: cu.cap, pack: cu.latePackShare },
  { label: "Vergleich: Paket 15 % + Bonus bis +100 %", cap: 1, pack: cu.latePackShare },
];

console.log(`Referenz (Median-Ersatz) Ausbauwert: ${[7, 14, 21, 28, 35, 42].map((d) => `T${d} ${Math.round(refBuild[d] / 1000)}k`).join(", ")}`);
console.log(`Spitze (25 % Rüstung) Ausbauwert:    ${[7, 14, 21, 28, 35, 42].map((d) => `T${d} ${Math.round(topBuild[d] / 1000)}k`).join(", ")}`);
console.log(`Kurve: Beginn unter ${cu.from * 100} %, voll (+${cu.cap * 100} %) ab ≤ ${cu.full * 100} %, Hysterese ${cu.resumeBelow * 100} %, Höchstbestand ${cu.storeHours} h, Zufluss bis Saisontag ${cu.stopDay}`);
for (const s of [0, 7, 14, 21, 28]) {
  console.log(`\nEinstieg nach ${s} Tagen (Saisontag ${s + 1}): Ausbauwert / Median nach x Tagen, Saisonende = Tag ${SEASON}; Σ Gutschrift (Richtwert)`);
  for (const v of variants) {
    const r = late(s, v, cu);
    const cells = r.snaps.map((x) => `${x.day === r.days ? "Ende" : `+${x.day}`}: ${Math.round((build(x.base) / refBuild[s + x.day]) * 100)} %`);
    const peak = Math.max(...r.snaps.map((x) => build(x.base) / topBuild[s + x.day]));
    console.log(`  ${v.label.padEnd(44)}${cells.map((x) => x.padEnd(12)).join("")} max/Spitze ${Math.round(peak * 100)} %  Σ ${Math.round(r.total / 1000)}k`);
  }
}
