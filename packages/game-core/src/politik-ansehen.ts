// Weltpolitik: Ansehen je KI-Spieler (docs/REGELN-WELTPOLITIK.md, Abschnitt 3). Skala −100 … +100, Start 0, je Saison.
// Gerechnet beim Lesen aus den Buchungen der Saison (kein Job): Pluspunkte sättigen (G · (1 − A/100)), Abzüge wirken
// voll, an jeder Tagesgrenze verliert das Ansehen 5 % in Richtung 0. Drei Stufen: ≤ −30 Misstraut, ≥ +30 Vertraut.
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface AnsehenBalance {
  decayPerDay: number;
  vertrautFrom: number;
  misstrautTo: number;
  /** Liefervertrag mit diesem KI-Spieler erfüllt; höchstens contractMaxPerDay je Tag. */
  contract: number;
  contractMaxPerDay: number;
  gesuch: number;
  /** Vertragsstrafe (Spieler hat nicht oder nur teilweise erfüllt, oder gekündigt). */
  penalty: number;
  /** Überfall auf diesen KI-Spieler. */
  raid: number;
  /** So lange nach einem Überfall schließen Händler und Festung nichts ab. */
  raidBlockHours: number;
  /** Überfall ≤ pactBreakHours nach Erlöschen eines selbst gekündigten Pakts mit ihm: einmal zusätzlich. */
  pactBreak: number;
  pactBreakHours: number;
  bonusDelta: Record<AnsehenLevel, number>;
  quotaShare: Record<AnsehenLevel, number>;
  /** Berüchtigt: Mittel des Ansehens über alle KI-Spieler höchstens so tief (Ersatz für den globalen Ruf). */
  notoriousMean: number;
  /** Kopfgeld-Zuschlag für Angreifer eines Berüchtigten. */
  notoriousBounty: number;
  /** Paktangebot eines KI-Spielers bei „Vertraut“ höchstens einmal je so viele Tage. */
  pactOfferEveryDays?: number;
}

export type AnsehenLevel = "misstraut" | "bekannt" | "vertraut";
export type AnsehenKind = "vertrag" | "gesuch" | "strafe" | "ueberfall" | "pakt_ende";

export interface AnsehenEntry {
  atMs: number;
  kind: AnsehenKind;
  /** Beleg (Vertrag, Gesuch, Bericht, Pakt) für den Verlauf. */
  ref?: string;
}

export interface AnsehenBooking {
  atMs: number;
  /** Buchungsgrund: vertrag, gesuch, strafe, ueberfall, paktbruch, zerfall. */
  reason: string;
  delta: number;
  value: number;
  ref?: string;
}

export interface AnsehenResult {
  value: number;
  level: AnsehenLevel;
  /** Letzter Überfall auf diesen KI-Spieler (Sperre raidBlockHours). */
  lastRaidMs: number | null;
  /** Buchungen in zeitlicher Folge (der Zerfall eines Tages ist eine eigene Zeile). */
  history: AnsehenBooking[];
}

export function ansehenLevel(value: number, cfg: AnsehenBalance): AnsehenLevel {
  if (value <= cfg.misstrautTo) return "misstraut";
  if (value >= cfg.vertrautFrom) return "vertraut";
  return "bekannt";
}

const clamp = (v: number) => Math.max(-100, Math.min(100, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Ansehen zum Zeitpunkt nowMs aus den Buchungen ab Saisonbeginn. Tage zählen ab Saisonbeginn (Tag 0 = erste 24 h);
 * der Zerfall wirkt an jeder Tagesgrenze mit 5 % des Stands vom Beginn dieses Tages.
 */
export function ansehenAt(entries: AnsehenEntry[], seasonStartMs: number, nowMs: number, cfg: AnsehenBalance): AnsehenResult {
  const list = entries.filter((e) => e.atMs >= seasonStartMs && e.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs || a.kind.localeCompare(b.kind));
  const dayOf = (ms: number) => Math.floor((ms - seasonStartMs) / DAY_MS);
  const history: AnsehenBooking[] = [];
  let value = 0;
  /** Stand zu Tagesbeginn: der Zerfall des Tages wirkt auf ihn (R′ = R + G · (1 − R/100) − 0,05 · R). */
  let dayStart = 0;
  let day = 0;
  let contractsToday = 0;
  let lastRaidMs: number | null = null;
  const pactEnds: number[] = [];
  const decayTo = (d: number) => {
    while (day < d) {
      day++;
      contractsToday = 0;
      const delta = -cfg.decayPerDay * dayStart;
      value = clamp(value + delta);
      dayStart = value;
      if (delta === 0) continue;
      if (Math.abs(delta) >= 0.005) history.push({ atMs: seasonStartMs + day * DAY_MS, reason: "zerfall", delta: round2(delta), value: round2(value) });
    }
  };
  const book = (e: AnsehenEntry, reason: string, raw: number) => {
    const delta = raw > 0 ? raw * (1 - value / 100) : raw;
    value = clamp(value + delta);
    history.push({ atMs: e.atMs, reason, delta: round2(delta), value: round2(value), ref: e.ref });
  };
  for (const e of list) {
    decayTo(dayOf(e.atMs));
    if (e.kind === "vertrag") {
      const room = cfg.contractMaxPerDay - contractsToday * cfg.contract;
      if (room <= 0) continue;
      contractsToday++;
      book(e, "vertrag", Math.min(cfg.contract, room));
    } else if (e.kind === "gesuch") book(e, "gesuch", cfg.gesuch);
    else if (e.kind === "strafe") book(e, "strafe", cfg.penalty);
    else if (e.kind === "pakt_ende") pactEnds.push(e.atMs);
    else if (e.kind === "ueberfall") {
      book(e, "ueberfall", cfg.raid);
      lastRaidMs = e.atMs;
      const i = pactEnds.findIndex((t) => e.atMs >= t && e.atMs <= t + cfg.pactBreakHours * HOUR_MS);
      if (i >= 0) {
        pactEnds.splice(i, 1);
        book(e, "paktbruch", cfg.pactBreak);
      }
    }
  }
  decayTo(dayOf(nowMs));
  const v = round2(value);
  return { value: v, level: ansehenLevel(v, cfg), lastRaidMs, history };
}

/** Wirkung der Stufe bei diesem KI-Spieler (Vertragsbonus additiv, Kontingent-Anteil). */
export function ansehenEffects(level: AnsehenLevel, cfg: AnsehenBalance): { bonusDelta: number; quotaShare: number; gesuche: boolean; pakt: boolean } {
  return { bonusDelta: cfg.bonusDelta[level] ?? 0, quotaShare: cfg.quotaShare[level] ?? cfg.quotaShare.bekannt, gesuche: level !== "misstraut", pakt: level === "vertraut" };
}

/** Berüchtigt (Ersatz für den globalen Ruf): Mittel über alle KI-Spieler (ohne Buchung = 0) ≤ notoriousMean. */
export function isNotorious(values: number[], kiCount: number, cfg: AnsehenBalance): boolean {
  if (kiCount <= 0) return false;
  const sum = values.reduce((s, v) => s + v, 0);
  return sum / kiCount <= cfg.notoriousMean;
}

/** Gleichgewicht bei täglich G Pluspunkten (ohne Abzüge): G / (G/100 + Zerfall). */
export function ansehenEquilibrium(perDay: number, cfg: AnsehenBalance): number {
  return perDay / (perDay / 100 + cfg.decayPerDay);
}
