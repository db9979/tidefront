// Gemeinsame Typen des Regelkerns. Nur löschbare Typ-Syntax (kein enum, kein namespace).
import type { AdmiralBalance } from "./admirals.ts"; // Admirale
import type { ContractsBalance, MarketNewsBalance } from "./market/types.ts";
import type { EspionageBalance, IntelState } from "./espionage.ts";
import type { RouteWeather, WeatherBalance } from "./weather.ts";
import type { PowerBalance, PowerSnapshot } from "./power.ts";
import type { CableLink, PowerLog } from "./power-green.ts";
import type { BlockadeBalance, ConvoysBalance, MinesBalance } from "./naval.ts"; // See: Minen/Blockade/Konvoi
import type { ExpansionDef } from "./expansion.ts"; // Mehrere Häfen

// Ausgelagert (Dateien unter 500 Zeilen), hier re-exportiert: Fortschritt und Kampf.
import type { AchievementsBalance, LuckBalance, VeteranBalance, ResearchBalance, ResearchState } from "./types-progress.ts";
export type { AchievementReward, AchievementDef, AchievementsBalance, LuckBalance, VeteranRank, VeteranBalance, TechEffect, TechDef, ResearchBalance, ResearchOrder, BreakthroughChoice, ResearchRoll, ResearchState } from "./types-progress.ts";
export type { Side, PhaseName, AttackerInput, DefenderInput, PhaseReport, SideOutcome, BattleReport, NestGarrison, RaidForce } from "./types-combat.ts";

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

/**
 * Stufenabhängige Kostenmischung (v1.29): Beim Ausbau von Stufe L auf L+1 wird der Anteil min(max, perLevel × L) der
 * Stahlkosten zum Börsen-Richtpreis (market.refPrice) wertgleich auf andere Rohstoffe umgelegt, gewichtet nach `to`
 * (bzw. BuildingDef.costShiftTo). Höhere Stufen verlagern also mehr; der Gesamtwert bleibt (bis auf Rundung) gleich.
 */
export interface CostShift {
  perLevel: number;
  max: number;
  to: ResourceMap;
}

