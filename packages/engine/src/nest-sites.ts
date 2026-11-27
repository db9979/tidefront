// Nestplätze der Welt in die Tabelle nest eintragen (Seed beim migrate, Saisonwechsel). Idempotent.
import { nestSites } from "@tidefront/world";
import { inArray } from "drizzle-orm";
import { tables, type DbOrTx } from "@tidefront/db";

/**
 * Legt fehlende Nester aus `nestSites()` an. Vorhandene Nester (gleiches Feld) bleiben unverändert – so werden später
 * ergänzte Plätze (Stufe 6, Balance v1.15) in einer laufenden Welt nachgetragen, ohne bestehende Nester anzufassen.
 * Felder mit einem Hafen werden übersprungen (beim Saisonwechsel sind die Häfen schon gelöscht). Liefert die Zahl der
 * neu angelegten Nester.
 */
export async function ensureNests(db: DbOrTx, opts: { dropStartNests?: boolean } = {}): Promise<number> {
  // Saisonwechsel: Start-Nester (Einstieg, start-nest.ts – Nester außerhalb der Weltplätze) verfallen mit den Häfen;
  // die neue Saison legt sie bei der Hafenwahl bei Bedarf neu an.
  if (opts.dropStartNests) {
    const keep = new Set(nestSites().map((s) => `${s.col},${s.row}`));
    const extra = (await db.select({ id: tables.nest.id, col: tables.nest.col, row: tables.nest.row }).from(tables.nest)).filter((n) => !keep.has(`${n.col},${n.row}`));
    if (extra.length > 0) await db.delete(tables.nest).where(inArray(tables.nest.id, extra.map((n) => n.id)));
  }
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
