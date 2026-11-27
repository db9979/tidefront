// Einstieg: Jeder neue Spieler hat bei der Hafenwahl ein unbesiegtes Piratennest der Stufe 1 in höchstens 300 km
// (START_NEST_KM). Fehlt eins, wird auf einem freien, übers Wasser erreichbaren Seefeld direkt vor der Küste eines
// angelegt (eine Pirateninsel): nicht auf Häfen, Nestern, Rohstofffeldern (auch künftigen Feldplätzen) oder
// Handelshäfen; das Gelände bleibt unverändert. Seefeld statt Küste, damit das neue Nest nie ein Küstenfeld belegt, das
// ein anderer Spieler als Hafenplatz wählen könnte. Das Start-Nest ist dem Spieler bekannt (Lagebild-Eintrag „Hafenamt“), und das
// Auftragsbuch nennt es als Ziel des Nest-Auftrags, auch wenn das Wissen später verblasst.
import { and, eq, inArray } from "drizzle-orm";
import { hexDistanceKm, isTradePortHex, neighbors, terrainAt, type Hex } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { nestData, nestIntelData, recordSightings } from "./intel-store.ts";
import { ensureNestRolls } from "./nest-live.ts"; // Lebendige Nester
import { partyOf } from "./intel-sight.ts";
import { rules as fieldRules, sitesOf } from "./fields-core.ts";

/** Höchstabstand des zugesicherten Start-Nests vom Heimathafen. */
export const START_NEST_KM = 300;
/** Ein neu angelegtes Start-Nest liegt nicht direkt vor der Hafeneinfahrt. */
const MIN_KM = 90;
/** Wunschabstand: eine kurze, aber echte Fahrt. */
const IDEAL_KM = 180;
/** Möglichst Abstand zu anderen Nestern (sonst Häufung an derselben Küste). */
const NEST_GAP_KM = 120;

export interface StartNest { id: number; col: number; row: number; level: number; distanceKm: number }

/** Nächstes unbesiegtes (bzw. wieder besetztes) Nest der Stufe 1 in START_NEST_KM, sonst null. */
export async function nearestOpenLevel1(db: DbOrTx, home: Hex, nowMs: number, maxKm = START_NEST_KM): Promise<StartNest | null> {
  const rows = await db.select().from(tables.nest).where(eq(tables.nest.level, 1));
  let best: StartNest | null = null;
  for (const n of rows) {
    if (nestData(n, nowMs).empty) continue;
    const d = hexDistanceKm(home, n);
    if (d > maxKm || (best && best.distanceKm <= d)) continue;
    best = { id: n.id, col: n.col, row: n.row, level: n.level, distanceKm: d };
  }
  return best;
}

/**
 * Seefelder mit Küste nebenan in START_NEST_KM, die vom Hafen aus über Meer und Küste erreichbar sind (Breitensuche,
 * keine Binnenlandfelder), mit Abstand. Rein, ohne Datenbank.
 */
export function reachableShoreSea(home: Hex, maxKm = START_NEST_KM): { col: number; row: number; d: number }[] {
  const seen = new Set<string>([`${home.col},${home.row}`]);
  const queue: Hex[] = [home];
  const out: { col: number; row: number; d: number }[] = [];
  while (queue.length > 0) {
    const h = queue.shift()!;
    for (const n of neighbors(h.col, h.row)) {
      const k = `${n.col},${n.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const t = terrainAt(n.col, n.row);
      if (t !== "sea" && t !== "coast") continue;
      const d = hexDistanceKm(home, n);
      if (d > maxKm) continue;
      queue.push(n);
      if (t === "sea" && neighbors(n.col, n.row).some((x) => terrainAt(x.col, x.row) === "coast")) out.push({ col: n.col, row: n.row, d });
    }
  }
  return out;
}

/**
 * Sorgt bei der Hafenwahl für ein Start-Nest (in der Transaktion von chooseBase, vor dem Anlegen des Hafens). Liefert
 * das Nest (vorhanden oder neu) oder null, wenn in Reichweite kein freies Küstenfeld liegt.
 */
export async function ensureStartNest(db: DbOrTx, home: Hex, nowMs: number): Promise<(StartNest & { created: boolean }) | null> {
  const have = await nearestOpenLevel1(db, home, nowMs);
  if (have) return { ...have, created: false };
  const fr = fieldRules();
  const sites = new Set((fr ? sitesOf(fr) : []).map((f) => `${f.col},${f.row}`));
  const cands = reachableShoreSea(home).filter((c) => c.d >= MIN_KM && !isTradePortHex(c.col, c.row) && !sites.has(`${c.col},${c.row}`));
  if (cands.length === 0) return null;
  const cols = [...new Set(cands.map((c) => c.col))];
  const [bases, nests, fields] = await Promise.all([
    db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base).where(inArray(tables.base.col, cols)),
    db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest),
    db.select({ col: tables.resourceField.col, row: tables.resourceField.row }).from(tables.resourceField).where(inArray(tables.resourceField.col, cols)),
  ]);
  const blocked = new Set([...bases, ...nests, ...fields].map((x) => `${x.col},${x.row}`));
  const free = cands.filter((c) => !blocked.has(`${c.col},${c.row}`));
  const crowded = (c: Hex) => nests.some((n) => hexDistanceKm(c, n) < NEST_GAP_KM);
  // Bevorzugt: nicht gedrängt, dann nah am Wunschabstand; gleiche Lage → feste Reihenfolge (Spalte, Zeile).
  free.sort((a, b) => Number(crowded(a)) - Number(crowded(b)) || Math.abs(a.d - IDEAL_KM) - Math.abs(b.d - IDEAL_KM) || a.col - b.col || a.row - b.row);
  for (const c of free) {
    const ins = await db.insert(tables.nest).values({ col: c.col, row: c.row, level: 1 }).onConflictDoNothing().returning({ id: tables.nest.id });
    if (ins.length > 0) return { id: ins[0].id, col: c.col, row: c.row, level: 1, distanceKm: c.d, created: true };
  }
  return null;
}

/** Das Start-Nest ist dem Spieler bekannt (Lagebild: Stufe und Zustand wie nach einer Aufklärung). */
export async function revealStartNest(db: DbOrTx, playerId: number, nestId: number, nowMs: number): Promise<void> {
  const [row] = await db.select().from(tables.nest).where(and(eq(tables.nest.id, nestId)));
  if (!row) return;
  // Lebendige Nester: Wurf (Stufe 1 fest) und Besetzung festhalten, damit das Lagebild genau bleibt.
  if (await ensureNestRolls(db, nowMs, [row])) return revealStartNest(db, playerId, nestId, nowMs);
  const { party } = await partyOf(db, playerId);
  await recordSightings(db, party, [{ kind: "nest", objectId: row.id, level: "lagebild", source: "Hafenamt", data: nestIntelData(row, nowMs) }], nowMs);
}
