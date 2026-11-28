// Saisonlauf, Wirtschaftsteil (Welle 5 der Abschlussprüfung 0.38, Balance v1.38): misst je KI-Spieler täglich Bestand und
// Produktion je Rohstoff und je Woche Füllgrade, Lager in Stunden Produktion, ungenutzten Anteil (Bestand ÷ bisherige
// Produktion), abgeholte Belohnungen gegen die Produktion der Woche, Elektrolyse, Forschungswert und PvP. Nur Ausgabe –
// keine Wächter (Ziele dieser Kennzahlen sind Messgrößen für die Balance, keine Fehler). Aufgerufen aus saison.ts.
import { sql } from "drizzle-orm";
import type { Db } from "@tidefront/db";
import { productionRates, researchCost, settle, storageCapacity, type BaseState } from "@tidefront/game-core";
import { balance, basesOfPlayer } from "../src/index.ts";
import { buildingValue } from "../src/scoring.ts";
import { challengeReward, streakBonus } from "../src/challenge-pool.ts";
import { weeklyBonus, weeklyReward } from "../src/achievement-defs.ts";

const DAY = 86400000;
const price = (r: string) => balance.market.refPrice[r] ?? 1;
const resValue = (m: Record<string, number> | null | undefined) =>
  Object.entries(m ?? {}).reduce((a, [r, n]) => a + (Number.isFinite(Number(n)) && r in balance.market.refPrice ? Number(n) * price(r) : 0), 0);
const pct = (v: number) => `${Math.round(v * 100)}`;

/** Forschungswert eines Hafens: Summe der Kosten aller erforschten Stufen zum Richtpreis. */
export function researchValueOf(state: BaseState): number {
  let v = 0;
  for (const [id, lvl] of Object.entries(state.research?.levels ?? {})) {
    if (!balance.research?.techs[id]) continue;
    for (let l = 0; l < lvl; l++) v += resValue(researchCost(id, l, balance));
  }
  return v;
}

export interface WirtschaftWeek {
  day: number;
  profile: string;
  /** Füllgrad (Bestand ÷ Lager), Lager in Stunden Produktion, ungenutzter Anteil der bisherigen Produktion – je Rohstoff. */
  fill: Record<string, number>;
  hours: Record<string, number>;
  unused: Record<string, number>;
  /** Abgeholte Belohnungen der Woche (Tagesbefehle, Serien, Wochenziele, Erfolge) ÷ Produktion der Woche (Richtwert). */
  rewardShare: number;
  /** Wie ein aktiver Mensch: alle Tagesbefehle 3/3 an 7 Tagen, Serienbonus, drei Wochenziele und Wochenbonus (KZ des Heimathafens). */
  rewardFullShare: number;
  electrolysis: { level: number; fuelMade: number; shareOfFuel: number; wasted: number };
  /** Forschungswert ÷ Gebäudewert (alle Häfen). */
  researchShare: number;
  /** Siege gegen andere Spieler (Menschen und KI) seit Saisonbeginn. */
  pvp: { wins: number };
}

export class Wirtschaft {
  /** Je KI und Rohstoff: aufsummierte Netto-Produktion (positiv) seit Saisonbeginn, Tageswerte der laufenden Woche. */
  private cum = new Map<number, Record<string, number>>();
  private weekProd = new Map<number, number>();
  private fuelProd = new Map<number, number>();
  readonly weeks: WirtschaftWeek[] = [];

  private db: Db;
  private t0: number;
  constructor(db: Db, t0: number) { this.db = db; this.t0 = t0; }

  /** Einmal je Saisontag (Stand zu Tagesende): Produktion je Stunde × 24 aufaddieren. */
  async daily(t: number, bots: { id: number }[]): Promise<void> {
    for (const b of bots) {
      const cum = this.cum.get(b.id) ?? Object.fromEntries(balance.resources.map((r) => [r, 0]));
      let rw = 0;
      for (const x of await basesOfPlayer(this.db, b.id)) {
        const s = settle(x.state as BaseState, t, balance);
        const pr = productionRates(s, balance, undefined, t);
        for (const r of balance.resources) {
          const v = Math.max(0, pr.perHour[r] ?? 0) * 24;
          cum[r] += v;
          rw += v * price(r);
          if (r === "treibstoff") this.fuelProd.set(b.id, (this.fuelProd.get(b.id) ?? 0) + v);
        }
      }
      this.cum.set(b.id, cum);
      this.weekProd.set(b.id, (this.weekProd.get(b.id) ?? 0) + rw);
    }
  }

