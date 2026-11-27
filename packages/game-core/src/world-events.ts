// Weltereignisse des Freibeuter-Kartells (REGELN.md, Abschnitt Weltereignisse): Schatzschiff, Großflotte,
// Belagerung. Rein: Zusammensetzung, Route und Position zum Zeitpunkt, Abfangpunkt, Beute, Schadenswertung,
// Belagerungsabzug. Werte unter balance.worldEvents.
import type { AttackerInput, Balance, BattleReport, Counts, GeoPoint, ResourceMap } from "./types.ts";
import { distanceKm } from "./geo.ts";
import { defenseHp, raidDefenseHp } from "./pirates.ts";
import { mulberry32, randomInt } from "./rng.ts";

const HOUR_MS = 3600000;

export type WorldEventKind = "schatzschiff" | "grossflotte" | "belagerung";
export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = ["schatzschiff", "grossflotte", "belagerung"];

export interface WorldEventsBalance {
  /** Abstand zwischen zwei Ereignissen [min, max] in Stunden. */
  spawnIntervalHours: [number, number];
  /** Erstes Ereignis frühestens so lange nach Saisonbeginn. */
  firstSpawnAfterHours: number;
  /** Kein geeignetes Ziel: neuer Versuch nach so vielen Stunden. */
  retryHours: number;
  /** Kein neues Ereignis, wenn die Saison in weniger Stunden endet. */
  minSeasonHoursLeft: number;
  kindWeights: Record<WorldEventKind, number>;
  /** Stärke mal (1 + seasonGrowth * Saisonfortschritt). */
  seasonGrowth: number;
  /** Untergrenze der Bezugs-Lebenspunkte (Spielerstärke). */
  minReferenceHp: number;
  /** Banner „Ereignis in der Nähe“ bis zu dieser Entfernung. */
  nearbyKm: number;
  schatzschiff: {
    durationHours: [number, number];
    routeKm: [number, number];
    spawnKmFromBase: [number, number];
    escortShareOfDefense: number;
    minEscort: number;
    loot: ResourceMap;
    lootSeasonGrowth: number;
  };
  grossflotte: {
    announceHours: number;
    attackIntervalHours: number;
    maxTargets: number;
    regionRadiusKm: number;
    shareOfDefense: number;
    minSchnellboote: number;
    miliPerBoot: number;
    lootPool: ResourceMap;
    /** v1.16 (L7): Stärke-Bezug mit den Gewichten des Kartells (`pirates.raidHpWeights`), sonst ungewichtet. */
    raidWeights?: boolean;
  };
  belagerung: {
    durationHours: number;
    productionPenalty: number;
    tickMinutes: number;
    shareOfDefense: number;
    minSchnellboote: number;
    lootPool: ResourceMap;
  };
}

/** Werte der Weltereignisse aus der Balance (Schlüssel worldEvents). */
export function worldEventsBalance(balance: Balance): WorldEventsBalance {
  const w = (balance as Balance & { worldEvents?: WorldEventsBalance }).worldEvents;
  if (w === undefined) throw new Error("balance.worldEvents fehlt");
  return w;
}

// ---------------------------------------------------------------- Planung und Stärke

/** Saisonfortschritt 0..1. */
export function seasonProgress(startMs: number, endMs: number, nowMs: number): number {
  if (endMs <= startMs) return 1;
  return Math.max(0, Math.min(1, (nowMs - startMs) / (endMs - startMs)));
}

/** Stärkefaktor nach Saisonfortschritt: 1 + seasonGrowth * Fortschritt. */
export function strengthFactor(progress: number, balance: Balance): number {
  return 1 + worldEventsBalance(balance).seasonGrowth * Math.max(0, Math.min(1, progress));
}

/** Bezugs-Lebenspunkte (Spielerstärke): Median der Verteidigungs-Lebenspunkte, mindestens minReferenceHp. */
export function referenceHp(hps: number[], balance: Balance): number {
  const min = worldEventsBalance(balance).minReferenceHp;
  if (hps.length === 0) return min;
  const s = [...hps].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.max(min, median);
}

/** Nächstes Ereignis: Zeitpunkt und Art (gewichteter Zufall aus kindWeights), deterministisch aus dem Seed. */
export function nextSpawn(nowMs: number, seed: number, balance: Balance): { atMs: number; kind: WorldEventKind } {
  const w = worldEventsBalance(balance);
  const rng = mulberry32(seed);
  const [lo, hi] = w.spawnIntervalHours;
  const hours = randomInt(rng, lo, hi);
  return { atMs: nowMs + hours * HOUR_MS, kind: pickKind(rng(), balance) };
}

/** Art nach Gewicht; u in [0, 1). */
export function pickKind(u: number, balance: Balance): WorldEventKind {
  const weights = worldEventsBalance(balance).kindWeights;
  const total = WORLD_EVENT_KINDS.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0);
  let x = u * total;
  for (const k of WORLD_EVENT_KINDS) {
    x -= Math.max(0, weights[k] ?? 0);
    if (x < 0) return k;
  }
  return WORLD_EVENT_KINDS[0];
}

