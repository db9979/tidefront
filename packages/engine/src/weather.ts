// Wetter und Strom auf dem Server (v1.6): Modifikator-Quelle „Wetter“ (Nebel kürzt die Radar-Vorwarnzeit),
// Wetter auf Missionsrouten und am Kampfort sowie das Lesemodell der Versorgung (Stromkurve 24 h, Vorhersage).
// Das Wetter ist deterministisch (game-core/weather.ts); die Karte rechnet dasselbe Feld im Browser.
import {
  DEFAULT_SITE,
  POWER_RANKS,
  combatWeather,
  fogRadarFactor,
  forecastRange,
  forecastSkill,
  forecastSpread,
  forecastWeatherAt,
  renewableSupply,
  powerAt,
  powerBalance,
  powerForecast,
  routeWeather,
  weatherAt,
  type ArrivalWeather,
  type BaseState,
  type GeoPoint,
  type CombatWeather,
  type Modifiers,
  type PowerRankKey,
  type RouteWeather,
} from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { balance } from "./context.ts";
import { registerModifierSource } from "./modifiers.ts";

/** Nebel am Hafen kürzt die Radar-Vorwarnzeit (bis fogRadarMax). Als Quelle „Wetter“ im Info-Blatt sichtbar. */
export function weatherModifiers(state: BaseState | null, nowMs: number): Modifiers {
  const wb = balance.weather;
  // Nur mit Radarstation: ohne Radar gibt es nichts zu kürzen (und keine Zeile im Info-Blatt).
  if (!wb || !state || (state.buildings.radarstation ?? 0) < 1) return {};
  // Auf ganze Prozent gerundet: Dunst unter einem halben Prozent ändert nichts.
  const factor = Math.round(fogRadarFactor(weatherAt(state.site ?? DEFAULT_SITE, nowMs, wb).fog, wb) * 100) / 100;
  return factor < 1 ? { radarWarning: factor } : {};
}

registerModifierSource((_db, _playerId, ctx) => weatherModifiers(ctx.state, ctx.nowMs), "wetter", "Wetter");

/** Wetter entlang der Route bei Abfahrt (Planung und Vorschau); undefined ohne Wetter in der Balance. */
export function missionWeather(fromCol: number, fromRow: number, toCol: number, toRow: number, nowMs: number): RouteWeather | undefined {
  if (!balance.weather) return undefined;
  return routeWeather(hexCenter(fromCol, fromRow), hexCenter(toCol, toRow), nowMs, balance.weather);
}

/**
 * Planungsvorschau: Routenwetter bei Abfahrt (gemessen, gilt so) samt Vorhersage für das Ziel zur voraussichtlichen
 * Ankunft (Nebel, Wind, Wolken mit Spannbreite; Unsicherheit nach Vorlauf und Vorhersagegüte des Hafens `own`).
 * Nur für die Anzeige – der gespeicherte Plan behält das Routenwetter bei Abfahrt, am Ziel gilt das echte Wetter.
 */
export function withArrival(
  w: RouteWeather | undefined, toCol: number, toRow: number, arriveAtMs: number, nowMs: number, own?: BaseState | null,
): RouteWeather | undefined {
  const wb = balance.weather;
  if (!w || !wb) return w;
  const p = hexCenter(toCol, toRow);
  const skill = forecastSkill(own, wb);
  const f = forecastWeatherAt(p, arriveAtMs, nowMs, wb, skill);
  const r = forecastRange(p, arriveAtMs, nowMs, wb, skill);
  const atTarget: ArrivalWeather = {
    atMs: arriveAtMs, wind: f.wind, clouds: f.clouds, fog: f.fog, storm: f.storm,
    forecast: { wind: r.wind, clouds: r.clouds, fog: r.fog, stormPossible: r.stormPossible, skill },
  };
  return { ...w, atTarget };
}

/** Wetter am Kampfort (Luftphasen); undefined ohne Wetter. */
export function battleWeather(col: number, row: number, atMs: number): CombatWeather | undefined {
  if (!balance.weather) return undefined;
  return combatWeather(hexCenter(col, row), atMs, balance.weather);
}

/** Nebel an einem Feld (Aufklärung). */
export function fogAt(col: number, row: number, atMs: number): number {
  return balance.weather ? weatherAt(hexCenter(col, row), atMs, balance.weather).fog : 0;
}

