// Mehrere Häfen: Namen von Häfen – Prüfung beim Umbenennen und Ortsname einer neuen Kolonie aus der Karte.
// Eigenes Modul ohne Befehls-Importe (wird von expansion-arrive.ts und harbors.ts genutzt).
import { eq } from "drizzle-orm";
import { hexCenter, placeNameAt } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { playerName } from "./naval-common.ts";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Erlaubte Hafennamen: 2–32 Zeichen, Buchstaben, Ziffern, Leerzeichen und _ . ' ’ - (wie Allianznamen, Länge wie „Hafen wählen“). */
export const BASE_NAME_RE = /^[\p{L}\p{N} _.'’-]{2,32}$/u;

/** Hafenname bereinigt (Leerraum gekürzt) oder null, wenn er nicht erlaubt ist. */
export function normalizeBaseName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return BASE_NAME_RE.test(name) && /[\p{L}\p{N}]/u.test(name) ? name : null;
}

/**
 * Name einer neuen Kolonie auf (col,row): Ortsname aus der Karte (world placeNameAt: Ort, „Küste bei <Ort>“ oder
 * „Posten <Meer/Region>“). Trägt schon ein Hafen diesen Namen, folgt „II“, „III“ …; sonst „<Spielername> II“.
 */
export async function colonyNameAt(db: DbOrTx, playerId: number, col: number, row: number): Promise<string> {
  const taken = new Set((await db.select({ name: tables.base.name }).from(tables.base)).map((r) => r.name.toLowerCase()));
  const place = placeNameAt(hexCenter(col, row));
  if (place) {
    for (let i = 1; i < ROMAN.length; i++) {
      const n = i === 1 ? place : `${place} ${ROMAN[i]}`;
      if (n.length <= 32 && !taken.has(n.toLowerCase())) return n;
    }
  }
  const own = (await db.select({ id: tables.base.id }).from(tables.base).where(eq(tables.base.playerId, playerId))).length + 1;
  return `${await playerName(db, playerId)} ${ROMAN[own] ?? own}`.slice(0, 32);
}