  /** Wochenzeile je KI (nach daily am selben Tag aufrufen). */
  async weekly(day: number, t: number, bots: { id: number; profile: string }[]): Promise<void> {
    for (const b of bots) {
      const bases = await basesOfPlayer(this.db, b.id);
      const stock: Record<string, number> = {}, cap: Record<string, number> = {}, rate: Record<string, number> = {};
      let level = 0, fuelMade = 0, wasted = 0, research = 0, buildings = 0;
      for (const r of balance.resources) { stock[r] = 0; cap[r] = 0; rate[r] = 0; }
      for (const x of bases) {
        const s = settle(x.state as BaseState, t, balance);
        const pr = productionRates(s, balance, undefined, t);
        const c = storageCapacity(s, balance);
        for (const r of balance.resources) { stock[r] += s.resources[r] ?? 0; cap[r] += c; rate[r] += Math.max(0, pr.perHour[r] ?? 0); }
        level += s.buildings.elektrolyse ?? 0;
        fuelMade += s.powerLog?.fuelMade ?? 0;
        wasted += s.powerLog?.wasted ?? 0;
        research += researchValueOf(s);
        buildings += buildingValue(s.buildings);
      }
      const cum = this.cum.get(b.id) ?? {};
      const since = new Date(t - 7 * DAY).toISOString(), until = new Date(t).toISOString();
      const claimed = await this.db.execute<{ reward: Record<string, number> }>(sql`
        select reward from daily_challenge where player_id = ${b.id} and claimed_at > ${since}::timestamptz and claimed_at <= ${until}::timestamptz
        union all select reward from weekly_goal where player_id = ${b.id} and claimed_at > ${since}::timestamptz and claimed_at <= ${until}::timestamptz
        union all select reward from achievement_tier where player_id = ${b.id} and claimed_at > ${since}::timestamptz and claimed_at <= ${until}::timestamptz`);
      const rewards = claimed.reduce((a, r) => a + resValue(r.reward), 0);
      const kz = (bases.find((x) => x.isHome) ?? bases[0])?.state.buildings.kommandozentrale ?? 0;
      let full = resValue(weeklyBonus(kz)) + 3 * resValue(weeklyReward(kz)) + resValue(streakBonus(7, kz)?.reward);
      for (const tier of [0, 1, 2] as const) full += 7 * resValue(challengeReward(tier, kz).reward);
      const [pvp] = await this.db.execute<{ wins: number }>(sql`
        select count(*) filter (where winner = 'attacker')::int as wins from battle_report
        where attacker_player_id = ${b.id} and defender_player_id is not null and defender_player_id <> ${b.id} and created_at >= to_timestamp(${this.t0 / 1000})`);
      const w: WirtschaftWeek = {
        day, profile: b.profile,
        fill: Object.fromEntries(balance.resources.map((r) => [r, cap[r] > 0 ? stock[r] / cap[r] : 0])),
        hours: Object.fromEntries(balance.resources.map((r) => [r, rate[r] > 0 ? stock[r] / rate[r] : 0])),
        unused: Object.fromEntries(balance.resources.map((r) => [r, (cum[r] ?? 0) > 0 ? stock[r] / cum[r] : 0])),
        rewardShare: rewards / Math.max(1, this.weekProd.get(b.id) ?? 0),
        rewardFullShare: full / Math.max(1, this.weekProd.get(b.id) ?? 0),
        electrolysis: { level, fuelMade, shareOfFuel: fuelMade / Math.max(1, this.fuelProd.get(b.id) ?? 0), wasted },
        researchShare: research / Math.max(1, buildings),
        pvp: { wins: pvp?.wins ?? 0 },
      };
      this.weeks.push(w);
      this.weekProd.set(b.id, 0);
      const row = (m: Record<string, number>, f: (v: number) => string) => balance.resources.map((r) => f(m[r])).join("/");
      console.log(`    ${b.profile.padEnd(10)} Wirtschaft: Füllgrad S/T/E/P ${row(w.fill, pct)} % · Lager ${row(w.hours, (v) => String(Math.round(v)))} h · ungenutzt ${row(w.unused, pct)} % · Belohnungen ${pct(w.rewardShare)} % der Wochenproduktion (aktiver Mensch ${pct(w.rewardFullShare)} %) · Elektrolyse Stufe ${level} (${Math.round(fuelMade)} Treibstoff = ${pct(w.electrolysis.shareOfFuel)} %, verfallen ${Math.round(wasted)} Strom) · Forschung ${pct(w.researchShare)} % des Gebäudewerts · PvP-Siege ${w.pvp.wins}`);
    }
  }
}