const RANK_TEXT: Record<PowerRankKey, string> = {
  radar: "Radar eingeschränkt",
  production: "Produktion gedrosselt",
  training: "Ausbildung langsamer",
  research: "Forschung langsamer",
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const HOUR_MS = 3600000;

/**
 * Versorgung für die Basis: Augenblick, Stromkurve über forecastHours (Angebot nach Quelle, Bedarf nach Rang,
 * Speicherstand, Wetter am Hafen) und die erste Mangelwarnung („Ab 23 Uhr fehlen 40 Strom – Radar eingeschränkt“;
 * die Uhrzeit setzt die Oberfläche in Ortszeit).
 */
export function gridView(state: BaseState, nowMs: number, mods?: Modifiers) {
  const now = powerAt(state, nowMs, balance, mods);
  const hours = powerBalance(balance).forecastHours;
  // Kurve ab der nächsten vollen Stunde: Jeder Balken ist genau eine Uhrzeit-Stunde (Beschriftung „14 Uhr“ stimmt).
  const startMs = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  // Vorhersage (v1.18): Die Kurve rechnet mit dem vorhergesagten Wetter am Hafen, nicht mit dem echten.
  const wb0 = balance.weather;
  const skill = forecastSkill(state, wb0);
  const wx = wb0 ? (p: GeoPoint, ms: number) => forecastWeatherAt(p, ms, nowMs, wb0, skill) : undefined;
  const curve = powerForecast(state, startMs, hours, balance, mods, wx);
  let warning: { atMs: number; missing: number; rank: PowerRankKey; text: string } | null = null;
  const nowRank = POWER_RANKS.find((k) => now.served[k] < 0.999);
  if (nowRank) {
    const supply = now.supply.kraftwerk + now.supply.wind + now.supply.solar + now.supply.storage;
    const demand = POWER_RANKS.reduce((a, k) => a + now.demand[k], 0);
    warning = { atMs: nowMs, missing: Math.max(1, Math.round(demand - supply)), rank: nowRank, text: RANK_TEXT[nowRank] };
  }
  for (const h of warning ? [] : curve) {
    const rank = POWER_RANKS.find((k) => h.served[k] < 0.999);
    if (!rank) continue;
    const supply = h.supply.kraftwerk + h.supply.wind + h.supply.solar + h.supply.storage;
    const demand = POWER_RANKS.reduce((a, k) => a + h.demand[k], 0);
    warning = { atMs: h.atMs, missing: Math.max(1, Math.round(demand - supply)), rank, text: RANK_TEXT[rank] };
    break;
  }
  const wb = balance.weather;
  return {
    now: {
      supply: now.supply,
      demand: now.demand,
      served: now.served,
      stored: now.stored,
      capacity: now.storageCapacity,
      charge: now.charge,
      throttle: now.throttle,
      fuelPerHour: now.fuelPerHour,
      weather: now.weather,
    },
    curve: curve.map((h) => ({
      atMs: h.atMs,
      supply: { kraftwerk: r1(h.supply.kraftwerk), wind: r1(h.supply.wind), solar: r1(h.supply.solar), storage: r1(h.supply.storage) },
      demand: { radar: r1(h.demand.radar), production: r1(h.demand.production), training: r1(h.demand.training), research: r1(h.demand.research) },
      served: h.served,
      stored: r1(h.stored),
      wind: r1(h.wind * 100) / 100,
      clouds: r1(h.clouds * 100) / 100,
      fog: r1(h.fog * 100) / 100,
      daylight: r1(h.daylight * 100) / 100,
      storm: h.storm,
      ...band(state, h, nowMs),
    })),
    warning,
    stormFrom: wb?.stormFrom ?? 0.8,
    fogFrom: wb?.fogScoutFrom ?? 0.35,
    slowFrom: wb?.shipSlowFrom ?? 0.5,
    stormWarning: wb ? stormStart(state.site ?? DEFAULT_SITE, nowMs, startMs + hours * HOUR_MS, skill) : null,
    // Sturm möglich (oberer Rand der Spannbreite), obwohl die Vorhersage keinen zeigt: erste solche Stunde.
    stormPossibleAt: wb ? (curve.find((h) => forecastRange(state.site ?? DEFAULT_SITE, h.atMs + HOUR_MS / 2, nowMs, wb, skill).stormPossible)?.atMs ?? null) : null,
    forecast: wb?.forecast ? { skill, issuedEveryHours: wb.forecast.issueEveryHours } : null,
  };
}

/** Beginn des nächsten vorhergesagten Sturms am Hafen auf 5 Minuten genau (oder `fromMs` bei Sturm jetzt); null ohne Sturm. */
function stormStart(site: { lat: number; lon: number }, fromMs: number, untilMs: number, skill: number): { atMs: number; plusMinusH: number } | null {
  const step = 5 * 60000;
  for (let t = fromMs; t < untilMs; t = t === fromMs ? Math.floor(fromMs / step) * step + step : t + step) {
    if (forecastWeatherAt(site, t, fromMs, balance.weather!, skill).storm) {
      return { atMs: t, plusMinusH: Math.round(forecastSpread((t - fromMs) / HOUR_MS, balance.weather!, skill).shiftH * 2) / 2 };
    }
  }
  return null;
}

/**
 * Spannbreite einer Stunde der Stromkurve: Wind und Bewölkung (forecastRange in der Stundenmitte) und daraus das
 * Angebot aus Wind und Sonne von schlecht bis gut; Kraftwerk und Speicher wie in der Vorhersage.
 */
function band(state: BaseState, h: { atMs: number; supply: Record<"kraftwerk" | "wind" | "solar" | "storage", number>; daylight: number; wind: number; clouds: number }, nowMs: number) {
  const wb = balance.weather;
  const r = wb
    ? forecastRange(state.site ?? DEFAULT_SITE, h.atMs + HOUR_MS / 2, nowMs, wb, forecastSkill(state, wb))
    : { wind: [h.wind, h.wind], clouds: [h.clouds, h.clouds] };
  const fixed = h.supply.kraftwerk + h.supply.storage;
  // Das Band enthält immer die Vorhersage selbst.
  let lo = h.supply.wind + h.supply.solar;
  let hi = lo;
  // Wind über die Spannbreite abtasten (Windparks schalten bei Orkan ab, daher nicht nur die Ränder).
  for (let i = 0; i <= 4; i++) {
    const wind = r.wind[0] + ((r.wind[1] - r.wind[0]) * i) / 4;
    const dark = renewableSupply(state, { wind, clouds: r.clouds[1], daylight: h.daylight }, balance);
    const bright = renewableSupply(state, { wind, clouds: r.clouds[0], daylight: h.daylight }, balance);
    lo = Math.min(lo, dark.wind + dark.solar);
    hi = Math.max(hi, bright.wind + bright.solar);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    supplyLow: r1(fixed + lo),
    supplyHigh: r1(fixed + hi),
    windRange: [r2(r.wind[0]), r2(r.wind[1])] as [number, number],
    cloudsRange: [r2(r.clouds[0]), r2(r.clouds[1])] as [number, number],
  };
}
