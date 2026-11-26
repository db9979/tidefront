// Wetter (seit v1.6, Modell überarbeitet in v1.9): deterministisches Wetterfeld über der Karte, rein aus Ort, Zeit
// und Seed. Wenige ziehende Wettersysteme: Tiefs ziehen nach Nordost (stärkster Wind im Ring um den Kern und an der
// Südflanke, im Winter kräftiger), Hochs ziehen langsam und leben länger. Dazu regionale Klimatendenzen (Nordatlantik
// windiger und wolkiger, Mittelmeer sonniger, regionale Winde: Mistral, Meltemi, Levante bei Gibraltar, Bora),
// weiches Rauschen über Raum und Zeit, Nebel an den Nebelküsten (jahreszeitlich) und Tageslicht aus dem Sonnenstand.
// Einzige Zufallsquelle: mulberry32.
import type { GeoPoint } from "./types.ts";
import { mulberry32 } from "./rng.ts";

const HOUR_MS = 3600000;
const RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

/** Werte unter `weather` in balance.json. */
export interface WeatherBalance {
  /** Grund-Seed des Wetters; zusammen mit dem Zeitfenster eines Systems ergibt er dessen Seed. */
  seed: number;
  /** Alle so viele Stunden entsteht ein neues Wettersystem im Westen. */
  systemEveryHours: number;
  /** Lebensdauer eines Tiefs in Stunden (Stärke steigt und fällt sinusförmig). */
  systemLifeHours: number;
  /** Lebensdauer eines Hochs in Stunden (je System ±10 % gestreut); fehlt der Wert, wie Tiefs. */
  highLifeHours?: number;
  /** Sturm ab dieser Windstärke (0–1). */
  stormFrom: number;
  /** Schiffe: Bremsung beginnt ab diesem Wind und ist ab `shipSlowFull` voll (`shipSlowMax`, 0,3 = +30 % Reisezeit). */
  shipSlowFrom: number;
  shipSlowFull: number;
  shipSlowMax: number;
  /** Stützstellen entlang der Route (gleichmäßig, Start und Ziel eingeschlossen). */
  routeSamples: number;
  /** Kampf: Angriff der Flugzeuge mal (1 − airStormPenalty · Sturmanteil am Kampfort). */
  airStormPenalty: number;
  /** Kampf: Luftschlag der Bomber mal (1 − cloudStrikePenalty · Bewölkung am Kampfort). */
  cloudStrikePenalty: number;
  /** Radar: Vorwarnzeit mal (1 − fogRadarMax · Nebel am Hafen). */
  fogRadarMax: number;
  /** Aufklärung: ab diesem Nebel ist das Lagebild unsicher (gerundet), ab `fogScoutHeavy` grob gerundet. */
  fogScoutFrom: number;
  fogScoutHeavy: number;
}

/** Wetter an einem Ort zu einem Zeitpunkt; alle Größen 0–1. */
export interface Weather {
  wind: number;
  clouds: number;
  fog: number;
  /** Tageslicht aus dem Sonnenstand (Sinus der Sonnenhöhe, nachts 0). */
  daylight: number;
  /** Wind ≥ stormFrom. */
  storm: boolean;
}

