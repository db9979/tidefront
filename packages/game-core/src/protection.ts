import type { Balance, ProtectionState } from "./types.ts";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

export type ProtectionReason = "nachtschild" | "anfaengerschutz" | "niederlage" | "gruendungsschutz";

export function createProtection(
  createdAtMs: number,
  nightShieldStartHour: number | null = null,
  tzOffsetMinutes = 0,
  timeZone: string | null = null,
): ProtectionState {
  return {
    createdAtMs,
    nightShieldStartHour,
    tzOffsetMinutes,
    ...(timeZone && validTimeZone(timeZone) ? { timeZone } : {}),
    nightShieldSuspendedUntilMs: 0,
    defeatShieldUntilMs: 0,
  };
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat | null {
  if (!zoneFormats.has(timeZone)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
      });
    } catch {
      f = null;
    }
    zoneFormats.set(timeZone, f);
  }
  return zoneFormats.get(timeZone) ?? null;
}

/** Gültiger IANA-Zeitzonenname (z. B. "Europe/Berlin")? */
export function validTimeZone(timeZone: string | null | undefined): timeZone is string {
  return typeof timeZone === "string" && timeZone.length > 0 && timeZone.length <= 64 && zoneFormat(timeZone) !== null;
}

/** Versatz der Ortszeit zu UTC in Minuten zum Zeitpunkt ms (Sommerzeit berücksichtigt). */
export function zoneOffsetAt(timeZone: string, ms: number): number {
  const f = zoneFormat(timeZone);
  if (!f) return 0;
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Fenster für eine feste Einstellung: das laufende, falls nowMs darin liegt, sonst das nächste. Mit IANA-Zeitzone
 * folgt die Startstunde der Ortszeit samt Sommerzeit; ältere Stände ohne timeZone rechnen mit dem festen Versatz.
 */
function windowFor(startHour: number | null, tzOffsetMinutes: number, nowMs: number, duration: number, timeZone?: string | null) {
  if (startHour === null) return null;
  const zone = validTimeZone(timeZone) ? timeZone : null;
  const offsetAt = (ms: number) => (zone ? zoneOffsetAt(zone, ms) : tzOffsetMinutes) * 60000;
  const offset = offsetAt(nowMs);
  const local = nowMs + offset;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  // Fenster, das am Vortag, heute oder morgen beginnt.
  for (let d = -1; d <= 1; d++) {
    const localStart = dayStart + d * DAY_MS + startHour * HOUR_MS;
    // Versatz zum Beginn des Fensters (kann an Umstellungstagen vom jetzigen abweichen).
    let startMs = localStart - offset;
    if (zone) startMs = localStart - offsetAt(startMs);
    if (nowMs < startMs + duration) return { startMs, endMs: startMs + duration };
  }
  return null;
}

/**
 * Zeitfenster des Nachtschilds: das laufende Fenster, falls nowMs darin liegt, sonst das nächste.
 * Fenster reichen über Mitternacht (z. B. Start 22 Uhr, 8 Stunden: bis 6 Uhr).
 * Eine vorgemerkte Änderung (nightShieldNext) gilt ab fromMs; die alte Einstellung endet dort.
 */
export function nightShieldWindow(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): { startMs: number; endMs: number } | null {
  const duration = balance.protection.nightShieldHours * HOUR_MS;
  const n = p.nightShieldNext;
  if (n && nowMs >= n.fromMs) return windowFor(n.startHour, n.tzOffsetMinutes, nowMs, duration, n.timeZone);
  const w = windowFor(p.nightShieldStartHour, p.tzOffsetMinutes, nowMs, duration, p.timeZone);
  if (!n) return w;
  if (w && w.startMs < n.fromMs) return { startMs: w.startMs, endMs: Math.min(w.endMs, n.fromMs) };
  const later = windowFor(n.startHour, n.tzOffsetMinutes, n.fromMs, duration, n.timeZone);
  return later && { startMs: Math.max(later.startMs, n.fromMs), endMs: later.endMs };
}

/** Übernimmt eine fällige vorgemerkte Einstellung in die laufende. */
export function settleNightShield(p: ProtectionState, nowMs: number): ProtectionState {
  const n = p.nightShieldNext;
  if (!n || nowMs < n.fromMs) return { ...p };
  const { timeZone: _old, ...rest } = p;
  return { ...rest, nightShieldStartHour: n.startHour, tzOffsetMinutes: n.tzOffsetMinutes, ...(n.timeZone ? { timeZone: n.timeZone } : {}), nightShieldNext: null };
}

/**
 * Spieler ändert Startstunde oder Zeitzone des Nachtschilds. Die neue Einstellung gilt erst nach
 * nightShieldChangeHours (ein Schild lässt sich so nicht gegen einen erkannten Angriff einschalten),
 * und die nächste Änderung ist erst nach derselben Frist erlaubt.
 */
export function scheduleNightShieldChange(
  p: ProtectionState,
  startHour: number | null,
  tzOffsetMinutes: number,
  nowMs: number,
  balance: Balance,
  timeZone: string | null = null,
): { ok: true; protection: ProtectionState; fromMs: number } | { ok: false; code: string; untilMs?: number } {
  if (startHour !== null && (!Number.isInteger(startHour) || startHour < 0 || startHour > 23)) return { ok: false, code: "bad_hour" };
  if (!Number.isInteger(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > 840) return { ok: false, code: "bad_tz" };
  if (timeZone !== null && !validTimeZone(timeZone)) return { ok: false, code: "bad_tz" };
  const delay = balance.protection.nightShieldChangeHours * HOUR_MS;
  const cur = settleNightShield(p, nowMs);
  const last = cur.nightShieldChangedAtMs ?? -Infinity;
  if (nowMs < last + delay) return { ok: false, code: "shield_cooldown", untilMs: last + delay };
  const pending = cur.nightShieldNext;
  const target = pending ?? { startHour: cur.nightShieldStartHour, tzOffsetMinutes: cur.tzOffsetMinutes, timeZone: cur.timeZone };
  // Mit Zeitzone zählt nur die Zone (der Versatz wechselt mit der Sommerzeit), sonst der Versatz.
  const sameZone = timeZone !== null ? (target.timeZone ?? null) === timeZone : !target.timeZone && target.tzOffsetMinutes === tzOffsetMinutes;
  if (target.startHour === startHour && sameZone) return { ok: false, code: "shield_unchanged" };
  const fromMs = nowMs + delay;
  return {
    ok: true,
    fromMs,
    protection: { ...cur, nightShieldNext: { startHour, tzOffsetMinutes, ...(timeZone !== null ? { timeZone } : {}), fromMs }, nightShieldChangedAtMs: nowMs },
  };
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
  if (p.beginnerEndedAtMs !== undefined && nowMs >= p.beginnerEndedAtMs) return false; // PvP: eigener Spielerüberfall
  return nowMs < p.createdAtMs + balance.protection.beginnerDays * DAY_MS;
}

/**
 * PvP-Vorlage: Ein eigener Überfall auf einen Spielerhafen beendet den Anfängerschutz sofort (Nester, Felder und
 * Weltereignisse nicht). Ohne laufenden Anfängerschutz bleibt der Stand unverändert.
 */
export function endBeginnerProtection(p: ProtectionState, nowMs: number, balance: Balance): ProtectionState {
  if (!isBeginnerProtected(p, nowMs, balance)) return { ...p };
  return { ...p, beginnerEndedAtMs: nowMs };
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

/** Mehrere Häfen: Gründungsschutz einer neuen Kolonie (expansion.ts colonyProtection). */
export function isFoundingShieldActive(p: ProtectionState, nowMs: number): boolean {
  return nowMs < (p.foundingShieldUntilMs ?? 0);
}

/** Gesamtstatus; bei mehreren Gründen in der Reihenfolge Anfängerschutz, Gründungsschutz, Niederlage, Nachtschild. */
export function protectionStatus(
  p: ProtectionState,
  nowMs: number,
  balance: Balance,
): { protected: boolean; reason: ProtectionReason | null } {
  if (isBeginnerProtected(p, nowMs, balance)) return { protected: true, reason: "anfaengerschutz" };
  if (isFoundingShieldActive(p, nowMs)) return { protected: true, reason: "gruendungsschutz" };
  if (isDefeatShieldActive(p, nowMs)) return { protected: true, reason: "niederlage" };
  if (isNightShieldActive(p, nowMs, balance)) return { protected: true, reason: "nachtschild" };
  return { protected: false, reason: null };
}