function boats(refHp: number, share: number, factor: number, min: number, balance: Balance): number {
  const hp = balance.npcUnits.schnellboot.hp;
  return Math.max(min, Math.round((refHp * share * factor) / hp));
}

function scaleRes(m: ResourceMap, f: number): ResourceMap {
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(m)) out[r] = Math.round((v * f) / 10) * 10;
  return out;
}

/** Schatzschiff: Begleitschutz aus Schnellbooten und Beute, beides wächst mit dem Saisonfortschritt. */
export function composeTreasure(refHp: number, progress: number, balance: Balance): { units: Counts; loot: ResourceMap } {
  const t = worldEventsBalance(balance).schatzschiff;
  const n = boats(refHp, t.escortShareOfDefense, strengthFactor(progress, balance), t.minEscort, balance);
  return { units: { schnellboot: n }, loot: scaleRes(t.loot, 1 + t.lootSeasonGrowth * Math.max(0, Math.min(1, progress))) };
}

/** Großflotte: Schnellboote mit Miliz, Bezug sind die Zielhäfen; Beutepool wächst mit der Stärke. */
export function composeArmada(refHp: number, progress: number, balance: Balance): { units: Counts; lootPool: ResourceMap } {
  const g = worldEventsBalance(balance).grossflotte;
  const f = strengthFactor(progress, balance);
  const n = boats(refHp, g.shareOfDefense, f, g.minSchnellboote, balance);
  return { units: { schnellboot: n, piratenmiliz: n * g.miliPerBoot }, lootPool: scaleRes(g.lootPool, f) };
}

/**
 * Lebenspunkte eines Zielhafens als Bezug der Großflotte. Sie landet wie das Kartell Miliz, die Schiffe daheim kämpfen
 * nur auf See mit: mit `grossflotte.raidWeights` (v1.16) gewichtet wie der Kartell-Überfall (`raidDefenseHp` ohne
 * Forschung), sonst ungewichtet (`defenseHp`, bis v1.15).
 */
export function armadaTargetHp(units: Counts, defenses: Counts, balance: Balance): number {
  return worldEventsBalance(balance).grossflotte.raidWeights ? raidDefenseHp(units, defenses, balance) : defenseHp(units, defenses, balance);
}

/** Belagerungsring aus Schnellbooten; Bezug ist der belagerte Hafen. */
export function composeSiege(targetHp: number, progress: number, balance: Balance): { units: Counts; lootPool: ResourceMap } {
  const s = worldEventsBalance(balance).belagerung;
  const f = strengthFactor(progress, balance);
  const ref = Math.max(worldEventsBalance(balance).minReferenceHp, targetHp);
  return { units: { schnellboot: boats(ref, s.shareOfDefense, f, s.minSchnellboote, balance) }, lootPool: scaleRes(s.lootPool, f) };
}

/** Die Großflotte als Angreifer auf einen Hafen: eigene Landungskapazität, Beute ohne Laderaumgrenze. */
export function armadaAttacker(units: Counts, balance: Balance): AttackerInput {
  const g = worldEventsBalance(balance).grossflotte;
  return {
    units: { ...units },
    troopSpaceBonus: { schnellboot: g.miliPerBoot * (balance.npcUnits.piratenmiliz.size ?? 1) },
    unlimitedCargo: true,
  };
}

// ---------------------------------------------------------------- Route und Abfangen

export interface RoutePoint extends GeoPoint {
  atMs: number;
}

/** Route über Wegpunkte; die Zeit verteilt sich nach Strecke gleichmäßig zwischen startMs und endMs. */
export function buildRoute(points: GeoPoint[], startMs: number, endMs: number): RoutePoint[] {
  if (points.length === 0) return [];
  const legs = [0];
  for (let i = 1; i < points.length; i++) legs.push(legs[i - 1] + distanceKm(points[i - 1], points[i]));
  const total = legs[legs.length - 1];
  return points.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    atMs: total > 0 ? Math.round(startMs + ((endMs - startMs) * legs[i]) / total) : i === 0 ? startMs : endMs,
  }));
}

export function routeLengthKm(route: GeoPoint[]): number {
  let s = 0;
  for (let i = 1; i < route.length; i++) s += distanceKm(route[i - 1], route[i]);
  return s;
}

