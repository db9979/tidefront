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
}

export const DEFAULT_POWER: PowerBalance = { stepMinutes: 30, minSpeed: 0.25, forecastHours: 24, horizonHours: 336 };
/** Ort für Stützpunkte ohne gespeicherte Lage (ältere Stände, Tests). */
export const DEFAULT_SITE: GeoPoint = { lat: 50, lon: 0 };

export type PowerRankKey = "radar" | "production" | "training" | "research";
export const POWER_RANKS: readonly PowerRankKey[] = ["radar", "production", "training", "research"];

export interface PowerSnapshot {
  atMs: number;
  weather: Weather | null;
  /** Angebot je Quelle (Strom); storage = Entladung des Speicherwerks. */
  supply: { kraftwerk: number; wind: number; solar: number; storage: number };
  /** Bedarf je Rang (Ausbildung und Forschung nur, solange ein Auftrag läuft). */
  demand: Record<PowerRankKey, number>;
  /** Versorgter Anteil je Rang (1 ohne Bedarf). */
  served: Record<PowerRankKey, number>;
  /** Laden (+) bzw. Entladen (−) in Strom je Stunde. */
  charge: number;
  stored: number;
  storageCapacity: number;
  /** Auslastung des Kraftwerks 0–1 (unter 1 nur bei Treibstoff 0). */
  throttle: number;
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

/**
 * Netz in einem Augenblick mit Kraftwerk-Auslastung `throttle`. Bestand `stored` des Speichers,
 * Wetter `w`. Reine Rechnung, keine Fortschreibung.
 */
function piece(base: BaseState, t: number, w: Weather | null, stored: number, throttle: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  const supply = { kraftwerk: 0, wind: 0, solar: 0, storage: 0 };
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
  const gen = supply.kraftwerk + supply.wind + supply.solar;
  const need = demand.radar + demand.production + demand.training + demand.research;
  let charge = 0;
  if (gen >= need) {
    if (stored < spec.capacity - EPS) charge = Math.min(spec.rate, gen - need);
  } else if (stored > EPS) {
    supply.storage = Math.min(spec.rate, need - gen);
    charge = -supply.storage;
  }
  let avail = gen + supply.storage;
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
  return {
    atMs: t, weather: w, supply, demand, served, charge, stored, storageCapacity: spec.capacity,
    throttle, fuelPerHour, perHour, buildingPerHour,
  };
}

/**
 * Netz bei gegebenem Bestand: Bei Treibstoff 0 läuft das Kraftwerk nur so weit, wie Treibstoff nachkommt
 * (Grundrate und Raffinerie), sonst voll. Die Auslastung wird per Bisektion bestimmt (Treibstoff-Rate ≥ 0).
 */
function solvePiece(base: BaseState, t: number, w: Weather | null, stored: number, fuel: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  const full = piece(base, t, w, stored, 1, balance, mods);
  if (fuel > EPS || full.fuelPerHour <= 0 || (full.perHour.treibstoff ?? 0) >= 0) return full;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if ((piece(base, t, w, stored, mid, balance, mods).perHour.treibstoff ?? 0) >= 0) lo = mid;
    else hi = mid;
  }
  return piece(base, t, w, stored, lo, balance, mods);
}

/** Netz zum Zeitpunkt `atMs` mit dem aktuellen Bestand (der Stützpunkt sollte bis atMs fortgeschrieben sein). */
export function powerAt(base: BaseState, atMs: number, balance: Balance, mods?: Modifiers): PowerSnapshot {
  const stored = Math.min(base.powerStored ?? 0, storageSpecs(base, balance).capacity);
  return solvePiece(base, atMs, siteWeather(base, atMs, balance), stored, base.resources.treibstoff ?? 0, balance, mods);
}

/** Wetterquelle der Fortschreibung: Ort und Zeit → Wetter. Ohne Angabe das tatsächliche Wetter (weatherAt). */
export type WeatherSource = (site: GeoPoint, ms: number) => Weather;

