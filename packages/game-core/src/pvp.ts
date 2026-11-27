// Spieler gegen Spieler (Vorlage docs/VORLAGE-PVP.md, freigegeben 27.11.2026): Kopfgeld auf die Spitze, Mutfaktor,
// Paarbremse. Nur die Wertung ändert sich – Ressourcen, Beute und Verluste bleiben, wie der Kampf sie ergibt.
// Rang und Punkte zum Tagesbeginn hält der Server beim Kampf im Bericht fest (PvpStamp, report.pvp); die Wertung
// rechnet daraus und aus der Reihenfolge der Berichte (Paarbremse) bei jedem Abruf neu.
import type { Balance } from "./types.ts";

export interface PvpBalance {
  /** Kopfgeld auf Rang 1, 2, 3 … der Gesamtwertung (Anteil zusätzlich, nur auf Kampfpunkte des Angreifers). */
  bountyByRank: number[];
  /** Kampfpunkte, die ein Kopfgeld-Ziel aus dem Kampf erhält (Verteidigung der Spitze), × diesem Faktor. */
  bountyDefenseFactor: number;
  /** Mutfaktor √(Punkte Ziel / Punkte Angreifer), begrenzt auf mutMin … mutMax. */
  mutMin: number;
  mutMax: number;
  /** Kopfgeld × Mutfaktor höchstens so viel. */
  maxFactor: number;
  /** Paarbremse: Kämpfe desselben Paares innerhalb dieses Fensters zählen × pairFactors[n] (n = frühere Kämpfe). */
  pairWindowHours: number;
  pairFactors: number[];
  /** Kein Kopfgeld und kein Mutfaktor über 1 nach Handel, Transport, Stationierung, Allianz oder Pakt in diesen Tagen. */
  collusionDays: number;
  /** Verwaltung „Auffällige Paare“: ab so vielen Kämpfen in suspiciousDays Tagen. */
  suspiciousFights: number;
  suspiciousDays: number;
  /** Ein eigener Überfall auf einen Spielerhafen beendet den Anfängerschutz. */
  beginnerEndsOnPlayerRaid: boolean;
}

/** Beim Kampf festgehalten (report.pvp): Stand zum Tagesbeginn und die daraus folgenden Faktoren. */
export interface PvpStamp {
  /** Spieltag der Rang-Momentaufnahme (JJJJ-MM-TT). */
  day: string;
  attackerRank: number | null;
  defenderRank: number | null;
  attackerPoints: number;
  defenderPoints: number;
  /** Rang des Ziels, wenn es als Kopfgeld-Ziel gilt (Verteidigung zählt dann × bountyDefenseFactor), sonst null. */
  bountyRank: number | null;
  /** 1 + Kopfgeld; 1 ohne Kopfgeld oder nach Absprache. */
  bountyFactor: number;
  mut: number;
  /** Handel/Transport/Stationierung/Allianz/Pakt in den letzten collusionDays Tagen. */
  collusion: boolean;
}

export function pvpOf(balance: Balance): PvpBalance | null {
  return balance.pvp ?? null;
}

/**
 * Rang des Ziels, wenn es ein Kopfgeld trägt: Rang 1 … bountyByRank.length mit Punkten, und der Angreifer ist selbst
 * schlechter platziert (ohne Rang = schlechter). Sonst null.
 */
export function bountyRankOf(attackerRank: number | null, defenderRank: number | null, defenderPoints: number, b: PvpBalance): number | null {
  if (defenderRank === null || defenderRank < 1 || defenderRank > b.bountyByRank.length || !(defenderPoints > 0)) return null;
  if (attackerRank !== null && attackerRank <= defenderRank) return null;
  return defenderRank;
}

/** Mutfaktor √(Punkte Ziel / Punkte Angreifer), begrenzt; Angreifer ohne Punkte: Höchstwert (Ziel mit Punkten) bzw. 1. */
export function mutFactor(targetPoints: number, attackerPoints: number, b: PvpBalance): number {
  const t = Math.max(0, targetPoints);
  const a = Math.max(0, attackerPoints);
  if (a === 0) return t > 0 ? b.mutMax : 1;
  return Math.min(b.mutMax, Math.max(b.mutMin, Math.sqrt(t / a)));
}

/** Faktoren eines Kampfes aus Rang und Punkten zum Tagesbeginn. */
export function pvpStamp(
  i: { day: string; attackerRank: number | null; defenderRank: number | null; attackerPoints: number; defenderPoints: number; collusion: boolean },
  b: PvpBalance,
): PvpStamp {
  const bountyRank = bountyRankOf(i.attackerRank, i.defenderRank, i.defenderPoints, b);
  const bountyFactor = bountyRank !== null && !i.collusion ? 1 + (b.bountyByRank[bountyRank - 1] ?? 0) : 1;
  const m = mutFactor(i.defenderPoints, i.attackerPoints, b);
  return { ...i, bountyRank, bountyFactor, mut: i.collusion ? Math.min(1, m) : m };
}

/**
 * Faktoren auf die Kostenwerte eines Kampfes: kampf (Angreifer, Kopfgeld × Mut, höchstens maxFactor), beute
 * (Angreifer, nur Mut) und defense (Verteidiger: Kopfgeld-Ziel × bountyDefenseFactor). Ohne Stempel alles 1.
 */
export function stampFactors(s: PvpStamp | null | undefined, b: PvpBalance | null): { kampf: number; beute: number; defense: number } {
  if (!s || !b) return { kampf: 1, beute: 1, defense: 1 };
  return {
    kampf: Math.min(b.maxFactor, s.bountyFactor * s.mut),
    beute: Math.min(b.maxFactor, s.mut),
    defense: s.bountyRank !== null ? b.bountyDefenseFactor : 1,
  };
}

/** Paarbremse: Faktor für den Kampf, vor dem schon n Kämpfe desselben Paares im Fenster lagen. */
export function pairFactor(n: number, b: PvpBalance | null): number {
  if (!b || b.pairFactors.length === 0) return 1;
  return b.pairFactors[Math.min(Math.max(0, n), b.pairFactors.length - 1)];
}

/** Schlüssel eines Spielerpaares, unabhängig von der Richtung. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface PairFight {
  id: number;
  atMs: number;
  /** Beteiligte Paare (pairKey); Sammelangriff: jeder Teilnehmer mit dem Ziel. */
  pairs: string[];
}

/**
 * Für jeden Kampf und jedes beteiligte Paar die Zahl der früheren Kämpfe desselben Paares im Fenster (windowMs, beide
 * Richtungen, Sammelangriffe eingeschlossen). Reihenfolge: Zeit, dann Bericht-ID.
 */
export function pairIndexes(fights: PairFight[], windowMs: number): Map<number, Map<string, number>> {
  const sorted = [...fights].sort((x, y) => x.atMs - y.atMs || x.id - y.id);
  const seen = new Map<string, number[]>();
  const out = new Map<number, Map<string, number>>();
  for (const f of sorted) {
    const mine = new Map<string, number>();
    for (const key of new Set(f.pairs)) {
      const times = (seen.get(key) ?? []).filter((t) => t > f.atMs - windowMs);
      mine.set(key, times.length);
      times.push(f.atMs);
      seen.set(key, times);
    }
    out.set(f.id, mine);
  }
  return out;
}
