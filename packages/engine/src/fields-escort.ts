// Felder: Geleitabteilung (docs/REGELN-FELDER.md, Abschnitt Geleitschutz). Ein Teil der Besatzung begleitet die
// Ertragskonvois des Felds und kämpft bei Abfangversuchen (Kartell, Kriegsgegner) mit; fahren mehrere Konvois
// zugleich, teilt sie sich anteilig nach Warenwert auf. Gegen Spielerangriffe auf das Feld verteidigt sie nicht,
// gegen Kartellangriffe schon (fields-run.ts). Gespeichert in resource_field.escort; die Schiffe bleiben Teil der
// Besatzungsmission (returning), Verluste im Konvoikampf werden dort abgezogen. Eingehängt in naval-convoy.ts
// (liveEscort, fightEscort) und fields-run.ts.
import { and, eq, gt, lte } from "drizzle-orm";
import {
  activeUnits, cargoValue, clampEscort, escortCheck, splitEscort, subtractCounts, type Counts, type ResourceMap,
} from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type Engine } from "./context.ts";
import { runCommand } from "./commands.ts";
import { fieldById } from "./fields-core.ts";

/** Aktuelle Geleitabteilung einer Besatzungsmission (leer, wenn das Feld nicht mehr gehalten wird). */
export async function fieldEscortOf(db: DbOrTx, missionId: number | null): Promise<Counts> {
  if (missionId === null) return {};
  const [f] = await db.select({ escort: tables.resourceField.escort, ownerId: tables.resourceField.ownerId })
    .from(tables.resourceField).where(eq(tables.resourceField.missionId, missionId));
  if (!f || f.ownerId === null) return {};
  const [m] = await db.select({ status: tables.mission.status, returning: tables.mission.returning }).from(tables.mission).where(eq(tables.mission.id, missionId));
  if (!m || m.status !== "stationed") return {};
  return clampEscort(activeUnits((m.returning as Counts | null) ?? {}), (f.escort as Counts) ?? {});
}

/**
 * Anteil der Geleitabteilung, der einen Ertragskonvoi im Moment `atMs` begleitet: Die Abteilung verteilt sich auf
 * alle zu diesem Zeitpunkt fahrenden Konvois derselben Besatzung, die mit Geleit ausgelaufen sind und es noch haben
 * (anteilig nach Warenwert, splitEscort). Ein Konvoi allein erhält die ganze Abteilung.
 */
export async function fieldEscortShare(db: DbOrTx, c: { id: number; missionId: number | null }, atMs: number): Promise<Counts> {
  const all = await fieldEscortOf(db, c.missionId);
  if (c.missionId === null || Object.keys(all).length === 0) return {};
  const t = tables.convoy;
  const rows = await db.select({ id: t.id, cargo: t.cargo, escort: t.escort }).from(t)
    .where(and(eq(t.kind, "feld"), eq(t.missionId, c.missionId), eq(t.status, "underway"), lte(t.departAt, new Date(atMs)), gt(t.arriveAt, new Date(atMs))));
  const sailing = rows.filter((r) => r.id === c.id || Object.values((r.escort as Counts) ?? {}).some((n) => n > 0));
  if (!sailing.some((r) => r.id === c.id)) sailing.push({ id: c.id, cargo: {}, escort: {} });
  return splitEscort(all, sailing.map((r) => ({ id: r.id, value: cargoValue((r.cargo as ResourceMap) ?? {}, balance) }))).get(c.id) ?? {};
}

/** Verluste der Geleitabteilung im Konvoikampf: aus Besatzung und Geleit streichen. */
export async function fieldEscortLosses(tx: Tx, missionId: number | null, before: Counts, after: Counts): Promise<void> {
  if (missionId === null) return;
  const lost = subtractCounts(before, after);
  if (Object.keys(lost).length === 0) return;
  const [m] = await tx.select().from(tables.mission).where(eq(tables.mission.id, missionId)).for("update");
  if (!m || m.status !== "stationed") return;
  const garrison = subtractCounts(activeUnits((m.returning as Counts | null) ?? {}), lost);
  await tx.update(tables.mission).set({ returning: garrison }).where(eq(tables.mission.id, m.id));
  const [f] = await tx.select({ id: tables.resourceField.id, escort: tables.resourceField.escort }).from(tables.resourceField)
    .where(eq(tables.resourceField.missionId, missionId));
  if (f) {
    const escort = clampEscort(garrison, subtractCounts((f.escort as Counts) ?? {}, lost));
    await tx.update(tables.resourceField).set({ escort }).where(eq(tables.resourceField.id, f.id));
  }
}

/**
 * Geleitabteilung eines eigenen Felds festlegen (leer = aufheben). Gilt ab dem nächsten Ertragskonvoi.
 * Codes: no_field, field_no_garrison, field_escort_invalid, field_escort_too_large.
 */
export function setFieldEscort(engine: Engine, playerId: number, key: string, fieldId: number, units: Counts) {
  return runCommand<{ ok: true; escort: Counts }>(engine, playerId, key, "fieldEscort", async (ctx) => {
    const field = await fieldById(ctx.tx, fieldId, true);
    if (!field || field.ownerId !== playerId) throw new GameError("no_field");
    const [m] = field.missionId !== null
      ? await ctx.tx.select().from(tables.mission).where(and(eq(tables.mission.id, field.missionId), eq(tables.mission.status, "stationed")))
      : [];
    if (!m) throw new GameError("field_no_garrison");
    const r = escortCheck(activeUnits((m.returning as Counts | null) ?? {}), units, balance);
    if (!r.ok) throw new GameError(r.code);
    await ctx.tx.update(tables.resourceField).set({ escort: r.escort }).where(eq(tables.resourceField.id, field.id));
    ctx.notify.push([[playerId], "missions"]);
    return { ok: true as const, escort: r.escort };
  });
}
