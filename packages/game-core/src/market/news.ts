// Marktnachrichten: Einflüsse der Welt auf den Richtwert (ref) je Ressource. Rein und deterministisch.
// Ein Einfluss verschiebt den Richtwert um einen Anteil (pct, +0,12 = +12 %) von startMs bis endMs und klingt danach
// über fadeMs linear ab. Alle Einflüsse einer Ressource werden addiert und auf ±maxTotal gedeckelt (Zielversatz).
// Der effektive Versatz folgt dem Zielversatz höchstens maxChangePerHour je Stunde (sanft). Effektiver Richtwert =
// Grundrichtwert × (1 + Versatz). Den Kurs verschieben Nachrichten nicht direkt: er folgt dem effektiven Richtwert
// über die Rückkehrformel (pricing.ts). Ohne Einflüsse ist der Versatz exakt 0 und alles bit-gleich wie ohne Nachrichten.
import type { MarketNewsBalance } from "./types.ts";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Ein Einfluss auf den Richtwert einer Ressource. */
export interface MarketInfluence {
  resource: string;
  /** Anteil am Grundrichtwert, z. B. 0,12 = +12 %, −0,1 = −10 %. */
  pct: number;
  startMs: number;
  /** Ende der vollen Wirkung; danach linear abklingend über fadeMs. */
  endMs: number;
  fadeMs: number;
}

/** Gespeicherter effektiver Versatz je Ressource (Anteil am Grundrichtwert) zum Zeitpunkt atMs. */
export interface RefOffsets {
  atMs: number;
  offset: Record<string, number>;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Wirkung eines Einflusses zu nowMs: vor dem Beginn 0, bis endMs voll, danach linear bis 0 nach fadeMs. */
export function influenceAt(inf: MarketInfluence, nowMs: number): number {
  if (!finite(inf.pct) || nowMs < inf.startMs) return 0;
  if (nowMs <= inf.endMs) return inf.pct;
  if (!(inf.fadeMs > 0)) return 0;
  const left = 1 - (nowMs - inf.endMs) / inf.fadeMs;
  return left > 0 ? inf.pct * left : 0;
}

/** Zeitpunkt, ab dem ein Einfluss nichts mehr bewirkt. */
export function influenceEndsMs(inf: MarketInfluence): number {
  return inf.endMs + Math.max(0, inf.fadeMs);
}

/** Zielversatz je Ressource: Summe aller Wirkungen, gedeckelt auf ±maxTotal. Ressourcen ohne Einfluss: exakt 0. */
export function targetOffsets(
  influences: readonly MarketInfluence[],
  resources: readonly string[],
  nowMs: number,
  maxTotal: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of resources) out[r] = 0;
  for (const inf of influences) {
    if (!Object.hasOwn(out, inf.resource)) continue;
    out[inf.resource] += influenceAt(inf, nowMs);
  }
  const cap = Math.max(0, maxTotal);
  for (const r of resources) out[r] = out[r] === 0 ? 0 : clamp(out[r], -cap, cap);
  return out;
}

/**
 * Schreibt den effektiven Versatz von prev.atMs auf nowMs fort: je Ressource höchstens maxChangePerHour × Stunden
 * Richtung Ziel, nie über ±maxTotal. Ohne vorherigen Stand beginnt er bei 0 (ohne Bewegung). Läuft die Zeit
 * rückwärts, bleibt der Stand.
 */
export function stepOffsets(
  prev: RefOffsets | null,
  target: Readonly<Record<string, number>>,
  nowMs: number,
  maxChangePerHour: number,
  maxTotal: number,
): RefOffsets {
  const fromMs = prev?.atMs ?? nowMs;
  const dt = Math.max(0, nowMs - fromMs);
  const maxStep = Math.max(0, maxChangePerHour) * (dt / MS_PER_HOUR);
  const cap = Math.max(0, maxTotal);
  const offset: Record<string, number> = {};
  const before = prev?.offset ?? {};
  const keys = new Set([...Object.keys(target), ...Object.keys(before)]);
  for (const r of keys) {
    const o = finite(before[r]) ? before[r] : 0;
    const t = finite(target[r]) ? target[r] : 0;
    const next = o + clamp(t - o, -maxStep, maxStep);
    offset[r] = next === 0 ? 0 : clamp(next, -cap, cap);
  }
  return { atMs: Math.max(fromMs, nowMs), offset };
}

