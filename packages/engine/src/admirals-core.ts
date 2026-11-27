// Admirale im Server, Kern: Status, Hafenkommandant (passive Wirkung über das Modifikatoren-System), Auslaufen
// mit Admiral. Ohne Abhängigkeit von commands.ts (das diese Datei nutzt); Befehle und Ansicht in admirals.ts.
// Status (abgeleitet, keine Buchführung bei der Rückkehr): gefangen > verwundet > unterwegs > bereit.
import { and, eq, inArray } from "drizzle-orm";
import { admiralModifiers, type Modifiers } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError } from "./context.ts";
import { registerModifierSource } from "./modifiers.ts";
import { homeBaseOf } from "./store.ts";

export type AdmiralRow = typeof tables.admiral.$inferSelect;
export type AdmiralStatus = "bereit" | "unterwegs" | "verwundet" | "gefangen";

// Felder: eine stationierte Besatzung bindet ihren Admiral ebenfalls (fields-admiral.ts).
const ACTIVE_MISSION = ["outbound", "returning", "stationed"];

function fail(code: string): never {
  throw new GameError(code);
}

/** Missionen (Id → aktiv?) zu den Admiralen. */
export async function activeMissions(db: DbOrTx, rows: AdmiralRow[]): Promise<Set<number>> {
  const ids = rows.map((r) => r.missionId).filter((x): x is number => x !== null);
  if (ids.length === 0) return new Set();
  const ms = await db
    .select({ id: tables.mission.id, status: tables.mission.status })
    .from(tables.mission)
    .where(inArray(tables.mission.id, ids));
  return new Set(ms.filter((m) => ACTIVE_MISSION.includes(m.status)).map((m) => m.id));
}

/** Status eines Admirals zum Zeitpunkt nowMs und bis wann er gilt (Verwundung, Gefangenschaft). */
export function admiralStatus(a: AdmiralRow, active: Set<number>, nowMs: number): { status: AdmiralStatus; until: number | null } {
  if (a.captiveUntil && a.captiveUntil.getTime() > nowMs) return { status: "gefangen", until: a.captiveUntil.getTime() };
  if (a.woundedUntil && a.woundedUntil.getTime() > nowMs) return { status: "verwundet", until: a.woundedUntil.getTime() };
  if (a.missionId !== null && active.has(a.missionId)) return { status: "unterwegs", until: null };
  return { status: "bereit", until: null };
}

const specsOf = (a: AdmiralRow) => [a.spec1, a.spec2];

/** Modifikatoren eines Admirals in einer Rolle. */
export function admiralRowMods(a: AdmiralRow, role: "mission" | "defense" | "harbor"): Modifiers {
  return admiralModifiers(specsOf(a), a.xp, role, balance);
}

/**
 * Stationierter, bereiter Hafenkommandant eines Hafens (oder null). Mehrere Häfen: je Hafen höchstens einer
 * (admiral.base_id); ohne baseId der Heimathafen.
 */
export async function readyHarborAdmiral(db: DbOrTx, playerId: number | null, baseId: number | undefined, nowMs: number): Promise<AdmiralRow | null> {
  if (playerId === null || !balance.admirals) return null;
  const id = baseId ?? (await homeBaseOf(db, playerId))?.id;
  if (id === undefined) return null;
  const rows = await db
    .select()
    .from(tables.admiral)
    .where(and(eq(tables.admiral.playerId, playerId), eq(tables.admiral.baseId, id), eq(tables.admiral.stationed, true)));
  if (rows.length === 0) return null;
  const active = await activeMissions(db, rows);
  return rows.find((a) => admiralStatus(a, active, nowMs).status === "bereit") ?? null;
}

// Passive Wirkung des Hafenkommandanten (z. B. Radar-Vorwarnzeit, Bunkerschutz) über das Modifikatoren-System.
// Kampfwerte wirken nicht hier, sondern nur im Verteidigungskampf (admirals-battle.ts).
// Mehrere Häfen: nur der Kommandant des Hafens, für den gerechnet wird (ctx.baseId).
registerModifierSource(async (db, playerId, { nowMs, baseId }) => {
  const a = await readyHarborAdmiral(db, playerId, baseId, nowMs);
  return a ? admiralRowMods(a, "harbor") : null;
}, "admiral", "Hafenkommandant");

/**
 * Admiral für eine neue Mission: gehört dem Spieler, ist bereit und (mit baseId) im Ausgangshafen. Sperrt die Zeile.
 * Codes: admiral_unknown, admiral_busy, admiral_other_base.
 */
export async function admiralForLaunch(tx: Tx, playerId: number, admiralId: number, nowMs: number, baseId?: number): Promise<{ id: number; mods: Modifiers }> {
  const [a] = await tx.select().from(tables.admiral).where(eq(tables.admiral.id, admiralId)).for("update");
  if (!a || a.playerId !== playerId) fail("admiral_unknown");
  if (baseId !== undefined && a.baseId !== baseId) fail("admiral_other_base");
  const st = admiralStatus(a, await activeMissions(tx, [a]), nowMs);
  if (st.status !== "bereit") fail("admiral_busy");
  return { id: a.id, mods: admiralRowMods(a, "mission") };
}

/** Admiral der Mission vermerken (unterwegs, solange die Mission läuft). */
export async function assignAdmiral(tx: Tx, admiralId: number, missionId: number): Promise<void> {
  await tx.update(tables.admiral).set({ missionId }).where(eq(tables.admiral.id, admiralId));
}

/** Für die Vorschau: Missionsmodifikatoren eines eigenen Admirals (ohne Verfügbarkeitsprüfung). */
export async function admiralPreviewMods(db: DbOrTx, playerId: number, admiralId: number | undefined): Promise<Modifiers | null> {
  if (admiralId === undefined) return null;
  const [a] = await db.select().from(tables.admiral).where(eq(tables.admiral.id, admiralId));
  return a && a.playerId === playerId ? admiralRowMods(a, "mission") : null;
}
