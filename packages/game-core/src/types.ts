// Gemeinsame Typen des Regelkerns. Nur löschbare Typ-Syntax (kein enum, kein namespace).
import type { Modifiers } from "./modifiers.ts";

export type ResourceMap = Record<string, number>;
export type Counts = Record<string, number>;

export interface AttackValues {
  see: number;
  luft: number;
  land: number;
  anlage?: number;
  /** U-Jagd: Schaden gegen getauchte U-Boote (Wasserbomben); Vorgabe 0. */
  uboot?: number;
}

export interface BuildingDef {
  cost: ResourceMap;
  seconds: number;
  produces?: string;
  perHour?: number;
  powerPerLevel?: number;
  powerSupplyPerLevel?: number;
  capacityBase?: number;
  capacityGrowth?: number;
  protectedBase?: number;
  protectedGrowth?: number;
  buildSpeedPerLevel?: number;
  slotsPerLevel?: number;
  commandPointsBase?: number;
  commandPointsPerLevel?: number;
  missionSlotsBase?: number;
  missionSlotsPerTwoLevels?: number;
  marketFromLevel?: number;
  creditLimitPerLevel?: number;
  warningMinutesBase?: number;
  warningMinutesPerLevel?: number;
  /** Forschungsamt: Forschung je Stufe über 1 schneller (0,1 = +10 %). */
  researchSpeedPerLevel?: number;
}

export type Branch = "see" | "land" | "luft";

export interface UnitDef {
  branch: Branch;
  hp: number;
  attack: AttackValues;
  bonus: Record<string, number>;
  builtIn?: string;
  /** Mindeststufe des Baugebäudes `builtIn` (Vorgabe 1). */
  requiresLevel?: number;
  /** Getaucht (U-Boot): nur durch U-Jagd (`attack.uboot`) zu treffen, kein Ziel für Bomber und Küstenbatterien. */
  submerged?: boolean;
  cost?: ResourceMap;
  seconds?: number;
  upkeepPerHour?: number;
  commandPoints?: number;
  speedKmh?: number;
  fuelPer100Km?: number;
  cargo?: number;
  troopSpace?: number;
  size?: number;
  rangeKm?: number;
}

export interface DefenseDef {
  cost: ResourceMap;
  seconds: number;
  hp: number;
  attack?: AttackValues;
  oneShotDamageToLanding?: number;
}

export interface NestLevelDef {
  loot: ResourceMap;
  [unitOrDefenseId: string]: number | ResourceMap;
}

export interface MarketBalance {
  refPrice: ResourceMap;
  depth: ResourceMap;
  fee: number;
  maxImpactPerTrade: number;
  hourBand: number;
  dayBand: number;
  haltMinutes: number;
  floorFactor: number;
  ceilFactor: number;
  reversionHalfLifeHours: number;
  dailyLimitShareOfStorage: number;
  slippageTolerance: number;
  tradesPerMinute: number;
  convoySpeedKmh: number;
}

export interface Balance {
  version: string;
  resources: string[];
  start: ResourceMap;
  baseTricklePerHour: ResourceMap;
  building: {
    costFactor: number;
    timeFactor: number;
    maxLevel: number;
    maxBuildSeconds: number;
    levelCapAboveCommand: number;
    productionGrowth: number;
    /** Höchstzahl der Aufträge in der Bauschlange eines Stützpunkts. */
    queueSlots: number;
  };
  buildings: Record<string, BuildingDef>;
  units: Record<string, UnitDef>;
  npcUnits: Record<string, UnitDef>;
  defenses: Record<string, DefenseDef>;
  combat: {
    maxRoundsPerPhase: number;
    randomSpread: number;
    airSuperiorityBomberBonus: number;
    airSuperiorityBomberMalus: number;
    wreckShare: number;
    wreckHours: number;
    defenseRepairShare: number;
    hospitalShareDefender: number;
    hospitalShareAttacker: number;
    aircraftDamagedShare: number;
    /** Salven des U-Boot-Angriffs aus dem Verborgenen vor dem Seegefecht (Vorgabe 1). */
    torpedoSalvos?: number;
  };
  loot: {
    maxShareOfUnprotected: number;
    repeatFactors: number[];
    repeatWindowHours: number;
    weakTargetBelowShare: number;
    weakTargetLootFactor: number;
  };
  protection: {
    nightShieldHours: number;
    beginnerDays: number;
    afterDefeatShieldHours: number;
    /** Neue Nachtschild-Einstellung gilt erst nach so vielen Stunden; ebenso lange bis zur nächsten Änderung. */
    nightShieldChangeHours: number;
  };
  pirates: {
    nestLevels: Record<string, NestLevelDef>;
    nestRespawnHours: number;
    raidIntervalHours: number;
    raidStrengthShareOfDefense: number;
    raidMinSchnellboote: number;
    raidMiliPerBoot: number;
    /** Schwankung der Überfallstärke je Überfall (0,3 = ±30 %). */
    raidStrengthSpread: number;
  };
  market: MarketBalance;
  /** Forschung (seit v1.3); fehlt sie, gibt es keine Forschung. */
  research?: ResearchBalance;
}

