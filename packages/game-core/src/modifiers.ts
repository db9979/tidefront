// Modifikatoren: Multiplikatoren auf Spielwerte aus Forschung (später auch Wetter, Admirale, Ereignisse).
// Jeder Wert ist ein Faktor; fehlt er, gilt 1 (neutral). Ohne Modifikatoren rechnen alle Kernfunktionen
// exakt wie zuvor (x * 1 === x). Mehrere Quellen werden je Schlüssel multipliziert (combineModifiers).
import type { Branch } from "./types.ts";

/** Gattung eines Schützen oder Ziels im Kampf; "anlage" = Verteidigungsanlagen. */
export type ModBranch = Branch | "anlage";
/** Angriffswert, der verwendet wird: gegen See, Luft, Land, Anlagen oder getauchte U-Boote (U-Jagd). */
export type ModAttackKey = "see" | "luft" | "land" | "anlage" | "uboot";

export interface Modifiers {
  /** Angriff je Gattung des Schützen (see, land, luft, anlage). */
  attack?: Partial<Record<ModBranch, number>>;
  /** Angriff je verwendetem Angriffswert (gegen See, Luft, Land, Anlagen, U-Boote = U-Jagd). */
  attackVs?: Partial<Record<ModAttackKey, number>>;
  /** Angriff je Einheitentyp (z. B. uboot, jagdbomber). */
  attackUnit?: Record<string, number>;
  /** Lebenspunkte je Gattung (see, land, luft, anlage). */
  hp?: Partial<Record<ModBranch, number>>;
  /** Tempo je Gattung (see, luft). */
  speed?: Partial<Record<Branch, number>>;
  /** Treibstoffverbrauch von Missionen. */
  fuel?: number;
  /** Bauzeit von Gebäuden. */
  buildTime?: number;
  /** Ausbildungszeit je ausführendem Gebäude (werft, kaserne, flugfeld, anlagen). */
  trainingTime?: Record<string, number>;
  /** Gebäudeproduktion je Ressource (nicht die Grundrate). */
  production?: Record<string, number>;
  /** Lagerkapazität. */
  storage?: number;
  /** Bunkerschutz (Tiefbunker). */
  bunker?: number;
  /** Radar-Vorwarnzeit des eigenen Stützpunkts. */
  radarWarning?: number;
  /** Ladekapazität eigener Verbände (Transport, Beute, Bergung). */
  cargo?: number;
  /** Beute-Anteil am ungeschützten Bestand (nicht feste Nestbeute). */
  loot?: number;
  /** Schaden, den die eigenen Landungstruppen durch Minensperren erleiden. */
  mineDamage?: number;
  /** Tarnung: Faktor auf die Vorwarnzeit, die ein Ziel gegen eigene Überfälle hat (< 1 = später erkannt). */
  stealth?: number;
  /** Forschungsdauer. */
  researchTime?: number;
  /** Spionage: Erfolgswert eigener Spione (Faktor → Würfelpunkte, espionage.ts modPoints). */
  spyAttack?: number;
  /** Gegenspionage: Abwehr des eigenen Hafens (Faktor → Würfelpunkte). */
  spyDefense?: number;
}

export const NEUTRAL_MODIFIERS: Modifiers = Object.freeze({}) as Modifiers;

type MapKey = "attack" | "attackVs" | "attackUnit" | "hp" | "speed" | "trainingTime" | "production";
type ScalarKey = "fuel" | "buildTime" | "storage" | "bunker" | "radarWarning" | "cargo" | "loot" | "mineDamage" | "stealth" | "researchTime" | "spyAttack" | "spyDefense";

export const MAP_KEYS: readonly MapKey[] = ["attack", "attackVs", "attackUnit", "hp", "speed", "trainingTime", "production"];
export const SCALAR_KEYS: readonly ScalarKey[] = ["fuel", "buildTime", "storage", "bunker", "radarWarning", "cargo", "loot", "mineDamage", "stealth", "researchTime", "spyAttack", "spyDefense"];

/** Faktor eines skalaren Schlüssels (1, wenn nicht gesetzt). */
export function modValue(mods: Modifiers | undefined, key: ScalarKey): number {
  return mods?.[key] ?? 1;
}

/** Faktor eines Eintrags in einem Kennfeld (1, wenn nicht gesetzt). */
export function modEntry(mods: Modifiers | undefined, key: MapKey, entry: string): number {
  const m = mods?.[key] as Record<string, number> | undefined;
  return m?.[entry] ?? 1;
}

/** Kombiniert Quellen multiplikativ je Schlüssel (Forschung × Wetter × Admiral …). */
export function combineModifiers(...list: (Modifiers | undefined | null)[]): Modifiers {
  const out: Modifiers = {};
  for (const m of list) {
    if (!m) continue;
    for (const k of SCALAR_KEYS) {
      const v = m[k];
      if (v !== undefined) out[k] = (out[k] ?? 1) * v;
    }
    for (const k of MAP_KEYS) {
      const src = m[k] as Record<string, number> | undefined;
      if (!src) continue;
      const dst = ((out[k] as Record<string, number> | undefined) ?? {}) as Record<string, number>;
      for (const [e, v] of Object.entries(src)) dst[e] = (dst[e] ?? 1) * v;
      (out as Record<string, unknown>)[k] = dst;
    }
  }
  return out;
}

/** Setzt einen Faktor über einen Pfad wie "fuel" oder "production.stahl" (multiplikativ). */
export function applyModPath(mods: Modifiers, path: string, factor: number): boolean {
  const [k, e] = path.split(".");
  if ((SCALAR_KEYS as readonly string[]).includes(k) && e === undefined) {
    const key = k as ScalarKey;
    mods[key] = (mods[key] ?? 1) * factor;
    return true;
  }
  if ((MAP_KEYS as readonly string[]).includes(k) && e !== undefined && e !== "") {
    const key = k as MapKey;
    const dst = ((mods[key] as Record<string, number> | undefined) ?? {}) as Record<string, number>;
    dst[e] = (dst[e] ?? 1) * factor;
    (mods as Record<string, unknown>)[key] = dst;
    return true;
  }
  return false;
}

/** Ist ein Pfad gültig ("fuel", "attack.see", "production.stahl" …)? */
export function isModPath(path: string): boolean {
  return applyModPath({}, path, 1);
}

/** Vorwarnzeit, die ein Ziel gegen einen Angreifer mit diesen Modifikatoren hat (Tarnung). */
export function warningMinutesAgainst(targetWarningMinutes: number, attackerMods?: Modifiers): number {
  return targetWarningMinutes * modValue(attackerMods, "stealth");
}
