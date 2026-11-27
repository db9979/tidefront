// Typen für Erfolge, Wochenziele, Kriegsglück, Veteranen und Forschung (aus types.ts ausgelagert, dort re-exportiert).
import type { Counts, ResourceMap } from "./types.ts";

// ---------------------------------------------------------------- Erfolge (Abzeichen) und Wochenziele

/** Belohnung einer Erfolgsstufe: Kredite und Ressourcen, einmalig. */
export type AchievementReward = Record<string, number>;

export interface AchievementDef {
  title: string;
  description: string;
  /** Zähler (achievement_counter), z. B. nester, beute, spionage. */
  counter: string;
  /** Schwellen für Bronze, Silber, Gold (aufsteigend). */
  thresholds: [number, number, number];
  /** Anzeigetexte der Stufen statt „Zahl/Schwelle“ (z. B. Saisonplatzierung). */
  tierTexts?: [string, string, string];
  /** Eigene Belohnungen je Stufe; sonst die gemeinsamen. */
  rewards?: [AchievementReward, AchievementReward, AchievementReward];
}

export interface AchievementsBalance {
  /** Gemeinsame Belohnung je Stufe (Bronze, Silber, Gold). */
  rewards: [AchievementReward, AchievementReward, AchievementReward];
  list: Record<string, AchievementDef>;
  /** Erfolg „Kaufmann“ und Wochenziel „Geschäfte“ zählen nur Börsengeschäfte ab diesem Wert (Kredite, seit 0.24.4). */
  minCountedTradeCredits?: number;
  weekly: {
    /** Ressourcenwert je Ziel bei Kommandozentrale 0; wächst um stageGrowth je Stufe. */
    goalValue: number;
    goalCredits: number;
    /** Wochenbonus bei allen drei Zielen. */
    bonusValue: number;
    bonusCredits: number;
    stageGrowth: number;
  };
}

/** Würfel des Kriegsglücks: 1 = min, die = max, dazwischen linear innerMin … innerMax (luck.ts). */
export interface LuckBalance {
  die: number;
  min: number;
  max: number;
  innerMin: number;
  innerMax: number;
}

export interface VeteranRank {
  id: string;
  name: string;
  /** Mindesterfahrung (Durchschnitt je Einheit des Typs). */
  minXp: number;
  /** Angriffsbonus (0,05 = +5 %). */
  attackBonus: number;
}

export interface VeteranBalance {
  /** Ränge aufsteigend nach minXp; der erste hat minXp 0 (Rekrut). */
  ranks: VeteranRank[];
  /** Erfahrung je überlebender Einheit nach einem Sieg bzw. einer Niederlage (vor dem Stärkefaktor). */
  xpWin: number;
  xpLoss: number;
  /** Stärkefaktor = gegnerische / eigene Lebenspunkte vor dem Kampf, begrenzt auf [ratioMin, ratioMax]. */
  ratioMin: number;
  ratioMax: number;
  /** Verluste: Erfahrung × (1 − lossPenalty × Anteil der verlorenen Einheiten am Bestand des Typs). */
  lossPenalty: number;
  /** Obergrenze der Erfahrung je Typ. */
  maxXp: number;
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
