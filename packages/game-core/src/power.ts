// Stromnetz (seit v1.6): Quellen Kraftwerk (verbraucht Treibstoff), Windpark und Solarfeld (wetterabhängig),
// Speicherwerk als Puffer; Verbraucher mit fester Rangfolge bei Mangel (1 Radar, 2 Produktion, 3 Ausbildung,
// 4 Forschung). Weil Wind und Sonne schwanken, integriert die Fortschreibung in festen Zeitschritten
// (stepMinutes, an der Uhr ausgerichtet; Wetter je Schritt konstant) und teilt Schritte an Ereignissen
// (Speicher voll/leer, Treibstoff 0, Ende eines Auftrags). Innerhalb eines Stücks sind alle Raten konstant.
import type { Balance, BaseState, GeoPoint, ResourceMap } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry } from "./modifiers.ts";
import { buildingLevel, cloneBase, storageCapacity, upkeepPerHour } from "./economy.ts";
import { sunshine, weatherAt, type Weather } from "./weather.ts";
import {
  cableBuilding, cableCapacity, clonePowerLog, electrolysisSpecs, greenBalance, logHours, DEFAULT_GREEN,
  type CableBalance, type GreenBalance,
} from "./power-green.ts";

const HOUR_MS = 3600000;
const EPS = 1e-9;

/** Werte unter `power` in balance.json. */
export interface PowerBalance {
  /** Zeitschritt der Fortschreibung in Minuten (Wetter je Schritt konstant). */
  stepMinutes: number;
  /** Mindesttempo von Ausbildung und Forschung ohne Strom (0,25 = ein Viertel). */
  minSpeed: number;
  /** Länge der Stromkurve in der Anzeige (Stunden). */
  forecastHours: number;
  /** So weit rechnet die Prognose der Fertigstellung voraus; danach gilt das letzte Tempo. */
  horizonHours: number;
  /** Grüner Hafen (v1.21): Ökostrom-Anteil und Produktionsbonus. */
  green?: GreenBalance;
  /** Seekabel (v1.21): Reichweite, Verlust, Puffer, Abrechnung. */
  cable?: CableBalance;
}

export const DEFAULT_POWER: PowerBalance = { stepMinutes: 30, minSpeed: 0.25, forecastHours: 24, horizonHours: 336 };
/** Ort für Stützpunkte ohne gespeicherte Lage (ältere Stände, Tests). */
export const DEFAULT_SITE: GeoPoint = { lat: 50, lon: 0 };

export type PowerRankKey = "radar" | "production" | "training" | "research";
export const POWER_RANKS: readonly PowerRankKey[] = ["radar", "production", "training", "research"];

export interface PowerSnapshot {
  atMs: number;
  weather: Weather | null;
  /** Angebot je Quelle (Strom); storage = Entladung des Speicherwerks, cable = Bezug aus dem Kabelpuffer. */
  supply: { kraftwerk: number; wind: number; solar: number; storage: number; cable: number };
  /**
   * Überschuss nach Bedarf und Speicher (Strom je Stunde): fuel → Elektrolyse, cable → ins Seekabel,
   * wasted → verfällt (Ökostrom ohne Abnehmer; Kraftwerksstrom nur bei fester Auslastung, s. loadFollow).
   */
  surplus: { fuel: number; cable: number; wasted: number };
  /** Davon verfallender Ökostrom (Wind/Sonne ohne Abnehmer; Kraftwerksüberschuss nicht). */
  greenWasted: number;
  /** Treibstoff je Stunde aus der Elektrolyse (in perHour enthalten). */
  fuelMade: number;
  /** Gedeckter Bedarf je Stunde und Anteil daraus aus Ökostrom (Wind, Sonne, grüner Speicheranteil, Kabel). */
  green: { used: number; total: number };
  /** Änderung des Ökostrom-Anteils im Speicher je Stunde. */
  greenCharge: number;
  /** Kabelpuffer (Empfänger) zu Beginn des Stücks. */
  buffer: number;
  /** Bedarf je Rang (Ausbildung und Forschung nur, solange ein Auftrag läuft). */
  demand: Record<PowerRankKey, number>;
  /** Versorgter Anteil je Rang (1 ohne Bedarf). */
  served: Record<PowerRankKey, number>;
  /** Laden (+) bzw. Entladen (−) in Strom je Stunde. */
  charge: number;
  stored: number;
  storageCapacity: number;
  /**
   * Auslastung des Kraftwerks 0–1. Das Kraftwerk regelt nach (Lastfolge): Es deckt nur, was Ökostrom, Kabelbezug
   * und Speicher offen lassen; bei Treibstoff 0 zusätzlich nur so weit, wie Treibstoff nachkommt.
   */
  throttle: number;
  /** Die Auslastung ist durch fehlenden Treibstoff begrenzt (nicht durch geringen Bedarf). */
  fuelLimited: boolean;
  fuelPerHour: number;
  /** Netto-Raten der Ressourcen je Stunde und Gebäudeproduktion in diesem Augenblick. */
  perHour: ResourceMap;
  buildingPerHour: ResourceMap;
}