interface WeatherSystem {
  /** Entstehung in Stunden seit Epoche. */
  bornH: number;
  lat0: number;
  lon0: number;
  /** Zug in Grad je Stunde. */
  vLat: number;
  vLon: number;
  radiusKm: number;
  /** Lebensdauer in Stunden. */
  lifeH: number;
  /** +1 Tief (Wind, Wolken), −1 Hoch (ruhig, klar). */
  sign: number;
  intensity: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash32(a: number, b: number, c = 0, d = 0): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  for (const v of [b, c, d]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------- Wettersysteme

const systemCache = new Map<string, WeatherSystem>();

/** System des Zeitfensters `slot` (je systemEveryHours eines), deterministisch aus Seed und Fenster. */
function systemOf(slot: number, wb: WeatherBalance): WeatherSystem {
  const key = `${wb.seed}:${slot}`;
  const hit = systemCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(hash32(wb.seed, slot, 7));
  const low = rng() < 0.66;
  // Tiefs entstehen über dem Westatlantik und ziehen nach Nordost; Hochs (Azorenhoch) wandern langsam.
  const lat0 = low ? 44 + 18 * rng() : 30 + 16 * rng();
  const lon0 = low ? -62 + 32 * rng() : -55 + 30 * rng();
  const speedKmh = low ? 32 + 28 * rng() : 5 + 10 * rng();
  const vLon = speedKmh / (KM_PER_DEG * Math.cos(lat0 * RAD));
  const vLat = low ? 0.02 + 0.06 * rng() : (rng() - 0.5) * 0.04;
  const sys: WeatherSystem = {
    bornH: slot * wb.systemEveryHours + rng() * wb.systemEveryHours,
    lat0,
    lon0,
    vLat,
    vLon,
    radiusKm: low ? 450 + 550 * rng() : 800 + 700 * rng(),
    lifeH: low ? wb.systemLifeHours : (wb.highLifeHours ?? wb.systemLifeHours) * (0.9 + 0.2 * rng()),
    sign: low ? 1 : -1,
    intensity: 0.55 + 0.45 * rng(),
  };
  if (systemCache.size > 4000) systemCache.clear();
  systemCache.set(key, sys);
  return sys;
}

/** Aktive Systeme zur Stunde `h` mit Lebensphase (0–1, sinusförmig). */
function activeSystems(h: number, wb: WeatherBalance): { sys: WeatherSystem; env: number }[] {
  const out: { sys: WeatherSystem; env: number }[] = [];
  const maxLife = Math.max(wb.systemLifeHours, 1.1 * (wb.highLifeHours ?? 0));
  const first = Math.floor((h - maxLife) / wb.systemEveryHours) - 1;
  const last = Math.floor(h / wb.systemEveryHours);
  for (let k = first; k <= last; k++) {
    const sys = systemOf(k, wb);
    const age = h - sys.bornH;
    if (age <= 0 || age >= sys.lifeH) continue;
    out.push({ sys, env: Math.sin((Math.PI * age) / sys.lifeH) ** 0.7 });
  }
  return out;
}

// ---------------------------------------------------------------- Rauschen über Raum und Zeit

function lattice(seed: number, x: number, y: number, z: number): number {
  return hash32(seed, x, y, z) / 4294967296;
}

/** Weiches Wertrauschen in [−1, 1] (trilinear, geglättet). */
function noise3(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  let v = 0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
        v += w * lattice(seed, x0 + dx, y0 + dy, z0 + dz);
      }
    }
  }
  return v * 2 - 1;
}

// ---------------------------------------------------------------- Sonnenstand

/** Tag des Jahres (1–366, UTC). */
function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/** Tageslicht 0–1: Sinus der Sonnenhöhe aus Breitengrad, Uhrzeit (UTC, Länge) und Jahreszeit. */
export function daylightAt(lat: number, lon: number, ms: number): number {
  const doy = dayOfYear(ms);
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const utcH = (((ms / HOUR_MS) % 24) + 24) % 24;
  const hourAngle = 15 * RAD * (utcH + lon / 15 - 12);
  const sinEl = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle);
  return clamp01(sinEl);
}

// ---------------------------------------------------------------- Klima

/** Gauß-Glocke um einen Punkt (Radius in Grad). */
function bump(lat: number, lon: number, cLat: number, cLon: number, r: number): number {
  const dx = (lon - cLon) * Math.cos(cLat * RAD);
  const dy = lat - cLat;
  return Math.exp(-(dx * dx + dy * dy) / (r * r));
}

/** Mittelmeer und Nordafrika (weicher Übergang). */
function medShare(lat: number, lon: number): number {
  return smooth(47, 42, lat) * smooth(-9, -4, lon) * smooth(40, 34, lon);
}

