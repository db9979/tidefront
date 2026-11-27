// Felder: Admirale für Feldmissionen (docs/REGELN-FELDER.md, Einnehmen). Ein Admiral führt Aufklärung, Besetzen und
// Verstärkung wie jeden Verband (Missionsrolle: Kampf, Tempo, Treibstoff …). Nach der Einnahme bleibt er bei der
// Besatzung (Mission „stationed“, Status „unterwegs“) und führt sie bei Angriffen auf das Feld (Spieler und Kartell),
// nicht die Geleitabteilung. Mit der Besatzung kehrt er heim (Rückruf, Niederlage). Eine Verstärkung bringt ihren
// Admiral zur Besatzung, wenn diese noch keinen hat (sonst kehrt die Verstärkung um).
import { and, eq } from "drizzle-orm";
import type { Mission, Modifiers } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { GameError } from "./context.ts";
import { admiralForLaunch, admiralPreviewMods, admiralStatus } from "./admirals-core.ts";
import { missionAdmiral, type BattleAdmiral } from "./admirals-battle.ts";
import { fieldName, type FieldRow } from "./fields-core.ts";

/** Admiral, der eine Besatzung (stationierte Mission) führt – nur, wenn er weder verwundet noch gefangen ist. */
export async function garrisonAdmiral(tx: Tx, m: { id: number; plan: unknown; playerId: number | null }, due: number): Promise<BattleAdmiral | null> {
  const adm = await missionAdmiral(tx, m.plan as Mission, m.id, m.playerId);
  if (!adm) return null;
  const st = admiralStatus(adm.row, new Set([m.id]), due).status;
  return st === "verwundet" || st === "gefangen" ? null : adm;
}

/** Admiral-ID, die eine stehende Besatzung führt (oder null). */
async function garrisonAdmiralId(db: DbOrTx, garrisonMissionId: number): Promise<number | null> {
  const [m] = await db.select({ plan: tables.mission.plan }).from(tables.mission).where(eq(tables.mission.id, garrisonMissionId));
  const id = (m?.plan as Mission | undefined)?.admiralId;
  if (!id) return null;
  const [a] = await db.select({ id: tables.admiral.id }).from(tables.admiral)
    .where(and(eq(tables.admiral.id, id), eq(tables.admiral.missionId, garrisonMissionId)));
  return a ? a.id : null;
}

/**
 * Admiral für eine Feldmission prüfen und sperren (Ausgangshafen, bereit). Verstärkung nur, wenn die Besatzung noch
 * keinen Admiral hat. Codes: admiral_unknown, admiral_busy, admiral_other_base, field_has_admiral.
 */
export async function fieldLaunchAdmiral(tx: Tx, playerId: number, admiralId: number | undefined, baseId: number, field: FieldRow, reinforce: boolean, nowMs: number) {
  if (admiralId === undefined) return null;
  const adm = await admiralForLaunch(tx, playerId, admiralId, nowMs, baseId);
  if (reinforce && field.missionId !== null && (await garrisonAdmiralId(tx, field.missionId)) !== null) throw new GameError("field_has_admiral");
  return adm;
}

/** Vorschau: Missionsmodifikatoren des gewählten Admirals (ohne Verfügbarkeitsprüfung). */
export function fieldPreviewAdmiralMods(db: DbOrTx, playerId: number, admiralId: number | undefined): Promise<Modifiers | null> {
  return admiralPreviewMods(db, playerId, admiralId);
}

/**
 * Verstärkung trifft ein: ihr Admiral übernimmt die Besatzung, wenn sie keinen hat (wechselt dabei in den Hafen des
 * Felds und ist dort nicht mehr Hafenkommandant). false = die Besatzung hat schon einen Admiral (Verstärkung kehrt um).
 */
export async function reinforceAdmiral(tx: Tx, m: { id: number }, plan: Mission, g: { id: number; baseId: number | null }): Promise<{ ok: boolean; admiralId: number | null }> {
  const id = plan.admiralId;
  if (!id) return { ok: true, admiralId: null };
  const [a] = await tx.select().from(tables.admiral).where(eq(tables.admiral.id, id)).for("update");
  if (!a || a.missionId !== m.id) return { ok: true, admiralId: null };
  if ((await garrisonAdmiralId(tx, g.id)) !== null) return { ok: false, admiralId: null };
  const set: Partial<typeof tables.admiral.$inferInsert> = { missionId: g.id };
  if (g.baseId !== null && g.baseId !== a.baseId) Object.assign(set, { baseId: g.baseId, stationed: false });
  await tx.update(tables.admiral).set(set).where(eq(tables.admiral.id, a.id));
  return { ok: true, admiralId: a.id };
}

/** Ansicht „Admirale“: Posten je Admiral, der eine Feldbesatzung führt (Admiral-ID → Text). */
export async function admiralPosts(db: DbOrTx, rows: { id: number; missionId: number | null }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const r of rows.filter((x) => x.missionId !== null)) {
    const [f] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.missionId, r.missionId!));
    const [m] = await db.select({ status: tables.mission.status }).from(tables.mission).where(eq(tables.mission.id, r.missionId!));
    if (f && m?.status === "stationed") out.set(r.id, `führt die Besatzung auf ${fieldName(f as FieldRow)}`);
  }
  return out;
}
