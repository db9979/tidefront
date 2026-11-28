// See: Minen, Blockade und Konvois (docs/REGELN-SEE.md). Reine, deterministische Regeln; Werte aus den Blöcken
// `mines`, `blockade` und `convoys` der Balance. Fehlt ein Block, ist das jeweilige System aus.
import type { Balance, Counts, GeoPoint, ResourceMap, Result } from "./types.ts";
import { mulberry32 } from "./rng.ts";
import { distanceKm } from "./geo.ts";

export interface MinesBalance {
  /** Höchstentfernung des Minenfelds vom eigenen Hafen. */
  layRadiusKm: number;
  /** Wirkradius eines Felds um die Feldmitte (eine Route, die näher vorbeiführt, kreuzt es). */
  fieldRadiusKm: number;
  maxStrength: number;
  lifetimeHours: number;
  maxFieldsPerPlayer: number;
  /** Kosten je Stärkepunkt beim Legen. */
  costPerStrength: ResourceMap;
  /** Verlustanteil je Stärkepunkt (vor Schiffstyp und Räumschutz), höchstens maxLossShare. */
  lossPerStrength: number;
  maxLossShare: number;
  /** Faktor je Schiffstyp (U-Boote tauchen unter den Ankertauen, Minenräumer sind dafür gebaut). */
  typeFactor: Record<string, number>;
  /** Räumschutz = shieldPerSweeperShare × Anteil der Minenräumer an den Schiffen, höchstens maxShield. */
  shieldPerSweeperShare: number;
  maxShield: number;
  /** Stärke, die je versenktem Schiff verbraucht wird. */
  strengthPerHit: number;
  /** Radar sieht fremde Felder bis radarKmPerLevel × Stufe der Radarstation. */
  radarKmPerLevel: number;
  /** Aufklärung deckt Felder bis zu dieser Entfernung vom Ziel und entlang der Route auf. */
  scoutRevealKm: number;
  /** Handelskonvois: Faktor auf den Verlustanteil für die Ladung (fehlt: Konvois verlieren keine Ladung). */
  cargoLossFactor?: number;
}

export interface BlockadeBalance {
  minHours: number;
  maxHours: number;
  /** Mindest-Kommandopunkte der Schiffe (eine einzelne Korvette blockiert keinen Hafen). */
  minCommandPoints: number;
  /** Faktor auf die Gebäudeproduktion des blockierten Hafens (Modifikator-Quelle „Blockade“). */
  productionFactor: number;
  /** Eingehende Lieferungen werden während der Blockade jeweils um so viele Minuten zurückgehalten. */
  deliveryHoldMinutes: number;
}

export interface ConvoysBalance {
  /** Kartell: Chance = base + per100Km × Strecke/100 + per1000Value × Warenwert/1000, höchstens max. */
  cartelBaseChance: number;
  cartelChancePer100Km: number;
  cartelChancePer1000Value: number;
  cartelMaxChance: number;
  /** Unter dieser Strecke fängt das Kartell nie ab. */
  cartelMinDistanceKm: number;
  /** Kartellverband: Schnellboote je 1000 Warenwert, mindestens min, höchstens max. */
  cartelBoatsPer1000Value: number;
  cartelMinBoats: number;
  cartelMaxBoats: number;
  /** Ladungsverlust ohne Geleitschutz bzw. wenn der Geleitschutz unterliegt. */
  lossShareUnescorted: number;
  lossShareEscortBeaten: number;
  /** Anteil der Ladung, den ein siegreicher Abfangverband höchstens erbeutet (durch Laderaum begrenzt). */
  plunderShare: number;
  /**
   * Börsenlieferungen und Lieferverträge (Konvoiart boerse/vertrag): Faktor auf die Kartellchance und eigene Obergrenze
   * (fehlt: wie Handelskonvois). Hält den erwarteten Ladungsverlust ohne Geleit klein (docs/REGELN-SEE.md).
   */
  marketChanceFactor?: number;
  marketMaxChance?: number;
  /**
   * v1.35 (M-09): Börsenkonvois rechnen die Kartellchance mit dem Warenwert aller eigenen Börsenkonvois der letzten so
   * vielen Stunden (einschließlich dieses) – eine geteilte Order senkt das Risiko kaum noch. Fehlt er: nur dieser Konvoi.
   */
  marketValueWindowHours?: number;
  /** Größenklasse der Ladung für fremde Konvois (Warenwert bis klein bzw. mittel, darüber groß). */
  cargoSmallMaxValue?: number;
  cargoMediumMaxValue?: number;
}

