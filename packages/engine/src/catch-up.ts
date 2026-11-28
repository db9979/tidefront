// Aufholhilfe (game-core catch-up.ts, docs/REGELN.md „Aufholhilfe“): einmal je Stunde im Worker Median der Ausbaupunkte,
// Rückstand je Spieler und Zufluss der Baugutschrift; Startpaket für Spät-Einsteiger bei der Hafenwahl. Leichtgewichtig
// für den Raspberry Pi: eine Abfrage nur der Gebäudestufen aller Häfen, geschrieben werden nur Häfen mit Hilfe oder
// Konto (je Hafen eine kurze Transaktion mit Zeilensperre, damit kein gleichzeitiger Bauauftrag Gutschrift verliert).
import { sql } from "drizzle-orm";
import {
  accrueCatchUp,
  catchUpBonus,
  catchUpOf,
  emptyCatchUp,
  median,
  productionRates,
  refValue,
  type BaseState,
  type CatchUpBalance,
  type CatchUpState,
  type Counts,
} from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { buildingValue, countsValue } from "./scoring.ts"; // Ausbau- und (v1.35) Militärpunkte nur lesen
import { runningSeason } from "./season.ts";
import { getSetting, setSetting } from "./settings.ts";

const DAY_MS = 86400000;
/** Zwischenspeicher des letzten Laufs (server_setting): Zeitpunkt und Median-Ausbauwert. */
export const CATCH_UP_KEY = "catch_up";

export interface CatchUpSnapshot {
  atMs: number;
  /** v1.35: Median der Gebäudeproduktion (Richtwert je Stunde, alle Häfen eines Spielers) derselben Spieler; null: keiner. */
  medianPerHour: number | null;
  /** Median der Ausbauwerte (Richtwert) der Spieler, deren erster Hafen mindestens minBaseAgeDays alt ist; null: keiner. */
  median: number | null;
  /** Ausbauwert je Spieler (alle Häfen). */
  values: Map<number, number>;
  /** Saisontag (1 = erster Tag); null ohne laufende Saison. */
  seasonDay: number | null;
}

/** Saisontag zum Zeitpunkt nowMs (1 = erster Tag der Saison). */
export function seasonDayAt(seasonStartMs: number, nowMs: number): number {
  return Math.floor((nowMs - seasonStartMs) / DAY_MS) + 1;
}

/**
 * Median der Ausbaupunkte (Menschen und KI) und Ausbauwert je Spieler – eine Abfrage. v1.35: mit includeMilitary zählt
 * der Wert der Einheiten (daheim und unterwegs) und Anlagen mit (M-10), dazu der Median der Gebäudeproduktion für den
 * Mindestzufluss (AN-10).
 */
export async function catchUpSnapshot(db: DbOrTx, nowMs: number, cu: CatchUpBalance): Promise<CatchUpSnapshot> {
  const rows = await db.execute<{ player_id: number; first_ms: number; state: BaseState }>(sql`
    select player_id, (extract(epoch from min(created_at) over (partition by player_id)) * 1000)::float8 as first_ms, state
    from base`);
  const values = new Map<number, number>();
  const perHour = new Map<number, number>();
  const first = new Map<number, number>();
  for (const r of rows) {
    const s = r.state;
    let v = buildingValue(s.buildings ?? {});
    if (cu.includeMilitary) v += countsValue(s.units) + countsValue(s.unitsAway) + countsValue(s.defenses);
    values.set(r.player_id, (values.get(r.player_id) ?? 0) + v);
    if (cu.minFlowShare) perHour.set(r.player_id, (perHour.get(r.player_id) ?? 0) + refValue(productionRates(s, balance, undefined, nowMs).buildingPerHour, balance));
    first.set(r.player_id, r.first_ms);
  }
  const oldEnough = [...values.keys()].filter((id) => nowMs - (first.get(id) ?? nowMs) >= cu.minBaseAgeDays * DAY_MS);
  const m = median(oldEnough.map((id) => values.get(id) ?? 0));
  const mp = cu.minFlowShare ? median(oldEnough.map((id) => perHour.get(id) ?? 0)) : null;
  const season = await runningSeason(db);
  return {
    atMs: nowMs, median: m !== null && m > 0 ? m : null, medianPerHour: mp !== null && mp > 0 ? mp : null, values,
    seasonDay: season ? seasonDayAt(season.startsAt.getTime(), nowMs) : null,
  };
}

