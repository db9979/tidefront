// Mehrere Häfen: Gründung eines Außenpostens per Kolonieschiff und Verlegung zwischen eigenen Häfen
// (docs/REGELN-EXPANSION.md). Reine, deterministische Regeln; Werte aus dem Block `expansion` der Balance.
// Fehlt der Block, gibt es keine Außenposten. Gelände, Nester, Handelshäfen und Felder liefert der Aufrufer.
import type { Balance, BaseState, Counts, GeoPoint, ProtectionState, ResourceMap } from "./types.ts";
import { createBase, buildingLevel } from "./economy.ts";
import { settleNightShield } from "./protection.ts";
import type { Veterancy } from "./veterans.ts";

const HOUR_MS = 3600000;

export interface ExpansionDef {
  /** Höchstzahl der Häfen je Spieler (Heimathafen eingeschlossen). */
  maxBases: number;
  /** Je erreichter Stufe der Kommandozentrale des Heimathafens ein weiterer Hafen (aufsteigend). */
  unlockCommandLevels: number[];
  /** Einheit, die gründet (wird verbraucht). */
  colonyShip: string;
  /** Mindestabstand in Feldern zu fremden bzw. eigenen Häfen. */
  minDistanceHex: number;
  minDistanceOwnHex: number;
  /** Höchstentfernung des neuen Hafens zum Heimathafen (km). */
  maxRangeKm: number;
  /** Gründungsschutz des neuen Hafens (Stunden). */
  colonyShieldHours: number;
  /** Erster Kartell-Überfall auf den neuen Hafen frühestens nach so vielen Stunden. */
  firstRaidAfterHours: number;
  /** Startbestand des neuen Hafens (zusätzlich zur Ladung). */
  startResources: ResourceMap;
  /** Gebäude, die nur im Heimathafen gebaut werden dürfen. */
  homeOnlyBuildings: string[];
  /** Mindeststufe der Hafenkommandantur für das Kolonieschiff. */
  harborLevelForShip: number;
  /**
   * v1.35 (Nutzerentscheid 12B): Gründungsgebühr ab dem 3. Hafen = Kosten des Kolonieschiffs × (colonyCostGrowth^(n − 2) − 1)
   * für den n-ten Hafen (3. Hafen: × 1 zusätzlich, also doppelt so teuer wie der 2.). Fehlt sie, keine Gebühr.
   */
  colonyCostGrowth?: number;
  /**
   * v1.35 (Nutzerentscheid 12C): Unterhalt je Kolonie und Tag, laufend abgezogen; je Ressource höchstens so viel, wie die
   * Gebäude der Kolonie davon erzeugen (eine neue Kolonie gerät dadurch nie ins Minus).
   */
  colonyUpkeepPerDay?: ResourceMap;
}

export interface HexPos {
  col: number;
  row: number;
}

export function expansionOf(balance: Balance): ExpansionDef | null {
  return balance.expansion ?? null;
}

/** Abstand zweier Felder in Feldschritten (Gitter „odd-r“: ungerade Zeilen um ein halbes Feld nach Osten). */
export function hexSteps(a: HexPos, b: HexPos): number {
  const cube = (h: HexPos) => {
    const x = h.col - (h.row - (h.row & 1)) / 2;
    return { x, z: h.row, y: -x - h.row };
  };
  const p = cube(a);
  const q = cube(b);
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z));
}

/** Erlaubte Zahl eigener Häfen: 1 + je erreichter Freischaltstufe der Kommandozentrale (Heimathafen), höchstens maxBases. */
export function allowedBases(homeState: BaseState, balance: Balance): number {
  const e = expansionOf(balance);
  if (!e) return 1;
  const kz = buildingLevel(homeState, "kommandozentrale");
  return Math.min(e.maxBases, 1 + e.unlockCommandLevels.filter((l) => l <= kz).length);
}

/** Nächste Freischaltstufe der Kommandozentrale (null: keine weitere). */
export function nextUnlockLevel(homeState: BaseState, balance: Balance): number | null {
  const e = expansionOf(balance);
  if (!e || allowedBases(homeState, balance) >= e.maxBases) return null;
  const kz = buildingLevel(homeState, "kommandozentrale");
  return e.unlockCommandLevels.find((l) => l > kz) ?? null;
}

/**
 * Gründungsgebühr für den n-ten eigenen Hafen (n = vorhandene Häfen + laufende Gründungen + 1): Kosten des Kolonieschiffs ×
 * (colonyCostGrowth^(n − 2) − 1), aufgerundet; für den 2. Hafen und ohne colonyCostGrowth leer.
 */
export function foundingFee(n: number, balance: Balance): ResourceMap {
  const e = expansionOf(balance);
  const g = e?.colonyCostGrowth;
  if (!e || !g || n <= 2) return {};
  const f = g ** (n - 2) - 1;
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(balance.units[e.colonyShip]?.cost ?? {})) if (v > 0) out[r] = Math.ceil(v * f - 1e-9);
  return out;
}

export function colonyShipCount(units: Counts, balance: Balance): number {
  const e = expansionOf(balance);
  return e ? units[e.colonyShip] ?? 0 : 0;
}

