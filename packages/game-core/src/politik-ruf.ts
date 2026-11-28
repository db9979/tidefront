// Weltpolitik Stufe 2: globaler Ruf (docs/REGELN-WELTPOLITIK.md, Abschnitt 3a; Vorlage 3.3). Eine Zahl −100 … +100 je
// Mensch und Saison, Start 0, gerechnet beim Lesen aus den Belegen der Saison (kein Zähler, kein Job): Pluspunkte
// sättigen (G · (1 − R/100)), Abzüge wirken voll, an jeder Tagesgrenze verliert der Ruf 5 % in Richtung 0
// (R′ = R + G · (1 − R/100) − 0,05 · R). Drei Stufen: ≤ −30 Berüchtigt · Unbescholten · ≥ +30 Angesehen.
// Der Ruf zählt nicht im Rang und ändert keine Börsenpreise; er wirkt nur bei den KI-Spielern (Verträge, Gesuche),
// beim Kopfgeld auf Berüchtigte und in der Ächtung des Seerats.
const DAY_MS = 86_400_000;

export interface RufBalance {
  decayPerDay: number;
  angesehenFrom: number;
  beruechtigtTo: number;
  /** KI-Liefervertrag erfüllt; höchstens contractMaxPerDay Punkte je Tag. */
  contract: number;
  contractMaxPerDay: number;
  /** Gesuch erfüllt. */
  gesuch: number;
  /** Handel: + feePoint je feePer Taler gezahlter Gebühr (Börse, KI-Verträge), höchstens feeMaxPerDay je Tag. */
  feePer: number;
  feePoint: number;
  feeMaxPerDay: number;
  /** Hilfe: als Stationierter einen Kartell-Überfall im fremden Hafen abgewehrt; je Paar × helpPairFactors in helpPairDays. */
  help: number;
  helpPairFactors: number[];
  helpPairDays: number;
  /** Kartell-Abwehr: Konvoi oder Feld gegen eine Kartellgruppe ≥ cartelHoldMinBoats gehalten; höchstens cartelHoldMaxPerWeek je Woche. */
  cartelHold: number;
  cartelHoldMinBoats: number;
  cartelHoldMaxPerWeek: number;
  /** Überfall auf ein Schwachziel (isWeakTarget), ohne Krieg. */
  weakRaid: number;
  /** Vertragsstrafe fällig (nicht oder teilweise erfüllt, gekündigt). */
  penalty: number;
  /** Paktbruch: Überfall oder Kriegserklärung ≤ pactBreakHours nach Erlöschen des selbst gekündigten Pakts (einmal). */
  pactBreak: number;
  pactBreakHours: number;
  /** Blockade vor einem Spielerhafen ohne Krieg, je angefangenem Tag. */
  blockadePerDay: number;
  /** In den ersten Tagen (Anfängerschutz) kein Abzug außer der Vertragsstrafe. */
  protectionDays: number;
  /** Kopfgeld-Zuschlag für Angreifer eines Berüchtigten (nicht bei Absprache). */
  notoriousBounty: number;
  /** Ächtung (Seerat, nur gegen Berüchtigte): Dauer und Kopfgeld-Zuschlag (statt notoriousBounty). */
  aechtungHours: number;
  aechtungBounty: number;
}

export type RufLevel = "beruechtigt" | "unbescholten" | "angesehen";
export type RufKind = "vertrag" | "gesuch" | "handel" | "hilfe" | "kartell" | "schwachziel" | "strafe" | "paktbruch" | "blockade";

export interface RufEntry {
  atMs: number;
  kind: RufKind;
  /** Beleg (Vertrag, Gesuch, Bericht, Blockade, Pakt) für den Verlauf. */
  ref?: string;
  /** handel: gezahlte Gebühr in Taler. */
  amount?: number;
  /** hilfe: Gastgeber (für die Paarbremse). */
  partner?: number;
}

export interface RufBooking {
  atMs: number;
  /** Grund: vertrag, gesuch, handel, hilfe, kartell, schwachziel, strafe, paktbruch, blockade, zerfall. */
  reason: string;
  delta: number;
  value: number;
  ref?: string;
}

export interface RufResult {
  value: number;
  level: RufLevel;
  history: RufBooking[];
}

export function rufLevel(value: number, cfg: RufBalance): RufLevel {
  if (value <= cfg.beruechtigtTo) return "beruechtigt";
  if (value >= cfg.angesehenFrom) return "angesehen";
  return "unbescholten";
}

export const RUF_LEVEL_TEXT: Record<RufLevel, string> = { beruechtigt: "Berüchtigt", unbescholten: "Unbescholten", angesehen: "Angesehen" };

export const RUF_REASON_TEXT: Record<string, string> = {
  vertrag: "KI-Liefervertrag erfüllt", gesuch: "Gesuch erfüllt", handel: "Gebühren im Handel", hilfe: "Kartell im fremden Hafen abgewehrt",
  kartell: "Konvoi oder Feld gegen das Kartell gehalten", schwachziel: "Überfall auf ein Schwachziel", strafe: "Vertragsstrafe",
  paktbruch: "Paktbruch", blockade: "Blockade eines Spielerhafens", zerfall: "Zerfall (5 % je Tag)",
};