export function powerBalance(balance: Balance): PowerBalance {
  return balance.power ?? DEFAULT_POWER;
}

/** Rang eines Gebäudes als Verbraucher (0 = kein Verbraucher). */
function rankOf(id: string, balance: Balance): number {
  const def = balance.buildings[id];
  if (!def.powerPerLevel) return 0;
  return def.powerRank ?? (def.produces !== undefined ? 2 : 0);
}

/** Speicherwerk: Kapazität und Lade-/Entladeleistung. */
export function storageSpecs(base: BaseState, balance: Balance): { capacity: number; rate: number } {
  let capacity = 0;
  let rate = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    const l = buildingLevel(base, id);
    capacity += (def.storagePerLevel ?? 0) * l;
    rate += (def.storageRatePerLevel ?? 0) * l;
  }
  return { capacity, rate };
}

/** Wetter am Hafen für den Zeitschritt, in dem `ms` liegt (null ohne Wetter in der Balance). */
export function siteWeather(base: BaseState, ms: number, balance: Balance): Weather | null {
  if (!balance.weather) return null;
  const step = powerBalance(balance).stepMinutes * 60000;
  return weatherAt(base.site ?? DEFAULT_SITE, Math.floor(ms / step) * step, balance.weather);
}

/** Laufen zum Zeitpunkt t Aufträge in diesem Gebäude (Ausbildung) bzw. Forschung? */
function activeAt(base: BaseState, id: string, rank: number, t: number, balance: Balance): boolean {
  if (rank === 3) return base.trainingQueue.some((o) => o.builtIn === id && o.startedAt <= t && t < o.finishesAt);
  if (rank === 4) {
    const o = base.research?.order;
    return id === balance.research?.building && !!o && o.startedAt <= t && t < o.finishesAt;
  }
  return true;
}

const RANK_KEY: Record<number, PowerRankKey> = { 1: "radar", 2: "production", 3: "training", 4: "research" };

/** Zustand des Netzes, der sich innerhalb der Fortschreibung ändert. */
interface GridState {
  stored: number;
  storedGreen: number;
  /** Kabelpuffer des Empfängers. */
  buffer: number;
  /** Treibstoff liegt an der Lagergrenze (Elektrolyse nur, soweit Verbrauch sie aufnimmt). */
  fuelFull: boolean;
}

/**
 * Netz in einem Augenblick mit Kraftwerk-Auslastung `throttle`, Speicher- und Pufferstand `st`, Wetter `w`.
 * Reine Rechnung, keine Fortschreibung. Ökostrom deckt den Bedarf zuerst, dann lädt er den Speicher; der Rest
 * (nur Ökostrom) geht in die Elektrolyse, danach ins Seekabel. Bei `throttle` 1 verfiele Kraftwerksüberschuss; solvePiece
 * regelt deshalb nach (siehe loadFollow).
 */
