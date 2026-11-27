// Nestplätze der Welt in die Tabelle nest eintragen (Seed beim migrate, Saisonwechsel). Idempotent.
import { nestSites } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";

/**
 * Legt fehlende Nester aus `nestSites()` an. Vorhandene Nester (gleiches Feld) bleiben unverändert – so werden später
 * ergänzte Plätze (Stufe 6, Balance v1.15) in einer laufenden Welt nachgetragen, ohne bestehende Nester anzufassen.
 * Felder mit einem Hafen werden übersprungen (beim Saisonwechsel sind die Häfen schon gelöscht). Liefert die Zahl der
 * neu angelegten Nester.
 */
export async function ensureNests(db: DbOrTx): Promise<number> {
  const taken = new Set((await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base)).map((b) => `${b.col},${b.row}`));
  const sites = nestSites().filter((s) => !taken.has(`${s.col},${s.row}`));
  if (sites.length === 0) return 0;
  const added = await db
    .insert(tables.nest)
    .values(sites.map((s) => ({ col: s.col, row: s.row, level: s.level })))
    .onConflictDoNothing()
    .returning({ id: tables.nest.id });
  return added.length;
}