export interface FoundingCheck {
  target: HexPos;
  /** Zielfeld ist Küste (packages/world isCoast). */
  coast: boolean;
  /** Entfernung Zielfeld → Heimathafen (km). */
  homeDistanceKm: number;
  /** Alle Häfen auf der Karte; own = gehört dem Gründer. */
  bases: (HexPos & { own: boolean })[];
  nests: HexPos[];
  tradePorts: HexPos[];
  /** Positionen der Rohstofffelder. */
  fields: HexPos[];
  homeState: BaseState;
  /** Eigene Häfen (Heimathafen eingeschlossen) und laufende Gründungen. */
  ownBases: number;
  pendingFoundings: number;
  /** Verband der Gründung; fehlt er, wird das Kolonieschiff nicht geprüft (Ankunft). */
  units?: Counts;
}

const same = (a: HexPos, b: HexPos) => a.col === b.col && a.row === b.row;

/**
 * Grund, warum auf dem Feld kein Hafen gegründet werden kann; null = frei.
 * Codes: expansion_off, command_level (nächste Freischaltung über die Kommandozentrale), base_limit, colony_ship (nicht genau
 * ein Kolonieschiff), not_coast, field_taken (Hafen oder Nest), trade_port, resource_field, too_close_own, too_close, too_far.
 */
export function foundingBlocker(c: FoundingCheck, balance: Balance): string | null {
  const e = expansionOf(balance);
  if (!e) return "expansion_off";
  const allowed = allowedBases(c.homeState, balance);
  if (c.ownBases + c.pendingFoundings >= allowed) return allowed < e.maxBases ? "command_level" : "base_limit";
  if (c.units && colonyShipCount(c.units, balance) !== 1) return "colony_ship";
  if (!c.coast) return "not_coast";
  if (c.bases.some((b) => same(b, c.target)) || c.nests.some((n) => same(n, c.target))) return "field_taken";
  if (c.tradePorts.some((p) => same(p, c.target))) return "trade_port";
  if (c.fields.some((f) => same(f, c.target))) return "resource_field";
  for (const b of c.bases) {
    const d = hexSteps(b, c.target);
    if (b.own && d < e.minDistanceOwnHex) return "too_close_own";
    if (!b.own && d < e.minDistanceHex) return "too_close";
  }
  if (c.homeDistanceKm > e.maxRangeKm) return "too_far";
  return null;
}

/**
 * Schutz einer neuen Kolonie: Anfängerschutz erbt den Beginn des Heimathafens (createdAtMs), dazu Gründungsschutz
 * für colonyShieldHours; die Nachtschild-Einstellung (auch eine vorgemerkte) wird übernommen.
 */
export function colonyProtection(home: ProtectionState, nowMs: number, balance: Balance): ProtectionState {
  const s = settleNightShield(home, nowMs);
  const hours = expansionOf(balance)?.colonyShieldHours ?? 0;
  return {
    createdAtMs: home.createdAtMs,
    nightShieldStartHour: s.nightShieldStartHour,
    tzOffsetMinutes: s.tzOffsetMinutes,
    ...(s.timeZone ? { timeZone: s.timeZone } : {}),
    nightShieldSuspendedUntilMs: 0,
    defeatShieldUntilMs: 0,
    foundingShieldUntilMs: nowMs + hours * HOUR_MS,
    ...(s.beginnerEndedAtMs !== undefined ? { beginnerEndedAtMs: s.beginnerEndedAtMs } : {}), // PvP: Anfängerschutz beendet
    ...(s.nightShieldNext ? { nightShieldNext: { ...s.nightShieldNext } } : {}),
    ...(s.nightShieldChangedAtMs !== undefined ? { nightShieldChangedAtMs: s.nightShieldChangedAtMs } : {}),
  };
}

/** Neuer Hafen einer Gründung: leerer Stützpunkt mit Startbestand plus Ladung, Schutz nach colonyProtection. */
export function createColony(balance: Balance, nowMs: number, site: GeoPoint, homeProtection: ProtectionState, cargo: ResourceMap = {}): BaseState {
  const state = createBase(balance, nowMs, site);
  const start = expansionOf(balance)?.startResources ?? {};
  for (const r of balance.resources) state.resources[r] = (start[r] ?? 0) + (cargo[r] ?? 0);
  state.protection = colonyProtection(homeProtection, nowMs, balance);
  state.colony = { foundedAtMs: nowMs };
  return state;
}

/** Darf das Gebäude in diesem Hafen gebaut werden? (homeOnlyBuildings nur im Heimathafen, also nicht in Kolonien.) */
export function homeOnlyBlocked(base: BaseState, buildingId: string, balance: Balance): boolean {
  return base.colony !== undefined && (expansionOf(balance)?.homeOnlyBuildings ?? []).includes(buildingId);
}

/**
 * Verlegung: Erfahrung im Zielhafen nach Ankunft von `units` mit der Erfahrung `from` (Durchschnitt des Ausgangshafens).
 * Gewichtetes Mittel über den Bestand des Ziels (daheim und unterwegs). Liefert undefined, wenn nichts bleibt.
 */
export function mergeVeterancy(target: BaseState, from: Veterancy | undefined, units: Counts): Veterancy | undefined {
  const out: Veterancy = { ...(target.veterancy ?? {}) };
  for (const [id, n] of Object.entries(units)) {
    if (!(n > 0)) continue;
    const have = (target.units[id] ?? 0) + (target.unitsAway[id] ?? 0);
    const xp = ((out[id] ?? 0) * have + (from?.[id] ?? 0) * n) / (have + n);
    if (xp > 1e-6) out[id] = xp;
    else delete out[id];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