export function minesOf(b: Balance): MinesBalance | null {
  return (b as { mines?: MinesBalance }).mines ?? null;
}
export function blockadeOf(b: Balance): BlockadeBalance | null {
  return (b as { blockade?: BlockadeBalance }).blockade ?? null;
}
export function convoysOf(b: Balance): ConvoysBalance | null {
  return (b as { convoys?: ConvoysBalance }).convoys ?? null;
}

function ships(units: Counts, balance: Balance): [string, number][] {
  return Object.entries(units).filter(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
}

// ---------------------------------------------------------------- Minen

/** Stärke, die ein Verband legt (Summe mineLayer je Schiff). */
export function layStrength(units: Counts, balance: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(units)) s += (balance.units[id]?.mineLayer ?? 0) * Math.max(0, n);
  return s;
}

/** Räumleistung eines Verbands (Summe mineSweeper je Schiff). */
export function sweepPower(units: Counts, balance: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(units)) s += (balance.units[id]?.mineSweeper ?? 0) * Math.max(0, n);
  return s;
}

/** Räumschutz eines Verbands in [0, maxShield] nach dem Anteil der Minenräumer an seinen Schiffen. */
export function sweeperShield(units: Counts, balance: Balance): number {
  const m = minesOf(balance);
  if (!m) return 0;
  let all = 0, sweepers = 0;
  for (const [id, n] of ships(units, balance)) {
    all += n;
    if ((balance.units[id].mineSweeper ?? 0) > 0) sweepers += n;
  }
  return all > 0 ? Math.min(m.maxShield, (sweepers / all) * m.shieldPerSweeperShare) : 0;
}

/** Kosten für eine Legefahrt (Stärke × costPerStrength, aufgerundet). */
export function mineLayCost(strength: number, balance: Balance): ResourceMap {
  const m = minesOf(balance);
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(m?.costPerStrength ?? {})) out[r] = Math.ceil(v * strength);
  return out;
}

/** Erwarteter Verlustanteil eines Schiffstyps beim Durchfahren eines Felds der Stärke `strength`. */
export function mineLossShare(unitId: string, strength: number, shield: number, balance: Balance): number {
  const m = minesOf(balance);
  if (!m || strength <= 0) return 0;
  const base = Math.min(m.maxLossShare, strength * m.lossPerStrength);
  return base * (m.typeFactor[unitId] ?? 1) * (1 - shield);
}

export interface MineTransit {
  losses: Counts;
  survivors: Counts;
  /** Versenkte Schiffe. */
  hits: number;
  /** Verbrauchte Feldstärke. */
  consumed: number;
  shield: number;
}

/**
 * Durchfahrt eines Verbands durch ein Minenfeld. Nur Schiffe sinken; je Typ erwartete Verluste
 * n × Anteil, der Bruchteil wird mit dem Seed gewürfelt. Reicht der Truppenraum danach nicht mehr,
 * gehen die überzähligen Truppen mit unter (anteilig je Typ). Flugzeuge bleiben unberührt.
 */
export function mineTransit(units: Counts, strength: number, balance: Balance, seed: number): MineTransit {
  const m = minesOf(balance);
  const survivors: Counts = { ...units };
  const losses: Counts = {};
  const shield = sweeperShield(units, balance);
  if (!m || strength <= 0) return { losses, survivors, hits: 0, consumed: 0, shield };
  const rng = mulberry32(seed);
  let hits = 0;
  for (const [id, n] of ships(units, balance).sort(([a], [b]) => a.localeCompare(b))) {
    const e = n * mineLossShare(id, strength, shield, balance);
    const k = Math.min(n, Math.floor(e) + (rng() < e - Math.floor(e) ? 1 : 0));
    if (k > 0) {
      losses[id] = k;
      survivors[id] = n - k;
      hits += k;
    }
  }
  // Truppen ohne Platz an Bord gehen mit den Landungsschiffen unter.
  let space = 0, troops = 0;
  for (const [id, n] of Object.entries(survivors)) {
    const d = balance.units[id];
    if (!d || n <= 0) continue;
    space += (d.troopSpace ?? 0) * n;
    if (d.branch === "land") troops += (d.size ?? 0) * n;
  }
  if (troops > space) {
    const ratio = space / troops;
    for (const [id, n] of Object.entries(survivors)) {
      if (balance.units[id]?.branch !== "land" || n <= 0) continue;
      const keep = Math.floor(n * ratio + 1e-9);
      if (keep < n) {
        losses[id] = (losses[id] ?? 0) + n - keep;
        survivors[id] = keep;
      }
    }
  }
  return { losses, survivors, hits, consumed: Math.min(strength, hits * m.strengthPerHit), shield };
}

