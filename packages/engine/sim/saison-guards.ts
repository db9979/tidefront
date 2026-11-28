// Wächter des Saisonlaufs (npm run sim:saison, Welle 2): rein, ohne Datenbank, damit testbar (test/saison-guards.test.ts).
// „fehler“ lassen den Lauf scheitern (Exit-Code 1) – Dinge, die nie passieren dürfen (Weltereignis-Flut, Nachrichtenflut,
// gescheiterte Ereignisse, Prüflauf). „warnung“ sind Balance- und KI-Ziele (Nutzerentscheidungen 0.38, Befunde M-01/M-02/
// M-03/AN-05/ST-06); mit --strict scheitert der Lauf auch an ihnen.

export type GuardLevel = "fehler" | "warnung";
export interface GuardResult { id: string; level: GuardLevel; ok: boolean; text: string; value: number | null; limit: number }

/** Grenzen der Wächter (alle hier, damit sie im Bericht und im Test dieselben sind). */
export const GUARD_LIMITS = {
  /** Neue gewöhnliche Weltereignisse je Tag (Planer: alle 48–96 h, höchstens 2 gleichzeitig; die Flut 0.38 hatte 91). */
  worldEventsPerDay: 3,
  /** Neue Zeilen in market_news je Tag (ohne Flut: wenige je Ereignis und Knappheitsmeldung). */
  newsRowsPerDay: 60,
  /** Nachrichten (Tabelle message) je Spieler und Tag. */
  messagesPerPlayerDay: 40,
  /** Gescheiterte Ereignisse (game_event.status = failed) am Ende. */
  failedEvents: 0,
  /** Kartellverlust je Tag in % der Tagesproduktion (Median der KI-Spieler ab Tag 7; Nutzerentscheid 2: ≤ 10 %). */
  cartelShare: 0.1,
  /** Punkteanteil Kampf + Beute (Nutzerentscheid 3: ≤ 50 %) und Befehle (Nutzerentscheid 4: ≤ 5 %), Median der KI. */
  fightLootShare: 0.5,
  ordersShare: 0.05,
  /** Nest-6-Beute: mitgenommener Anteil der angebotenen Beute (Laderaum, M-02). */
  nest6CargoShare: 0.8,
  /** KI an der Börse: Geschäfte je KI-Spieler und Tag (AN-05: ≥ 1). */
  tradesPerBotDay: 1,
  /** Lager der KI in Stunden Produktion am Ende (Nutzerentscheid 5: KI-Lager klein). */
  botStockHours: 48,
  /** Freibeuter: erster Sieg über Nest 4 spätestens an diesem Saisontag (ST-06: Tag 16 ± 2). */
  freibeuterNest4Day: 18,
  /** Schrittdauer: kein Worker-Schritt (ohne KI-Züge) langsamer als so viele ms (TE-05: Alarm ab 2 s). */
  stepMaxMs: 2000,
} as const;

