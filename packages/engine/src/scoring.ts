// Wertung einer Saison: Punkte je Spieler in fünf Kategorien. Kampf und Beute kommen ausschließlich aus den
// Kampfberichten der Saison (battle_report), Ausbau und Militär aus dem aktuellen Stand, Befehle aus den
// abgeholten Tagesbefehlen (daily_challenge). Nichts davon wird gespeichert: Die Rangliste rechnet bei jedem Abruf
// (30 s Zwischenspeicher) neu, ein Balance-Wechsel (v1.24: Richtpreis, Kartell-Abwehr × npcDefenseFactor) gilt also
// sofort rückwirkend für die ganze laufende Saison. Nur das Saisonende schreibt season_result.
import { sql } from "drizzle-orm";
import { pairFactor, pairIndexes, pairKey, protectionStatus, pvpOf, researchCost, stampFactors, upgradeCost, type BaseState, type Counts, type PairFight, type PvpStamp, type ResourceMap } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { challengePoints } from "./challenges.ts";

/** Punkte = Kostenwert (zum Börsen-Richtpreis, Stahl = 1) / POINT_DIVISOR, je Kategorie abgerundet. */
export const POINT_DIVISOR = 100;

/**
 * Fester Kostenwert der NPC-Einheiten des Kartells (sie haben keine Baukosten). Angelehnt an vergleichbare
 * Spielereinheiten: Schnellboot ~ 0,45 Korvette (Lebenspunkte und Angriff), Piratenmiliz ~ 0,8 Schützen.
 */
export const NPC_UNIT_VALUE: Record<string, number> = { schnellboot: 250, piratenmiliz: 40, flaggschiff: 2375 }; // Flaggschiff-Sektion (Saisonfinale): gleicher Wert je LP wie Schnellboot mit 8 Miliz

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

/**
 * v1.38 (ST-15): Kostenwert der erforschten Stufen eines Hafens × scoring.researchFactor (zählt zum Ausbau); ohne Faktor 0.
 */
export function researchScoreValue(levels: Counts | null | undefined): number {
  const f = balance.scoring?.researchFactor ?? 0;
  const techs = balance.research?.techs ?? {};
  if (f <= 0) return 0;
  let s = 0;
  for (const [id, level] of Object.entries(levels ?? {})) {
    if (!techs[id]) continue;
    for (let l = 0; l < Math.min(level, techs[id].maxLevel); l++) s += resValue(researchCost(id, l, balance));
  }
  return s * f;
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
  // PvP (docs/VORLAGE-PVP.md): nur für Kämpfe zwischen zwei Spielern gelesen.
  /** Bericht-ID und Zeitpunkt (Reihenfolge der Paarbremse). */
  id?: number;
  atMs?: number;
  /** Sammelangriff: alle Teilnehmer (sonst nur der Angreifer). */
  participants?: number[] | null;
  /** Beim Kampf festgehalten (Kopfgeld, Mutfaktor, Absprache). */
  pvp?: PvpStamp | null;
  /** Verwaltung: Bericht aus der Wertung genommen. */
  pvpExcluded?: boolean | null;
  /** v1.35: Überfall auf ein Piratennest (battle_report.nest_id gesetzt) – Kampf und Beute × scoring.nestFactor. */
  nest?: boolean | null;
}

/** Faktoren eines Spielerkampfs auf Kampf und Beute des Angreifers und Kampf des Verteidigers. */
export interface PvpFactors { kampf: number; beute: number; defense: number }

const HOUR_MS = 3600000;

/** Kampf zwischen zwei verschiedenen Spielern? */
export function isPvpReport(b: ScoredReport): boolean {
  return b.attackerPlayerId !== null && b.defenderPlayerId !== null && b.attackerPlayerId !== b.defenderPlayerId;
}

/**
 * PvP-Faktoren je Bericht (nach id): Kopfgeld und Mutfaktor aus dem Stempel, Paarbremse aus der Reihenfolge der
 * Spielerkämpfe (beide Richtungen, Sammelangriffe mit jedem Teilnehmer), ausgenommene Berichte 0. Der Angreifer
 * nimmt die Stufe seines Paares, der Verteidiger die niedrigste aller beteiligten Paare. Ohne Balance-Block pvp: leer.
 */