function piece(base: BaseState, t: number, w: Weather | null, st: GridState, throttle: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  const supply = { kraftwerk: 0, wind: 0, solar: 0, storage: 0, cable: 0 };
  const demand: Record<PowerRankKey, number> = { radar: 0, production: 0, training: 0, research: 0 };
  let fuelPerHour = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    const l = buildingLevel(base, id);
    if (l < 1) continue;
    if (def.powerSupplyPerLevel) {
      supply.kraftwerk += def.powerSupplyPerLevel * l * throttle;
      fuelPerHour += (def.fuelPerHourPerLevel ?? 0) * l * throttle;
    }
    if (def.windPowerPerLevel && w && w.wind <= (def.stormCutoff ?? 1)) supply.wind += def.windPowerPerLevel * l * w.wind;
    if (def.solarPowerPerLevel && w) supply.solar += def.solarPowerPerLevel * l * sunshine(w, def.cloudLoss ?? 0);
    const rank = rankOf(id, balance);
    if (rank > 0 && activeAt(base, id, rank, t, balance)) demand[RANK_KEY[rank]] += (def.powerPerLevel ?? 0) * l;
  }
  const spec = storageSpecs(base, balance);
  const green = supply.wind + supply.solar;
  const gen = supply.kraftwerk + green;
  const need = demand.radar + demand.production + demand.training + demand.research;
  const greenToDemand = Math.min(green, need);
  const frac = st.stored > EPS ? Math.min(1, Math.max(0, st.storedGreen / st.stored)) : 0;
  let charge = 0;
  let greenCharge = 0;
  let greenSurplus = 0;
  let surplus = 0;
  if (gen >= need) {
    if (st.stored < spec.capacity - EPS) charge = Math.min(spec.rate, gen - need);
    greenCharge = Math.min(green - greenToDemand, charge);
    greenSurplus = green - greenToDemand - greenCharge;
    surplus = gen - need - charge;
  } else {
    let deficit = need - gen;
    if (base.cable?.role === "in" && st.buffer > EPS) {
      supply.cable = Math.min(cableCapacity(base, t, balance), deficit);
      deficit -= supply.cable;
    }
    if (st.stored > EPS && deficit > 0) {
      supply.storage = Math.min(spec.rate, deficit);
      charge = -supply.storage;
      greenCharge = -supply.storage * frac;
    }
  }
  let avail = gen + supply.storage + supply.cable;
  const consumed = Math.min(need, avail);
  const served = { radar: 1, production: 1, training: 1, research: 1 };
  for (const k of POWER_RANKS) {
    if (demand[k] <= 0) continue;
    const got = Math.min(avail, demand[k]);
    served[k] = got / demand[k];
    avail -= got;
  }
  const buildingPerHour: ResourceMap = {};
  for (const r of balance.resources) buildingPerHour[r] = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    const l = buildingLevel(base, id);
    if (def.produces === undefined || l < 1) continue;
    const raw = (def.perHour ?? 0) * balance.building.productionGrowth ** (l - 1);
    buildingPerHour[def.produces] = (buildingPerHour[def.produces] ?? 0) + raw * served.production * modEntry(mods, "production", def.produces);
  }
  const perHour: ResourceMap = {};
  for (const r of balance.resources) perHour[r] = (balance.baseTricklePerHour[r] ?? 0) + buildingPerHour[r];
  if ("proviant" in perHour) perHour.proviant -= upkeepPerHour(base, balance);
  if ("treibstoff" in perHour) perHour.treibstoff -= fuelPerHour;
  // v1.35 (Nutzerentscheid 12C): Unterhalt einer Kolonie je Tag, je Ressource höchstens die Gebäudeproduktion der Kolonie.
  const colonyUpkeep = base.colony ? balance.expansion?.colonyUpkeepPerDay : undefined;
  if (colonyUpkeep) for (const [r, v] of Object.entries(colonyUpkeep)) if (r in perHour) perHour[r] -= Math.min(Math.max(0, v) / 24, Math.max(0, buildingPerHour[r] ?? 0));
  // Elektrolyse aus Ökostrom-Überschuss; an der Lagergrenze nur so viel, wie der Verbrauch aufnimmt.
  const elec = electrolysisSpecs(base, balance);
  let toFuel = "treibstoff" in perHour ? Math.min(greenSurplus, elec.rate) : 0;
  if (st.fuelFull && toFuel > 0) toFuel = Math.min(toFuel, Math.max(0, -perHour.treibstoff) * elec.ratio);
  const fuelMade = toFuel > 0 ? toFuel / elec.ratio : 0;
  if (fuelMade > 0) {
    perHour.treibstoff += fuelMade;
    buildingPerHour.treibstoff = (buildingPerHour.treibstoff ?? 0) + fuelMade;
  }
  const toCable = base.cable?.role === "out" ? Math.min(Math.max(0, greenSurplus - toFuel), cableCapacity(base, t, balance)) : 0;
  const used = greenToDemand + supply.cable + supply.storage * frac;
  return {
    atMs: t, weather: w, supply, demand, served, charge, stored: st.stored, storageCapacity: spec.capacity,
    throttle, fuelLimited: false, fuelPerHour, perHour, buildingPerHour,
    surplus: { fuel: Math.max(0, toFuel), cable: toCable, wasted: Math.max(0, surplus - Math.max(0, toFuel) - toCable) },
    greenWasted: Math.max(0, greenSurplus - Math.max(0, toFuel) - toCable),
    fuelMade, green: { used: Math.min(used, consumed), total: consumed }, greenCharge, buffer: st.buffer,
  };
}

