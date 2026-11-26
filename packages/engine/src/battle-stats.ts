// Persönliche Kampfbilanz der Saison (Meldungen → Bilanz). Berechnet aus battle_report (die Tabelle wird zum
// Saisonende geleert, enthält also genau die laufende Saison) und kurz zwischengespeichert.
// aggregateBattleStats ist rein (Tests ohne Datenbank), battleStats liest und speichert zwischen.
import { eq, or, sql } from "drizzle-orm";
import { luckFactor, type BattleReport, type Counts } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance } from "./context.ts";
import type { Engine } from "./context.ts";
import { baseOfPlayer } from "./store.ts";
import { veteranView, type VeteranInfo } from "./veterans.ts";
// Wert wie in der Wertung (Summe der Kosten; NPC-Einheiten mit festem Wert).
import { unitValue } from "./scoring.ts";

export type BattleCategory = "ueberfall" | "abwehr" | "nest" | "kartell" | "weltereignis";

export interface BattleStatsRow {
  kind: string;
  winner: string | null;
  attackerPlayerId: number | null;
  nestLevel: number | null;
  battle: BattleReport | null;
}

export interface BattleStats {
  battles: number;
  /** Siege/Niederlagen je Art: Überfälle (eigene), Abwehr gegen Spieler, Nester, Kartell-Abwehr, Weltereignisse. */
  record: Record<BattleCategory, { wins: number; losses: number }>;
  wins: number;
  losses: number;
  /** Versenkte Tonnage: Kostenwert vernichteter gegnerischer Schiffe und U-Boote (Kostensumme wie in der Wertung). */
  sunkValue: number;
  sunkShips: number;
  /** Vernichteter Gesamtwert: alle gegnerischen Einheiten und Anlagen, die nicht zurückkehren. */
  destroyedValue: number;
  /** Eigene endgültige Verluste (ohne Lazarett, Reparatur, beschädigte Flugzeuge). */
  ownLosses: Counts;
  ownLossValue: number;
  /** Eigener Einheitentyp mit dem meisten ausgeteilten Schaden über alle Kämpfe. */
  bestUnit: { id: string; damage: number } | null;
  /** Würfelglück: Durchschnitt der eigenen W20 in ausgetragenen Phasen (Erwartung 10,5). */
  luck: { rolls: number; average: number | null; expected: number; pannen: number; volltreffer: number };
  /** Höchste besiegte Neststufe; null ohne Sieg gegen ein Nest. */
  strongestNest: number | null;
}

const CATEGORIES: BattleCategory[] = ["ueberfall", "abwehr", "nest", "kartell", "weltereignis"];

const isShip = (id: string) => (balance.units[id] ?? balance.npcUnits[id])?.branch === "see";

function categoryOf(row: BattleStatsRow, own: boolean): BattleCategory | null {
  if (row.kind === "kartell") return "kartell";
  if (row.kind === "weltereignis") return "weltereignis";
  if (row.kind === "ueberfall") return row.nestLevel !== null ? "nest" : own ? "ueberfall" : "abwehr";
  return null;
}

