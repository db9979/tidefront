// Lagebild Stufe 3 (docs/REGELN-LAGEBILD.md 5.6, 6): Satelliten (Bahn, Überflug, Streifen), Startrampe und Raumfahrt,
// Gegenmittel (Tarnnetze, Störsender, Tarnanstrich auf Flugzeuge, Funkdisziplin des Admirals). Rein und deterministisch;
// Server (packages/engine/src/intel-sat*.ts, intel-counter.ts) und Oberfläche rechnen mit denselben Funktionen.
// Strecken in Projektions-Kilometern (x nach Osten); die Kartenbreite gibt der Aufrufer mit (game-core kennt die Welt nicht).
import type { Balance, BaseState, ResourceMap, Result } from "./types.ts";
import type { IntelBalance, IntelLevel } from "./intel.ts";
import { hasResources } from "./economy.ts";

export type SatelliteType = "optisch" | "radar";

/** Eine Satellitenart (Raumfahrt-Technik, Startkosten, Kenntnisstufe). */
export interface SatelliteTypeBalance {
  /** Technik im Zweig Raumfahrt, die den Start erlaubt. */
  tech: string;
  cost: ResourceMap;
  /** Kenntnisstufe im Streifen: optisch Erkennung, Radar Sichtung. */
  level: IntelLevel;
  /** Nur optisch: Felder mit Bewölkung über diesem Wert bleiben verdeckt (Radar: fehlt, sieht durch Wolken und Nebel). */
  cloudMax?: number;
  /** v1.35: eigene Lebensdauer dieser Art in Stunden (optisch 336 = 14 Tage); fehlt sie, gilt lifetimeHours des Blocks. */
  lifetimeHours?: number;
}

/** Balance-Block `intel.satellite` (seit v1.23). */
export interface SatelliteBalance {
  /** Gebäude, von dem aus gestartet wird (Startrampe). */
  launchpad: string;
  types: Record<SatelliteType, SatelliteTypeBalance>;
  lifetimeHours: number;
  /** Bahn: alle periodHours ein Überflug über einen Nord-Süd-Streifen von stripKm Breite, je Überflug shiftKm nach Westen. */
  periodHours: number;
  stripKm: number;
  shiftKm: number;
  /** So lange ist der Streifen je Überflug live, danach „bekannt“. */
  liveMinutes: number;
  /** Höchstzahl gleichzeitig je Spieler, mit der Technik `moreTech` maxMore. */
  max: number;
  maxMore: number;
  moreTech: string;
  /** Startrampe: Startkosten −discountPerLevel je Stufe über 1, höchstens discountMax. */
  discountPerLevel?: number;
  discountMax?: number;
}

/** Gegenmittel (6), Balance-Block `intel.counter` (seit v1.23). */
export interface CounterBalance {
  /** Tarnnetze (Zweig Heer): Ausguck und optische Satelliten erkennen den Hafen nur als Sichtung; ab fieldsFromLevel auch Felder und Posten. */
  camoTech: string;
  camoFieldsFromLevel: number;
  /** Störsender (Hafengebäude): fremdes Radar im Umkreis radiusKm −perLevel je Stufe, höchstens max; erkennbar für fremdes Radar in revealKm. */
  jammer: string;
  jammerRadiusKm: number;
  jammerPerLevel: number;
  jammerMax: number;
  jammerRevealKm: number;
  /** Tarnanstrich: Sichtweite fremder Sensoren auf eigene Flugzeuge −paintPerLevel je Stufe. */
  paintTech: string;
  paintPerLevel: number;
  /** Admiral mit Spezialisierung `admiralSpec`: Radar-Sichtweite fremder Sensoren auf seinen Verband × admiralRadarFactor. */
  admiralSpec: string;
  admiralRadarFactor: number;
}