export interface BuildingDef {
  cost: ResourceMap;
  /** Kostenverschiebung (v1.29): Zielmischung des von Stahl verlagerten Werts; ohne Angabe building.costShift.to. */
  costShiftTo?: ResourceMap;
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
  /** Spätspiel (v1.24): ab dieser Stufe der Kommandozentrale gibt jede Stufe commandPointsLatePerLevel statt commandPointsPerLevel. */
  commandPointsLateFromLevel?: number;
  commandPointsLatePerLevel?: number;
  missionSlotsBase?: number;
  missionSlotsPerTwoLevels?: number;
  marketFromLevel?: number;
  creditLimitPerLevel?: number;
  warningMinutesBase?: number;
  warningMinutesPerLevel?: number;
  /** Forschungsamt: Forschung je Stufe über 1 schneller (0,1 = +10 %). */
  researchSpeedPerLevel?: number;
  /** Strom (v1.6): Rang bei Mangel, Kraftwerk-Treibstoff, Windpark, Solarfeld, Speicherwerk (siehe power.ts). */
  powerRank?: number;
  fuelPerHourPerLevel?: number;
  windPowerPerLevel?: number;
  stormCutoff?: number;
  solarPowerPerLevel?: number;
  cloudLoss?: number;
  storagePerLevel?: number;
  storageRatePerLevel?: number;
  /** Elektrolyse (v1.21): Aufnahme an Ökostrom-Überschuss je Stufe (Strom/h) und Strom je Treibstoff. */
  electrolysisPerLevel?: number;
  electrolysisRatio?: number;
  /** Seekabel-Station (v1.21): Kabelleistung je Stufe (Strom/h). */
  cablePerLevel?: number;
  /** Voraussetzung (v1.23, z. B. Startrampe): andere Gebäude dieses Hafens mindestens auf dieser Stufe. */
  requires?: Record<string, number>;
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
  /** Verdeckte Einheit (Spion): kämpft nicht, fährt nicht in Verbänden mit, nur für Spionageaufträge. */
  covert?: boolean;
  /** Höchstzahl je Stufe des Baugebäudes (daheim, unterwegs, in Ausbildung). */
  maxPerLevel?: number;
  /** See: Minen/Blockade/Konvoi – Minenstärke, die ein Schiff legt (Minenleger) bzw. räumt (Minenräumer). */
  mineLayer?: number;
  mineSweeper?: number;
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
  /** Optional (v1.15): eigene Wiederkehr in Stunden statt pirates.nestRespawnHours. Kein Teil der Besatzung. */
  respawnHours?: number;
  [unitOrDefenseId: string]: number | ResourceMap | undefined;
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
  /** Marktnachrichten (seit v1.5). */
  news?: MarketNewsBalance;
  /** Lieferverträge (seit v1.31, market/contracts.ts). */
  contracts?: ContractsBalance;
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
    /** Stufenabhängige Kostenmischung (v1.29), siehe upgradeCost. */
    costShift?: CostShift;
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
    /** Kriegsglück (seit v1.4): ein Würfel je Phase und Seite als Schadensfaktor; fehlt es, kein Würfel. */
    luck?: LuckBalance;
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
    /** Anteil des Lebenspunkte-Zuwachses aus der Forschung des Verteidigers, den das Kartell mitzählt (v1.7; fehlt: 0). */
    raidResearchWeight?: number;
    /**
     * Gewicht der Lebenspunkte für die Überfallstärke je Einheit (ID) oder Gattung (`see`, `land`), Anlagen je ID
     * (v1.13; fehlt ein Eintrag: 1). Schiffe kämpfen nicht am Boden und zählen deshalb geringer.
     */
    raidHpWeights?: Record<string, number>;
    /** Lebendige Nester (nest-living.ts): Wurf je Besetzung, Erholung, Beutewachstum; fehlt er, sind Nester fest. */
    living?: import("./nest-living.ts").LivingBalance;
  };
  market: MarketBalance;
  /** Wertung (seit v1.24, engine/scoring.ts); fehlt es, zählt jeder Kampf voll. */
  scoring?: ScoringBalance;
  /** Forschung (seit v1.3); fehlt sie, gibt es keine Forschung. */
  research?: ResearchBalance;
  /** Veteranen (seit v1.4); fehlt es, sammeln Einheiten keine Erfahrung. */
  veterans?: VeteranBalance;
  /** Nachrichtendienst und Spionage (espionage.ts); fehlt es, gibt es keine Spionage. */
  espionage?: EspionageBalance;
  weather?: WeatherBalance; // Wetter (seit v1.6); fehlt es, rechnen Wind und Sonne mit 0
  power?: PowerBalance;
  admirals?: AdmiralBalance; // Admirale (admirals.ts); fehlt es, gibt es keine Admirale
  /** Erfolge und Wochenziele (Erfolge); fehlt es, gibt es keine Abzeichen und Wochenziele. */
  achievements?: AchievementsBalance;
  /** Allianz-Ops: Sammelangriff und Stationierung (alliance-ops.ts); fehlt es, gelten die Vorgaben. */
  allianceOps?: import("./alliance-ops.ts").AllianceOpsBalance;
  // See: Minen/Blockade/Konvoi (naval.ts); fehlt ein Block, ist das System aus.
  mines?: MinesBalance;
  blockade?: BlockadeBalance;
  convoys?: ConvoysBalance;
  /** Mehrere Häfen: Gründung und Verlegung (expansion.ts); fehlt es, gibt es keine Außenposten. */
  expansion?: ExpansionDef;
  /** Lagebild (seit v1.17, intel.ts); fehlt es, sieht jeder alles (kein Kartennebel). */
  intel?: import("./intel.ts").IntelBalance;
  /** Spieler gegen Spieler (Kopfgeld, Mutfaktor, Paarbremse; pvp.ts); fehlt es, zählt jeder Kampf ohne diese Faktoren. */
  pvp?: import("./pvp.ts").PvpBalance;
  /** Aufholhilfe (catch-up.ts): Baugutschrift für Häfen weit unter dem Median; fehlt es, gibt es keine. */
  catchUp?: import("./catch-up.ts").CatchUpBalance;
  /** Weltpolitik (politik-*.ts): Gezeit, Seerat, Ansehen, Gesuche; fehlt es, gibt es keine Weltpolitik. */
  politik?: import("./politik-balance.ts").PolitikBalance;
}