/**
 * Kürzeste Entfernung eines Punkts von der Strecke a→b (gerade in Länge/Breite wie die Kartenlinien,
 * abgetastet höchstens alle 10 km).
 */
export function routeDistanceKm(a: GeoPoint, b: GeoPoint, p: GeoPoint): number {
  const steps = Math.max(1, Math.ceil(distanceKm(a, b) / 10));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    best = Math.min(best, distanceKm({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }, p));
  }
  return best;
}

/** Kreuzt die Strecke a→b ein Minenfeld mit Mitte `field`? */
export function routeCrossesField(a: GeoPoint, b: GeoPoint, field: GeoPoint, balance: Balance): boolean {
  const m = minesOf(balance);
  return !!m && routeDistanceKm(a, b, field) <= m.fieldRadiusKm;
}

/** Seed je Mission und Feld (deterministisch, unabhängig von der Reihenfolge der Abfrage). */
export function mineSeed(missionId: number, fieldId: number): number {
  return (Math.imul(missionId >>> 0, 0x9e3779b1) ^ Math.imul(fieldId >>> 0, 0x85ebca77)) >>> 0;
}

/** Seed der Rückfahrt (eigener Strom, damit Hin- und Rückfahrt durch dasselbe Feld unabhängig würfeln). */
export function mineReturnSeed(missionId: number, fieldId: number): number {
  return (mineSeed(missionId, fieldId) ^ 0x52e7a11d) >>> 0;
}

/**
 * Handelskonvoi durch ein Minenfeld: die Ladung verliert deterministisch den Anteil
 * min(maxLossShare, Stärke × lossPerStrength) × cargoLossFactor × (1 − Räumschutz des Geleits). Ein Verlust
 * verbraucht wie ein Treffer strengthPerHit Stärke. Ohne `cargoLossFactor` laufen Konvois ohne Verlust durch.
 */
export function convoyMineLoss(strength: number, escort: Counts, balance: Balance): { share: number; consumed: number } {
  const m = minesOf(balance);
  const k = m?.cargoLossFactor ?? 0;
  if (!m || strength <= 0 || k <= 0) return { share: 0, consumed: 0 };
  const share = Math.min(m.maxLossShare, strength * m.lossPerStrength) * k * (1 - sweeperShield(escort, balance));
  return { share, consumed: share > 0 ? Math.min(strength, m.strengthPerHit) : 0 };
}

// ---------------------------------------------------------------- Blockade

/**
 * Taugt ein Verband für eine Blockade? Nur Schiffe, mindestens eines bewaffnet (Angriff gegen See),
 * zusammen mindestens minCommandPoints. Codes: no_blockade, blockade_ships_only, blockade_too_weak.
 */
export function blockadeCheck(units: Counts, balance: Balance): Result<{ commandPoints: number }> {
  const b = blockadeOf(balance);
  if (!b) return { ok: false, code: "no_blockade" };
  let cp = 0, armed = false;
  for (const [id, n] of Object.entries(units)) {
    if (n <= 0) continue;
    const d = balance.units[id];
    if (!d || d.branch !== "see") return { ok: false, code: "blockade_ships_only" };
    cp += (d.commandPoints ?? 0) * n;
    if (d.attack.see > 0) armed = true;
  }
  if (!armed || cp + 1e-9 < b.minCommandPoints) return { ok: false, code: "blockade_too_weak" };
  return { ok: true, commandPoints: cp };
}

/** Haltedauer in Stunden, auf [minHours, maxHours] begrenzt und auf ganze Stunden gerundet. */
export function blockadeHours(hours: number | undefined, balance: Balance): number {
  const b = blockadeOf(balance);
  if (!b) return 0;
  const h = Math.round(Number.isFinite(hours) ? hours! : b.minHours);
  return Math.max(b.minHours, Math.min(b.maxHours, h));
}