// ---------------------------------------------------------------- Forschung

/** Wirkung einer Technik: Faktor 1 + perLevel * Stufe auf einen Modifikator-Pfad (z. B. "production.stahl"). */
export interface TechEffect {
  path: string;
  perLevel: number;
}

export interface TechDef {
  /** Zweig (seefahrt, heer, luftfahrt, wirtschaft). */
  branch: string;
  maxLevel: number;
  /** Kosten der ersten Stufe; jede weitere mal research.costFactor. */
  cost: ResourceMap;
  /** Dauer der ersten Stufe in Sekunden (Forschungsamt Stufe 1); jede weitere mal research.timeFactor. */
  seconds: number;
  /** Mindeststufe des Forschungsamts (Vorgabe 1). */
  requiresBuildingLevel?: number;
  /** Voraussetzungen: andere Techniken mit Mindeststufe. */
  requires?: Record<string, number>;
  effects: TechEffect[];
}

export interface ResearchBalance {
  /** Gebäude, in dem geforscht wird. */
  building: string;
  costFactor: number;
  timeFactor: number;
  branches: string[];
  /** Durchbruch-Würfel beim Abschluss: Chance = baseChance + perBuildingLevel * Stufe Forschungsamt, höchstens maxChance. */
  breakthrough?: { baseChance: number; perBuildingLevel: number; maxChance: number; speedFactor: number };
  techs: Record<string, TechDef>;
}

export interface ResearchOrder {
  techId: string;
  targetLevel: number;
  startedAt: number;
  finishesAt: number;
  /** Bezahlte Kosten (Grundlage der Erstattung beim Abbruch). */
  cost: ResourceMap;
  /** Durchbruch-Chance (0..1), beim Start festgelegt und angezeigt. */
  chance?: number;
  /** Seed des Durchbruch-Wurfs (vom Server beim Start gesetzt). */
  seed?: number;
  /** Diese Forschung lief mit halber Dauer (Durchbruch-Belohnung eingelöst). */
  halved?: boolean;
}

export type BreakthroughChoice = "level" | "speed";

/** Ergebnis des Durchbruch-Wurfs einer abgeschlossenen Forschung. */
export interface ResearchRoll {
  techId: string;
  /** Stufe, die erforscht wurde. */
  level: number;
  /** Wurf 1..100; Durchbruch, wenn roll <= chance * 100. */
  roll: number;
  chance: number;
  breakthrough: boolean;
  /** Gewählte Belohnung; null = Wahl steht noch aus. Ohne Durchbruch immer null. */
  choice: BreakthroughChoice | null;
  atMs: number;
}

export interface ResearchState {
  /** Erreichte Stufe je Technik. */
  levels: Counts;
  /** Laufender Forschungsauftrag (höchstens einer). */
  order: ResearchOrder | null;
  /** Letzter Durchbruch-Wurf (nachvollziehbar gespeichert). */
  lastRoll?: ResearchRoll | null;
  /** Belohnung „nächste Forschung halb so lang“ liegt bereit. */
  halfNext?: boolean;
}