/**
 * Lastfolge: Auslastung, bei der das Kraftwerk genau den Bedarf deckt, den Ökostrom, Kabelbezug und Speicher offen
 * lassen. Kein Kraftwerksstrom lädt den Speicher oder verfällt (er ginge nie in Elektrolyse oder Kabel).
 */
function loadFollow(base: BaseState, t: number, w: Weather | null, st: GridState, balance: Balance, mods?: Modifiers): number {
  const off = piece(base, t, w, st, 0, balance, mods);
  const max = piece(base, t, w, st, 1, balance, mods).supply.kraftwerk;
  if (max <= EPS) return 1;
  const need = off.demand.radar + off.demand.production + off.demand.training + off.demand.research;
  const open = need - (off.supply.wind + off.supply.solar + off.supply.storage + off.supply.cable);
  return Math.min(1, Math.max(0, open / max));
}

/**
 * Netz bei gegebenem Bestand: Das Kraftwerk regelt nach Bedarf (loadFollow). Bei Treibstoff 0 läuft es höchstens so
 * weit, wie Treibstoff nachkommt (Grundrate, Raffinerie, Elektrolyse); die Auslastung wird dann per Bisektion bestimmt
 * (Treibstoff-Rate ≥ 0; die Rate fällt mit der Auslastung, weil Kraftwerksstrom nie in die Elektrolyse geht).
 */
function solvePiece(base: BaseState, t: number, w: Weather | null, st: GridState, fuel: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  const top = loadFollow(base, t, w, st, balance, mods);
  const full = piece(base, t, w, st, top, balance, mods);
  if (fuel > EPS || full.fuelPerHour <= 0 || (full.perHour.treibstoff ?? 0) >= 0) return full;
  let lo = 0;
  let hi = top;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if ((piece(base, t, w, st, mid, balance, mods).perHour.treibstoff ?? 0) >= 0) lo = mid;
    else hi = mid;
  }
  return { ...piece(base, t, w, st, lo, balance, mods), fuelLimited: true };
}

/** Anfangszustand des Netzes aus dem Stützpunkt. */
function gridState(base: BaseState, balance: Balance, mods?: Modifiers): GridState {
  const stored = Math.min(Math.max(0, base.powerStored ?? 0), storageSpecs(base, balance).capacity);
  return {
    stored,
    storedGreen: Math.min(stored, Math.max(0, base.powerLog?.storedGreen ?? 0)),
    buffer: base.cable?.role === "in" ? Math.max(0, base.cable.buffer ?? 0) : 0,
    fuelFull: (base.resources.treibstoff ?? 0) >= storageCapacity(base, balance, mods) - EPS,
  };
}

/** Netz zum Zeitpunkt `atMs` mit dem aktuellen Bestand (der Stützpunkt sollte bis atMs fortgeschrieben sein). */
export function powerAt(base: BaseState, atMs: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  return solvePiece(base, atMs, siteWeather(base, atMs, balance), gridState(base, balance, mods), base.resources.treibstoff ?? 0, balance, mods);
}

/** Wetterquelle der Fortschreibung: Ort und Zeit → Wetter. Ohne Angabe das tatsächliche Wetter (weatherAt). */
export type WeatherSource = (site: GeoPoint, ms: number) => Weather;