/** Jahreszeit: +1 Mitte Januar (Winter der Nordhalbkugel), −1 Mitte Juli. */
export function seasonAt(ms: number): number {
  return Math.cos((2 * Math.PI * (dayOfYear(ms) - 15)) / 365);
}

/**
 * Regionale Grundwerte: Wind, Wolken, Nebelneigung. Der Grundwind ist mäßig; Stürme bringen die Tiefs.
 * Regionale Winde: Mistral (Golf du Lion, Winter), Meltemi (Ägäis, Sommer), Levante/Poniente (Straße von Gibraltar),
 * Bora (Adria, Winter). Nebel an den Nebelküsten, im Sommer und in den Übergangszeiten häufiger.
 */
export function climateAt(lat: number, lon: number, ms: number): { wind: number; clouds: number; fog: number } {
  const north = smooth(40, 62, lat);
  const med = medShare(lat, lon);
  const south = smooth(36, 28, lat);
  const winter = seasonAt(ms);
  const win = Math.max(0, winter);
  const summer = Math.max(0, -winter);
  const wind = 0.27 + 0.05 * north - 0.05 * med - 0.04 * south + 0.06 * winter * (0.2 + north)
    + 0.32 * win * bump(lat, lon, 42.5, 5, 2.5) // Mistral
    + 0.22 * summer * bump(lat, lon, 38, 25.5, 3) // Meltemi
    + 0.12 * bump(lat, lon, 36, -5.5, 1.2) // Gibraltar
    + 0.1 * win * bump(lat, lon, 44, 15, 2.5); // Bora
  const clouds = 0.56 + 0.12 * north - 0.3 * med * (0.4 + summer) - 0.12 * south + 0.06 * winter;
  const fogSeason = 0.5 + 0.5 * summer + 0.25 * (1 - Math.abs(winter));
  const fog = fogSeason * Math.max(
    0.58 * bump(lat, lon, 45, -51, 5), // Neufundlandbank
    0.57 * bump(lat, lon, 55, 3, 4.5), // Nordsee
    0.45 * bump(lat, lon, 50, -4, 3), // Ärmelkanal
    0.42 * bump(lat, lon, 40, -10, 2.5), // Portugal (Auftriebsnebel)
    0.12 * north,
  );
  return { wind, clouds, fog };
}

// ---------------------------------------------------------------- Wetterfeld

const cache = new Map<string, Weather>();