/** Position auf der Route zum Zeitpunkt (vor dem Start am Anfang, nach dem Ende am Ziel). */
export function routePosition(route: RoutePoint[], atMs: number): GeoPoint {
  if (route.length === 0) throw new Error("leere Route");
  if (atMs <= route[0].atMs) return { lat: route[0].lat, lon: route[0].lon };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    if (atMs <= b.atMs) {
      const t = b.atMs > a.atMs ? (atMs - a.atMs) / (b.atMs - a.atMs) : 1;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  const last = route[route.length - 1];
  return { lat: last.lat, lon: last.lon };
}

/**
 * Frühester Abfangpunkt: erster Zeitpunkt t ab departMs (und nicht vor dem Start der Route), zu dem ein Verband
 * mit speedKmh von origin die Position des Ziels erreicht hat (Fahrzeit ≤ t − departMs). null, wenn das Ziel
 * vor dem Ende der Route nicht erreicht wird. Grob in stepMs-Schritten, dann auf eine Minute genau.
 */
export function interceptPoint(
  route: RoutePoint[],
  origin: GeoPoint,
  speedKmh: number,
  departMs: number,
  stepMs = 5 * 60000,
): { atMs: number; point: GeoPoint } | null {
  if (route.length === 0 || !(speedKmh > 0)) return null;
  const end = route[route.length - 1].atMs;
  const reached = (t: number) => (distanceKm(origin, routePosition(route, t)) / speedKmh) * HOUR_MS <= t - departMs;
  let prev = Math.max(departMs, route[0].atMs);
  if (prev > end) return null;
  if (reached(prev)) return { atMs: prev, point: routePosition(route, prev) };
  for (let t = prev + stepMs; ; t += stepMs) {
    const tt = Math.min(t, end);
    if (reached(tt)) {
      let lo = prev;
      let hi = tt;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2);
        if (reached(mid)) hi = mid;
        else lo = mid;
      }
      return { atMs: hi, point: routePosition(route, hi) };
    }
    if (tt >= end) return null;
    prev = tt;
  }
}

// ---------------------------------------------------------------- Kampf und Beute

/** Lebenspunkte eines Kartellverbands (Schiffe und Truppen). */
export function forceHp(units: Counts, balance: Balance): number {
  return defenseHp(units, {}, balance);
}

/** Verband ohne leere Einträge. */
export function activeUnits(units: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(units)) if (n > 0) out[id] = n;
  return out;
}

/**
 * Kampf auf See gegen einen Kartellverband: Sinken alle Schiffe des Verteidigers, ertrinken die Truppen an
 * Bord (sie zählen als Verluste). Liefert den angepassten Bericht und ob der Verband vernichtet ist.
 */
export function strandTroops(report: BattleReport, balance: Balance): { report: BattleReport; destroyed: boolean } {
  const all = { ...balance.units, ...balance.npcUnits };
  const final = { ...report.defender.final };
  const shipsLeft = Object.entries(final).some(([id, n]) => n > 0 && all[id]?.branch === "see");
  const losses = { ...report.defender.losses };
  const survivors = { ...report.defender.survivors };
  const returned = { ...report.defender.returned };
  if (!shipsLeft) {
    for (const [id, n] of Object.entries(final)) {
      if (n > 0 && all[id]?.branch === "land") {
        losses[id] = (losses[id] ?? 0) + n;
        final[id] = 0;
        survivors[id] = 0;
        returned[id] = 0;
      }
    }
  }
  const destroyed = Object.values(final).every((n) => n <= 0);
  return {
    destroyed,
    report: { ...report, winner: destroyed ? "attacker" : "defender", defender: { ...report.defender, final, losses, survivors, returned } },
  };
}

/** Beute, durch die Ladekapazität begrenzt (bei Knappheit proportional gekürzt, je Ressource abgerundet). */
export function capLoot(loot: ResourceMap, cargoCapacity: number): ResourceMap {
  const total = Object.values(loot).reduce((s, v) => s + Math.max(0, v), 0);
  const scale = total > cargoCapacity ? Math.max(0, cargoCapacity) / total : 1;
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(loot)) out[r] = Math.floor(Math.max(0, v) * scale + 1e-9);
  return out;
}

/**
 * Beute für Schaden (Großflotte, Belagerung): Anteil des Beutepools = vernichtete Lebenspunkte / Anfangs-
 * Lebenspunkte, höchstens der Rest des Pools, durch die Ladekapazität begrenzt.
 */
export function damageLoot(
  pool: ResourceMap,
  paid: ResourceMap,
  destroyedHp: number,
  initialHp: number,
  cargoCapacity: number,
): ResourceMap {
  const share = initialHp > 0 ? Math.max(0, Math.min(1, destroyedHp / initialHp)) : 0;
  const raw: ResourceMap = {};
  for (const [r, v] of Object.entries(pool)) raw[r] = Math.max(0, Math.min(v * share, v - (paid[r] ?? 0)));
  return capLoot(raw, cargoCapacity);
}

// ---------------------------------------------------------------- Belagerung

/**
 * Belagerungsabzug für einen Zeitraum: productionPenalty der Gebäudeproduktion (ohne Grundrate). Ressourcen,
 * deren Lager voll ist (keine Produktion), bleiben unberührt; der Bestand fällt nie unter 0.
 */
export function applySiegePenalty(
  resources: ResourceMap,
  buildingPerHour: ResourceMap,
  capacity: number,
  hours: number,
  balance: Balance,
): { resources: ResourceMap; deducted: ResourceMap } {
  const penalty = worldEventsBalance(balance).belagerung.productionPenalty;
  const out: ResourceMap = { ...resources };
  const deducted: ResourceMap = {};
  for (const r of balance.resources) {
    const stock = resources[r] ?? 0;
    const d = stock < capacity ? Math.min(stock, Math.max(0, (buildingPerHour[r] ?? 0) * penalty * Math.max(0, hours))) : 0;
    out[r] = stock - d;
    deducted[r] = d;
  }
  return { resources: out, deducted };
}