/** Zuletzt zwischengespeicherter Median (höchstens zwei Laufabstände alt), sonst null. */
async function cachedMedian(db: DbOrTx, nowMs: number, cu: CatchUpBalance): Promise<number | null | undefined> {
  const raw = await getSetting(db, CATCH_UP_KEY);
  if (!raw) return undefined;
  try {
    const c = JSON.parse(raw) as { atMs: number; median: number | null };
    return nowMs - c.atMs <= 2 * cu.refreshMinutes * 60000 ? c.median : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stündlicher Lauf (Worker, alle 10 Minuten aufgerufen; rechnet nur, wenn refreshMinutes seit dem letzten Lauf vergangen
 * sind, oder mit force). Liefert die Zahl der geschriebenen Häfen.
 */
export async function runCatchUp(engine: Engine, nowMs: number, opts: { force?: boolean } = {}): Promise<number> {
  const cu = catchUpOf(balance);
  if (!cu) return 0;
  if (!opts.force) {
    const raw = await getSetting(engine.db, CATCH_UP_KEY);
    const last = raw ? (JSON.parse(raw) as { atMs?: number }).atMs ?? 0 : 0;
    if (nowMs - last < cu.refreshMinutes * 60000) return 0;
  }
  const snap = await catchUpSnapshot(engine.db, nowMs, cu);
  await setSetting(engine.db, CATCH_UP_KEY, JSON.stringify({ atMs: nowMs, median: snap.median }));
  // Ab stopDay kein Zufluss mehr (Bonus und Verhältnis werden weiter angezeigt).
  const flowing = snap.seasonDay !== null && snap.seasonDay < cu.stopDay;
  const bases = await engine.db.execute<{ id: number; player_id: number; has: boolean }>(sql`
    select id, player_id, state ? 'catchUp' as has from base order by id`);
  let written = 0;
  for (const b of bases) {
    const value = snap.values.get(b.player_id) ?? 0;
    const ratio = snap.median === null ? null : value / snap.median;
    // Häfen ohne Konto und ohne Aussicht auf Hilfe bleiben unberührt (keine Schreiblast).
    if (!b.has && (ratio === null || ratio >= cu.from)) continue;
    const done = await engine.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ state: BaseState }>(sql`select state from base where id = ${b.id} for update`);
      if (!row) return false;
      const prev = row.state.catchUp ?? null;
      const { bonus, active } = catchUpBonus(ratio, cu, prev);
      if (!prev && bonus <= 0) return false;
      const base: CatchUpState = { ...(prev ?? emptyCatchUp(nowMs)), bonus, active, ratio };
      const perHour = refValue(productionRates(row.state, balance, undefined, nowMs).buildingPerHour, balance);
      // Zufluss mit dem Bonus des vorigen Laufs (er galt die vergangene Stunde), danach der neue Bonus.
      const minPerHour = (cu.minFlowShare ?? 0) * (snap.medianPerHour ?? 0); // v1.35: Mindestzufluss für Rückkehrer
      const next = prev ? { ...accrueCatchUp(prev, perHour, nowMs, cu, flowing, minPerHour), bonus, active, ratio } : base;
      await tx.execute(sql`update base set state = jsonb_set(state, '{catchUp}', ${JSON.stringify(next)}::jsonb) where id = ${b.id}`);
      return true;
    });
    if (done) written++;
  }
  return written;
}

/**
 * Startpaket für Spät-Einsteiger (Hafenwahl, erster Hafen der Saison): ab Saisontag latePackFromDay latePackShare des
 * Median-Ausbauwerts als Baugutschrift. Median aus dem Zwischenspeicher des Workers, sonst frisch gerechnet.
 */
export async function latePackState(db: DbOrTx, nowMs: number): Promise<CatchUpState | null> {
  const cu = catchUpOf(balance);
  if (!cu || cu.latePackShare <= 0) return null;
  const season = await runningSeason(db);
  if (!season || seasonDayAt(season.startsAt.getTime(), nowMs) < cu.latePackFromDay) return null;
  let m = await cachedMedian(db, nowMs, cu);
  if (m === undefined) m = (await catchUpSnapshot(db, nowMs, cu)).median;
  if (!m) return null;
  const pack = Math.round(cu.latePackShare * m);
  return pack > 0 ? { ...emptyCatchUp(nowMs), credit: pack, pack } : null;
}

/** Anzeige im Hafen: Bestand, Bonus, Verhältnis, Herkunft (Startpaket, Zufluss). Null ohne Konto. */
export function catchUpView(s: BaseState) {
  const c = s.catchUp;
  const cu = catchUpOf(balance);
  if (!c || !cu) return null;
  return {
    credit: Math.floor(c.credit),
    bonus: c.bonus,
    ratio: c.ratio,
    active: c.active,
    earned: Math.floor(c.earned),
    pack: c.pack ?? 0,
    /** Regelwerte für die Erklärung. */
    rules: { from: cu.from, full: cu.full, cap: cu.cap, resumeBelow: cu.resumeBelow, storeHours: cu.storeHours },
  };
}
