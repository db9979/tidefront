// Wertung einer Saison: Punkte je Spieler in fünf Kategorien. Kampf und Beute kommen ausschließlich aus den
// Kampfberichten der Saison (battle_report), Ausbau und Militär aus dem aktuellen Stand, Befehle aus den
// abgeholten Tagesbefehlen (daily_challenge).
import { sql } from "drizzle-orm";
import { protectionStatus, upgradeCost, type BaseState, type Counts, type ResourceMap } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { challengePoints } from "./challenges.ts";

/** Punkte = Kostenwert / POINT_DIVISOR, je Kategorie abgerundet. */
export const POINT_DIVISOR = 100;

/**
 * Fester Kostenwert der NPC-Einheiten des Kartells (sie haben keine Baukosten). Angelehnt an vergleichbare
 * Spielereinheiten: Schnellboot ~ 0,45 Korvette (Lebenspunkte und Angriff), Piratenmiliz ~ 0,8 Schützen.
 */
export const NPC_UNIT_VALUE: Record<string, number> = { schnellboot: 250, piratenmiliz: 40 };

export type Category = "ausbau" | "militaer" | "kampf" | "beute" | "befehle";
export const CATEGORIES: Category[] = ["ausbau", "militaer", "kampf", "beute", "befehle"];

export interface Score {
  ausbau: number;
  militaer: number;
  kampf: number;
  beute: number;
  /** Punkte aus Tagesbefehlen (schon Punkte, kein Kostenwert). */
  befehle: number;
  total: number;
}

function sumRes(m: ResourceMap | null | undefined): number {
  let s = 0;
  for (const v of Object.values(m ?? {})) s += Number(v) || 0;
  return s;
}

/** Kostenwert einer Einheit, Anlage oder NPC-Einheit (Summe aller Ressourcen). */
export function unitValue(id: string): number {
  const u = balance.units[id] ?? balance.defenses[id];
  if (u) return sumRes(u.cost);
  return NPC_UNIT_VALUE[id] ?? 0;
}

export function countsValue(c: Counts | null | undefined): number {
  let s = 0;
  for (const [id, n] of Object.entries(c ?? {})) s += unitValue(id) * (Number(n) || 0);
  return s;
}

/** Summe der Kosten aller gebauten Gebäudestufen. */
export function buildingValue(buildings: Counts): number {
  let s = 0;
  for (const [id, level] of Object.entries(buildings)) {
    if (!balance.buildings[id]) continue;
    for (let l = 0; l < level; l++) s += sumRes(upgradeCost(id, l, balance));
  }
  return s;
}

const pts = (v: number) => Math.max(0, Math.floor(v / POINT_DIVISOR));

/** Kostenwerte der vier Kategorien in Punkte umrechnen; befehle sind bereits Punkte. */
export function makeScore(values: { ausbau: number; militaer: number; kampf: number; beute: number }, befehle = 0): Score {
  const s = { ausbau: pts(values.ausbau), militaer: pts(values.militaer), kampf: pts(values.kampf), beute: pts(values.beute) };
  const b = Math.max(0, Math.floor(befehle));
  return { ...s, befehle: b, total: s.ausbau + s.militaer + s.kampf + s.beute + b };
}

export interface Standing extends Score {
  playerId: number;
  name: string;
  rank: number;
  base: { id: number; name: string; col: number; row: number; protection: string | null } | null;
}

/** Wettbewerbsrangfolge: gleiche Gesamtpunkte, gleicher Rang (1, 1, 3). */
export function rankStandings<T extends { total: number; name: string }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "de"));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.total !== sorted[i - 1].total) rank = i + 1;
    return { ...r, rank };
  });
}

/** Auszeichnungen: Platz 1 bis 3 der Gesamtwertung, je Kategorie ein Bester (nur mit Punkten). */
export function awardsFor<T extends Score & { playerId: number; rank: number }>(ranked: T[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (id: number, a: string) => out.set(id, [...(out.get(id) ?? []), a]);
  const medal: Record<number, string> = { 1: "gold", 2: "silber", 3: "bronze" };
  for (const r of ranked) if (r.total > 0 && medal[r.rank]) add(r.playerId, medal[r.rank]);
  for (const c of CATEGORIES) {
    let best: T | null = null;
    for (const r of ranked) if (r[c] > 0 && (!best || r[c] > best[c])) best = r;
    if (best) add(best.playerId, `best_${c}`);
  }
  return out;
}

/**
 * Stand aller Spieler: vier Abfragen (Spieler mit Stützpunkt, laufende Missionen, Kampfberichte und
 * abgeholte Tagesbefehle seit Saisonbeginn), danach reine Rechnung.
 */
export async function computeStandings(db: DbOrTx, seasonStartMs: number, nowMs: number): Promise<Standing[]> {
  const players = await db.execute<{
    id: number; name: string; base_id: number | null; base_name: string | null; col: number | null; row: number | null; state: BaseState | null;
  }>(sql`select p.id, p.name, b.id as base_id, b.name as base_name, b.col, b.row, b.state
         from player p left join base b on b.player_id = p.id`);
  const missions = await db.execute<{ player_id: number; status: string; units: Counts | null; returning: Counts | null }>(sql`
    select player_id, status, plan->'units' as units, "returning" as returning from mission
    where player_id is not null and status in ('outbound', 'returning', 'staged', 'stationed')`);
  const since = new Date(seasonStartMs).toISOString();
  const reports = await db.execute<{
    attacker_player_id: number | null; defender_player_id: number | null; al: Counts | null; dl: Counts | null; loot: ResourceMap | null;
  }>(sql`
    select attacker_player_id, defender_player_id,
      report->'battle'->'attacker'->'losses' as al, report->'battle'->'defender'->'losses' as dl, report->'battle'->'loot' as loot
    from battle_report where report ? 'battle' and created_at >= ${since}::timestamptz`);
  const orders = await challengePoints(db, seasonStartMs);

  const raw = new Map<number, { ausbau: number; militaer: number; kampf: number; beute: number }>();
  const get = (id: number) => {
    let r = raw.get(id);
    if (!r) raw.set(id, (r = { ausbau: 0, militaer: 0, kampf: 0, beute: 0 }));
    return r;
  };
  for (const p of players) {
    const r = get(p.id);
    if (!p.state) continue;
    r.ausbau += buildingValue(p.state.buildings ?? {});
    r.militaer += countsValue(p.state.units) + countsValue(p.state.defenses);
  }
  for (const m of missions) get(m.player_id).militaer += countsValue(m.status === "returning" || m.status === "stationed" ? m.returning : m.units); // Allianz-Ops: stationed
  for (const b of reports) {
    if (b.attacker_player_id !== null) {
      const r = get(b.attacker_player_id);
      r.kampf += countsValue(b.dl);
      r.beute += sumRes(b.loot);
    }
    if (b.defender_player_id !== null) get(b.defender_player_id).kampf += countsValue(b.al);
  }
  const rows = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    base: p.base_id === null
      ? null
      : { id: p.base_id, name: p.base_name!, col: p.col!, row: p.row!, protection: protectionStatus(p.state!.protection, nowMs, balance).reason },
    ...makeScore(get(p.id), orders.get(p.id) ?? 0),
  }));
  return rankStandings(rows);
}
