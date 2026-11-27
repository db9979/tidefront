// Felder: Verstärkung einer Besatzung (docs/REGELN-FELDER.md, Einnehmen). „Besetzen“ gegen ein eigenes Feld mit
// stehender Besatzung schickt Schiffe ohne Kampf zur Besatzung: bei Ankunft werden sie ihr hinzugefügt (kein Rückruf
// nötig). Aus einem anderen eigenen Hafen wechseln sie dabei in den Hafen des Felds (Veteranen gewichtet gemischt wie
// bei der Verlegung, unitsAway wandert mit). Ist das Feld bei Ankunft nicht mehr eigen, kehrt der Verband heim.
import { eq } from "drizzle-orm";
import { activeUnits, addCounts, mergeVeterancy, returnMission, settle, type Counts, type Mission } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, type NoticeJob } from "./context.ts";
import { lockBases, saveBase } from "./store.ts";
import { modsOf } from "./modifiers.ts";
import { activeCounts, hasShips, pushNotice, sendHome, storeNavalReport, type MissionRowLike, type Notes } from "./naval-common.ts";
import { fieldName, type FieldRow } from "./fields-core.ts";
import { reinforceAdmiral } from "./fields-admiral.ts";

/** Hat der Admiral der Verstärkung die Besatzung übernommen? Dann steht er im Plan der Besatzung. */
async function joinedAdmiral(tx: Tx, admiralId: number, garrisonId: number): Promise<{ admiralId?: number }> {
  const [a] = await tx.select({ missionId: tables.admiral.missionId }).from(tables.admiral).where(eq(tables.admiral.id, admiralId));
  return a?.missionId === garrisonId ? { admiralId } : {};
}

/** Stehende Besatzungsmission eines Felds oder null. */
export async function stationedGarrison(db: DbOrTx, f: FieldRow, lock = false) {
  if (f.missionId === null) return null;
  const q = db.select().from(tables.mission).where(eq(tables.mission.id, f.missionId));
  const [m] = lock ? await q.for("update") : await q;
  return m && m.status === "stationed" ? m : null;
}

/** Prüfung beim Auslaufen einer Verstärkung. Codes: empty_fleet, field_ships_only, field_no_garrison. */
export async function checkReinforce(db: DbOrTx, f: FieldRow, units: Counts): Promise<void> {
  const ships = activeCounts(units);
  if (Object.keys(ships).length === 0) throw new GameError("empty_fleet");
  if (Object.keys(ships).some((id) => balance.units[id]?.branch !== "see")) throw new GameError("field_ships_only");
  if (!(await stationedGarrison(db, f))) throw new GameError("field_no_garrison");
}

/** Ankunft einer Verstärkung (auch: Besetzen-Verband erreicht ein inzwischen eigenes Feld). */
export async function reinforceArrive(tx: Tx, m: MissionRowLike, plan: Mission, field: FieldRow, due: number, notify: Notes, push: NoticeJob[]): Promise<void> {
  const pid = m.playerId!;
  const units = activeCounts(plan.units);
  const name = fieldName(field);
  const g = field.ownerId === pid ? await stationedGarrison(tx, field, true) : null;
  // Admiral der Verstärkung übernimmt die Besatzung, wenn sie keinen hat; sonst kehrt die Verstärkung um.
  const refused = !g || g.baseId === null || m.baseId === null || !hasShips(units) ? "field_lost"
    : !(await reinforceAdmiral(tx, m, plan, g)).ok ? "field_has_admiral" : null;
  if (refused || !g || g.baseId === null || m.baseId === null) {
    const reportId = await storeNavalReport(tx, {
      kind: "feld", title: `Verstärkung für ${name} kehrt um`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId, atMs: due,
      report: { field: { id: field.id, kind: field.kind, tier: field.tier, refused: refused ?? "field_lost" } },
    });
    await sendHome(tx, m, plan, units, {}, reportId, due);
    push.push(pushNotice(pid, "report", `Verstärkung für ${name} kehrt um`, refused === "field_has_admiral" ? "Die Besatzung hat schon einen Admiral." : "Das Feld wird nicht mehr von dir gehalten.", "berichte"));
    notify.push([[pid], "reports"], [[pid], "missions"]);
    return;
  }
  const gPlan = { ...(g.plan as Mission), ...(plan.admiralId ? await joinedAdmiral(tx, plan.admiralId, g.id) : {}) };
  // Ausgesandt laut gespeichertem Plan (Minenverluste unterwegs stecken nur in plan.units des Ablaufs).
  const [orig] = await tx.select({ plan: tables.mission.plan }).from(tables.mission).where(eq(tables.mission.id, m.id));
  const sent = activeCounts(((orig?.plan as Mission | undefined) ?? plan).units);
  let onBooks = sent; // was die Besatzungsmission künftig als ausgesandt führt
  if (m.baseId !== g.baseId) {
    onBooks = units;
    // Wechsel in den Hafen des Felds: Ausgangshafen gibt die Einheiten ab, Zielhafen führt sie als unterwegs.
    const bases = await lockBases(tx, [m.baseId, g.baseId]);
    const from = bases.get(m.baseId);
    const to = bases.get(g.baseId);
    if (from && to) {
      await saveBase(tx, from.id, returnMission(from.state, sent, {}, {}, due, balance, await modsOf(tx, from, due)));
      const next = settle(to.state, due, balance, await modsOf(tx, to, due));
      const vet = mergeVeterancy(next, from.state.veterancy, units);
      if (vet) next.veterancy = vet;
      else delete next.veterancy;
      next.unitsAway = addCounts(next.unitsAway, units);
      await saveBase(tx, to.id, next);
    }
  }
  // Gleicher Hafen: die Einheiten sind dort schon als unterwegs geführt; sie kehren mit der Besatzung heim.
  const garrison = addCounts(activeUnits((g.returning as Counts | null) ?? {}), units);
  await tx.update(tables.mission).set({ plan: { ...gPlan, units: addCounts(gPlan.units, onBooks) }, returning: garrison }).where(eq(tables.mission.id, g.id));
  const reportId = await storeNavalReport(tx, {
    kind: "feld", title: `Verstärkung auf ${name} eingetroffen`, attackerPlayerId: pid, defenderPlayerId: null, attackerBaseId: m.baseId,
    defenderBaseId: g.baseId, atMs: due,
    report: { field: { id: field.id, kind: field.kind, tier: field.tier, outcome: "reinforced", units, garrison } },
  });
  await tx.update(tables.mission).set({ status: "done", returning: {}, cargoHome: {}, reportId, returnAt: new Date(due) }).where(eq(tables.mission.id, m.id));
  push.push(pushNotice(pid, "report", `Verstärkung auf ${name} eingetroffen`, "Die Schiffe gehören jetzt zur Besatzung.", "berichte"));
  notify.push([[pid], "reports"], [[pid], "missions"], [[pid], "base"]);
}