/** Rückruf je Stück der Integration [from, to); true beendet die Integration vorzeitig. */
export type PieceCallback = (snap: PowerSnapshot, from: number, to: number) => boolean | void;

type Hit = "full" | "empty" | "fuel" | "buffer" | "fuelcap" | null;

/**
 * Schreibt Bestände, Speicher, Kabelpuffer und Zähler (powerLog) von resUpdatedAt bis toMs fort (Kern von settle).
 * Produktion füllt nur bis zur Lagerkapazität, der Bestand fällt nie unter 0; Bestand 0 bei negativer
 * Proviant-Rate setzt versorgungsmangel. Stücke enden an Ereignissen (Speicher voll/leer, Treibstoff 0 oder an
 * der Lagergrenze, Kabelpuffer leer, Ende eines Auftrags, Ende einer Sabotage an der Kabelstation).
 */
export function integrateGrid(base: BaseState, toMs: number, balance: Balance, mods?: Modifiers, onPiece?: PieceCallback, wx?: WeatherSource): BaseState {
  const next = cloneBase(base);
  const capacity = storageCapacity(base, balance, mods);
  const spec = storageSpecs(base, balance);
  const step = powerBalance(balance).stepMinutes * 60000;
  const windowHours = (greenBalance(balance) ?? DEFAULT_GREEN).windowHours;
  const st = gridState(base, balance, mods);
  const log = clonePowerLog(base.powerLog);
  let sent = 0;
  let t = base.resUpdatedAt;
  const ends: number[] = [];
  for (const o of base.trainingQueue) if (o.finishesAt > t && o.finishesAt < toMs) ends.push(o.finishesAt);
  const ro = base.research?.order;
  if (ro && ro.finishesAt > t && ro.finishesAt < toMs) ends.push(ro.finishesAt);
  const sab = base.intel?.sabotage;
  if (sab && sab.target === cableBuilding(balance) && sab.untilMs > t && sab.untilMs < toMs) ends.push(sab.untilMs);
  ends.sort((a, b) => a - b);
  let last: PowerSnapshot | null = null;
  let stop = false;
  while (t < toMs && !stop) {
    const stepStart = Math.floor(t / step) * step;
    let stepEnd = Math.min(toMs, stepStart + step);
    for (const e of ends) if (e > t && e < stepEnd) { stepEnd = e; break; }
    const site = base.site ?? DEFAULT_SITE;
    const w = balance.weather ? (wx ? wx(site, stepStart) : weatherAt(site, stepStart, balance.weather)) : null;
    for (let guard = 0; t < stepEnd && guard < 8; guard++) {
      const fuel = next.resources.treibstoff ?? 0;
      st.fuelFull = fuel >= capacity - EPS;
      const snap = solvePiece(next, t, w, st, fuel, balance, mods);
      last = snap;
      let t2 = stepEnd;
      let hit: Hit = null;
      const at = (dt: number, h: Hit) => {
        const x = t + dt * HOUR_MS;
        if (x < t2) { t2 = x; hit = h; }
      };
      if (snap.charge > EPS) at((spec.capacity - st.stored) / snap.charge, "full");
      else if (snap.charge < -EPS) at(st.stored / -snap.charge, "empty");
      const fuelRate = snap.perHour.treibstoff ?? 0;
      if (fuelRate < -EPS && fuel > EPS && snap.fuelPerHour > 0) at(fuel / -fuelRate, "fuel");
      if (fuelRate > EPS && snap.fuelMade > 0 && fuel < capacity) at((capacity - fuel) / fuelRate, "fuelcap");
      if (snap.supply.cable > EPS) at(st.buffer / snap.supply.cable, "buffer");
      if (!(t2 > t) || guard === 7) { t2 = stepEnd; hit = null; }
      const hours = (t2 - t) / HOUR_MS;
      for (const r of balance.resources) {
        const stock = next.resources[r] ?? 0;
        const rate = snap.perHour[r] ?? 0;
        let value = stock;
        if (rate >= 0) {
          if (stock < capacity) value = Math.min(capacity, stock + rate * hours);
        } else value = Math.max(0, stock + rate * hours);
        next.resources[r] = value;
      }
      st.stored = Math.min(spec.capacity, Math.max(0, st.stored + snap.charge * hours));
      st.storedGreen = Math.min(st.stored, Math.max(0, st.storedGreen + snap.greenCharge * hours));
      st.buffer = Math.max(0, st.buffer - snap.supply.cable * hours);
      if (hit === "full") st.stored = spec.capacity;
      if (hit === "empty") st.stored = st.storedGreen = 0;
      if (hit === "fuel") next.resources.treibstoff = 0;
      if (hit === "fuelcap") next.resources.treibstoff = capacity;
      if (hit === "buffer") st.buffer = 0;
      if (t2 > t) {
        logHours(log, t, t2, snap.green.used, snap.green.total, windowHours);
        log.greenUsed += (snap.green.used + snap.surplus.fuel + snap.surplus.cable) * hours;
        log.fuelMade += snap.fuelMade * hours;
        log.sent += snap.surplus.cable * hours;
        log.drawn += snap.supply.cable * hours;
        log.wasted += snap.surplus.wasted * hours;
        sent += snap.surplus.cable * hours;
      }
      if (onPiece && onPiece(snap, t, t2)) { stop = true; t = t2; break; }
      t = t2;
    }
  }
  const final = last ?? solvePiece(next, base.resUpdatedAt, siteWeather(base, base.resUpdatedAt, balance), st, next.resources.treibstoff ?? 0, balance, mods);
  next.versorgungsmangel = (next.resources.proviant ?? 0) <= 0 && (final.perHour.proviant ?? 0) < 0;
  next.resUpdatedAt = Math.max(base.resUpdatedAt, stop ? t : toMs);
  if (spec.capacity > 0 || base.powerStored !== undefined) next.powerStored = st.stored;
  // Zähler nur, wenn es etwas zu zählen gibt (alte Stände ohne Strom bleiben unverändert).
  if (base.powerLog || log.hours.length > 0 || st.storedGreen > 0) next.powerLog = { ...log, storedGreen: st.storedGreen };
  if (next.cable?.role === "in") next.cable = { ...next.cable, buffer: st.buffer };
  if (next.cable?.role === "out") next.cable = { ...next.cable, sent: (next.cable.sent ?? 0) + sent };
  return next;
}