/** Reine Berechnung ohne Zwischenspeicher. */
function computeWeather(lat: number, lon: number, ms: number, wb: WeatherBalance): Weather {
  const h = ms / HOUR_MS;
  const base = climateAt(lat, lon, ms);
  let windAdd = 0;
  let cloudAdd = 0;
  let calm = 0;
  const kmLon = KM_PER_DEG * Math.cos(lat * RAD);
  // Tiefs im Winter kräftiger als im Sommer.
  const season = 0.75 + 0.25 * seasonAt(ms);
  for (const { sys, env } of activeSystems(h, wb)) {
    const age = h - sys.bornH;
    const cLat = sys.lat0 + sys.vLat * age;
    const cLon = sys.lon0 + sys.vLon * age;
    const dx = (lon - cLon) * kmLon;
    const dy = (lat - cLat) * KM_PER_DEG;
    const q = (dx * dx + dy * dy) / (sys.radiusKm * sys.radiusKm);
    if (q > 9) continue;
    const g = Math.exp(-q);
    const s = sys.intensity * env;
    if (sys.sign > 0) {
      // Wind: im Kern schwächer, am stärksten im Ring um etwa einen Radius, an der Südflanke kräftiger.
      const south = 1 - 0.3 * Math.max(-1, Math.min(1, dy / sys.radiusKm));
      windAdd += 0.35 * s * season * south * (0.3 * g + 0.7 * q * Math.exp(1 - q));
      // Wolkenschirm etwas nach Osten versetzt (Warmfront voraus).
      const qc = ((dx - 0.4 * sys.radiusKm) ** 2 + dy * dy) / (sys.radiusKm * sys.radiusKm);
      cloudAdd += 0.45 * s * Math.exp(-qc / 1.7);
    } else {
      windAdd -= 0.07 * s * g;
      cloudAdd -= 0.15 * s * g;
      calm += s * g;
    }
  }
  const nx = lon / 7;
  const ny = lat / 7;
  const nt = h / 9;
  const wind = clamp01(base.wind + windAdd + 0.1 * noise3(wb.seed ^ 0x1111, nx, ny, nt));
  const clouds = clamp01(base.clouds + cloudAdd + 0.16 * noise3(wb.seed ^ 0x2222, nx, ny, nt));
  const daylight = daylightAt(lat, lon, ms);
  // Nebel: Nebelküsten, wenig Wind (bei Sturm nie), eher nachts und morgens, unter Hochdruck häufiger.
  const still = clamp01(1 - (wind - 0.2) / 0.45);
  const fogNoise = 0.5 + 0.5 * noise3(wb.seed ^ 0x3333, lon / 4, lat / 4, h / 6);
  const fog = clamp01(base.fog * still * ((0.75 + 0.25 * (1 - daylight)) * (0.6 + 0.8 * fogNoise) + 0.25 * Math.min(1, calm)));
  return { wind, clouds, fog, daylight, storm: wind >= wb.stormFrom };
}

/**
 * Wetter an einem Ort zur Zeit `ms`. Zwischengespeichert je Ort (auf 0,01° gerundet) und Minute,
 * damit Fortschreibung, Vorhersage und Karte dieselben Felder nicht mehrfach rechnen.
 */
