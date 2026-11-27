// Wettervorhersage (v1.18): Das tatsächliche Wetter (weather.ts) bleibt unverändert und gilt für Kampf, Strom und
// Reise. Vorhersagen (Stromkurve, Sturmwarnung, Wetter am Ziel in der Missionsplanung) weichen davon ab, und zwar
// umso mehr, je weiter sie vorausschauen. Die Abweichung ist deterministisches Rauschen je Ausgabezeitpunkt: Alle
// `issueEveryHours` Stunden wird die Vorhersage neu „ausgegeben“, dazwischen bleibt ihr Fehlermuster fest (nichts
// flackert). Drei Fehlerquellen: zeitliche Verschiebung der Systeme (das Wetter kommt früher oder später),
// Wind und Nebel relativ, Bewölkung absolut. Das Rauschen ist um 0 symmetrisch, die Vorhersage im Mittel unverzerrt.
// Funkmesstechnik und Radarstation verringern die Unsicherheit (forecastSkill).
import type { BaseState, GeoPoint } from "./types.ts";
import { combatWeatherOf, daylightAt, weatherAt, weatherNoise, type CombatWeather, type Weather, type WeatherBalance } from "./weather.ts";

const HOUR_MS = 3600000;
/** Verstärkung des Rauschens (Spitzen werden bei ±1 gekappt; mittlerer Betrag ≈ 0,55 des Höchstwerts). */
const GAIN = 2;

/** Werte unter `weather.forecast` in balance.json. */
export interface ForecastBalance {
  /** Alle so viele Stunden wird die Vorhersage neu ausgegeben (neues Fehlermuster). */
  issueEveryHours: number;
  /** Wind: höchste relative Abweichung je 3 h Vorlauf und gesamt (0,05 / 0,3 = ±5 % je 3 h, höchstens ±30 %). */
  windPer3h: number;
  windMax: number;
  /** Bewölkung: höchste absolute Abweichung je 3 h Vorlauf und gesamt (Anteil 0–1). */
  cloudsPer3h: number;
  cloudsMax: number;
  /** Nebel: höchste relative Abweichung je 3 h Vorlauf und gesamt. */
  fogPer3h: number;
  fogMax: number;
  /** Zeitliche Verschiebung der Wettersysteme: Stunden je 3 h Vorlauf und höchstens. */
  shiftPer3h: number;
  shiftMaxHours: number;
  /** Forschung, die die Vorhersage verbessert, und ihr Abschlag auf die Unsicherheit je Stufe. */
  skillTech: string;
  skillPerLevel: number;
  /** Abschlag mit Radarstation (ab Stufe 1). */
  radarBonus: number;
  /** Untergrenze des Unsicherheitsfaktors. */
  minFactor: number;
  /** Die Spannbreite nutzt diesen Teil der Höchstabweichung (0,8: deckt etwa 4 von 5 Fällen, statt immer sehr breit). */
  bandShare: number;
}

/** Höchstabweichung bei Vorlauf `leadH` (Stunden) und Unsicherheitsfaktor `factor`. */
export interface ForecastSpread {
  wind: number;
  clouds: number;
  fog: number;
  shiftH: number;
}