/** Wertung (v1.24). Punkte bewerten Ressourcen zum Börsen-Richtpreis (market.refPrice). */
export interface ScoringBalance {
  /**
   * Faktor auf Kampfpunkte gegen das Kartell bzw. NPC: Abwehr von Überfällen ohne angreifenden Spieler (Kartell, Großflotte,
   * Konvoi, Feld) und Angriffe auf die Weltereignisse in npcWorldEventKinds.
   */
  npcDefenseFactor: number;
  /** Weltereignisse, deren Bekämpfung als Abwehr zählt (Großflotte, Belagerungsring). */
  npcWorldEventKinds?: string[];
  /** Saisonfinale: Faktor auf Kampfpunkte aus Kämpfen gegen die Armada (Weltereignis finale). */
  armadaFactor?: number;
  /** v1.35 (Nutzerentscheid 3): Faktor auf Kampf- und Beutepunkte aus Nestüberfällen; fehlt er, zählen Nester voll. */
  nestFactor?: number;
  /**
   * v1.35 (Nutzerentscheid 4): Befehle zählen höchstens mit diesem Anteil am Gesamtrang (Deckel: Befehle ≤ Anteil ×
   * Gesamt, also ≤ Anteil/(1 − Anteil) × übrige Punkte); fehlt er, zählen sie unbegrenzt.
   */
  ordersMaxShare?: number;
}
// ---------------------------------------------------------------- Ergebnis

export type Fail = { ok: false; code: string };
export type Result<T> = ({ ok: true } & T) | Fail;

// ---------------------------------------------------------------- Stützpunkt

export interface ProtectionState {
  /** Gründungszeitpunkt des Stützpunkts (Beginn des Anfängerschutzes; Kolonien erben den des Heimathafens). */
  createdAtMs: number;
  /** Mehrere Häfen: Gründungsschutz einer Kolonie bis zu diesem Zeitpunkt (fehlt sonst). */
  foundingShieldUntilMs?: number;
  /** Startstunde des Nachtschilds 0..23 in Ortszeit des Spielers; null = nicht gewählt. */
  nightShieldStartHour: number | null;
  /** Versatz der Ortszeit zu UTC in Minuten (z. B. 60 für MEZ); Rückfall, wenn timeZone fehlt (ältere Stände). */
  tzOffsetMinutes: number;
  /** IANA-Zeitzone des Spielers (z. B. "Europe/Berlin"): Startstunde folgt der Sommerzeit. */
  timeZone?: string;
  /** Nachtschild ist bis zu diesem Zeitpunkt aufgehoben (eigener Angriff). */
  nightShieldSuspendedUntilMs: number;
  /** Schutz nach verlorener Verteidigung bis zu diesem Zeitpunkt. */
  defeatShieldUntilMs: number;
  /** PvP-Vorlage: Anfängerschutz vorzeitig beendet (eigener Überfall auf einen Spielerhafen) zu diesem Zeitpunkt. */
  beginnerEndedAtMs?: number;
  /** Vorgemerkte Nachtschild-Einstellung, gültig ab fromMs (fehlt in älteren Ständen). */
  nightShieldNext?: { startHour: number | null; tzOffsetMinutes: number; timeZone?: string; fromMs: number } | null;
  /** Zeitpunkt der letzten Änderung durch den Spieler (fehlt in älteren Ständen). */
  nightShieldChangedAtMs?: number;
}

export interface BuildOrder {
  buildingId: string;
  targetLevel: number;
  startedAt: number;
  finishesAt: number;
  /** Aufholhilfe: aus der Baugutschrift bezahlter Teil der Kosten (Abbruch erstattet ihn in die Gutschrift zurück). */
  credit?: ResourceMap;
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
  /** Erfahrung je Einheitentyp (Durchschnitt je Einheit, Stützpunkt und Saison); fehlt sie, sind alle Rekruten. */
  veterancy?: Record<string, number>;
  /** Nachrichtendienst: Sabotage, Desinformation, Erfahrung (espionage.ts); fehlt er, ist nichts davon aktiv. */
  intel?: IntelState;
  /** Lage des Hafens für das Wetter (v1.6; fehlt sie, gilt power.ts DEFAULT_SITE) und Ladung des Speicherwerks. */
  site?: GeoPoint;
  powerStored?: number;
  /** Ökostrom, Elektrolyse, Seekabel (v1.21, power-green.ts): Zähler und Stundenwerte des Netzes. */
  powerLog?: PowerLog;
  /** Seekabel (v1.21): höchstens ein Kabel je Hafen (abgebend oder empfangend). */
  cable?: CableLink | null;
  /** Mehrere Häfen: nur bei Kolonien (gegründet per Kolonieschiff); fehlt im Heimathafen. */
  colony?: { foundedAtMs: number };
  /** Lagebild Stufe 3 (v1.23, intel-sat.ts): von hier gestartete Satelliten (abgelaufene räumt der Server). */
  satellites?: import("./intel-sat.ts").SatelliteState[];
  /** Aufholhilfe (catch-up.ts): Konto der Baugutschrift; zählt nicht zum Lager, nicht plünder- oder handelbar. */
  catchUp?: import("./catch-up.ts").CatchUpState;
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
  grid: PowerSnapshot; // Stromnetz im Augenblick (Quellen, Rangfolge, Speicher, Wetter)
}