export function weatherAt(point: GeoPoint, ms: number, wb: WeatherBalance): Weather {
  const key = `${wb.seed},${Math.round(point.lat * 100)},${Math.round(point.lon * 100)},${Math.floor(ms / 60000)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = computeWeather(point.lat, point.lon, Math.floor(ms / 60000) * 60000, wb);
  if (cache.size > 50000) cache.clear();
  cache.set(key, w);
  return w;
}

/** Sturmanteil 0–1 für Schiffe und Flugzeuge: 0 bis shipSlowFrom, linear bis shipSlowFull. */
export function stormShare(wind: number, wb: WeatherBalance): number {
  return clamp01((wind - wb.shipSlowFrom) / (wb.shipSlowFull - wb.shipSlowFrom));
}

/** Windstärke 0–1 in Beaufort (0–12): Bremsung ab 0,5 ≈ Bft 6, Sturm ab 0,8 = Bft 9. */
export function beaufort(wind: number): number {
  return Math.max(0, Math.min(12, Math.round(wind * 11.25)));
}

/** Bezeichnungen der Beaufort-Skala (Index = Bft). */
export const BEAUFORT_WORDS = [
  "Windstille", "leiser Zug", "leichte Brise", "schwache Brise", "mäßige Brise", "frische Brise", "starker Wind",
  "steifer Wind", "stürmischer Wind", "Sturm", "schwerer Sturm", "orkanartiger Sturm", "Orkan",
] as const;

/** Sonnenertrag 0–1 für Solarfelder: Tageslicht × (1 − cloudLoss · Bewölkung). */
export function sunshine(w: Weather, cloudLoss: number): number {
  return w.daylight * (1 - cloudLoss * w.clouds);
}

// ---------------------------------------------------------------- Route und Kampf

/** Wetter entlang einer Route bei Abfahrt (Grundlage für Reisezeit und Startverbot der Flugzeuge). */
export interface RouteWeather {
  /** Mittlerer Wind entlang der Route. */
  avgWind: number;
  maxWind: number;
  /** Mittlere Bewölkung und Nebel entlang der Route (Anzeige). */
  avgClouds: number;
  avgFog: number;
  /** Mittlerer Sturmanteil (0–1) entlang der Route. */
  storminess: number;
  /** Faktor auf die Reisezeit der Schiffe (1 … 1 + shipSlowMax). */
  shipFactor: number;
  /** Sturm am Start (Flugzeuge starten nicht). */
  stormAtOrigin: boolean;
  /** Wetter am Ziel zur voraussichtlichen Ankunft (nur Anzeige in der Planung; deterministisch). */
  atTarget?: ArrivalWeather;
}

/** Wetter am Ziel zur Ankunft: Nebel (Aufklärung), Wind (Luftkampf) und Wolken (Luftschlag). */
export interface ArrivalWeather {
  atMs: number;
  wind: number;
  clouds: number;
  fog: number;
  storm: boolean;
}

export function arrivalWeather(target: GeoPoint, arriveMs: number, wb: WeatherBalance): ArrivalWeather {
  const w = weatherAt(target, arriveMs, wb);
  return { atMs: arriveMs, wind: w.wind, clouds: w.clouds, fog: w.fog, storm: w.storm };
}

/** Wetter entlang der Großkreis-Näherung (lineare Interpolation) zwischen Start und Ziel zur Abfahrt. */
export function routeWeather(origin: GeoPoint, target: GeoPoint, departMs: number, wb: WeatherBalance): RouteWeather {
  const n = Math.max(2, Math.round(wb.routeSamples));
  let sw = 0, sc = 0, sf = 0, ss = 0, maxWind = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = weatherAt({ lat: origin.lat + (target.lat - origin.lat) * t, lon: origin.lon + (target.lon - origin.lon) * t }, departMs, wb);
    sw += w.wind;
    sc += w.clouds;
    sf += w.fog;
    ss += stormShare(w.wind, wb);
    maxWind = Math.max(maxWind, w.wind);
  }
  const storminess = ss / n;
  return {
    avgWind: sw / n,
    maxWind,
    avgClouds: sc / n,
    avgFog: sf / n,
    storminess,
    shipFactor: 1 + wb.shipSlowMax * storminess,
    stormAtOrigin: weatherAt(origin, departMs, wb).storm,
  };
}

/** Wetter am Kampfort als Faktoren der Luftphasen (resolveBattle, Parameter `weather`). */
export interface CombatWeather {
  /** Faktor auf allen Schaden der Flugzeuge (Luftkampf und Luftschlag). */
  air: number;
  /** Zusätzlicher Faktor auf den Luftschlag der Bomber (Wolken). */
  strike: number;
  wind: number;
  clouds: number;
  storm: boolean;
}

export function combatWeather(point: GeoPoint, ms: number, wb: WeatherBalance): CombatWeather {
  const w = weatherAt(point, ms, wb);
  return {
    air: 1 - wb.airStormPenalty * stormShare(w.wind, wb),
    strike: 1 - wb.cloudStrikePenalty * w.clouds,
    wind: w.wind,
    clouds: w.clouds,
    storm: w.storm,
  };
}

/** Faktor auf die Radar-Vorwarnzeit durch Nebel am Hafen. */
export function fogRadarFactor(fog: number, wb: WeatherBalance): number {
  return 1 - wb.fogRadarMax * clamp01(fog);
}

/** Für die Kartendarstellung: aktive Tiefs (sign +1) und Hochs (−1) zur Zeit `ms` mit Mittelpunkt und wirksamer Stärke. */
export function weatherSystemsAt(ms: number, wb: WeatherBalance): { lat: number; lon: number; radiusKm: number; sign: number; strength: number }[] {
  const h = ms / 3600000;
  return activeSystems(h, wb).map(({ sys, env }) => {
    const age = h - sys.bornH;
    return { lat: sys.lat0 + sys.vLat * age, lon: sys.lon0 + sys.vLon * age, radiusKm: sys.radiusKm, sign: sys.sign, strength: sys.intensity * env };
  });
}
