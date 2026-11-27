// Test-Hilfe Mehrere Häfen: zweiten Hafen eines Spielers per SQL anlegen (Gründung ist Sache von P1).
// Sucht ein freies Küstenfeld (kein Hafen, kein Nest) – von unten nach oben, damit es nicht mit den
// Küstenfeldern der Testdateien kollidiert, die von oben suchen. Optional nahe einem Feld (maxKm).
import { and, eq } from "drizzle-orm";
import { tables, type Db } from "@tidefront/db";
import { COLS, ROWS, hexCenter, hexDistanceKm, isCoast, nestSites } from "@tidefront/world";
import { createBase, type BaseState } from "@tidefront/game-core";
import { balance } from "../src/index.ts";

export interface SecondHarborOpts {
  /** Startzustand anpassen (Gebäude, Einheiten …); Vorgabe: Startzustand mit vielen Ressourcen. */
  patch?: (s: BaseState) => void;
  /** Feld vorgeben statt suchen. */
  at?: { col: number; row: number };
  /** Nahe diesem Feld suchen (höchstens maxKm, mindestens minKm entfernt). */
  near?: { col: number; row: number };
  maxKm?: number;
  minKm?: number;
  name?: string;
}

export async function freeCoastField(db: Db, opts: SecondHarborOpts = {}): Promise<{ col: number; row: number }> {
  const taken = new Set((await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)).map((b) => `${b.col},${b.row}`));
  for (const n of nestSites()) taken.add(`${n.col},${n.row}`);
  for (let row = ROWS - 1; row >= 0; row--) {
    for (let col = COLS - 1; col >= 0; col--) {
      if (!isCoast(col, row) || taken.has(`${col},${row}`)) continue;
      if (opts.near) {
        const d = hexDistanceKm(opts.near, { col, row });
        if (d > (opts.maxKm ?? 300) || d < (opts.minKm ?? 0)) continue;
      }
      return { col, row };
    }
  }
  throw new Error("kein freies Küstenfeld");
}

/** Legt einen weiteren Hafen (is_home = false) für den Spieler an; liefert ID und Feld. */
export async function addSecondHarbor(db: Db, playerId: number, opts: SecondHarborOpts = {}) {
  const f = opts.at ?? (await freeCoastField(db, opts));
  const s = createBase(balance, Date.now(), hexCenter(f.col, f.row));
  s.resources = { stahl: 50000, treibstoff: 50000, elektronik: 50000, proviant: 50000 };
  opts.patch?.(s);
  const name = opts.name ?? `Außenposten ${playerId}`;
  const [r] = await db
    .insert(tables.base)
    .values({ playerId, name, ...f, state: { ...s, site: hexCenter(f.col, f.row) }, isHome: false })
    .returning({ id: tables.base.id });
  return { baseId: r.id, name, ...f };
}

/** Hafenzustand lesen (roh aus der Datenbank). */
export async function harborState(db: Db, baseId: number): Promise<BaseState> {
  const [b] = await db.select({ state: tables.base.state }).from(tables.base).where(and(eq(tables.base.id, baseId)));
  return b.state as BaseState;
}
