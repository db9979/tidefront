import type {
  Balance,
  Counts,
  DefenderInput,
  NestGarrison,
  ProtectionState,
  RaidForce,
  ResourceMap,
  Result,
} from "./types.ts";
import type { ProtectionReason } from "./protection.ts";
import { protectionStatus } from "./protection.ts";
import { mulberry32, randomFactor } from "./rng.ts";
import type { Modifiers } from "./modifiers.ts";
import { modEntry } from "./modifiers.ts";

const HOUR_MS = 3600000;

/** Besatzung (Einheiten, Anlagen) und feste Beute eines Nests. Code: unknown_nest_level. */
export function nestGarrison(level: number, balance: Balance): Result<{ nest: NestGarrison }> {
  const def = balance.pirates.nestLevels[String(level)];
  if (def === undefined) return { ok: false, code: "unknown_nest_level" };
  const units: Counts = {};
  const defenses: Counts = {};
  for (const [id, value] of Object.entries(def)) {
    if (typeof value !== "number" || id === "respawnHours") continue;
    if (Object.hasOwn(balance.defenses, id)) defenses[id] = value;
    else units[id] = value;
  }
  const loot: ResourceMap = {};
  for (const r of balance.resources) loot[r] = def.loot[r] ?? 0;
  return { ok: true, nest: { level, units, defenses, loot } };
}

/** Nest als Verteidiger für resolveBattle (feste Beute). */
export function nestDefender(level: number, balance: Balance): Result<{ defender: DefenderInput }> {
  const g = nestGarrison(level, balance);
  if (!g.ok) return g;
  return { ok: true, defender: { units: g.nest.units, defenses: g.nest.defenses, fixedLoot: g.nest.loot } };
}

/** Wiederkehr eines Nests in Stunden: eigene der Stufe (respawnHours) oder pirates.nestRespawnHours. */
export function nestRespawnHours(balance: Balance, level?: number): number {
  const own = level === undefined ? undefined : balance.pirates.nestLevels[String(level)]?.respawnHours;
  return typeof own === "number" && own > 0 ? own : balance.pirates.nestRespawnHours;
}

/** Ist ein besiegtes Nest wieder besetzt? Ohne Stufe gilt die allgemeine Wiederkehr. */
export function isNestRespawned(defeatedAtMs: number, nowMs: number, balance: Balance, level?: number): boolean {
  return nowMs >= defeatedAtMs + nestRespawnHours(balance, level) * HOUR_MS;
}

/** Lebenspunkte der Verteidigung: Schiffe, Bodentruppen und Anlagen des Stützpunkts (ohne Flugzeuge). */
export function defenseHp(units: Counts, defenses: Counts, balance: Balance): number {
  let hp = 0;
  for (const [id, n] of Object.entries(units)) {
    const def = balance.units[id] ?? balance.npcUnits[id];
    if (def !== undefined && def.branch !== "luft") hp += def.hp * Math.max(0, n);
  }
  for (const [id, n] of Object.entries(defenses)) {
    const def = balance.defenses[id];
    if (def !== undefined) hp += def.hp * Math.max(0, n);
  }
  return hp;
}

/** Gewicht einer Einheit oder Anlage für die Überfallstärke (`raidHpWeights`, v1.13): erst die ID, dann die Gattung, sonst 1. */
export function raidHpWeight(id: string, branch: string | undefined, balance: Balance): number {
  const w = balance.pirates.raidHpWeights;
  if (!w) return 1;
  return w[id] ?? (branch !== undefined ? w[branch] : undefined) ?? 1;
}

/**
 * Lebenspunkte der Verteidigung, die das Kartell ansetzt: je Einheit bzw. Anlage gewichtet mit `raidHpWeights` (v1.13,
 * Schiffe zählen geringer), angehoben um den Anteil `raidResearchWeight` des Lebenspunkte-Zuwachses aus den Modifikatoren
 * des Verteidigers (v1.7; Forschung: hp je Gattung, Anlagen `anlage`). Ohne Gewichte und Modifikatoren genau `defenseHp`.
 */
