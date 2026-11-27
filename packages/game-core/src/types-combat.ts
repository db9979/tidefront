// Typen für Kampf und Piraten (aus types.ts ausgelagert, dort re-exportiert).
import type { Counts, ResourceMap } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import type { CombatWeather } from "./weather.ts";
import type { BattleSetup } from "./battle-setup.ts";

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
  /** Kriegsglück: W20-Wurf je Seite in dieser Phase (seit v1.4; fehlt in älteren Berichten). */
  luck?: { attacker: number; defender: number };
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
  weather?: CombatWeather; // Wetter am Kampfort (v1.6)
  /** Eingaben des Kampfs (Modifikatoren, Versorgungsmangel, Beuteregeln); ältere Berichte ohne. */
  setup?: BattleSetup;
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
  strengthFactor: number; // gezogener Schwankungsfaktor der Stärke (1 ohne Seed)
  attacker: AttackerInput;
}