/** Bilanz aus den Kampfberichten eines Spielers (rein). Berichte ohne Kampf werden übersprungen. */
export function aggregateBattleStats(rows: BattleStatsRow[], playerId: number): BattleStats {
  const record = Object.fromEntries(CATEGORIES.map((c) => [c, { wins: 0, losses: 0 }])) as BattleStats["record"];
  const ownLosses: Counts = {};
  const damage: Record<string, number> = {};
  const nestWins: number[] = [];
  let battles = 0, wins = 0, losses = 0, sunkValue = 0, sunkShips = 0, destroyedValue = 0, ownLossValue = 0;
  let rolls = 0, rollSum = 0, pannen = 0, volltreffer = 0;
  const die = balance.combat.luck?.die ?? 20;
  for (const row of rows) {
    const b = row.battle;
    if (!b || !b.attacker || !b.defender) continue;
    const own = row.attackerPlayerId === playerId;
    const side = own ? "attacker" : "defender";
    const enemy = own ? "defender" : "attacker";
    const cat = categoryOf(row, own);
    if (!cat) continue;
    battles++;
    const won = b.winner === side;
    if (won) { wins++; record[cat].wins++; } else { losses++; record[cat].losses++; }
    if (won && cat === "nest" && row.nestLevel !== null) nestWins.push(row.nestLevel);
    for (const [id, before] of Object.entries(b[enemy].before ?? {})) {
      const gone = Math.max(0, before - (b[enemy].final?.[id] ?? 0));
      if (gone <= 0) continue;
      const v = unitValue(id) * gone;
      destroyedValue += v;
      if (isShip(id)) { sunkValue += v; sunkShips += gone; }
    }
    for (const [id, before] of Object.entries(b[side].before ?? {})) {
      const gone = Math.max(0, before - (b[side].final?.[id] ?? 0));
      if (gone <= 0) continue;
      ownLosses[id] = (ownLosses[id] ?? 0) + gone;
      ownLossValue += unitValue(id) * gone;
    }
    for (const p of b.phases ?? []) {
      for (const [id, d] of Object.entries(p.damage?.[side] ?? {})) {
        // Nur eigene Einheiten (keine Minensperren o. Ä.) zählen für die beste Einheit.
        if (balance.units[id]) damage[id] = (damage[id] ?? 0) + d;
      }
      // Alte Berichte (vor v1.4) haben keine Würfe: sie zählen nicht mit.
      if (!p.skipped && p.luck) {
        const r = p.luck[side];
        rolls++;
        rollSum += r;
        if (r <= 1) pannen++;
        if (r >= die) volltreffer++;
      }
    }
  }
  let bestUnit: BattleStats["bestUnit"] = null;
  for (const [id, d] of Object.entries(damage)) if (d > 0 && (!bestUnit || d > bestUnit.damage)) bestUnit = { id, damage: Math.round(d) };
  return {
    battles,
    record,
    wins,
    losses,
    sunkValue: Math.round(sunkValue),
    sunkShips,
    destroyedValue: Math.round(destroyedValue),
    ownLosses,
    ownLossValue: Math.round(ownLossValue),
    bestUnit,
    luck: { rolls, average: rolls > 0 ? rollSum / rolls : null, expected: (die + 1) / 2, pannen, volltreffer },
    strongestNest: nestWins.length > 0 ? Math.max(...nestWins) : null,
  };
}

/**
 * Für die Anzeige: ergänzt je Phase mit Würfen den Faktor (`luckFactor: { attacker, defender }`), damit die Oberfläche
 * die Regel nicht nachrechnen muss. Berichte ohne Kampf oder ohne Würfe (vor v1.4) bleiben unverändert.
 */
export function withLuckFactors(data: Record<string, unknown>): Record<string, unknown> {
  const battle = data.battle as BattleReport | undefined;
  const luck = balance.combat.luck;
  if (!battle?.phases || !luck) return data;
  const phases = battle.phases.map((p) =>
    p.luck ? { ...p, luckFactor: { attacker: luckFactor(p.luck.attacker, luck), defender: luckFactor(p.luck.defender, luck) } } : p,
  );
  return { ...data, battle: { ...battle, phases } };
}

const CACHE_MS = 60_000;
const cache = new Map<number, { atMs: number; value: BattleStats & { veterans: VeteranInfo[] } }>();

/** Zwischenspeicher leeren (Tests, Saisonwechsel). */
export function clearBattleStatsCache(playerId?: number): void {
  if (playerId === undefined) cache.clear();
  else cache.delete(playerId);
}

/** Kampfbilanz der Saison mit den Veteranenrängen des eigenen Stützpunkts; höchstens CACHE_MS alt. */
export async function battleStats(engine: Engine, playerId: number, nowMs = Date.now()): Promise<BattleStats & { veterans: VeteranInfo[] }> {
  const hit = cache.get(playerId);
  if (hit && nowMs - hit.atMs < CACHE_MS) return hit.value;
  const br = tables.battleReport;
  const rows = await engine.db
    .select({
      kind: br.kind,
      winner: br.winner,
      attackerPlayerId: br.attackerPlayerId,
      nestLevel: tables.nest.level,
      battle: sql<BattleReport | null>`${br.report}->'battle'`,
    })
    .from(br)
    .leftJoin(tables.nest, eq(tables.nest.id, br.nestId))
    .where(or(eq(br.attackerPlayerId, playerId), eq(br.defenderPlayerId, playerId)));
  const stats = aggregateBattleStats(rows, playerId);
  const own = await baseOfPlayer(engine.db, playerId);
  const value = { ...stats, veterans: own ? veteranView(own.state) : [] };
  if (cache.size > 5000) cache.clear();
  cache.set(playerId, { atMs: nowMs, value });
  return value;
}