// ---------------------------------------------------------------- Mission

export interface GeoPoint {
  lat: number;
  lon: number;
}

export type MissionType = "ueberfall" | "aufklaerung" | "transport"
  // See: Minen/Blockade/Konvoi – nur serverseitig geplant (naval-*.ts), nicht in MISSION_TYPES.
  | "minen" | "raeumen" | "blockade" | "abfangen" | "geleit"
  | "besetzen" // Felder: Rohstofffeld besetzen (fields-*.ts)
  | "gruendung" | "verlegung" | "patrouille" | "radarposten"; // Mehrere Häfen (expansion.ts); Lagebild Stufe 2 (intel-ops.ts)

export interface MissionInput {
  type: string;
  units: Counts;
  origin: GeoPoint;
  target: GeoPoint;
  /** Anzahl bereits laufender Missionen dieses Stützpunkts. */
  activeMissions: number;
  /** Nur Transport, Gründung, Verlegung: mitgeführte Ressourcen. */
  cargo?: ResourceMap;
  targetProtection?: ProtectionState; // Schutz des Ziels; Überfälle auf geschützte Ziele werden abgelehnt
  weather?: RouteWeather; // Wetter entlang der Route bei Abfahrt (v1.6); fehlt es, kein Wettereinfluss
  /** Seewege: vorgegebene Route (null = Luftlinie erzwingen); fehlt sie, rechnet planMission sie bei Schiffen selbst. */
  route?: MissionRoute | null;
  /** PvP: Überfall auf einen Spielerhafen – beendet den eigenen Anfängerschutz (balance.pvp.beginnerEndsOnPlayerRaid). */
  playerHarbor?: boolean;
  /** Aufklärung auf Sicht (balance.intel.sightRecon): Mission „aufklaerung“ kehrt am Wendepunkt um (recon-sight.ts). */
  sightRecon?: boolean;
}

/** Seewege: Route eines Verbands mit Schiffen (Wegpunkte als [Spalte, Zeile], Länge in km); siehe @tidefront/world seaRoute. */
export interface MissionRoute {
  hexes: [number, number][];
  km: number;
  partial?: boolean;
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
  recalledAtMs?: number; // Rückruf auf der Hinfahrt; fehlt ohne Rückruf
  warningFactor?: number; // Tarnung des Angreifers: Faktor auf die Vorwarnzeit des Ziels (fehlt = 1)
  detectedAtMs?: number; // vom Radar des Ziels erkannt (Server); einmal erkannt bleibt erkannt
  weather?: { avgWind: number; storminess: number; shipFactor: number }; // Wetter bei Abfahrt (v1.6)
  admiralId?: number; // Admirale: Führer des Verbands (Server); fehlt ohne Admiral
  route?: MissionRoute; // Seewege: Route über Wasser (mit Schiffen); fehlt = Luftlinie (auch alte Missionen)
  sightTurn?: import("./recon-sight.ts").SightTurn; // Aufklärung auf Sicht: Wendepunkt (fehlt = bis ans Ziel)
  foundingFee?: ResourceMap; // v1.35: Gründungsgebühr ab dem 3. Hafen (Server); kommt zurück, wenn die Gründung scheitert
}

export interface FleetCheck {
  commandPointsUsed: number;
  commandPointsAvailable: number;
  troopSize: number;
  troopSpace: number;
  cargoCapacity: number;
}