export function raidDefenseHp(units: Counts, defenses: Counts, balance: Balance, mods?: Modifiers): number {
  const w = mods ? (balance.pirates.raidResearchWeight ?? 0) : 0;
  let raw = 0;
  let boosted = 0;
  for (const [id, n] of Object.entries(units)) {
    const def = balance.units[id] ?? balance.npcUnits[id];
    if (def === undefined || def.branch === "luft") continue;
    const hp = def.hp * Math.max(0, n) * raidHpWeight(id, def.branch, balance);
    raw += hp;
    if (w > 0) boosted += hp * modEntry(mods, "hp", def.branch);
  }
  for (const [id, n] of Object.entries(defenses)) {
    const def = balance.defenses[id];
    if (def === undefined) continue;
    const hp = def.hp * Math.max(0, n) * raidHpWeight(id, undefined, balance);
    raw += hp;
    if (w > 0) boosted += hp * modEntry(mods, "hp", "anlage");
  }
  if (w <= 0 || raw <= 0) return raw;
  return raw + w * (boosted - raw);
}

/** Schwankungsfaktor der Überfallstärke: gleichverteilt in [1 - raidStrengthSpread, 1 + raidStrengthSpread]; ohne Seed 1. */
export function raidStrengthFactor(balance: Balance, seed?: number): number {
  if (seed === undefined) return 1;
  return randomFactor(mulberry32(seed), balance.pirates.raidStrengthSpread);
}

/**
 * Stellt einen Kartell-Überfall passend zur Verteidigung zusammen. Grundstärke in Booten:
 * raidStrengthShareOfDefense der Verteidigungs-Lebenspunkte (Schiffe, Bodentruppen, Anlagen)
 * geteilt durch die Lebenspunkte eines Schnellboots, mindestens raidMinSchnellboote. Mit Seed
 * schwankt sie um raidStrengthSpread. Miliz = Grundstärke * Faktor * raidMiliPerBoot (gerundet),
 * Boote = Miliz / raidMiliPerBoot (aufgerundet), damit jeder Milizionär einen Platz hat.
 * `mods` (v1.7): Modifikatoren des Verteidigers; die Forschung hebt die Lebenspunkte anteilig an (`raidDefenseHp`).
 */
export function composeRaid(units: Counts, defenses: Counts, balance: Balance, seed?: number, mods?: Modifiers): RaidForce {
  const p = balance.pirates;
  const hp = raidDefenseHp(units, defenses, balance, mods);
  const boatHp = balance.npcUnits.schnellboot.hp;
  const base = Math.max(p.raidMinSchnellboote, (hp * p.raidStrengthShareOfDefense) / boatHp);
  const factor = raidStrengthFactor(balance, seed);
  const miliz = Math.max(1, Math.round(base * factor * p.raidMiliPerBoot));
  const boats = Math.ceil(miliz / p.raidMiliPerBoot - 1e-9);
  const force: Counts = { schnellboot: boats, piratenmiliz: miliz };
  return {
    units: force,
    defenseHp: hp,
    strengthFactor: factor,
    attacker: {
      units: { ...force },
      // Eigene Landungskapazität: die Miliz fährt auf den Schnellbooten mit.
      troopSpaceBonus: { schnellboot: p.raidMiliPerBoot * (balance.npcUnits.piratenmiliz.size ?? 1) },
      unlimitedCargo: true,
    },
  };
}

/** Ist der nächste Überfall auf einen Stützpunkt fällig? */
export function isRaidDue(lastRaidAtMs: number, nowMs: number, balance: Balance): boolean {
  return nowMs >= lastRaidAtMs + balance.pirates.raidIntervalHours * HOUR_MS;
}

/** Entfällt ein Überfall wegen Nachtschild, Anfängerschutz oder Schutz nach Niederlage? */
export function raidBlocked(
  protection: ProtectionState,
  nowMs: number,
  balance: Balance,
): { blocked: boolean; reason: ProtectionReason | null } {
  const status = protectionStatus(protection, nowMs, balance);
  return { blocked: status.protected, reason: status.reason };
}
