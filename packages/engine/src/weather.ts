// Wetter und Strom auf dem Server (v1.6): Modifikator-Quelle „Wetter“ (Nebel kürzt die Radar-Vorwarnzeit),
// Wetter auf Missionsrouten und am Kampfort sowie das Lesemodell der Versorgung (Stromkurve 24 h, Vorhersage).
// Das Wetter ist deterministisch (game-core/weather.ts); die Karte rechnet dasselbe Feld im Browser.
import {
  DEFAULT_SITE,
  POWER_RANKS,
  combatWeather,
  fogRadarFactor,
  powerAt,
  powerBalance,
  powerForecast,
  routeWeather,
  weatherAt,
  type BaseState,
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

/**
 * Versorgung für die Basis: Augenblick, Stromkurve über forecastHours (Angebot nach Quelle, Bedarf nach Rang,
 * Speicherstand, Wetter am Hafen) und die erste Mangelwarnung („Ab 23 Uhr fehlen 40 Strom – Radar eingeschränkt“;
 * die Uhrzeit setzt die Oberfläche in Ortszeit).
 */
export function gridView(state: BaseState, nowMs: number, mods?: Modifiers) {
  const now = powerAt(state, nowMs, balance, mods);
  const hours = powerBalance(balance).forecastHours;
  const curve = powerForecast(state, nowMs, hours, balance, mods);
  let warning: { atMs: number; missing: number; rank: PowerRankKey; text: string } | null = null;
  for (const h of curve) {
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
    })),
    warning,
    stormFrom: wb?.stormFrom ?? 0.8,
    stormWarning: curve.find((h) => h.storm)?.atMs ?? null,
  };
}
