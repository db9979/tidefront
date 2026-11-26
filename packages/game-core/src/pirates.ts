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

const HOUR_MS = 3600000;

/** Besatzung (Einheiten, Anlagen) und feste Beute eines Nests. Code: unknown_nest_level. */
export function nestGarrison(level: number, balance: Balance): Result<{ nest: NestGarrison }> {
  const def = balance.pirates.nestLevels[String(level)];
  if (def === undefined) return { ok: false, code: "unknown_nest_level" };
  const units: Counts = {};
  const defenses: Counts = {};
  for (const [id, value] of Object.entries(def)) {
    if (typeof value !== "number") continue;
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

/** Ist ein besiegtes Nest wieder besetzt? */
export function isNestRespawned(defeatedAtMs: number, nowMs: number, balance: Balance): boolean {
  return nowMs >= defeatedAtMs + balance.pirates.nestRespawnHours * HOUR_MS;
}

/** Lebenspunkte der Verteidigung: Schiffe und Anlagen des Stützpunkts. */
export function defenseHp(units: Counts, defenses: Counts, balance: Balance): number {
  let hp = 0;
  for (const [id, n] of Object.entries(units)) {
    const def = balance.units[id] ?? balance.npcUnits[id];
    if (def !== undefined && def.branch === "see") hp += def.hp * Math.max(0, n);
  }
  for (const [id, n] of Object.entries(defenses)) {
    const def = balance.defenses[id];
    if (def !== undefined) hp += def.hp * Math.max(0, n);
  }
  return hp;
}

/**
 * Stellt einen Kartell-Überfall passend zur Verteidigung zusammen: so viele Schnellboote,
 * dass ihre Lebenspunkte raidStrengthShareOfDefense der Verteidigungs-Lebenspunkte erreichen
 * (aufgerundet, mindestens raidMinSchnellboote), je Boot raidMiliPerBoot Milizionäre.
 */
export function composeRaid(units: Counts, defenses: Counts, balance: Balance): RaidForce {
  const p = balance.pirates;
  const hp = defenseHp(units, defenses, balance);
  const boatHp = balance.npcUnits.schnellboot.hp;
  const boats = Math.max(p.raidMinSchnellboote, Math.ceil((hp * p.raidStrengthShareOfDefense) / boatHp - 1e-9));
  const force: Counts = { schnellboot: boats, piratenmiliz: boats * p.raidMiliPerBoot };
  return {
    units: force,
    defenseHp: hp,
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