export interface SeasonMetrics {
  days: number;
  /** Je Saisontag (1 …): neue gewöhnliche Weltereignisse, neue market_news-Zeilen, neue Nachrichten je Spieler. */
  perDay: { day: number; worldEvents: number; newsRows: number; messagesPerPlayer: number }[];
  failedEvents: number;
  auditOk: boolean;
  /** Je KI-Spieler: Kartellverlust je Tag in Anteilen der Tagesproduktion (ab Tag 7), Punkteanteile, Börse, Lager, Nester. */
  bots: {
    profile: string;
    cartelShareByDay: number[];
    points: { ausbau: number; militaer: number; kampf: number; beute: number; befehle: number; total: number };
    trades: number;
    stockHours: number;
    nest4Day: number | null;
    worldEventAttacks: number;
    /** v1.35: gewöhnliche Weltereignisse, die in der Saison in Reichweite (EVENT_RANGE_KM) eines eigenen Hafens entstanden. */
    worldEventsInRange?: number;
  }[];
  /** Nest-6-Überfälle (gewonnen): angebotene und mitgenommene Einheiten. */
  nest6: { offered: number; taken: number }[];
  /** Schritte des Workers: Höchstdauer in ms (ohne KI-Züge und Ereignisse). */
  stepMax: { step: string; maxMs: number }[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Alle Wächter auswerten. */
export function evaluateGuards(m: SeasonMetrics, L = GUARD_LIMITS): GuardResult[] {
  const out: GuardResult[] = [];
  const add = (id: string, level: GuardLevel, ok: boolean, text: string, value: number | null, limit: number) => out.push({ id, level, ok, text, value, limit });

  const we = Math.max(0, ...m.perDay.map((d) => d.worldEvents));
  const weDay = m.perDay.find((d) => d.worldEvents === we)?.day;
  add("weltereignisse", "fehler", we <= L.worldEventsPerDay, `Weltereignisse je Tag höchstens ${we}${weDay ? ` (Tag ${weDay})` : ""}, Grenze ${L.worldEventsPerDay}`, we, L.worldEventsPerDay);
  const news = Math.max(0, ...m.perDay.map((d) => d.newsRows));
  add("marktnachrichten", "fehler", news <= L.newsRowsPerDay, `Neue Marktnachrichten-Zeilen je Tag höchstens ${news}, Grenze ${L.newsRowsPerDay}`, news, L.newsRowsPerDay);
  const msg = Math.max(0, ...m.perDay.map((d) => d.messagesPerPlayer));
  add("nachrichten", "fehler", msg <= L.messagesPerPlayerDay, `Nachrichten je Spieler und Tag höchstens ${Math.round(msg * 10) / 10}, Grenze ${L.messagesPerPlayerDay}`, msg, L.messagesPerPlayerDay);
  add("ereignisse", "fehler", m.failedEvents <= L.failedEvents, `Gescheiterte Ereignisse: ${m.failedEvents}`, m.failedEvents, L.failedEvents);
  add("pruefung", "fehler", m.auditOk, `Prüflauf der Börse ${m.auditOk ? "in Ordnung" : "FEHLGESCHLAGEN"}`, m.auditOk ? 1 : 0, 1);

  const cartel = m.bots.map((b) => median(b.cartelShareByDay));
  const cMed = median(cartel);
  add("kartellkosten", "warnung", cMed <= L.cartelShare, `Kartellverlust je Tag (Median der KI ab Tag 7): ${pct(cMed)} der Tagesproduktion (≈ ${(cMed * 24).toFixed(1).replace(".", ",")} h Produktion), Ziel ≤ ${pct(L.cartelShare)}`, cMed, L.cartelShare);

  const shares = m.bots.filter((b) => b.points.total > 0).map((b) => ({ fl: (b.points.kampf + b.points.beute) / b.points.total, o: b.points.befehle / b.points.total }));
  const fl = median(shares.map((s) => s.fl));
  const o = median(shares.map((s) => s.o));
  add("punkte-kampf-beute", "warnung", fl <= L.fightLootShare, `Punkteanteil Kampf + Beute (Median der KI): ${pct(fl)}, Ziel ≤ ${pct(L.fightLootShare)}`, fl, L.fightLootShare);
  add("punkte-befehle", "warnung", o <= L.ordersShare, `Punkteanteil Tagesbefehle (Median der KI): ${pct(o)}, Ziel ≤ ${pct(L.ordersShare)}`, o, L.ordersShare);

  if (m.nest6.length > 0) {
    const share = m.nest6.reduce((a, n) => a + n.taken, 0) / Math.max(1, m.nest6.reduce((a, n) => a + n.offered, 0));
    add("nest6-laderaum", "warnung", share >= L.nest6CargoShare, `Nest-6-Beute nach Laderaum: ${pct(share)} mitgenommen (${m.nest6.length} Siege), Ziel ≥ ${pct(L.nest6CargoShare)}`, share, L.nest6CargoShare);
  } else add("nest6-laderaum", "warnung", true, "Nest-6-Beute nach Laderaum: kein Sieg über Nest 6", null, L.nest6CargoShare);

  for (const b of m.bots) {
    const perDay = b.trades / Math.max(1, m.days);
    add(`boerse-${b.profile}`, "warnung", perDay >= L.tradesPerBotDay, `${b.profile}: ${Math.round(perDay * 10) / 10} Börsengeschäfte je Tag, Ziel ≥ ${L.tradesPerBotDay}`, perDay, L.tradesPerBotDay);
    add(`lager-${b.profile}`, "warnung", b.stockHours <= L.botStockHours, `${b.profile}: Lager ${Math.round(b.stockHours)} h Produktion am Ende, Ziel ≤ ${L.botStockHours} h`, b.stockHours, L.botStockHours);
    // v1.35: Ohne Ereignis in Reichweite (Lage der Ereignisse ist Zufall) ist „kein Angriff“ kein Fehler der KI.
    if (b.profile !== "haendler") {
      const none = b.worldEventsInRange === 0;
      add(`weltereignis-${b.profile}`, "warnung", b.worldEventAttacks > 0 || none,
        `${b.profile}: ${b.worldEventAttacks} Angriffe auf Weltereignisse${b.worldEventsInRange !== undefined ? ` (${b.worldEventsInRange} in Reichweite entstanden)` : ""}`, b.worldEventAttacks, 1);
    }
  }
  const fb = m.bots.find((b) => b.profile === "freibeuter");
  if (fb && m.days >= L.freibeuterNest4Day) {
    add("freibeuter-nest4", "warnung", fb.nest4Day !== null && fb.nest4Day <= L.freibeuterNest4Day, `Freibeuter: erster Sieg Nest 4 ${fb.nest4Day === null ? "nie" : `an Tag ${fb.nest4Day}`}, Ziel ≤ Tag ${L.freibeuterNest4Day}`, fb.nest4Day, L.freibeuterNest4Day);
  }
  const slow = m.stepMax.filter((s) => s.maxMs > L.stepMaxMs);
  add("schrittdauer", "warnung", slow.length === 0, slow.length ? `Langsame Worker-Schritte: ${slow.map((s) => `${s.step} ${Math.round(s.maxMs)} ms`).join(", ")}` : `Kein Worker-Schritt über ${L.stepMaxMs} ms`, Math.max(0, ...m.stepMax.map((s) => s.maxMs)), L.stepMaxMs);
  return out;
}

/** Exit-Code: 1 bei verletzten Fehler-Wächtern (mit strict auch bei Warnungen), sonst 0. */
export function exitCode(results: GuardResult[], strict = false): number {
  return results.some((r) => !r.ok && (r.level === "fehler" || strict)) ? 1 : 0;
}
