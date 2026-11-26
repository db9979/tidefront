// Veteranen im Server: Erfahrung des Angreifers bei der Rückkehr anwenden, Ansicht der Ränge.
// Die Regeln selbst stehen rein im Kern (game-core/src/veterans.ts); der Verteidiger sammelt in applyDefenseResult.
import { eq } from "drizzle-orm";
import { applyAttackExperience, veteranRank, type BaseState, type BattleReport } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";

/**
 * Angreifer: Nach der Rückkehr eines Verbands (Bestand schon zurückgebucht) Erfahrung aus dem gespeicherten
 * Kampfbericht der Mission anwenden. Ohne Bericht, ohne Kampf oder fremden Bericht: unverändert.
 */
export async function withAttackExperience(tx: DbOrTx, reportId: number | null, playerId: number | null, state: BaseState): Promise<BaseState> {
  if (reportId === null || playerId === null || !balance.veterans) return state;
  const [r] = await tx
    .select({ report: tables.battleReport.report, attackerPlayerId: tables.battleReport.attackerPlayerId })
    .from(tables.battleReport)
    .where(eq(tables.battleReport.id, reportId));
  const battle = (r?.report as { battle?: BattleReport } | undefined)?.battle;
  if (!battle || r.attackerPlayerId !== playerId) return state;
  return applyAttackExperience(state, battle, balance);
}

export interface VeteranInfo {
  id: string;
  xp: number;
  rank: string;
  rankName: string;
  attackBonus: number;
  /** Nächster Rang und nötige Erfahrung; null auf dem höchsten Rang. */
  next: { name: string; minXp: number } | null;
}

/** Ränge aller Einheitentypen mit Erfahrung oder Bestand. */
export function veteranView(state: BaseState): VeteranInfo[] {
  const ranks = balance.veterans?.ranks ?? [];
  const out: VeteranInfo[] = [];
  for (const id of Object.keys(balance.units)) {
    const xp = state.veterancy?.[id] ?? 0;
    const have = (state.units[id] ?? 0) + (state.unitsAway[id] ?? 0);
    if (xp <= 0 && have <= 0) continue;
    const r = veteranRank(xp, balance);
    const next = ranks.filter((x) => x.minXp > xp).sort((a, b) => a.minXp - b.minXp)[0];
    out.push({
      id,
      xp: Math.round(xp * 10) / 10,
      rank: r?.id ?? "rekrut",
      rankName: r?.name ?? "Rekrut",
      attackBonus: r?.attackBonus ?? 0,
      next: next ? { name: next.name, minXp: next.minXp } : null,
    });
  }
  return out;
}