/**
 * Fertigstellung eines Auftrags mit Strom-Prognose (Ausbildung Rang 3, Forschung Rang 4): Der Auftrag
 * schreitet mit dem versorgten Anteil seines Rangs voran, mindestens mit minSpeed. `base` enthält den
 * Auftrag bereits (mit beliebig spätem finishesAt); Wetter ist deterministisch, Änderungen am Hafen
 * nach dem Start (neue Gebäude, Treibstoff) verschieben die Fertigstellung nicht mehr.
 */
export function poweredFinishMs(base: BaseState, startMs: number, workMs: number, rank: "training" | "research", balance: Balance, mods?: Modifiers): number {
  if (workMs <= 0) return startMs;
  const pb = powerBalance(balance);
  let remaining = workMs;
  let result: number | null = null;
  let speed = 1;
  const from = { ...base, resUpdatedAt: startMs };
  integrateGrid(from, startMs + pb.horizonHours * HOUR_MS, balance, mods, (snap, a, b) => {
    speed = Math.max(pb.minSpeed, snap.served[rank]);
    const progress = (b - a) * speed;
    if (progress >= remaining - 1e-6) {
      result = a + remaining / speed;
      return true;
    }
    remaining -= progress;
    return false;
  });
  if (result === null) result = startMs + pb.horizonHours * HOUR_MS + remaining / speed;
  return Math.ceil(result);
}

/** Stunde der Stromkurve: Mittel über die Stunde (Angebot je Quelle, Bedarf je Rang), Speicher am Ende. */
export interface PowerHour {
  atMs: number;
  supply: PowerSnapshot["supply"];
  demand: Record<PowerRankKey, number>;
  /** Niedrigster versorgter Anteil je Rang in der Stunde. */
  served: Record<PowerRankKey, number>;
  stored: number;
  /** Verwendung des Überschusses im Mittel (Elektrolyse, Kabel, verfällt). */
  surplus: PowerSnapshot["surplus"];
  greenWasted: number;
  /** Ökostrom-Anteil am gedeckten Bedarf in der Stunde (0–1; 0 ohne Bedarf). */
  greenShare: number;
  wind: number;
  clouds: number;
  fog: number;
  daylight: number;
  storm: boolean;
}