// ---------------------------------------------------------------- Ergebnis

export type Fail = { ok: false; code: string };
export type Result<T> = ({ ok: true } & T) | Fail;

// ---------------------------------------------------------------- Stützpunkt

export interface ProtectionState {
  /** Gründungszeitpunkt des Stützpunkts (Beginn des Anfängerschutzes). */
  createdAtMs: number;
  /** Startstunde des Nachtschilds 0..23 in Ortszeit des Spielers; null = nicht gewählt. */
  nightShieldStartHour: number | null;
  /** Versatz der Ortszeit zu UTC in Minuten (z. B. 60 für MEZ). */
  tzOffsetMinutes: number;
  /** Nachtschild ist bis zu diesem Zeitpunkt aufgehoben (eigener Angriff). */
  nightShieldSuspendedUntilMs: number;
  /** Schutz nach verlorener Verteidigung bis zu diesem Zeitpunkt. */
  defeatShieldUntilMs: number;
  /** Vorgemerkte Nachtschild-Einstellung, gültig ab fromMs (fehlt in älteren Ständen). */
  nightShieldNext?: { startHour: number | null; tzOffsetMinutes: number; fromMs: number } | null;
  /** Zeitpunkt der letzten Änderung durch den Spieler (fehlt in älteren Ständen). */
  nightShieldChangedAtMs?: number;
}

export interface BuildOrder {
  buildingId: string;
  targetLevel: number;
  startedAt: number;
  finishesAt: number;
}

export interface TrainingOrder {
  kind: "unit" | "defense";
  id: string;
  count: number;
  /** Gebäude, das den Auftrag ausführt; für Anlagen der Pseudo-Platz "anlagen". */
  builtIn: string;
  startedAt: number;
  finishesAt: number;
}

export interface BaseState {
  resources: ResourceMap;
  resUpdatedAt: number;
  buildings: Counts;
  /** Einheiten, die im Stützpunkt stehen. */
  units: Counts;
  /** Einheiten dieses Stützpunkts, die auf Mission sind (zählen für Unterhalt und Stellplätze). */
  unitsAway: Counts;
  defenses: Counts;
  /** Bauschlange in Reihenfolge; höchstens building.queueSlots Aufträge, der erste läuft. */
  buildQueue: BuildOrder[];
  /** Ausbildungsaufträge; höchstens einer je ausführendem Gebäude. */
  trainingQueue: TrainingOrder[];
  versorgungsmangel: boolean;
  protection: ProtectionState;
  /** Forschung dieser Saison; fehlt sie, ist nichts erforscht. */
  research?: ResearchState;
}

export interface ProductionInfo {
  /** Netto-Rate je Stunde (Grundrate + gedrosselte Gebäudeproduktion - Unterhalt). */
  perHour: ResourceMap;
  /** Gebäudeproduktion je Stunde nach Strom-Drosselung, ohne Grundrate. */
  buildingPerHour: ResourceMap;
  powerSupply: number;
  powerDemand: number;
  powerFactor: number;
  upkeepPerHour: number;
}

// ---------------------------------------------------------------- Mission

export interface GeoPoint {
  lat: number;
  lon: number;
}

export type MissionType = "ueberfall" | "aufklaerung" | "transport";

export interface MissionInput {
  type: string;
  units: Counts;
  origin: GeoPoint;
  target: GeoPoint;
  /** Anzahl bereits laufender Missionen dieses Stützpunkts. */
  activeMissions: number;
  /** Nur Transport: mitgeführte Ressourcen. */
  cargo?: ResourceMap;
  /** Schutzangaben des Ziels (Spielerstützpunkt); Überfälle auf geschützte Ziele werden abgelehnt. */
  targetProtection?: ProtectionState;
}