export function pvpFactors(reports: ScoredReport[]): Map<number, PvpFactors> {
  const cfg = pvpOf(balance);
  const out = new Map<number, PvpFactors>();
  if (!cfg) return out;
  const fights: PairFight[] = [];
  for (const r of reports) {
    if (!isPvpReport(r) || r.id === undefined) continue;
    const d = r.defenderPlayerId!;
    const ids = [r.attackerPlayerId!, ...(r.participants ?? [])].filter((x) => x !== d);
    fights.push({ id: r.id, atMs: r.atMs ?? 0, pairs: ids.map((x) => pairKey(x, d)) });
  }
  const idx = pairIndexes(fights, cfg.pairWindowHours * HOUR_MS);
  for (const r of reports) {
    const m = r.id === undefined ? undefined : idx.get(r.id);
    if (!m) continue;
    if (r.pvpExcluded) { out.set(r.id!, { kampf: 0, beute: 0, defense: 0 }); continue; }
    const st = stampFactors(r.pvp, cfg);
    const own = pairFactor(m.get(pairKey(r.attackerPlayerId!, r.defenderPlayerId!)) ?? 0, cfg);
    const def = Math.min(...[...m.values()].map((n) => pairFactor(n, cfg)));
    out.set(r.id!, { kampf: st.kampf * own, beute: st.beute * own, defense: st.defense * def });
  }
  return out;
}

/**
 * Kostenwerte eines Kampfberichts für Kampf und Beute. Der Angreifer bekommt die Verluste des Verteidigers als Kampf
 * und die Beute, der Verteidiger die Verluste des Angreifers. v1.24: Kämpfe gegen das Kartell zählen nur
 * × scoring.npcDefenseFactor – Abwehr ohne angreifenden Spieler (Kartell-Überfall, Großflotte, Konvoi, Feld) und
 * Angriffe auf die Weltereignisse in scoring.npcWorldEventKinds (seit dem Nutzerentscheid 27.11.2026 leer: Großflotte und
 * Belagerungsring zählen voll). Saisonfinale × scoring.armadaFactor. v1.35 (Nutzerentscheid 3): Nestüberfälle zählen
 * Kampf und Beute × scoring.nestFactor; Schatzschiff, übrige Weltereignisse und Kämpfe zwischen Spielern zählen voll.
 * v1.38 (ST-16): Kampfpunkte beider Seiten eines Spielerkampfs × scoring.pvpFactor (Beute nicht).
 */
export function reportScore(b: ScoredReport, pvp?: PvpFactors): { attacker: { kampf: number; beute: number } | null; defender: { kampf: number } | null } {
  const sc = balance.scoring;
  const f = sc?.npcDefenseFactor ?? 1;
  const npcEvent = b.kind === "weltereignis" && !!b.weKind && (sc?.npcWorldEventKinds ?? []).includes(b.weKind);
  const p = pvp ?? { kampf: 1, beute: 1, defense: 1 }; // PvP: Kopfgeld, Mutfaktor, Paarbremse (pvpFactors)
  const pf = isPvpReport(b) ? (sc?.pvpFactor ?? 1) : 1; // v1.38 (ST-16): Spielerkämpfe zählen Kampf × pvpFactor, beide Seiten
  // Saisonfinale: Kampfpunkte aus Armada-Kämpfen × scoring.armadaFactor (Beute voll; kein Spielerkampf, PvP-Faktoren 1).
  const armada = b.kind === "weltereignis" && b.weKind === "finale" ? (sc?.armadaFactor ?? 1) : null;
  const nest = b.nest && b.defenderPlayerId === null ? (sc?.nestFactor ?? 1) : 1;
  return {
    attacker: b.attackerPlayerId === null ? null : { kampf: countsValue(b.dl) * (armada ?? (npcEvent ? f : 1)) * nest * pf * p.kampf, beute: resValue(b.loot) * nest * p.beute },
    defender: b.defenderPlayerId === null ? null : { kampf: countsValue(b.al) * (b.attackerPlayerId === null ? f : 1) * pf * p.defense },
  };
}

