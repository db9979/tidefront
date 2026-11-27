// See: Minen, Blockade und Konvois – gemeinsame Hilfen der Module naval-*.ts (docs/REGELN-SEE.md).
import { eq } from "drizzle-orm";
import { planMission, settle, type Counts, type Mission, type MissionType, type Modifiers, type ProtectionState, type ResourceMap } from "@tidefront/game-core";
import { hexCenter } from "@tidefront/world";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { recordReportIntel } from "./intel-store.ts"; // Lagebild
import { balance, type ChangeKind, type NoticeJob } from "./context.ts";
import { diplomacyBlock, membershipOf, memberIds } from "./alliance-core.ts";
import { scheduleEvent, type BaseRow } from "./store.ts";
import { missionWeather } from "./weather.ts";
import { gameTimeZone } from "./challenge-pool.ts"; // einheitliche Zeitzone des Spiels
import { withPvpStamp } from "./pvp.ts"; // PvP: Rang, Kopfgeld und Mutfaktor beim Kampf festhalten

export const HOUR_MS = 3600000;
export type Notes = [number[] | null, ChangeKind][];

/** Eingabe einer Seemission (Minen legen/räumen, Blockade, Konvoi abfangen, Angriff auf einen Blockadeverband). */
export interface NavalInput {
  type: string;
  units: Counts;
  col: number;
  row: number;
  blockadeId?: number;
  convoyId?: number;
  holdHours?: number;
}

/** Missionsarten, die naval.ts plant (Angriffe auf Blockaden laufen als „ueberfall“ mit blockadeId). */
export const NAVAL_TYPES: ReadonlySet<string> = new Set(["minen", "raeumen", "blockade", "abfangen"]);

export interface MissionRowLike {
  id: number;
  playerId: number | null;
  baseId: number | null;
  type: string;
  targetKind: string;
  targetId: number | null;
  targetCol: number;
  targetRow: number;
  status?: string;
}

/** Feindlich im Sinne der Seeregeln: nicht derselbe Spieler, nicht dieselbe Allianz, kein Pakt. */
export async function hostile(db: DbOrTx, a: number, b: number, atMs: number): Promise<boolean> {
  return a !== b && (await diplomacyBlock(db, a, b, atMs)) === null;
}

/** Der Spieler und seine Allianzmitglieder. */
export async function partyMates(db: DbOrTx, playerId: number): Promise<number[]> {
  const m = await membershipOf(db, playerId);
  return m ? memberIds(db, m.allianceId) : [playerId];
}

export async function playerName(db: DbOrTx, id: number | null): Promise<string> {
  if (id === null) return "Freibeuter-Kartell";
  const [p] = await db.select({ name: tables.player.name }).from(tables.player).where(eq(tables.player.id, id));
  return p?.name ?? "?";
}

export async function storeNavalReport(
  tx: Tx,
  v: {
    kind: string; title: string; attackerPlayerId: number | null; defenderPlayerId: number | null;
    attackerBaseId?: number | null; defenderBaseId?: number | null; winner?: string | null; seed?: number | null; report: unknown; atMs: number;
  },
): Promise<number> {
  v = await withPvpStamp(tx, v); // PvP: report.pvp bei Kämpfen zwischen Spielern (Blockade, Konvoi, Feld)
  const [r] = await tx
    .insert(tables.battleReport)
    .values({
      kind: v.kind, title: v.title, attackerPlayerId: v.attackerPlayerId, defenderPlayerId: v.defenderPlayerId,
      attackerBaseId: v.attackerBaseId ?? null, defenderBaseId: v.defenderBaseId ?? null, nestId: null,
      winner: v.winner ?? null, seed: v.seed ?? null, report: v.report, balanceVersion: balance.version, createdAt: new Date(v.atMs),
    })
    .returning({ id: tables.battleReport.id });
  await recordReportIntel(tx, { ...v, defenderBaseId: v.defenderBaseId ?? null, nestId: null }); // Lagebild
  return r.id;
}

/**
 * Plant eine Seemission über planMission mit einer Grundart (Prüfungen, Treibstoff, Wetter) und setzt danach
 * die eigentliche Art. Grundart „ueberfall“ prüft den Schutz des Ziels und hebt den eigenen Nachtschild auf.
 */
export function planNaval(
  own: BaseRow,
  opts: { type: MissionType; baseType: "ueberfall" | "aufklaerung"; units: Counts; col: number; row: number; activeMissions: number; mods: Modifiers; targetProtection?: ProtectionState },
  nowMs: number,
) {
  const r = planMission(
    settle(own.state, nowMs, balance, opts.mods),
    {
      type: opts.baseType, units: opts.units, origin: hexCenter(own.col, own.row), target: hexCenter(opts.col, opts.row),
      activeMissions: opts.activeMissions, targetProtection: opts.targetProtection,
      weather: missionWeather(own.col, own.row, opts.col, opts.row, nowMs),
      sightRecon: opts.type === "aufklaerung", // Aufklärung auf Sicht (Kampagne, Felder)
    },
    nowMs,
    balance,
    opts.mods,
  );
  if (r.ok) r.mission.type = opts.type;
  return r;
}

/** Legt die Missionszeile an und plant die Ankunft. */
export async function insertMission<P extends Mission>(
  tx: Tx,
  v: { playerId: number; baseId: number; targetKind: string; targetId: number | null; col: number; row: number; plan: P },
): Promise<number> {
  const [m] = await tx
    .insert(tables.mission)
    .values({
      playerId: v.playerId, baseId: v.baseId, type: v.plan.type, targetKind: v.targetKind, targetId: v.targetId,
      targetCol: v.col, targetRow: v.row, plan: v.plan, status: "outbound", arriveAt: new Date(v.plan.arriveAtMs),
    })
    .returning({ id: tables.mission.id });
  await scheduleEvent(tx, "mission_arrive", v.plan.arriveAtMs, { missionId: m.id }, null);
  return m.id;
}

/** Mission ohne weiteren Ablauf am Ziel heimschicken (Rückkehr nach der Fahrzeit der Hinfahrt). */
export async function sendHome(tx: Tx, m: MissionRowLike, plan: Mission, returning: Counts, cargoHome: ResourceMap, reportId: number | null, due: number): Promise<void> {
  const returnAt = (plan.returnAtMs ?? due) + Math.max(0, due - plan.arriveAtMs);
  await tx.update(tables.mission).set({ status: "returning", returning, cargoHome, reportId, returnAt: new Date(returnAt) }).where(eq(tables.mission.id, m.id));
  await scheduleEvent(tx, "mission_return", returnAt, { missionId: m.id }, m.baseId);
}

export function activeCounts(units: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(units ?? {})) if (n > 0) out[id] = n;
  return out;
}

export function hasShips(units: Counts): boolean {
  return Object.entries(units).some(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
}

export function pushNotice(playerId: number, kind: NoticeJob["notice"]["kind"], title: string, body: string, tab = "karte", reportId?: number): NoticeJob {
  return { playerId, notice: { kind, title, body, url: `/?tab=${tab}`, tag: `see-${kind}`, ...(reportId !== undefined ? { reportId } : {}) } }; // reportId: ausführliche E-Mail
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", { timeZone: gameTimeZone(), day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
