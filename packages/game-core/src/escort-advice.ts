// See: Empfohlenes Geleit je Frachtwert (ENTSCHEIDUNGEN-5.md „Empfohlenes Geleit“). Rein und deterministisch, im
// Browser (Börsen-Order, Spielerhandel, Lieferverträge, Konvoi-Blatt), in den Server-Tests und bei den KI-Spielern.
// Die erwartete Kartellgruppe ist genau die, die der Server würfelt (cartelConvoyForce: Schnellboote nach Warenwert,
// ohne Zufall); die Chance des Überfalls wie cartelRoll (Börse/Vertrag mit marketChanceFactor). Der Probekampf
// rechnet resolveBattle mit der Siegregel des Servers (settleBattle + victoryRuleOf("konvoi")): Das Geleit hält,
// solange der Kartellverband es nicht vernichtet. Ohne Wetter (der Ort des Überfalls ist vorab unbekannt).
// Suche der günstigsten Mischung: escort-search.ts.
import { resolveBattle } from "./combat.ts";
import { settleBattle, victoryRuleOf } from "./battle-victory.ts";
import { simSeed } from "./battle-sim.ts";
import { cartelChance, cartelConvoyForce, convoysOf } from "./naval.ts";
import { fuelCost } from "./mission.ts";
import type { Balance, Counts } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";

/** Zielsicherheit der Empfehlung: Anteil abgewehrter Überfälle im Probekampf. */
export const ESCORT_TARGET = 0.9;
/** Probekämpfe je Prüfung während der Suche (feste Seeds ab 0). */
export const ESCORT_RUNS = 100;
/** Prüfung der Empfehlung mit frischen Seeds (ab diesem Index, so viele Läufe): die Suche passt sich nicht an ihre Seeds an. */
export const ESCORT_VERIFY_OFFSET = 20000;
export const ESCORT_VERIFY_RUNS = 200;

/** Der erwartete Überfall auf einen Konvoi. */
export interface CartelThreat {
  /** Kartellverband (wie der Server ihn zusammenstellt). */
  force: Counts;
  /** Chance, dass das Kartell diesen Konvoi überhaupt abfängt. */
  chance: number;
  /** Warenwert (Richtpreis). */
  value: number;
  /** Erwarteter Verlust ohne Geleit in Talern: Chance × lossShareUnescorted × Warenwert. */
  lossUnescorted: number;
  /** Verlust bei einem Überfall, wenn das Geleit unterliegt (Taler): lossShareEscortBeaten × Warenwert. */
  lossIfBeaten: number;
}

/**
 * Erwartete Kartellgruppe für Frachtwert und Strecke. `riskKm`: die Strecke, mit der der Server die Chance würfelt
 * (Börse: feste Strecke deliveryRiskKm, Vertrag/Handel: Luftlinie zwischen den Häfen). `market`: Börse/Vertrag.
 * Die Zusammensetzung hängt nur vom Warenwert ab und ist nicht zufällig (keine Spanne).
 */
export function expectedCartelGroup(value: number, riskKm: number, balance: Balance, market = false, riskValue = value): CartelThreat {
  const c = convoysOf(balance);
  const v = Math.max(0, value);
  // v1.35: Börse – Chance nach dem Warenwert der eigenen Börsenkonvois der letzten Stunden (riskValue ≥ value).
  const chance = c && v > 0 ? cartelChance(riskKm, Math.max(v, riskValue), balance, market) : 0;
  return {
    force: c && v > 0 ? cartelConvoyForce(v, balance) : {},
    chance,
    value: v,
    lossUnescorted: chance * (c?.lossShareUnescorted ?? 0) * v,
    lossIfBeaten: (c?.lossShareEscortBeaten ?? 0) * v,
  };
}

/** Wert einer Zählung von Einheiten zum Richtpreis (Baukosten). */
export function unitsValue(units: Counts, balance: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(units)) {
    if (n <= 0) continue;
    for (const [r, q] of Object.entries(balance.units[id]?.cost ?? {})) s += (q ?? 0) * n * (balance.market.refPrice[r] ?? 0);
  }
  return s;
}

export interface EscortProbe {
  /** Anteil der Probekämpfe, in denen das Geleit hält. */
  winRate: number;
  /** Mittlerer Wert der versenkten Geleitschiffe je Überfall (Taler, Baukosten zum Richtpreis). */
  avgLostValue: number;
  runs: number;
}

export interface EscortProbeOpts {
  modifiers?: Modifiers;
  runs?: number;
  /** Erster Seed-Index (Prüf-Seeds). */
  seedOffset?: number;
}

