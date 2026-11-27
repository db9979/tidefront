// Wertung einer Saison: Punkte je Spieler in fünf Kategorien. Kampf und Beute kommen ausschließlich aus den
// Kampfberichten der Saison (battle_report), Ausbau und Militär aus dem aktuellen Stand, Befehle aus den
// abgeholten Tagesbefehlen (daily_challenge). Nichts davon wird gespeichert: Die Rangliste rechnet bei jedem Abruf
// (30 s Zwischenspeicher) neu, ein Balance-Wechsel (v1.24: Richtpreis, Kartell-Abwehr × npcDefenseFactor) gilt also
// sofort rückwirkend für die ganze laufende Saison. Nur das Saisonende schreibt season_result.
import { sql } from "drizzle-orm";
import { protectionStatus, upgradeCost, type BaseState, type Counts, type ResourceMap } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { challengePoints } from "./challenges.ts";

/** Punkte = Kostenwert (zum Börsen-Richtpreis, Stahl = 1) / POINT_DIVISOR, je Kategorie abgerundet. */
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
  /** Ökostrom (v1.21): genutzter Ökostrom des grünsten eigenen Hafens (Strom-Stunden); zählt nicht zu den Punkten. */
  oekostrom?: number;
}

/** Mindestmenge Ökostrom (Strom-Stunden) für die Auszeichnung „Grünster Hafen“. */
export const GREENEST_MIN = 1000;

/**
 * Wert von Ressourcen zum Börsen-Richtpreis (v1.24, market.refPrice; Stahl 1, Treibstoff 1,8, Elektronik 3, Proviant 0,6).
 * Vorher zählte jede Ressource 1 – Punkte ließen sich über die Börse tauschen (Elektronik → Stahl).
 */
export function resValue(m: ResourceMap | null | undefined): number {
  const price = balance.market.refPrice;
  let s = 0;
  for (const [r, v] of Object.entries(m ?? {})) s += (Number(v) || 0) * (price[r] ?? 1);
  return s;
}

/** Kostenwert einer Einheit, Anlage (zum Richtpreis) oder NPC-Einheit (fester Wert). */
export function unitValue(id: string): number {
  const u = balance.units[id] ?? balance.defenses[id];
  if (u) return resValue(u.cost);
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
    for (let l = 0; l < level; l++) s += resValue(upgradeCost(id, l, balance));
  }
  return s;
}

const pts = (v: number) => Math.max(0, Math.floor(v / POINT_DIVISOR));

/** Ein Kampfbericht, wie computeStandings ihn liest. */
export interface ScoredReport {
  kind?: string | null;
  /** report.worldEvent.kind (Weltereignisse). */
  weKind?: string | null;
  attackerPlayerId: number | null;
  defenderPlayerId: number | null;
  /** Verluste des Angreifers bzw. Verteidigers. */
  al: Counts | null;
  dl: Counts | null;
  loot: ResourceMap | null;
}

/**
 * Kostenwerte eines Kampfberichts für Kampf und Beute. Der Angreifer bekommt die Verluste des Verteidigers als Kampf
 * und die Beute, der Verteidiger die Verluste des Angreifers. v1.24: Kämpfe gegen das Kartell zählen nur
 * × scoring.npcDefenseFactor – Abwehr ohne angreifenden Spieler (Kartell-Überfall, Großflotte, Konvoi, Feld) und
 * Angriffe auf die Weltereignisse in scoring.npcWorldEventKinds (Großflotte, Belagerungsring). Nester, Schatzschiff
 * und Kämpfe zwischen Spielern zählen voll; Beute zählt immer voll.
 */
export function reportScore(b: ScoredReport): { attacker: { kampf: number; beute: number } | null; defender: { kampf: number } | null } {
  const sc = balance.scoring;
  const f = sc?.npcDefenseFactor ?? 1;
  const npcEvent = b.kind === "weltereignis" && !!b.weKind && (sc?.npcWorldEventKinds ?? []).includes(b.weKind);
  return {
    attacker: b.attackerPlayerId === null ? null : { kampf: countsValue(b.dl) * (npcEvent ? f : 1), beute: resValue(b.loot) },
    defender: b.defenderPlayerId === null ? null : { kampf: countsValue(b.al) * (b.attackerPlayerId === null ? f : 1) },
  };
}

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
  /** Heimathafen des Spielers (mehrere Häfen: Punkte sind die Summe über alle Häfen). */
  base: { id: number; name: string; col: number; row: number; protection: string | null } | null;
  /** Anzahl der Häfen des Spielers. */
  bases: number;
  /** KI-Spieler (Kennzeichen „KI“ in Rangliste und Spielerübersicht). */
  bot: boolean;
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

