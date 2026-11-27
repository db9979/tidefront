// Spielzeit (Kalendertag in der Spielzeitzone) und das gleitende 24-h-Fenster des Handelslimits. Rein: Zeit kommt als nowMs.
// Seit v1.30 zählt das Limit (Kauf + Verkauf je Ressource) nicht mehr je Kalendertag, sondern über die letzten 24 Stunden:
// jeder Handel landet im Fach seiner vollen Stunde (Stundennummer floor(ms / 1 h)); ein Fach zählt, bis 24 Stunden nach
// Beginn seiner Stunde vergangen sind (ein Handel um 13:40 ist ab 13:00 am Folgetag wieder frei, also nach 23–24 h).
import type { ResourceId, TradeHour, TraderState } from "./types.ts";
import { gameTimeZone } from "../time-zone.ts";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Länge des gleitenden Fensters in Stunden. */
export const TRADE_WINDOW_HOURS = 24;

/** Spielzeitzone: TZ der Umgebung (Server), sonst Europe/Berlin – eine Quelle: time-zone.ts (gameTimeZone, TE-07). */
export function defaultTimeZone(): string {
  return gameTimeZone();
}

function localParts(nowMs: number, timeZone: string): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
}

/**
 * Tagesnummer (Tage seit 1970) des Kalendertags in der Spielzeitzone. Spieltag für Tagesbefehle und die tägliche
 * Knappheit der Marktnachrichten (seit 0.24.2; vorher Mitternacht UTC).
 */
export function gameDayIndex(nowMs: number, timeZone: string = defaultTimeZone()): number {
  const p = localParts(nowMs, timeZone);
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / MS_PER_DAY);
}

/** @deprecated Name aus der Zeit vor 0.24.2; gleich gameDayIndex. */
export const utcDayIndex = (nowMs: number): number => gameDayIndex(nowMs);

/** Stundennummer (Stunden seit 1970) von nowMs. */
export function hourIndex(nowMs: number): number {
  return Math.floor(nowMs / MS_PER_HOUR);
}

/**
 * Fächer des gleitenden Fensters zu nowMs, aufsteigend, ohne abgelaufene. Alte Zustände (vor v1.30: Zähler je
 * Kalendertag `dailyDayIndex`/`dailyVolume`) werden überführt: Volumen des laufenden Spieltags zählt als ein Fach zur
 * Stunde der letzten Mitternacht (Spielzeit) und wird damit wie bisher um Mitternacht frei; ein älterer Tag zählt nicht.
 */
export function tradeWindow(
  trader: Pick<TraderState, "tradeHours" | "dailyDayIndex" | "dailyVolume">,
  nowMs: number,
  timeZone: string = defaultTimeZone(),
): TradeHour[] {
  const nowH = hourIndex(nowMs);
  const minH = nowH - (TRADE_WINDOW_HOURS - 1);
  let hours: readonly TradeHour[] = Array.isArray(trader.tradeHours) ? trader.tradeHours : [];
  if (!Array.isArray(trader.tradeHours) && trader.dailyVolume && trader.dailyDayIndex === gameDayIndex(nowMs, timeZone)) {
    const localHour = Number(localParts(nowMs, timeZone).hour) % 24;
    hours = [{ h: nowH - localHour, q: { ...trader.dailyVolume } }];
  }
  return hours
    .filter((x) => x && Number.isFinite(x.h) && x.h >= minH && x.h <= nowH)
    .map((x) => ({ h: x.h, q: { ...x.q } }))
    .sort((a, b) => a.h - b.h);
}

function qtyOf(x: TradeHour, resource: ResourceId): number {
  const v = x.q[resource];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Gehandelte Menge einer Ressource in den letzten 24 Stunden. */
export function tradedInWindow(
  trader: Pick<TraderState, "tradeHours" | "dailyDayIndex" | "dailyVolume">,
  resource: ResourceId,
  nowMs: number,
  timeZone?: string,
): number {
  return tradeWindow(trader, nowMs, timeZone).reduce((sum, x) => sum + qtyOf(x, resource), 0);
}

/** Fenster nach einem Handel: Menge im Fach der laufenden Stunde zugebucht. */
export function addToWindow(window: readonly TradeHour[], resource: ResourceId, qty: number, nowMs: number): TradeHour[] {
  const h = hourIndex(nowMs);
  const out = window.map((x) => ({ h: x.h, q: { ...x.q } }));
  let slot = out.find((x) => x.h === h);
  if (!slot) {
    slot = { h, q: {} };
    out.push(slot);
    out.sort((a, b) => a.h - b.h);
  }
  slot.q[resource] = qtyOf(slot, resource) + qty;
  return out;
}

/** Freigaben einer Ressource: wann (ms) wie viel wieder frei wird, aufsteigend. */
export function windowReleases(
  trader: Pick<TraderState, "tradeHours" | "dailyDayIndex" | "dailyVolume">,
  resource: ResourceId,
  nowMs: number,
  timeZone?: string,
): { atMs: number; qty: number }[] {
  return tradeWindow(trader, nowMs, timeZone)
    .filter((x) => qtyOf(x, resource) > 0)
    .map((x) => ({ atMs: (x.h + TRADE_WINDOW_HOURS) * MS_PER_HOUR, qty: qtyOf(x, resource) }));
}

/**
 * Frühester Zeitpunkt, ab dem `need` Einheiten (zusätzlich zum Verbrauchten) ins Limit passen; jetzt, wenn schon frei;
 * null, wenn das Limit dafür nie reicht (need > limit).
 */
export function freeAtMs(
  releases: readonly { atMs: number; qty: number }[],
  used: number,
  limit: number,
  need: number,
  nowMs: number,
): number | null {
  if (need > limit) return null;
  let u = used;
  if (u + need <= limit) return nowMs;
  for (const r of releases) {
    u -= r.qty;
    if (u + need <= limit) return r.atMs;
  }
  return null;
}
