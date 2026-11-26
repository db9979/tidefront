// Admirale im Kampf: Führer des Verbands (Mission) und Hafenkommandant des Verteidigers liefern Modifikatoren;
// nach dem Kampf Erfahrung (nur Sieg, nach besiegtem Wert), Beförderung und bei deutlicher Niederlage ein W20-Wurf
// über das Schicksal (deterministisch aus dem Kampf-Seed). Das Ergebnis steht im Bericht unter `admirals`.
import { eq } from "drizzle-orm";
import {
  admiralFate,
  admiralModLines,
  admiralRank,
  admiralXpGain,
  activeSpecs,
  type AdmiralFate,
  type AdmiralModLine,
  type BattleReport,
  type Mission,
  type Modifiers,
  type Side,
} from "@tidefront/game-core";
import { tables, type Tx } from "@tidefront/db";
import { balance } from "./context.ts";
import { admiralRowMods, readyHarborAdmiral, type AdmiralRow } from "./admirals-core.ts";

const HOUR_MS = 3600000;

export interface BattleAdmiral {
  row: AdmiralRow;
  role: "mission" | "defense";
  mods: Modifiers;
}

function toBattle(row: AdmiralRow, role: "mission" | "defense"): BattleAdmiral {
  return { row, role, mods: admiralRowMods(row, role) };
}

/** Admiral, der diesen Verband führt (plan.admiralId), oder null. */
export async function missionAdmiral(tx: Tx, plan: Mission, missionId: number, playerId: number | null): Promise<BattleAdmiral | null> {
  if (!plan.admiralId || playerId === null || !balance.admirals) return null;
  const [a] = await tx.select().from(tables.admiral).where(eq(tables.admiral.id, plan.admiralId)).for("update");
  if (!a || a.playerId !== playerId || a.missionId !== missionId) return null;
  return toBattle(a, "mission");
}

/** Stationierter, bereiter Hafenkommandant des Verteidigers, oder null (Kartell, Nester, kein Admiral). */
export async function defenseAdmiral(tx: Tx, playerId: number | null, nowMs: number): Promise<BattleAdmiral | null> {
  const a = await readyHarborAdmiral(tx, playerId, nowMs);
  if (!a) return null;
  const [locked] = await tx.select().from(tables.admiral).where(eq(tables.admiral.id, a.id)).for("update");
  return locked ? toBattle(locked, "defense") : null;
}

/** Eine Seite im Bericht. */
export interface AdmiralReportSide {
  name: string;
  rankName: string;
  specs: { id: string; name: string }[];
  /** Wirksame Faktoren im Kampf (Spezialisierung, Pfad, Faktor). */
  lines: AdmiralModLine[];
  xpGain: number;
  xp: number;
  /** Neuer Rang nach Beförderung, sonst null. */
  promoted: string | null;
  lossShare: number;
  /** W20-Wurf oder null (nicht gewürfelt). */
  roll: number | null;
  fate: AdmiralFate;
  /** Ende von Verwundung oder Gefangenschaft (ms). */
  until: number | null;
}

export interface AdmiralReport {
  attacker?: AdmiralReportSide;
  defender?: AdmiralReportSide;
  /** Regeln zum Wurf: Schwelle der Verluste, Würfel, Grenzen. */
  rule: { lossShare: number; die: number; fallenMax: number; capturedMax: number; woundedMax: number };
}

async function settleSide(tx: Tx, adm: BattleAdmiral, side: Side, report: BattleReport, seed: number, nowMs: number): Promise<AdmiralReportSide> {
  const cfg = balance.admirals!;
  const a = adm.row;
  const specs = [a.spec1, a.spec2];
  const lines = admiralModLines(specs, a.xp, adm.role, balance);
  const shown = activeSpecs(specs, a.xp, balance).map((id) => ({ id, name: cfg.specs[id]?.name ?? id }));
  const xpGain = admiralXpGain(report, side, balance);
  const xp = a.xp + xpGain;
  const before = admiralRank(a.xp, balance);
  const after = admiralRank(xp, balance);
  const f = admiralFate(report, side, seed, balance);
  let until: number | null = null;
  if (f.fate === "gefallen") {
    await tx.delete(tables.admiral).where(eq(tables.admiral.id, a.id));
  } else {
    const set: Partial<typeof tables.admiral.$inferInsert> = {
      xp, battles: a.battles + 1, wins: a.wins + (report.winner === side ? 1 : 0),
    };
    if (f.fate === "verwundet") set.woundedUntil = new Date((until = nowMs + cfg.risk.woundedHours * HOUR_MS));
    if (f.fate === "gefangen") set.captiveUntil = new Date((until = nowMs + cfg.risk.captiveHours * HOUR_MS));
    await tx.update(tables.admiral).set(set).where(eq(tables.admiral.id, a.id));
  }
  return {
    name: a.name, rankName: before.def.name, specs: shown, lines, xpGain, xp,
    promoted: after.index > before.index ? after.def.name : null,
    lossShare: Math.round(f.lossShare * 1000) / 1000, roll: f.roll, fate: f.fate, until,
  };
}

/** Nach dem Kampf: Erfahrung, Beförderung, Schicksal beider Admirale. Ohne Admirale: undefined. */
export async function admiralsAfterBattle(
  tx: Tx,
  report: BattleReport,
  seed: number,
  attacker: BattleAdmiral | null,
  defender: BattleAdmiral | null,
  nowMs: number,
): Promise<AdmiralReport | undefined> {
  const cfg = balance.admirals;
  if (!cfg || (!attacker && !defender)) return undefined;
  const r = cfg.risk;
  const out: AdmiralReport = { rule: { lossShare: r.lossShare, die: r.die, fallenMax: r.fallenMax, capturedMax: r.capturedMax, woundedMax: r.woundedMax } };
  if (attacker) out.attacker = await settleSide(tx, attacker, "attacker", report, seed, nowMs);
  if (defender) out.defender = await settleSide(tx, defender, "defender", report, seed, nowMs);
  return out;
}