export interface Mission {
  type: MissionType;
  units: Counts;
  origin: GeoPoint;
  target: GeoPoint;
  distanceKm: number;
  travelSeconds: number;
  fuelCost: number;
  cargo: ResourceMap;
  departAtMs: number;
  arriveAtMs: number;
  returnAtMs: number;
  /** Zeitpunkt des Rückrufs auf der Hinfahrt; fehlt, wenn der Verband nicht zurückgerufen wurde. */
  recalledAtMs?: number;
  /** Tarnung des Angreifers: Faktor auf die Vorwarnzeit des Ziels (fehlt = 1). */
  warningFactor?: number;
}

export interface FleetCheck {
  commandPointsUsed: number;
  commandPointsAvailable: number;
  troopSize: number;
  troopSpace: number;
  cargoCapacity: number;
}

// ---------------------------------------------------------------- Kampf

export type Side = "attacker" | "defender";
export type PhaseName = "luftkampf" | "luftschlag" | "ubootangriff" | "seegefecht" | "landung";

export interface AttackerInput {
  units: Counts;
  versorgungsmangel?: boolean;
  /** Anzahl früherer Angriffe desselben Angreifers auf dieses Ziel binnen repeatWindowHours. */
  priorAttacksInWindow?: number;
  /** Zusätzlicher Truppenraum je Einheit eines Typs (Kartell: Miliz fährt auf den Schnellbooten mit). */
  troopSpaceBonus?: Record<string, number>;
  /** Beute nicht durch Ladekapazität begrenzt (Kartell-Überfall). */
  unlimitedCargo?: boolean;
  /** Ziel ist ein Schwachziel (Anteilsbeute mal loot.weakTargetLootFactor). */
  weakTarget?: boolean;
  /** Modifikatoren des Angreifers (Angriff, Lebenspunkte, Minenschaden, Ladung, Beute). */
  modifiers?: Modifiers;
}

export interface DefenderInput {
  units: Counts;
  defenses: Counts;
  versorgungsmangel?: boolean;
  /** Ressourcenbestand des Ziels (für anteilige Beute). */
  resources?: ResourceMap;
  /** Bunkerschutz je Ressource. */
  protectedPerResource?: number;
  /** Feste Beute (Piratennest) statt eines Anteils. */
  fixedLoot?: ResourceMap;
  /** Modifikatoren des Verteidigers (Angriff, Lebenspunkte). Bunkerschutz steckt schon in protectedPerResource. */
  modifiers?: Modifiers;
}

export interface PhaseReport {
  phase: PhaseName;
  /** true, wenn in der Phase nichts geschah (kein Schuss, keine Landung). */
  skipped: boolean;
  skipReason: string | null;
  rounds: number;
  /** Gesamtbestände (Einheiten und Anlagen) vor und nach der Phase. */
  before: { attacker: Counts; defender: Counts };
  after: { attacker: Counts; defender: Counts };
  /** Ausgeteilter Schaden je Einheitentyp. */
  damage: { attacker: Record<string, number>; defender: Record<string, number> };
  /** Einheitentyp mit dem meisten ausgeteilten Schaden, null ohne Schaden. */
  entscheidend: string | null;
  entscheidendSide: Side | null;
}

export interface SideOutcome {
  before: Counts;
  /** Bestand unmittelbar nach dem Kampf, vor Rückkehrern. */
  survivors: Counts;
  losses: Counts;
  /** Rückkehrer: Lazarett, reparierte Anlagen, beschädigte Flugzeuge. */
  returned: Counts;
  /** survivors + returned. */
  final: Counts;
}

export interface BattleReport {
  seed: number;
  winner: Side;
  airSuperiority: Side | null;
  landed: boolean;
  phases: PhaseReport[];
  attacker: SideOutcome;
  /** Einheiten und Anlagen des Verteidigers in einer gemeinsamen Zählung (IDs sind eindeutig). */
  defender: SideOutcome;
  loot: ResourceMap;
  wreck: ResourceMap;
}

// ---------------------------------------------------------------- Piraten

export interface NestGarrison {
  level: number;
  units: Counts;
  defenses: Counts;
  loot: ResourceMap;
}

export interface RaidForce {
  units: Counts;
  defenseHp: number;
  /** Gezogener Schwankungsfaktor der Stärke (1 ohne Seed). */
  strengthFactor: number;
  attacker: AttackerInput;
}
