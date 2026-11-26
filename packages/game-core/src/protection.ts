import type { Balance, ProtectionState } from "./types.ts";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

export type ProtectionReason = "nachtschild" | "anfaengerschutz" | "niederlage";

export function createProtection(
  createdAtMs: number,
  nightShieldStartHour: number | null = null,
  tzOffsetMinutes = 0,
): ProtectionState {
  return {
    createdAtMs,
    nightShieldStartHour,
    tzOffsetMinutes,
    nightShieldSuspendedUntilMs: 0,
    defeatShieldUntilMs: 0,
  };
}

/**
 * Zeitfenster des Nachtschilds: das laufende Fenster, falls nowMs darin liegt, sonst das nächste.
 * Fenster reichen über Mitternacht (z. B. Start 22 Uhr, 8 Stunden: bis 6 Uhr).
 */
export function nightShieldWindow(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): { startMs: number; endMs: number } | null {
  if (p.nightShieldStartHour === null) return null;
  const duration = balance.protection.nightShieldHours * HOUR_MS;
  const offset = p.tzOffsetMinutes * 60000;
  const local = nowMs + offset;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  // Fenster, das am Vortag, heute oder morgen beginnt.
  for (let d = -1; d <= 1; d++) {
    const start = dayStart + d * DAY_MS + p.nightShieldStartHour * HOUR_MS;
    if (local < start + duration) {
      return { startMs: start - offset, endMs: start + duration - offset };
    }
  }
  return null;
}

/** Liegt nowMs im täglichen Schildfenster (ohne Berücksichtigung einer Aufhebung)? */
export function isInNightShieldWindow(p: ProtectionState, nowMs: number, balance: Balance): boolean {
  const w = nightShieldWindow(p, nowMs, balance);
  return w !== null && nowMs >= w.startMs && nowMs < w.endMs;
}

export function isNightShieldActive(p: ProtectionState, nowMs: number, balance: Balance): boolean {
  return isInNightShieldWindow(p, nowMs, balance) && nowMs >= p.nightShieldSuspendedUntilMs;
}

/** Eigener Angriff: hebt den Nachtschild für diese (laufende oder nächste) Nacht auf. */
export function suspendNightShield(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): ProtectionState {
  const w = nightShieldWindow(p, nowMs, balance);
  if (w === null) return { ...p };
  return { ...p, nightShieldSuspendedUntilMs: Math.max(p.nightShieldSuspendedUntilMs, w.endMs) };
}

export function isBeginnerProtected(p: ProtectionState, nowMs: number, balance: Balance): boolean {
  return nowMs < p.createdAtMs + balance.protection.beginnerDays * DAY_MS;
}

export function isDefeatShieldActive(p: ProtectionState, nowMs: number): boolean {
  return nowMs < p.defeatShieldUntilMs;
}

/** Nach verlorener Verteidigung: Schutz für afterDefeatShieldHours. */
export function applyDefeatShield(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): ProtectionState {
  const until = nowMs + balance.protection.afterDefeatShieldHours * HOUR_MS;
  return { ...p, defeatShieldUntilMs: Math.max(p.defeatShieldUntilMs, until) };
}

/** Gesamtstatus; bei mehreren Gründen in der Reihenfolge Anfängerschutz, Niederlage, Nachtschild. */
export function protectionStatus(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): { protected: boolean; reason: ProtectionReason | null } {
  if (isBeginnerProtected(p, nowMs, balance)) return { protected: true, reason: "anfaengerschutz" };
  if (isDefeatShieldActive(p, nowMs)) return { protected: true, reason: "niederlage" };
  if (isNightShieldActive(p, nowMs, balance)) return { protected: true, reason: "nachtschild" };
  return { protected: false, reason: null };
}