/** Auszeichnungen: Platz 1 bis 3 der Gesamtwertung, je Kategorie ein Bester (nur mit Punkten), Grünster Hafen. */
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
  // Grünster Hafen (v1.21): meister genutzter Ökostrom in einem Hafen, ab GREENEST_MIN.
  let green: T | null = null;
  for (const r of ranked) if ((r.oekostrom ?? 0) >= GREENEST_MIN && (!green || r.oekostrom! > green.oekostrom!)) green = r;
  if (green) add(green.playerId, "best_oekostrom");
  return out;
}

/**
 * Stand aller Spieler: vier Abfragen (Spieler mit Stützpunkt, laufende Missionen, Kampfberichte und
 * abgeholte Tagesbefehle seit Saisonbeginn), danach reine Rechnung.
 */
export async function computeStandings(db: DbOrTx, seasonStartMs: number, nowMs: number): Promise<Standing[]> {
  const players = await db.execute<{
    id: number; name: string; bot: boolean; base_id: number | null; base_name: string | null; col: number | null; row: number | null; state: BaseState | null; is_home: boolean | null;
  }>(sql`select p.id, p.name, p.bot_profile is not null as bot, b.id as base_id, b.name as base_name, b.col, b.row, b.state, b.is_home
         from player p left join base b on b.player_id = p.id order by p.id, b.id`);
  const missions = await db.execute<{ player_id: number; status: string; units: Counts | null; returning: Counts | null }>(sql`
    select player_id, status, plan->'units' as units, "returning" as returning from mission
    where player_id is not null and status in ('outbound', 'returning', 'staged', 'stationed')`);
  const since = new Date(seasonStartMs).toISOString();
  const reports = await db.execute<{
    kind: string; we_kind: string | null; attacker_player_id: number | null; defender_player_id: number | null; al: Counts | null; dl: Counts | null; loot: ResourceMap | null;
  }>(sql`
    select kind, report->'worldEvent'->>'kind' as we_kind, attacker_player_id, defender_player_id,
      report->'battle'->'attacker'->'losses' as al, report->'battle'->'defender'->'losses' as dl, report->'battle'->'loot' as loot
    from battle_report where report ? 'battle' and created_at >= ${since}::timestamptz`);
  const orders = await challengePoints(db, seasonStartMs);

  const raw = new Map<number, { ausbau: number; militaer: number; kampf: number; beute: number }>();
  const get = (id: number) => {
    let r = raw.get(id);
    if (!r) raw.set(id, (r = { ausbau: 0, militaer: 0, kampf: 0, beute: 0 }));
    return r;
  };
  const green = new Map<number, number>(); // Ökostrom: bester Hafen je Spieler
  // Mehrere Häfen: eine Zeile je Hafen; Spieler einmal (Heimathafen als base), Werte summiert.
  const people = new Map<number, { playerId: number; name: string; base: Standing["base"]; bases: number; bot: boolean }>();
  for (const p of players) {
    const r = get(p.id);
    let person = people.get(p.id);
    if (!person) people.set(p.id, (person = { playerId: p.id, name: p.name, base: null, bases: 0, bot: !!p.bot }));
    if (!p.state || p.base_id === null) continue;
    person.bases += 1;
    if (p.is_home || !person.base) {
      person.base = { id: p.base_id, name: p.base_name!, col: p.col!, row: p.row!, protection: protectionStatus(p.state.protection, nowMs, balance).reason };
    }
    r.ausbau += buildingValue(p.state.buildings ?? {});
    green.set(p.id, Math.max(green.get(p.id) ?? 0, Math.floor(p.state.powerLog?.greenUsed ?? 0)));
    r.militaer += countsValue(p.state.units) + countsValue(p.state.defenses);
  }
  for (const m of missions) get(m.player_id).militaer += countsValue(m.status === "returning" || m.status === "stationed" ? m.returning : m.units); // Allianz-Ops: stationed
  for (const b of reports) {
    const sc = reportScore({ kind: b.kind, weKind: b.we_kind, attackerPlayerId: b.attacker_player_id, defenderPlayerId: b.defender_player_id, al: b.al, dl: b.dl, loot: b.loot });
    if (sc.attacker) {
      const r = get(b.attacker_player_id!);
      r.kampf += sc.attacker.kampf;
      r.beute += sc.attacker.beute;
    }
    if (sc.defender) get(b.defender_player_id!).kampf += sc.defender.kampf;
  }
  const rows = [...people.values()].map((p) => ({ ...p, ...makeScore(get(p.playerId), orders.get(p.playerId) ?? 0), oekostrom: green.get(p.playerId) ?? 0 }));
  return rankStandings(rows);
}
