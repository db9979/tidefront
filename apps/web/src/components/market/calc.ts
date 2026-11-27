// Reine Rechenhilfen für die Anzeige der Börse (Kursverlauf, Kursband, Schnellwahl, Sperrgründe).
// Die Regeln selbst prüft der Server; hier wird nur vorab erklärt, was er ablehnen würde.
import { market } from "@tidefront/game-core";
import type { Outputs } from "../../lib/trpc.ts";

export type MarketRes = Outputs["market"]["get"]["resources"][number];
export type MarketCfg = {
  refPrice: Record<string, number>;
  depth: Record<string, number>;
  fee: number;
  maxImpactPerTrade: number;
  hourBand: number;
  dayBand: number;
  haltMinutes: number;
  floorFactor: number;
  ceilFactor: number;
  reversionHalfLifeHours: number;
  convoySpeedKmh: number;
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Kurs zu einem Zeitpunkt (letzter Handel davor, zum Richtwert zurückgeführt); ohne Verlauf der aktuelle Kurs. */
export function priceAtTime(r: MarketRes, tMs: number, halfLife: number): number {
  return market.priceAt(r.history, tMs, r.ref, halfLife) ?? r.price;
}

/** Veränderung in Prozent gegen den Kurs vor `spanMs`. */
export function changePct(r: MarketRes, nowMs: number, spanMs: number, halfLife: number): number {
  const before = priceAtTime(r, nowMs - spanMs, halfLife);
  return before > 0 ? (r.price / before - 1) * 100 : 0;
}

/** Abweichung vom Richtwert in Prozent. */
export function refPct(r: MarketRes): number {
  return (r.price / r.ref - 1) * 100;
}

/**
 * Erlaubter Bereich für den Kurs nach dem nächsten Handel: Schnittmenge aus Stundenband, Tagesband
 * und Unter-/Obergrenze (wie die Prüfung `band` und `price_bounds` im Server).
 */
export function allowedRange(r: MarketRes, nowMs: number, cfg: MarketCfg) {
  const hl = cfg.reversionHalfLifeHours;
  const hourAgo = r.history.length ? priceAtTime(r, nowMs - HOUR, hl) : r.price;
  const dayAgo = r.history.length ? priceAtTime(r, nowMs - DAY, hl) : r.price;
  // Grenzen am Grundrichtwert (wie price_bounds im Server; Marktnachrichten verschieben sie nicht).
  const floor = cfg.floorFactor * (r.baseRef ?? r.ref);
  const ceil = cfg.ceilFactor * (r.baseRef ?? r.ref);
  const lo = Math.max(floor, hourAgo * (1 - cfg.hourBand), dayAgo * (1 - cfg.dayBand));
  const hi = Math.min(ceil, hourAgo * (1 + cfg.hourBand), dayAgo * (1 + cfg.dayBand));
  return { lo, hi, floor, ceil, hourAgo, dayAgo };
}

/** Kursverlauf als Punkte (Zeit, Kurs) im Fenster, mit Rückkehr zum Richtwert zwischen den Handeln. */
export function series(r: MarketRes, nowMs: number, spanMs: number, halfLife: number, samples = 96): { t: number; p: number }[] {
  const from = nowMs - spanMs;
  const times = new Set<number>();
  for (let i = 0; i <= samples; i++) times.add(from + (spanMs * i) / samples);
  // An jedem Handel ein Sprung: Punkt kurz davor und genau danach.
  for (const h of r.history) {
    if (h.tMs > from && h.tMs <= nowMs) {
      times.add(h.tMs - 1);
      times.add(h.tMs);
    }
  }
  return [...times].sort((a, b) => a - b).map((t) => ({ t, p: t >= nowMs ? r.price : priceAtTime(r, t, halfLife) }));
}

/**
 * Handelslimit im gleitenden 24-h-Fenster zum Zeitpunkt nowMs: Verbrauch und kommende Freigaben (bereits fällige, seit
 * dem letzten Laden der Börse, sind abgezogen).
 */
export function dailyWindow(r: MarketRes, nowMs: number): { used: number; left: number; reserved: number; releases: { atMs: number; qty: number }[] } {
  const all = r.dailyReleases ?? [];
  const gone = all.filter((x) => x.atMs <= nowMs).reduce((a, x) => a + x.qty, 0);
  // Lieferverträge (v1.31): Lieferungen der nächsten 24 h sind im Limit vorgemerkt und zählen hier als verbraucht.
  const reserved = Math.max(0, r.dailyReserved ?? 0);
  const used = Math.max(0, r.dailyUsed - gone) + reserved;
  return { used, left: Math.max(0, r.dailyLimit - used), reserved, releases: all.filter((x) => x.atMs > nowMs) };
}

/** Ab wann `qty` ins Handelslimit passt (jetzt, eine Freigabezeit oder null, wenn das Limit dafür nie reicht). */
export function dailyFreeAt(r: MarketRes, nowMs: number, qty: number): number | null {
  const w = dailyWindow(r, nowMs);
  return market.freeAtMs(w.releases, w.used, r.dailyLimit, qty, nowMs);
}

/** Kosten eines Kaufs (Kredite, ohne Rundung) – zum Abschätzen der bezahlbaren Menge. */
function buyCost(qty: number, price: number, depth: number, fee: number): number {
  return qty * price * (1 + qty / depth / 2) * (1 + fee);
}

export type Limits = {
  /** Größte Menge ohne Ablehnung wegen Kurswirkung. */
  impact: number;
  /** Rest des Tageslimits (gleitend 24 h). */
  daily: number;
  /** Bezahlbar (Kauf) bzw. Bestand (Verkauf). */
  funds: number;
  /** Platz bis zum Kreditlimit (nur Verkauf). */
  credit: number;
  /** Bis zum Rand des erlaubten Kursbereichs. */
  band: number;
};

/** Obergrenzen der Menge je Prüfung; die kleinste ist „max. sinnvoll“. */
export function limits(side: "buy" | "sell", r: MarketRes, nowMs: number, cfg: MarketCfg, o: { credits: number; creditLimit: number; stock: number }): Limits {
  const depth = cfg.depth[r.id] ?? 1;
  const p = r.price;
  const range = allowedRange(r, nowMs, cfg);
  const impact = Math.floor(depth * cfg.maxImpactPerTrade);
  const daily = dailyWindow(r, nowMs).left;
  let funds: number;
  let band: number;
  let credit = Infinity;
  if (side === "buy") {
    // Größte ganze Menge, deren Kosten in die Kredite passen (Halbierungssuche).
    let a = 0;
    let b = Math.max(0, Math.floor(o.credits / (p * (1 + cfg.fee))) + 1);
    while (a < b) {
      const mid = Math.ceil((a + b) / 2);
      if (buyCost(mid, p, depth, cfg.fee) <= o.credits) a = mid;
      else b = mid - 1;
    }
    funds = a;
    band = Math.floor(depth * Math.max(0, range.hi / p - 1));
  } else {
    funds = Math.floor(o.stock);
    band = Math.floor(depth * Math.max(0, p / range.lo - 1));
    const room = Math.max(0, o.creditLimit - o.credits);
    // Erlös je Einheit fällt mit der Menge; der Kurs vor dem Handel ist eine sichere Obergrenze.
    credit = Math.floor(room / (p * (1 - cfg.fee)));
  }
  return { impact, daily, funds, credit, band };
}

export function maxSensible(l: Limits): number {
  return Math.max(0, Math.min(l.impact, l.daily, l.funds, l.credit, l.band));
}

/** Ankunftszeit als Uhrzeit (HH:MM). */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/** Uhrzeit mit „morgen“ bzw. Datum, wenn nicht heute. */
export function when(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const n = new Date(nowMs);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / DAY);
  const prefix = days === 0 ? "" : days === 1 ? "morgen " : `${d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" })} `;
  return `${prefix}${clock(ms)}`;
}

/** Pfeil und Wort für eine Veränderung (nicht nur Farbe). */
export function trend(pct: number): { arrow: string; word: string; tone: "up" | "down" | "flat" } {
  if (Math.abs(pct) < 0.05) return { arrow: "■", word: "unverändert", tone: "flat" };
  return pct > 0 ? { arrow: "▲", word: "steigt", tone: "up" } : { arrow: "▼", word: "fällt", tone: "down" };
}

export function signed(pct: number, digits = 1): string {
  const v = Math.abs(pct) < 0.05 ? 0 : pct;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export const TONE_TEXT = { up: "text-moos", down: "text-siegel", flat: "text-ink2" } as const;