const clamp = (v: number) => Math.max(-100, Math.min(100, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const ORDER: Record<RufKind, number> = { vertrag: 0, gesuch: 1, handel: 2, hilfe: 3, kartell: 4, strafe: 5, schwachziel: 6, blockade: 7, paktbruch: 8 };

/**
 * Ruf zum Zeitpunkt nowMs aus den Belegen ab Saisonbeginn. Tage zählen ab Saisonbeginn; der Zerfall wirkt an jeder
 * Tagesgrenze mit decayPerDay des Stands vom Beginn dieses Tages. protectedUntilMs: bis dahin (Anfängerschutz) zählen
 * Abzüge nicht, außer der Vertragsstrafe.
 */
export function rufAt(entries: RufEntry[], seasonStartMs: number, nowMs: number, cfg: RufBalance, protectedUntilMs = -Infinity): RufResult {
  const list = entries.filter((e) => e.atMs >= seasonStartMs && e.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs || ORDER[a.kind] - ORDER[b.kind]);
  const dayOf = (ms: number) => Math.floor((ms - seasonStartMs) / DAY_MS);
  const history: RufBooking[] = [];
  let value = 0;
  let dayStart = 0;
  let day = 0;
  let contractPts = 0;
  let feeSum = 0;
  let feePts = 0;
  const cartelWeek = new Map<number, number>();
  const helps = new Map<number, number[]>();
  const decayTo = (d: number) => {
    while (day < d) {
      day++;
      contractPts = 0;
      feeSum = 0;
      feePts = 0;
      const delta = -cfg.decayPerDay * dayStart;
      value = clamp(value + delta);
      dayStart = value;
      if (Math.abs(delta) >= 0.005) history.push({ atMs: seasonStartMs + day * DAY_MS, reason: "zerfall", delta: round2(delta), value: round2(value) });
    }
  };
  const book = (e: RufEntry, raw: number) => {
    if (raw === 0) return;
    const delta = raw > 0 ? raw * (1 - value / 100) : raw;
    value = clamp(value + delta);
    history.push({ atMs: e.atMs, reason: e.kind, delta: round2(delta), value: round2(value), ref: e.ref });
  };
  for (const e of list) {
    decayTo(dayOf(e.atMs));
    switch (e.kind) {
      case "vertrag": {
        const pts = Math.min(cfg.contract, cfg.contractMaxPerDay - contractPts);
        if (pts <= 0) break;
        contractPts += pts;
        book(e, pts);
        break;
      }
      case "gesuch": book(e, cfg.gesuch); break;
      case "handel": {
        feeSum += Math.max(0, e.amount ?? 0);
        const earned = Math.min(cfg.feeMaxPerDay, Math.floor(feeSum / cfg.feePer) * cfg.feePoint);
        if (earned > feePts) {
          book(e, earned - feePts);
          feePts = earned;
        }
        break;
      }
      case "hilfe": {
        const key = e.partner ?? -1;
        const recent = (helps.get(key) ?? []).filter((t) => e.atMs - t < cfg.helpPairDays * DAY_MS);
        const f = cfg.helpPairFactors[Math.min(recent.length, cfg.helpPairFactors.length - 1)] ?? 0;
        helps.set(key, [...recent, e.atMs]);
        book(e, cfg.help * f);
        break;
      }
      case "kartell": {
        const w = Math.floor((e.atMs - seasonStartMs) / (7 * DAY_MS));
        const used = cartelWeek.get(w) ?? 0;
        const pts = Math.min(cfg.cartelHold, cfg.cartelHoldMaxPerWeek - used);
        if (pts <= 0) break;
        cartelWeek.set(w, used + pts);
        book(e, pts);
        break;
      }
      case "strafe": book(e, cfg.penalty); break;
      default: {
        if (e.atMs < protectedUntilMs) break; // Anfängerschutz: kein Abzug außer der Vertragsstrafe
        book(e, e.kind === "schwachziel" ? cfg.weakRaid : e.kind === "paktbruch" ? cfg.pactBreak : cfg.blockadePerDay);
      }
    }
  }
  decayTo(dayOf(nowMs));
  const v = round2(value);
  return { value: v, level: rufLevel(v, cfg), history };
}

/** Gleichgewicht bei täglich G Pluspunkten (ohne Abzüge): G / (G/100 + Zerfall). */
export function rufEquilibrium(perDay: number, cfg: RufBalance): number {
  return perDay / (perDay / 100 + cfg.decayPerDay);
}

/** Blockade: ein Beleg je angefangenem Tag ab Beginn bis Ende (bzw. jetzt). */
export function blockadeDays(startMs: number, endMs: number, nowMs: number): number[] {
  const end = Math.min(endMs, nowMs);
  const out: number[] = [];
  for (let t = startMs; t < end; t += DAY_MS) out.push(t);
  return out;
}

/** Optionen einer Wochensitzung mit Ächtung: nur wenn es Berüchtigte gibt, vor „Ruhige See“ eingereiht. */
export function withAechtung(options: string[], anyNotorious: boolean): string[] {
  if (!anyNotorious || options.includes("aechtung")) return options;
  const i = options.indexOf("ruhig");
  return i < 0 ? [...options, "aechtung"] : [...options.slice(0, i), "aechtung", ...options.slice(i)];
}

/** Wen trifft eine beschlossene Ächtung? Nur, wer beim Schluss der Sitzung berüchtigt ist (keine Namen in der Wahl). */
export function aechtungTargets(rufs: { playerId: number; value: number }[], cfg: RufBalance): number[] {
  return rufs.filter((r) => r.value <= cfg.beruechtigtTo).map((r) => r.playerId).sort((a, b) => a - b);
}
