// Einstellbare Ruhezeit für Pushes (Nutzerentscheid nach AN-07): jeder Spieler stellt seine Ruhezeit selbst ein,
// Vorgabe 23–7 Uhr Spielzeitzone, abschaltbar. Mit laufendem Nachtschild gilt zusätzlich dessen Fenster (push-bundle.ts);
// Angriffe gehen immer sofort. Ablage ohne Schemaänderung in server_setting unter "push_quiet:<Spieler-ID>" als JSON;
// fehlt der Eintrag, gilt die Vorgabe.
import { gameTimeZone } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { getSetting, setSetting } from "./settings.ts";

export interface QuietHours {
  on: boolean;
  /** Beginn und Ende als Minute des Tages (0 … 1439) in der Spielzeitzone; Ende < Beginn = über Mitternacht. */
  fromMin: number;
  toMin: number;
}

export const QUIET_DEFAULT: Readonly<QuietHours> = { on: true, fromMin: 23 * 60, toMin: 7 * 60 };

const key = (playerId: number) => `push_quiet:${playerId}`;
const okMinute = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1440;

/** Gültige Eingabe? Beginn ≠ Ende (sonst wäre die Ruhezeit leer oder ganztägig). */
export function cleanQuiet(x: unknown): QuietHours | null {
  const q = x as Partial<QuietHours> | null;
  if (!q || typeof q.on !== "boolean" || !okMinute(q.fromMin) || !okMinute(q.toMin) || q.fromMin === q.toMin) return null;
  return { on: q.on, fromMin: q.fromMin, toMin: q.toMin };
}

export async function getQuietHours(db: DbOrTx, playerId: number): Promise<QuietHours> {
  const raw = await getSetting(db, key(playerId));
  if (!raw) return { ...QUIET_DEFAULT };
  try {
    return cleanQuiet(JSON.parse(raw)) ?? { ...QUIET_DEFAULT };
  } catch {
    return { ...QUIET_DEFAULT };
  }
}

/** Für die Einstellungen: Ruhezeit und Spielzeitzone (Anzeige). */
export async function quietHoursView(db: DbOrTx, playerId: number): Promise<QuietHours & { timeZone: string }> {
  return { ...(await getQuietHours(db, playerId)), timeZone: gameTimeZone() };
}

/** Codes: bad_time. */
export async function setQuietHours(db: DbOrTx, playerId: number, input: unknown): Promise<{ ok: true } | { ok: false; code: "bad_time" }> {
  const q = cleanQuiet(input);
  if (!q) return { ok: false, code: "bad_time" };
  await setSetting(db, key(playerId), JSON.stringify(q));
  return { ok: true };
}

/** Minute des Tages in einer Zeitzone. */
export function minuteOfDayIn(nowMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nowMs);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** Ende der laufenden Ruhezeit (ms) oder null, wenn gerade keine läuft. Rein. */
export function quietEndMs(q: QuietHours, nowMs: number, timeZone = gameTimeZone()): number | null {
  if (!q.on || q.fromMin === q.toMin) return null;
  const m = minuteOfDayIn(nowMs, timeZone);
  const inside = q.fromMin < q.toMin ? m >= q.fromMin && m < q.toMin : m >= q.fromMin || m < q.toMin;
  if (!inside) return null;
  const minutesLeft = (q.toMin - m + 1440) % 1440;
  return nowMs - (nowMs % 60_000) + minutesLeft * 60_000;
}
