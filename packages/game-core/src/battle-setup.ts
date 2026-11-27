// Kampfbedingungen im Bericht: resolveBattle legt neben dem Ergebnis ab, mit welchen Eingaben gerechnet wurde
// (Modifikatoren aus Forschung/Admiral/Veteranen, Versorgungsmangel, Beuteregeln). Damit lässt sich ein Bericht
// später im Kampfsimulator nachstellen. Nur kampfrelevante Werte; Bestände des Ziels werden NICHT abgelegt
// (Beute aus Anteil: shareLoot = true).
import type { Counts, ResourceMap } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import type { AttackerInput, DefenderInput } from "./types-combat.ts";

export interface BattleSetupSide {
  versorgungsmangel?: boolean;
  /** Kampfwirksame Modifikatoren (Angriff, Lebenspunkte, Ladung, Beute, Minenschaden). */
  modifiers?: Modifiers;
  /** Vom Server entfernt, wenn der Gegner des Lesers ein Spieler ist (dessen Forschung bleibt geheim). */
  modifiersHidden?: boolean;
  troopSpaceBonus?: Record<string, number>;
  unlimitedCargo?: boolean;
  weakTarget?: boolean;
  priorAttacksInWindow?: number;
  protectedPerResource?: number;
  fixedLoot?: ResourceMap;
  /** Beute als Anteil am Bestand des Ziels (Bestand nicht gespeichert). */
  shareLoot?: boolean;
}

export interface BattleSetup {
  attacker: BattleSetupSide;
  defender: BattleSetupSide;
}

const COMBAT_MAP_KEYS = ["attack", "attackVs", "attackUnit", "hp"] as const;
const COMBAT_SCALAR_KEYS = ["cargo", "loot", "nestLoot", "mineDamage"] as const;

/** Nur die im Kampf wirksamen Schlüssel, neutrale Werte (1) weggelassen; undefined ohne Wirkung. */
export function combatModifiers(m: Modifiers | undefined): Modifiers | undefined {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of COMBAT_MAP_KEYS) {
    const src = m[k] as Record<string, number> | undefined;
    if (!src) continue;
    const kept = Object.fromEntries(Object.entries(src).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 1));
    if (Object.keys(kept).length) out[k] = kept;
  }
  for (const k of COMBAT_SCALAR_KEYS) {
    const v = m[k];
    if (typeof v === "number" && Number.isFinite(v) && v !== 1) out[k] = v;
  }
  return Object.keys(out).length ? (out as Modifiers) : undefined;
}

const nonEmpty = (c: Counts | undefined) => !!c && Object.values(c).some((v) => v > 0);

export function battleSetup(attacker: AttackerInput, defender: DefenderInput): BattleSetup {
  const a: BattleSetupSide = {};
  if (attacker.versorgungsmangel) a.versorgungsmangel = true;
  const am = combatModifiers(attacker.modifiers);
  if (am) a.modifiers = am;
  if (nonEmpty(attacker.troopSpaceBonus)) a.troopSpaceBonus = { ...attacker.troopSpaceBonus };
  if (attacker.unlimitedCargo) a.unlimitedCargo = true;
  if (attacker.weakTarget) a.weakTarget = true;
  if (attacker.priorAttacksInWindow) a.priorAttacksInWindow = attacker.priorAttacksInWindow;
  const d: BattleSetupSide = {};
  if (defender.versorgungsmangel) d.versorgungsmangel = true;
  const dm = combatModifiers(defender.modifiers);
  if (dm) d.modifiers = dm;
  if (defender.protectedPerResource !== undefined) d.protectedPerResource = defender.protectedPerResource;
  if (defender.fixedLoot) d.fixedLoot = { ...defender.fixedLoot };
  else if (defender.resources) d.shareLoot = true;
  return { attacker: a, defender: d };
}