/** Wertebereich einer Vorhersage: [niedrig, hoch] je Größe. */
export interface ForecastRange {
  wind: [number, number];
  clouds: [number, number];
  fog: [number, number];
  /** Sturm ist im Bereich möglich bzw. sicher (auch der untere Wind erreicht stormFrom). */
  stormPossible: boolean;
  stormCertain: boolean;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Unsicherheitsfaktor eines Hafens: 1 − skillPerLevel · Stufe der Funkmesstechnik − radarBonus (mit Radarstation),
 * nicht unter minFactor. 1 ohne Vorhersage-Block.
 */
export function forecastSkill(base: BaseState | null | undefined, wb: WeatherBalance | undefined): number {
  const fb = wb?.forecast;
  if (!fb || !base) return 1;
  const level = base.research?.levels[fb.skillTech] ?? 0;
  const radar = (base.buildings.radarstation ?? 0) >= 1 ? fb.radarBonus : 0;
  return Math.max(fb.minFactor, 1 - fb.skillPerLevel * level - radar);
}

/** Höchstabweichung bei `leadH` Stunden Vorlauf; alles 0 ohne Vorhersage-Block oder ohne Vorlauf. */
export function forecastSpread(leadH: number, wb: WeatherBalance, factor = 1): ForecastSpread {
  const fb = wb.forecast;
  if (!fb || leadH <= 0) return { wind: 0, clouds: 0, fog: 0, shiftH: 0 };
  const steps = leadH / 3;
  return {
    wind: Math.min(fb.windMax, fb.windPer3h * steps) * factor,
    clouds: Math.min(fb.cloudsMax, fb.cloudsPer3h * steps) * factor,
    fog: Math.min(fb.fogMax, fb.fogPer3h * steps) * factor,
    shiftH: Math.min(fb.shiftMaxHours, fb.shiftPer3h * steps) * factor,
  };
}

/** Ausgabezeitpunkt der Vorhersage, die um `nowMs` gilt. */
export function forecastIssuedAt(nowMs: number, wb: WeatherBalance): number {
  const every = (wb.forecast?.issueEveryHours ?? 3) * HOUR_MS;
  return Math.floor(nowMs / every) * every;
}

/** Fehlerrauschen der Ausgabe `issued` für Größe `k` an Ort und Zielzeit, in [−1, 1], symmetrisch um 0. */
function errorNoise(wb: WeatherBalance, issued: number, k: number, point: GeoPoint, ms: number): number {
  let seed = Math.imul(wb.seed ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  seed = Math.imul(seed ^ Math.floor(issued / HOUR_MS), 0x85ebca6b) >>> 0;
  seed = Math.imul(seed ^ (k * 0x27d4eb2d), 0xc2b2ae35) >>> 0;
  const v = GAIN * weatherNoise(seed, point.lon / 6, point.lat / 6, ms / HOUR_MS / 8);
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Vorhergesagtes Wetter an `point` zur Zeit `ms`, ausgegeben um `nowMs` (Vorlauf ms − nowMs).
 * Für die Gegenwart und Vergangenheit (und ohne Vorhersage-Block) das tatsächliche Wetter.
 */
export function forecastWeatherAt(point: GeoPoint, ms: number, nowMs: number, wb: WeatherBalance, factor = 1): Weather {
  const leadH = (ms - nowMs) / HOUR_MS;
  const s = forecastSpread(leadH, wb, factor);
  if (!wb.forecast || leadH <= 0 || factor <= 0) return weatherAt(point, ms, wb);
  const issued = forecastIssuedAt(nowMs, wb);
  const shifted = weatherAt(point, ms + errorNoise(wb, issued, 1, point, ms) * s.shiftH * HOUR_MS, wb);
  const wind = clamp01(shifted.wind * (1 + errorNoise(wb, issued, 2, point, ms) * s.wind));
  const clouds = clamp01(shifted.clouds + errorNoise(wb, issued, 3, point, ms) * s.clouds);
  const fog = clamp01(shifted.fog * (1 + errorNoise(wb, issued, 4, point, ms) * s.fog));
  return { wind, clouds, fog, daylight: daylightAt(point.lat, point.lon, ms), storm: wind >= wb.stormFrom };
}

/**
 * Spannbreite der Vorhersage: Vorhersage über das Zeitfenster ±shiftH (das Wetter kann früher oder später kommen),
 * erweitert um die Abweichung von Wind, Bewölkung und Nebel, beides mit dem Anteil bandShare der Höchstwerte.
 * Der tatsächliche Wert liegt bei 0,8 in etwa 4 von 5 Fällen darin (Simulation: 79–89 %, mit dem Vorlauf steigend).
 */
export function forecastRange(point: GeoPoint, ms: number, nowMs: number, wb: WeatherBalance, factor = 1): ForecastRange {
  const s = forecastSpread((ms - nowMs) / HOUR_MS, wb, factor * (wb.forecast?.bandShare ?? 1));
  const pts = s.shiftH > 0 ? [ms - s.shiftH * HOUR_MS, ms, ms + s.shiftH * HOUR_MS] : [ms];
  const ws = pts.map((t) => forecastWeatherAt(point, Math.max(nowMs, t), nowMs, wb, factor));
  const lo = (f: (w: Weather) => number) => Math.min(...ws.map(f));
  const hi = (f: (w: Weather) => number) => Math.max(...ws.map(f));
  const wind: [number, number] = [clamp01(lo((w) => w.wind) / (1 + s.wind)), clamp01(hi((w) => w.wind) / Math.max(0.01, 1 - s.wind))];
  const clouds: [number, number] = [clamp01(lo((w) => w.clouds) - s.clouds), clamp01(hi((w) => w.clouds) + s.clouds)];
  const fog: [number, number] = [clamp01(lo((w) => w.fog) / (1 + s.fog)), clamp01(hi((w) => w.fog) / Math.max(0.01, 1 - s.fog))];
  return { wind, clouds, fog, stormPossible: wind[1] >= wb.stormFrom, stormCertain: wind[0] >= wb.stormFrom };
}

/**
 * Kampfwetter zur Ankunft aus der Vorhersage (Probekampf, „Lohnende Ziele“): Mitte der Spannbreite von Wind und
 * Bewölkung. Für Gegenwart und Vergangenheit das tatsächliche Wetter.
 */
export function forecastCombatWeather(point: GeoPoint, ms: number, nowMs: number, wb: WeatherBalance, factor = 1): CombatWeather {
  const r = forecastRange(point, ms, nowMs, wb, factor);
  return combatWeatherOf({ wind: (r.wind[0] + r.wind[1]) / 2, clouds: (r.clouds[0] + r.clouds[1]) / 2 }, wb);
}
