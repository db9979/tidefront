// Felder: Admirale für Feldmissionen (docs/REGELN-FELDER.md, Einnehmen). Ein Admiral führt Aufklärung, Besetzen und
// Verstärkung wie jeden Verband (Missionsrolle: Kampf, Tempo, Treibstoff …). Nach der Einnahme bleibt er bei der
// Besatzung (Mission „stationed“, Status „unterwegs“) und führt sie bei Angriffen auf das Feld (Spieler und Kartell),
// nicht die Geleitabteilung. Mit der Besatzung kehrt er heim (Rückruf, Niederlage). Eine Verstärkung bringt ihren
// Admiral zur Besatzung, wenn diese noch keinen hat (sonst kehrt die Verstärkung um).
// Abziehen ohne Rückruf (fieldAdmiralRecall): der Admiral fährt allein auf einem Kurierboot heim – Fahrzeit mit dem
// schnellsten Schiff, ohne Treibstoff und Missionsplatz (Mission ADMIRAL_RETURN_TYPE, Status „returning“); die
// Besatzung hält das Feld ohne ihn. Bis zur Ankunft ist er „unterwegs“.
import { and, eq } from "drizzle-orm";
import type { Mission, Modifiers } from "@tidefront/game-core";
import { hexDistanceKm } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { admiralForLaunch, admiralPreviewMods, admiralStatus } from "./admirals-core.ts";
import { missionAdmiral, type BattleAdmiral } from "./admirals-battle.ts";
import { fieldById, fieldName, type FieldRow } from "./fields-core.ts";
import { ADMIRAL_RETURN_TYPE, readBase, scheduleEvent } from "./store.ts";
import { runCommand } from "./commands.ts";

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

/** Ansicht „Admirale“: Posten je Admiral bei einer Feldbesatzung oder auf der Heimfahrt davon (Text, Feld zum Abziehen). */
export async function admiralPosts(db: DbOrTx, rows: { id: number; missionId: number | null }[]): Promise<Map<number, { text: string; fieldId: number | null }>> {
  const out = new Map<number, { text: string; fieldId: number | null }>();
  for (const r of rows.filter((x) => x.missionId !== null)) {
    const [f] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.missionId, r.missionId!));
    const [m] = await db.select({ status: tables.mission.status }).from(tables.mission).where(eq(tables.mission.id, r.missionId!));
    if (f && m?.status === "stationed") out.set(r.id, { text: `führt die Besatzung auf ${fieldName(f as FieldRow)}`, fieldId: f.id });
  }
  // Allein auf der Heimfahrt von einer Besatzung (fieldAdmiralRecall).
  for (const r of rows.filter((x) => x.missionId !== null && !out.has(x.id))) {
    const [m] = await db.select({ type: tables.mission.type, status: tables.mission.status, targetId: tables.mission.targetId }).from(tables.mission).where(eq(tables.mission.id, r.missionId!));
    if (m?.type !== ADMIRAL_RETURN_TYPE || m.status !== "returning" || m.targetId === null) continue;
    const [f] = await db.select().from(tables.resourceField).where(eq(tables.resourceField.id, m.targetId));
    out.set(r.id, { text: `kehrt allein von ${f ? fieldName(f as FieldRow) : "einem Rohstofffeld"} heim`, fieldId: null });
  }
  return out;
}

/** Geschwindigkeit des Kurierboots: das schnellste Schiff der Balance (km/h). */
export function admiralBoatKmh(): number {
  return Math.max(1, ...Object.values(balance.units).filter((u) => u.branch === "see").map((u) => u.speedKmh ?? 0));
}

/**
 * Admiral von einer Besatzung abziehen, ohne sie zurückzurufen: er fährt allein in den Hafen des Felds (sein Hafen)
 * und ist bei Ankunft wieder bereit. Gefangen kann er nicht abziehen; verwundet fährt er heim und heilt dort weiter.
 * Codes: no_field, field_no_admiral, admiral_busy.
 */
export function fieldAdmiralRecall(engine: Engine, playerId: number, key: string, fieldId: number) {
  return runCommand<{ ok: true; admiralId: number; returnAtMs: number }>(engine, playerId, key, "fieldAdmiralRecall", async (ctx) => {
    const field = await fieldById(ctx.tx, fieldId, true); // Reihenfolge wie beim Rückruf: Feld vor Besatzung
    if (!field || field.ownerId !== playerId || field.missionId === null) throw new GameError("no_field");
    const [m] = await ctx.tx.select().from(tables.mission).where(eq(tables.mission.id, field.missionId)).for("update");
    if (!m || m.status !== "stationed" || m.baseId === null) throw new GameError("no_field");
    const plan = m.plan as Mission;
    const id = plan.admiralId;
    const [a] = id ? await ctx.tx.select().from(tables.admiral).where(eq(tables.admiral.id, id)).for("update") : [];
    if (!a || a.missionId !== m.id || a.playerId !== playerId) throw new GameError("field_no_admiral");
    if (a.captiveUntil && a.captiveUntil.getTime() > ctx.nowMs) throw new GameError("admiral_busy");
    const home = await readBase(ctx.tx, m.baseId);
    if (!home) throw new GameError("no_field");
    // Seewege: das Boot fährt die Route der Besatzung zurück (Hafen → Feld, rückwärts); ohne Route Luftlinie.
    const routed = plan.route && plan.route.hexes.length >= 2 ? plan.route : null;
    const km = routed ? Math.max(hexDistanceKm(field, home), routed.km) : hexDistanceKm(field, home);
    const returnAtMs = ctx.nowMs + Math.round((km / admiralBoatKmh()) * 3600000);
    const [r] = await ctx.tx.insert(tables.mission).values({
      playerId, baseId: home.id, type: ADMIRAL_RETURN_TYPE, targetKind: "field", targetId: field.id, targetCol: field.col, targetRow: field.row,
      plan: { ...plan, units: {}, admiralId: a.id, departAtMs: ctx.nowMs, arriveAtMs: ctx.nowMs, returnAtMs, recalledAtMs: undefined, travelSeconds: (returnAtMs - ctx.nowMs) / 1000 },
      status: "returning", returning: {}, cargoHome: {}, arriveAt: new Date(ctx.nowMs), returnAt: new Date(returnAtMs),
    }).returning({ id: tables.mission.id });
    await scheduleEvent(ctx.tx, "mission_return", returnAtMs, { missionId: r.id }, home.id);
    // Die Besatzung führt er nicht mehr; der Admiral hängt an der Heimfahrt (Status „unterwegs“ bis zur Ankunft).
    await ctx.tx.update(tables.mission).set({ plan: { ...plan, admiralId: undefined } }).where(eq(tables.mission.id, m.id));
    const set: Partial<typeof tables.admiral.$inferInsert> = { missionId: r.id };
    if (a.baseId !== home.id) Object.assign(set, { baseId: home.id, stationed: false });
    await ctx.tx.update(tables.admiral).set(set).where(eq(tables.admiral.id, a.id));
    ctx.notify.push([[playerId], "missions"], [[playerId], "base"]);
    return { ok: true as const, admiralId: a.id, returnAtMs };
  });
}