/**
 * Befehlspunkte nach dem Deckel scoring.ordersMaxShare (v1.35, Nutzerentscheid 4): höchstens dieser Anteil am Gesamtrang,
 * also Befehle ≤ Anteil ÷ (1 − Anteil) × übrige Punkte (abgerundet). Ohne Deckel unverändert.
 */
export function cappedOrders(befehle: number, otherPoints: number): number {
  const b = Math.max(0, Math.floor(befehle));
  const share = balance.scoring?.ordersMaxShare;
  if (share === undefined || share >= 1) return b;
  return Math.min(b, Math.floor((Math.max(0, share) / (1 - Math.max(0, share))) * Math.max(0, otherPoints) + 1e-9));
}

/** Kostenwerte der vier Kategorien in Punkte umrechnen; befehle sind bereits Punkte (gedeckelt, cappedOrders). */
export function makeScore(values: { ausbau: number; militaer: number; kampf: number; beute: number }, befehle = 0): Score {
  const s = { ausbau: pts(values.ausbau), militaer: pts(values.militaer), kampf: pts(values.kampf), beute: pts(values.beute) };
  const b = cappedOrders(befehle, s.ausbau + s.militaer + s.kampf + s.beute);
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
  const reportRows = await db.execute<{
    id: number; at: string | Date; kind: string; we_kind: string | null; attacker_player_id: number | null; defender_player_id: number | null; al: Counts | null; dl: Counts | null; loot: ResourceMap | null;
    pvp: PvpStamp | null; pvp_excluded: boolean | null; participants: number[] | null; nest: boolean;
  }>(sql`
    select id, created_at as at, kind, nest_id is not null as nest, report->'worldEvent'->>'kind' as we_kind, attacker_player_id, defender_player_id,
      report->'battle'->'attacker'->'losses' as al, report->'battle'->'defender'->'losses' as dl, report->'battle'->'loot' as loot,
      report->'pvp' as pvp, (report->>'pvpExcluded')::boolean as pvp_excluded,
      case when report ? 'allianceRaid' then jsonb_path_query_array(report, '$.allianceRaid.participants[*].playerId') end as participants
    from battle_report where report ? 'battle' and created_at >= ${since}::timestamptz`);
  const reports: ScoredReport[] = reportRows.map((b) => ({
    id: b.id, atMs: new Date(b.at).getTime(), kind: b.kind, weKind: b.we_kind, attackerPlayerId: b.attacker_player_id, defenderPlayerId: b.defender_player_id,
    al: b.al, dl: b.dl, loot: b.loot, pvp: b.pvp, pvpExcluded: b.pvp_excluded, participants: b.participants, nest: b.nest,
  }));
  const pvp = pvpFactors(reports); // PvP: Kopfgeld, Mutfaktor, Paarbremse
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
    r.ausbau += buildingValue(p.state.buildings ?? {}) + researchScoreValue(p.state.research?.levels); // v1.38: Forschung anteilig
    green.set(p.id, Math.max(green.get(p.id) ?? 0, Math.floor(p.state.powerLog?.greenUsed ?? 0)));
    r.militaer += countsValue(p.state.units) + countsValue(p.state.defenses);
  }
  for (const m of missions) get(m.player_id).militaer += countsValue(m.status === "returning" || m.status === "stationed" ? m.returning : m.units); // Allianz-Ops: stationed
  for (const b of reports) {
    const sc = reportScore(b, pvp.get(b.id!));
    if (sc.attacker) {
      const r = get(b.attackerPlayerId!);
      r.kampf += sc.attacker.kampf;
      r.beute += sc.attacker.beute;
    }
    if (sc.defender) get(b.defenderPlayerId!).kampf += sc.defender.kampf;
  }
  const rows = [...people.values()].map((p) => ({ ...p, ...makeScore(get(p.playerId), orders.get(p.playerId) ?? 0), oekostrom: green.get(p.playerId) ?? 0 }));
  return rankStandings(rows);
}