/** Effektiver Richtwert je Ressource: Grundrichtwert × (1 + Versatz). Versatz 0 oder fehlend: exakt der Grundrichtwert. */
export function effectiveRefPrices(
  baseRef: Readonly<Record<string, number>>,
  offsets: Readonly<Record<string, number>> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, ref] of Object.entries(baseRef)) {
    const o = offsets?.[r];
    out[r] = finite(o) && o !== 0 ? ref * (1 + o) : ref;
  }
  return out;
}

// ---------------------------------------------------------------- Anlässe

/** Großflotte: Wirkung je Ressource, mit dem Stärkefaktor des Ereignisses skaliert, höchstens maxPct. */
export function grossflottePcts(strength: number, cfg: MarketNewsBalance["worldEvents"]["grossflotte"]): Record<string, number> {
  const f = finite(strength) && strength > 0 ? strength : 1;
  const out: Record<string, number> = {};
  for (const [r, pct] of Object.entries(cfg.pct)) out[r] = Math.sign(pct) * Math.min(cfg.maxPct, Math.abs(pct) * f);
  return out;
}

/** Kriegslage: ruhige Lage = calm (z. B. −4 %), je laufendem Krieg und je Kartell-Überfall (24 h) mehr, höchstens max. */
export function warPct(wars: number, raids: number, cfg: MarketNewsBalance["war"]): number {
  const w = Math.max(0, finite(wars) ? wars : 0);
  const r = Math.max(0, finite(raids) ? raids : 0);
  return clamp(cfg.calm + cfg.perWar * w + cfg.perRaid * r, Math.min(cfg.calm, 0), cfg.max);
}

/** Ein aktiver Hafen für die Knappheit: Bestand, Lagerkapazität und Netto-Produktion je Stunde einer Ressource. */
export interface ScarcityBase {
  stock: number;
  capacity: number;
  netPerHour: number;
}

export function median(values: readonly number[]): number {
  const v = values.filter(finite).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Knappheitsindex einer Ressource (ein Tageswert), robust gegen einzelne Spieler:
 * Füllstand = Median der Bestände / Median der Lagerkapazitäten (höchstens 1), Defizitanteil = Anteil der Häfen mit
 * negativer Netto-Produktion (Verbrauch über Produktion). Index = fillWeight × (neutralFill − Füllstand)
 * + deficitWeight × Defizitanteil, gedeckelt auf ±max. Weniger als minBases Häfen: null (keine Wirkung).
 */
export function scarcityIndex(bases: readonly ScarcityBase[], cfg: MarketNewsBalance["scarcity"]): number | null {
  const valid = bases.filter((b) => finite(b.stock) && finite(b.capacity) && b.capacity > 0 && finite(b.netPerHour));
  if (valid.length < Math.max(1, cfg.minBases)) return null;
  const cap = median(valid.map((b) => b.capacity));
  const fill = Math.min(1, Math.max(0, median(valid.map((b) => b.stock)) / cap));
  const deficit = valid.filter((b) => b.netPerHour < 0).length / valid.length;
  const idx = cfg.fillWeight * (cfg.neutralFill - fill) + cfg.deficitWeight * deficit;
  return clamp(idx, -cfg.max, cfg.max);
}

/** Gleitender Mittelwert der letzten `window` Tageswerte, gedeckelt auf ±max; leer: 0. */
export function smoothScarcity(history: readonly number[], window: number, max: number): number {
  const last = history.filter(finite).slice(-Math.max(1, Math.floor(window)));
  if (last.length === 0) return 0;
  return clamp(last.reduce((a, b) => a + b, 0) / last.length, -max, max);
}

/**
 * Saisonende: in den letzten `days` Tagen steigt die Wirkung tageweise (Tag 1 von 7: 1/7, …, letzter Tag: voll).
 * Davor und nach dem Ende: 0.
 */
export function seasonEndFactor(nowMs: number, seasonEndMs: number, days: number): number {
  if (!(days > 0) || nowMs >= seasonEndMs) return 0;
  const from = seasonEndMs - days * MS_PER_DAY;
  if (nowMs < from) return 0;
  const day = Math.min(days, Math.floor((nowMs - from) / MS_PER_DAY) + 1);
  return day / days;
}

/** Auf 0,1 Prozentpunkte gerundet (gegen unnötige neue Nachrichten bei winzigen Änderungen). */
export function roundPct(pct: number): number {
  return Math.round(pct * 1000) / 1000;
}