/**
 * Stromkurve über `hours` Stunden ab `fromMs` (Stützpunkt wird zuvor bis fromMs fortgeschrieben). `wx`: Wetterquelle,
 * in der Anzeige die Vorhersage (weather-forecast.ts); ohne Angabe das tatsächliche Wetter.
 */
export function powerForecast(base: BaseState, fromMs: number, hours: number, balance: Balance, mods?: Modifiers, wx?: WeatherSource): PowerHour[] {
  const start = base.resUpdatedAt < fromMs ? integrateGrid(base, fromMs, balance, mods, undefined, wx) : { ...base, resUpdatedAt: fromMs };
  const out: PowerHour[] = [];
  for (let i = 0; i < hours; i++) {
    out.push({
      atMs: fromMs + i * HOUR_MS,
      supply: { kraftwerk: 0, wind: 0, solar: 0, storage: 0, cable: 0 },
      demand: { radar: 0, production: 0, training: 0, research: 0 },
      served: { radar: 1, production: 1, training: 1, research: 1 },
      surplus: { fuel: 0, cable: 0, wasted: 0 },
      greenWasted: 0,
      greenShare: 0,
      stored: 0, wind: 0, clouds: 0, fog: 0, daylight: 0, storm: false,
    });
  }
  const green = out.map(() => ({ used: 0, total: 0 }));
  integrateGrid(start, fromMs + hours * HOUR_MS, balance, mods, (snap, a, b) => {
    // Ein Stück kann über eine Stundengrenze reichen: anteilig verteilen.
    let x = a;
    while (x < b) {
      const i = Math.floor((x - fromMs) / HOUR_MS);
      if (i < 0 || i >= hours) break;
      const end = Math.min(b, fromMs + (i + 1) * HOUR_MS);
      const share = (end - x) / HOUR_MS;
      const h = out[i];
      for (const k of ["kraftwerk", "wind", "solar", "storage", "cable"] as const) h.supply[k] += snap.supply[k] * share;
      for (const k of ["fuel", "cable", "wasted"] as const) h.surplus[k] += snap.surplus[k] * share;
      h.greenWasted += snap.greenWasted * share;
      green[i].used += snap.green.used * share;
      green[i].total += snap.green.total * share;
      for (const k of POWER_RANKS) {
        h.demand[k] += snap.demand[k] * share;
        h.served[k] = Math.min(h.served[k], snap.served[k]);
      }
      h.stored = Math.min(snap.storageCapacity, Math.max(0, snap.stored + snap.charge * ((end - a) / HOUR_MS)));
      if (snap.weather) {
        h.wind += snap.weather.wind * share;
        h.clouds += snap.weather.clouds * share;
        h.fog += snap.weather.fog * share;
        h.daylight += snap.weather.daylight * share;
        h.storm = h.storm || snap.weather.storm;
      }
      x = end;
    }
  }, wx);
  out.forEach((h, i) => (h.greenShare = green[i].total > EPS ? Math.min(1, green[i].used / green[i].total) : 0));
  return out;
}

/** Strom aus Wind und Sonne bei Wetter `w` (für die Spannbreite der Stromkurve). */
export function renewableSupply(base: BaseState, w: Pick<Weather, "wind" | "clouds" | "daylight">, balance: Balance): { wind: number; solar: number } {
  let wind = 0;
  let solar = 0;
  for (const [id, def] of Object.entries(balance.buildings)) {
    const l = buildingLevel(base, id);
    if (l < 1) continue;
    if (def.windPowerPerLevel && w.wind <= (def.stormCutoff ?? 1)) wind += def.windPowerPerLevel * l * w.wind;
    if (def.solarPowerPerLevel) solar += def.solarPowerPerLevel * l * sunshine({ ...w, fog: 0, storm: false }, def.cloudLoss ?? 0);
  }
  return { wind, solar };
}