const clean = (c: Counts): Counts => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));

/**
 * Probekampf eines Geleits gegen den Kartellverband: Kartell greift an, das Geleit verteidigt mit den Modifikatoren
 * seines Heimathafens (wie fightEscort auf dem Server). null bei unbekannter Einheit.
 */
export function probeEscort(escort: Counts, force: Counts, balance: Balance, opts: EscortProbeOpts = {}): EscortProbe | null {
  const units = clean(escort);
  const runs = opts.runs ?? ESCORT_RUNS;
  if (Object.keys(units).length === 0) return { winRate: 0, avgLostValue: 0, runs };
  if (Object.keys(clean(force)).length === 0) return { winRate: 1, avgLostValue: 0, runs };
  const rule = victoryRuleOf("konvoi");
  let held = 0, lost = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle({ units: force }, { units, defenses: {}, ...(opts.modifiers ? { modifiers: opts.modifiers } : {}) }, balance, simSeed(i, opts.seedOffset ?? 0));
    if (!r.ok) return null;
    const s = settleBattle(r.report, balance, rule);
    if (!s.destroyed) held++;
    const fin = s.report.defender.final;
    const gone: Counts = {};
    for (const [id, n] of Object.entries(units)) gone[id] = Math.max(0, n - (fin[id] ?? 0));
    lost += unitsValue(gone, balance);
  }
  return { winRate: held / runs, avgLostValue: lost / runs, runs };
}

/** Fahrt des Geleits: einfache Strecke (Treibstoff hin und zurück) und Stunden, in denen die Schiffe nicht daheim sind. */
export interface EscortTrip {
  /** Einfache Strecke der Geleitfahrt in km (Börse: zum Handelshafen, Vertrag: zum Hafen des Verkäufers, Anbieter: zum Käufer). */
  km: number;
  /** Stunden, die die Schiffe fehlen (Auslaufen bis Heimkehr). */
  awayHours: number;
}

export interface EscortCost {
  /** Treibstoff für die Geleitfahrt (hin und zurück, wie planMission). */
  fuel: number;
  fuelValue: number;
  /** Proviant-Unterhalt der Schiffe während der Fahrt (läuft auch daheim, hier der Fahrt zugerechnet). */
  upkeep: number;
  upkeepValue: number;
  /** Erwarteter Wert versenkter Geleitschiffe: Chance × mittlerer Verlust je Überfall. */
  shipLossValue: number;
  /** Summe in Talern. */
  total: number;
  awayHours: number;
}

/** Kosten eines Geleits zum Richtpreis. `probe`: Probekampf (für die erwarteten Schiffsverluste), sonst ohne diese. */
export function escortCost(escort: Counts, trip: EscortTrip, threat: CartelThreat, balance: Balance, mods?: Modifiers, probe?: EscortProbe | null): EscortCost {
  const units = clean(escort);
  const ref = balance.market.refPrice;
  const fuel = Object.keys(units).length > 0 ? fuelCost(units, Math.max(0, trip.km), balance, mods) : 0;
  let upkeep = 0;
  for (const [id, n] of Object.entries(units)) upkeep += (balance.units[id]?.upkeepPerHour ?? 0) * n * Math.max(0, trip.awayHours);
  const fuelValue = fuel * (ref.treibstoff ?? 0);
  const upkeepValue = upkeep * (ref.proviant ?? 0);
  const shipLossValue = threat.chance * (probe?.avgLostValue ?? 0);
  return { fuel, fuelValue, upkeep, upkeepValue, shipLossValue, total: fuelValue + upkeepValue + shipLossValue, awayHours: trip.awayHours };
}

/** Abwägung: erwarteter Verlust ohne Geleit gegen Verlust mit Geleit plus Kosten des Geleits. */
export interface EscortTradeoff {
  lossUnescorted: number;
  /** Erwarteter Ladungsverlust mit diesem Geleit: Chance × (1 − Siegchance) × lossShareEscortBeaten × Warenwert. */
  lossEscorted: number;
  /** Ersparter Ladungsverlust. */
  saving: number;
  cost: EscortCost;
  /** Lohnt sich: ersparter Verlust größer als die Kosten. */
  worth: boolean;
}

export function escortTradeoff(threat: CartelThreat, winRate: number, cost: EscortCost): EscortTradeoff {
  const lossEscorted = threat.chance * (1 - winRate) * threat.lossIfBeaten;
  const saving = threat.lossUnescorted - lossEscorted;
  return { lossUnescorted: threat.lossUnescorted, lossEscorted, saving, cost, worth: saving > cost.total };
}