/** Rückruf je Stück der Integration [from, to); true beendet die Integration vorzeitig. */
export type PieceCallback = (snap: PowerSnapshot, from: number, to: number) => boolean | void;

/**
 * Schreibt Bestände und Speicher von resUpdatedAt bis toMs fort (Kern von settle). Produktion füllt nur bis zur
 * Lagerkapazität, der Bestand fällt nie unter 0; Bestand 0 bei negativer Proviant-Rate setzt versorgungsmangel.
 */
export function integrateGrid(base: BaseState, toMs: number, balance: Balance, mods?: Modifiers, onPiece?: PieceCallback, wx?: WeatherSource): BaseState {
  const next = cloneBase(base);
  const capacity = storageCapacity(base, balance, mods);
  const spec = storageSpecs(base, balance);
  const step = powerBalance(balance).stepMinutes * 60000;
  let stored = Math.min(Math.max(0, base.powerStored ?? 0), spec.capacity);
  let t = base.resUpdatedAt;
  const ends: number[] = [];
  for (const o of base.trainingQueue) if (o.finishesAt > t && o.finishesAt < toMs) ends.push(o.finishesAt);
  const ro = base.research?.order;
  if (ro && ro.finishesAt > t && ro.finishesAt < toMs) ends.push(ro.finishesAt);
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
      const snap = solvePiece(next, t, w, stored, fuel, balance, mods);
      last = snap;
      let t2 = stepEnd;
      let hit: "full" | "empty" | "fuel" | null = null;
      if (snap.charge > EPS) {
        const tf = t + ((spec.capacity - stored) / snap.charge) * HOUR_MS;
        if (tf < t2) { t2 = tf; hit = "full"; }
      } else if (snap.charge < -EPS) {
        const te = t + (stored / -snap.charge) * HOUR_MS;
        if (te < t2) { t2 = te; hit = "empty"; }
      }
      const fuelRate = snap.perHour.treibstoff ?? 0;
      if (fuelRate < -EPS && fuel > EPS && snap.fuelPerHour > 0) {
        const tz = t + (fuel / -fuelRate) * HOUR_MS;
        if (tz < t2) { t2 = tz; hit = "fuel"; }
      }
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
      stored = Math.min(spec.capacity, Math.max(0, stored + snap.charge * hours));
      if (hit === "full") stored = spec.capacity;
      if (hit === "empty") stored = 0;
      if (hit === "fuel") next.resources.treibstoff = 0;
      if (onPiece && onPiece(snap, t, t2)) { stop = true; t = t2; break; }
      t = t2;
    }
  }
  const final = last ?? solvePiece(next, base.resUpdatedAt, siteWeather(base, base.resUpdatedAt, balance), stored, next.resources.treibstoff ?? 0, balance, mods);
  next.versorgungsmangel = (next.resources.proviant ?? 0) <= 0 && (final.perHour.proviant ?? 0) < 0;
  next.resUpdatedAt = Math.max(base.resUpdatedAt, stop ? t : toMs);
  if (spec.capacity > 0 || base.powerStored !== undefined) next.powerStored = stored;
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
      supply: { kraftwerk: 0, wind: 0, solar: 0, storage: 0 },
      demand: { radar: 0, production: 0, training: 0, research: 0 },
      served: { radar: 1, production: 1, training: 1, research: 1 },
      stored: 0, wind: 0, clouds: 0, fog: 0, daylight: 0, storm: false,
    });
  }
  integrateGrid(start, fromMs + hours * HOUR_MS, balance, mods, (snap, a, b) => {
    // Ein Stück kann über eine Stundengrenze reichen: anteilig verteilen.
    let x = a;
    while (x < b) {
      const i = Math.floor((x - fromMs) / HOUR_MS);
      if (i < 0 || i >= hours) break;
      const end = Math.min(b, fromMs + (i + 1) * HOUR_MS);
      const share = (end - x) / HOUR_MS;
      const h = out[i];
      for (const k of ["kraftwerk", "wind", "solar", "storage"] as const) h.supply[k] += snap.supply[k] * share;
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