/** Produktionsfaktor eines blockierten Hafens (1 ohne Blockade-Block). */
export function blockadeProductionFactor(balance: Balance): number {
  return blockadeOf(balance)?.productionFactor ?? 1;
}

// ---------------------------------------------------------------- Konvois

/** Warenwert einer Ladung zum Richtwert der Börse. */
export function cargoValue(cargo: ResourceMap, balance: Balance): number {
  let v = 0;
  for (const [r, q] of Object.entries(cargo)) v += Math.max(0, q) * (balance.market.refPrice[r] ?? 0);
  return v;
}

/** Chance, dass das Kartell einen Konvoi abfängt (0 unter cartelMinDistanceKm). */
export function cartelChance(distance: number, value: number, balance: Balance, market = false): number {
  const c = convoysOf(balance);
  if (!c || distance < c.cartelMinDistanceKm || value <= 0) return 0;
  const raw = c.cartelBaseChance + (c.cartelChancePer100Km * distance) / 100 + (c.cartelChancePer1000Value * value) / 1000;
  if (market) return Math.max(0, Math.min(c.marketMaxChance ?? c.cartelMaxChance, raw * (c.marketChanceFactor ?? 1)));
  return Math.max(0, Math.min(c.cartelMaxChance, raw));
}

/** Erwarteter Ladungsanteil, den das Kartell ohne Geleit nimmt (Chance × Verlustanteil); Anzeige und Rechnung. */
export function cartelExpectedLoss(distance: number, value: number, balance: Balance, market = false): number {
  return cartelChance(distance, value, balance, market) * (convoysOf(balance)?.lossShareUnescorted ?? 0);
}

/** Größenklasse einer Ladung, wie fremde Sensoren sie einschätzen (nach Warenwert). */
export function cargoSizeClass(cargo: ResourceMap, balance: Balance): "klein" | "mittel" | "gross" {
  const c = convoysOf(balance);
  const v = cargoValue(cargo, balance);
  if (v <= (c?.cargoSmallMaxValue ?? 2000)) return "klein";
  if (v <= (c?.cargoMediumMaxValue ?? 10000)) return "mittel";
  return "gross";
}

/**
 * Würfel beim Auslaufen: Fängt das Kartell ab, und wann (Anteil der Fahrt in [0,25; 0,75])? Deterministisch per Seed.
 */
export function cartelRoll(seed: number, distance: number, value: number, balance: Balance, market = false): { hit: boolean; chance: number; atShare: number } {
  const rng = mulberry32(seed);
  const chance = cartelChance(distance, value, balance, market);
  const roll = rng();
  return { hit: roll < chance, chance, atShare: 0.25 + rng() * 0.5 };
}

/** Kartellverband gegen einen Konvoi: Schnellboote nach Warenwert. */
export function cartelConvoyForce(value: number, balance: Balance): Counts {
  const c = convoysOf(balance);
  if (!c) return {};
  const n = Math.round((value / 1000) * c.cartelBoatsPer1000Value);
  return { schnellboot: Math.max(c.cartelMinBoats, Math.min(c.cartelMaxBoats, n)) };
}

/** Teilt eine Ladung: `share` geht verloren (je Ressource abgerundet), der Rest bleibt. */
export function splitCargo(cargo: ResourceMap, share: number): { lost: ResourceMap; kept: ResourceMap } {
  const lost: ResourceMap = {};
  const kept: ResourceMap = {};
  const s = Math.max(0, Math.min(1, share));
  for (const [r, q] of Object.entries(cargo)) {
    const l = Math.floor(Math.max(0, q) * s + 1e-9);
    if (l > 0) lost[r] = l;
    kept[r] = Math.max(0, q) - l;
  }
  return { lost, kept };
}

/** Beute eines Abfangverbands: höchstens plunderShare der Ladung, durch den Laderaum begrenzt. */
export function convoyPlunder(cargo: ResourceMap, cargoCapacity: number, balance: Balance): ResourceMap {
  const c = convoysOf(balance);
  const { lost } = splitCargo(cargo, c?.plunderShare ?? 0);
  const total = Object.values(lost).reduce((a, b) => a + b, 0);
  const scale = total > cargoCapacity ? Math.max(0, cargoCapacity) / total : 1;
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(lost)) {
    const k = Math.floor(v * scale + 1e-9);
    if (k > 0) out[r] = k;
  }
  return out;
}