/** Ein gestarteter Satellit (im Zustand des Hafens mit der Startrampe; Bahnwerte beim Start festgeschrieben). */
export interface SatelliteState {
  id: number;
  type: SatelliteType;
  launchedAtMs: number;
  expiresAtMs: number;
  /** Mitte des ersten Streifens (Projektions-km); danach je Überflug shiftKm nach Westen, über den Kartenrand zurück. */
  x0: number;
  periodMs: number;
  stripKm: number;
  shiftKm: number;
  liveMs: number;
  /** Zähler für den Abschlussbericht: Überflüge, erfasste Objekte, unter Wolken verdeckte Objekte. */
  passes?: number;
  seen?: number;
  clouded?: number;
  /** Letzter Überflug (Zusammenfassung im Lagebild). */
  last?: { k: number; atMs: number; seen: number; clouded: number; nests: number; bases: number; fleets: number };
}

export interface SatPass {
  /** Nummer des Überflugs (1 = erster). */
  k: number;
  startMs: number;
  endMs: number;
  /** Streifen in Projektions-km, auf die Karte beschnitten. */
  x0: number;
  x1: number;
}

export const satelliteOf = (ib: IntelBalance | undefined): SatelliteBalance | null => ib?.satellite ?? null;
export const counterOf = (ib: IntelBalance | undefined): CounterBalance | null => ib?.counter ?? null;

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Überflug k (ab 1) eines Satelliten; null, wenn er erst nach dem Ende der Lebensdauer läge. */
export function satPass(s: SatelliteState, k: number, mapWidthKm: number): SatPass | null {
  if (k < 1) return null;
  const startMs = s.launchedAtMs + k * s.periodMs;
  if (startMs >= s.expiresAtMs) return null;
  const center = mod(s.x0 - s.shiftKm * (k - 1), mapWidthKm);
  return { k, startMs, endMs: startMs + s.liveMs, x0: Math.max(0, center - s.stripKm / 2), x1: Math.min(mapWidthKm, center + s.stripKm / 2) };
}

/** Zahl der Überflüge in der Lebensdauer. */
export function satPassCount(s: SatelliteState): number {
  return Math.max(0, Math.ceil((s.expiresAtMs - s.launchedAtMs) / s.periodMs) - 1);
}

/** Überflug, der jetzt live ist (Start ≤ jetzt < Start + liveMs), sonst null. */
export function currentPass(s: SatelliteState, nowMs: number, mapWidthKm: number): SatPass | null {
  const k = Math.floor((nowMs - s.launchedAtMs) / s.periodMs);
  const p = satPass(s, k, mapWidthKm);
  return p && nowMs >= p.startMs && nowMs < p.endMs ? p : null;
}

/** Nächster Überflug nach jetzt (null: keiner mehr in der Lebensdauer). */
export function nextPass(s: SatelliteState, nowMs: number, mapWidthKm: number): SatPass | null {
  const k = Math.max(1, Math.floor((nowMs - s.launchedAtMs) / s.periodMs) + 1);
  return satPass(s, k, mapWidthKm);
}

/** Aktive Satelliten (noch nicht abgelaufen). */
export function activeSatellites(state: BaseState, nowMs: number): SatelliteState[] {
  return (state.satellites ?? []).filter((s) => s.expiresAtMs > nowMs);
}

/** Höchstzahl gleichzeitiger Satelliten: max, mit Raumfahrt 2 (Technik moreTech) maxMore. */
export function satelliteLimit(techs: Record<string, number>, sb: SatelliteBalance): number {
  return (techs[sb.moreTech] ?? 0) >= 1 ? sb.maxMore : sb.max;
}

/** Startkosten bei Startrampe der Stufe `padLevel`: Grundkosten −discountPerLevel je Stufe über 1 (höchstens discountMax). */
export function satelliteCost(def: SatelliteTypeBalance, padLevel: number, sb: SatelliteBalance): ResourceMap {
  const off = Math.min(sb.discountMax ?? 0, (sb.discountPerLevel ?? 0) * Math.max(0, padLevel - 1));
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(def.cost)) out[r] = Math.ceil(v * (1 - off));
  return out;
}

/**
 * Darf der Hafen einen Satelliten dieser Art starten? active: Satelliten des Spielers in allen Häfen.
 * Codes: sat_off, sat_type, sat_pad, sat_tech, sat_limit, insufficient_resources.
 */
