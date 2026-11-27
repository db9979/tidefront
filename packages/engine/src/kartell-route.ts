// Seewege für das Kartell (Entscheidung U, ENTSCHEIDUNGEN-4.md): Ein Kartell-Überfall läuft vom nächsten Nest über
// Wasser zum Hafen. Die Vorlaufzeit bleibt auf offener See RAID_LEAD_MS (1 h) und wächst mit dem Umweg um Land
// (Routenlänge / Luftlinie), höchstens auf CARTEL_LEAD_CAP-fach. Die Route liegt im Plan (Karte, Radar, Position).
import { seaRoute, seaRouteCopy, hexDistanceKm, type SeaRoute } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { RAID_LEAD_MS } from "./context.ts";

/** Höchstens so viel länger als auf offener See (3 h statt 1 h): Häfen hinter Land werden nicht unerreichbar. */
export const CARTEL_LEAD_CAP = 3;

/** Aus so vielen Nestern (nach Luftlinie) wählt das Kartell das mit dem kürzesten Seeweg. */
const CANDIDATES = 3;

/**
 * Ausgangsnest, Route und Vorlaufzeit eines Kartell-Überfalls auf das Feld `to`. Ohne Nester: kein Seeweg, 1 h.
 * Rein bis auf die Nestliste; die Wegsuche ist zwischengespeichert.
 */
export function cartelRaidPlan(nests: readonly { col: number; row: number }[], to: { col: number; row: number }): { route: SeaRoute | null; leadMs: number } {
  const near = nests.map((n) => ({ n, d: hexDistanceKm(n, to) })).filter((x) => x.d > 0).sort((a, b) => a.d - b.d).slice(0, CANDIDATES);
  let best: { route: SeaRoute; ratio: number } | null = null;
  for (const { n, d } of near) {
    const r = seaRoute(n, to);
    const ratio = Math.max(1, r.km / d);
    if (!best || r.km < best.route.km) best = { route: r, ratio };
  }
  if (!best) return { route: null, leadMs: RAID_LEAD_MS };
  return { route: seaRouteCopy(best.route), leadMs: Math.round(RAID_LEAD_MS * Math.min(CARTEL_LEAD_CAP, best.ratio)) };
}

/** Nester der Welt für cartelRaidPlan. */
export async function nestSpots(db: DbOrTx): Promise<{ col: number; row: number }[]> {
  return db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest);
}