export function satelliteLaunchCheck(
  state: BaseState, type: string, techs: Record<string, number>, active: number, balance: Balance,
): Result<{ cost: ResourceMap; def: SatelliteTypeBalance; sb: SatelliteBalance }> {
  const sb = satelliteOf(balance.intel);
  if (!sb) return { ok: false, code: "sat_off" };
  const def = (sb.types as Record<string, SatelliteTypeBalance | undefined>)[type];
  if (!def) return { ok: false, code: "sat_type" };
  const pad = state.buildings[sb.launchpad] ?? 0;
  if (pad < 1) return { ok: false, code: "sat_pad" };
  if ((techs[def.tech] ?? 0) < 1) return { ok: false, code: "sat_tech" };
  if (active >= satelliteLimit(techs, sb)) return { ok: false, code: "sat_limit" };
  const cost = satelliteCost(def, pad, sb);
  if (!hasResources(state.resources, cost)) return { ok: false, code: "insufficient_resources" };
  return { ok: true, cost, def, sb };
}

/** Lebensdauer einer Satellitenart in Stunden (eigener Wert der Art, sonst der des Blocks). */
export function satelliteLifetimeHours(sb: SatelliteBalance, type: SatelliteType): number {
  return sb.types[type]?.lifetimeHours ?? sb.lifetimeHours;
}

/** Neuer Satellit: erster Streifen über dem Starthafen (x), Bahnwerte aus der Balance. */
export function newSatellite(id: number, type: SatelliteType, x: number, nowMs: number, sb: SatelliteBalance): SatelliteState {
  return {
    id, type, launchedAtMs: nowMs, expiresAtMs: nowMs + satelliteLifetimeHours(sb, type) * 3600000, x0: x,
    periodMs: sb.periodHours * 3600000, stripKm: sb.stripKm, shiftKm: sb.shiftKm, liveMs: sb.liveMinutes * 60000,
    passes: 0, seen: 0, clouded: 0,
  };
}

// ---------------------------------------------------------------- Gegenmittel

/** Ein Störsender (Hafen) in Projektions-km mit seiner Minderung (0 … max). */
export interface Jammer {
  x: number;
  y: number;
  playerId: number;
  reduction: number;
}

/** Minderung eines Störsenders der Stufe `level` (bei Strommangel aus). */
export function jammerReduction(level: number, powered: boolean, cb: CounterBalance): number {
  if (level < 1 || !powered) return 0;
  return Math.min(cb.jammerMax, cb.jammerPerLevel * level);
}

/**
 * Faktor auf fremdes Radar an einem Punkt: 1 − Minderung aller Störsender (nicht der eigenen Partei) im Umkreis,
 * zusammen höchstens jammerMax.
 */
export function jammerFactorAt(x: number, y: number, jammers: readonly Jammer[], party: ReadonlySet<number>, cb: CounterBalance): number {
  let red = 0;
  const r2 = cb.jammerRadiusKm * cb.jammerRadiusKm;
  for (const j of jammers) {
    if (party.has(j.playerId) || j.reduction <= 0) continue;
    if ((j.x - x) ** 2 + (j.y - y) ** 2 <= r2) red += j.reduction;
  }
  return 1 - Math.min(cb.jammerMax, red);
}

/** Tarnanstrich: Faktor auf die Sichtweite fremder Sensoren für einen Verband nur aus Flugzeugen (mindestens 0,2). */
export function paintFactor(level: number, cb: CounterBalance): number {
  return Math.max(0.2, 1 - cb.paintPerLevel * Math.max(0, level));
}

/** Wirkt das Tarnnetz der Stufe `level` auf die Objektart? Häfen ab Stufe 1, Felder und Posten ab camoFieldsFromLevel. */
export function camoActive(level: number, kind: "base" | "field" | "post", cb: CounterBalance): boolean {
  if (level < 1) return false;
  return kind === "base" || level >= cb.camoFieldsFromLevel;
}
