// Lagebild (docs/REGELN-LAGEBILD.md, Stufe 1): Sicht je Partei (Spieler bzw. Allianz). Sensoren sind Ausguck (jeder
// Hafen) und Radarstation (Strom, Nebel, Sabotage). Lazy beim Abruf berechnet und cacheSeconds zwischengespeichert;
// geprüft werden nur Objekte gegen Kreise (kein Raster). Server-Einstellung intel_fog schaltet den Kartennebel ab.
import { eq, inArray } from "drizzle-orm";
import {
  activeSabotage,
  liveLevelAt,
  powerAt,
  radarRangeKm,
  type BaseState,
  type IntelBalance,
  type IntelLevel,
  type SensorCircle,
} from "@tidefront/game-core";
import { hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseModifiers } from "./modifiers.ts";
import { weatherModifiers } from "./weather.ts";
import { getSetting, setSetting } from "./settings.ts";
import { withSite } from "./store.ts";

export const INTEL_FOG_SETTING = "intel_fog";

/** Regeln des Lagebilds (Balance-Block intel) oder undefined (dann kein Kartennebel). */
export function intelRules(): IntelBalance | undefined {
  return balance.intel;
}

/** Ein Sensor eines Hafens der Partei (für Sicht und Kartenzeichnung). */
export interface Sensor extends SensorCircle {
  col: number;
  row: number;
  baseId: number;
  playerId: number;
  /** Anzeigename der Quelle, z. B. „Radar Hafen Brest“. */
  label: string;
}

/** Sicht einer Partei zu einem Zeitpunkt. */
export interface Sight {
  /** Partei wie in der Diplomatie: "a:<Allianz>" oder "p:<Spieler>". */
  party: string;
  members: number[];
  /** Schlüssel, unter denen Wissen der Partei liegt (Allianz und alle Mitglieder). */
  keys: string[];
  sensors: Sensor[];
  atMs: number;
}

const sightCache = new Map<string, Sight>();
const fogCache = { value: true, atMs: Number.NaN };

/** Sicht-Zwischenspeicher leeren (Einstellung geändert, Tests). */
export function clearSightCache(): void {
  sightCache.clear();
  fogCache.atMs = Number.NaN;
}

/** Ist der Kartennebel an? Nur mit Balance-Block intel und ohne Einstellung intel_fog = "0" (10 s zwischengespeichert). */
export async function intelFogOn(db: DbOrTx, nowMs = Date.now()): Promise<boolean> {
  if (!intelRules()) return false;
  if (Math.abs(nowMs - fogCache.atMs) < 10000) return fogCache.value;
  const raw = await getSetting(db, INTEL_FOG_SETTING);
  fogCache.value = raw !== "0";
  fogCache.atMs = nowMs;
  return fogCache.value;
}

/** Verwaltung: Kartennebel an/aus. Aus = alle sehen alles wie bis 0.17; Sensoren und Wissen laufen weiter. */
export async function setIntelFog(db: DbOrTx, on: boolean): Promise<{ ok: true; on: boolean }> {
  await setSetting(db, INTEL_FOG_SETTING, on ? "1" : "0");
  clearSightCache();
  return { ok: true, on };
}

/** Partei eines Spielers mit allen Mitgliedern (ohne Allianz nur er selbst). */
export async function partyOf(db: DbOrTx, playerId: number): Promise<{ party: string; members: number[] }> {
  const [m] = await db.select({ allianceId: tables.allianceMember.allianceId }).from(tables.allianceMember).where(eq(tables.allianceMember.playerId, playerId));
  if (!m) return { party: `p:${playerId}`, members: [playerId] };
  const rows = await db.select({ id: tables.allianceMember.playerId }).from(tables.allianceMember).where(eq(tables.allianceMember.allianceId, m.allianceId));
  return { party: `a:${m.allianceId}`, members: rows.map((r) => r.id) };
}

/** Radarzustand eines Hafens: versorgter Strom (wie bei der Vorwarnzeit), Nebel am Hafen, laufende Sabotage. */
export function radarCondition(state: BaseState, nowMs: number) {
  const def = balance.buildings.radarstation;
  const powerServed = def?.powerPerLevel ? powerAt(state, state.resUpdatedAt, balance, baseModifiers(state)).served.radar : 1;
  return {
    powerServed,
    fogFactor: weatherModifiers(state, nowMs).radarWarning ?? 1,
    sabotaged: activeSabotage(state, nowMs)?.target === "radarstation",
  };
}

/** Sensoren eines Hafens: Ausguck immer, Radar mit Stufe ≥ 1 und Reichweite > 0. */
export function sensorsOfBase(b: { id: number; playerId: number; name: string; col: number; row: number; state: BaseState }, nowMs: number, ib: IntelBalance): Sensor[] {
  const { x, y } = hexCenterXY(b.col, b.row);
  const common = { x, y, col: b.col, row: b.row, baseId: b.id, playerId: b.playerId };
  const out: Sensor[] = [{ ...common, kind: "ausguck", km: ib.lookoutKm, label: `Ausguck ${b.name}` }];
  const level = b.state.buildings.radarstation ?? 0;
  if (level >= 1) {
    const km = radarRangeKm(level, ib, radarCondition(withSite(b.state, b.col, b.row), nowMs));
    if (km > 0) out.push({ ...common, kind: "radar", km: Math.round(km), label: `Radar ${b.name}` });
  }
  return out;
}

/** Sicht der Partei eines Spielers (zwischengespeichert für cacheSeconds, Uhr der Spiellogik). */
export async function sightOf(db: DbOrTx, playerId: number, nowMs: number): Promise<Sight> {
  const ib = intelRules();
  const { party, members } = await partyOf(db, playerId);
  const hit = sightCache.get(party);
  const ttl = (ib?.cacheSeconds ?? 60) * 1000;
  if (hit && nowMs >= hit.atMs && nowMs - hit.atMs < ttl && hit.members.length === members.length && members.every((m) => hit.members.includes(m))) return hit;
  const rows = ib ? await db.select().from(tables.base).where(inArray(tables.base.playerId, members)) : [];
  const sensors = ib ? rows.flatMap((b) => sensorsOfBase({ ...b, state: b.state as BaseState }, nowMs, ib)) : [];
  const keys = party.startsWith("a:") ? [party, ...members.map((m) => `p:${m}`)] : [party];
  const sight: Sight = { party, members, keys, sensors, atMs: nowMs };
  sightCache.set(party, sight);
  // Der Speicher wächst höchstens mit der Zahl der Parteien; alte Einträge räumen.
  if (sightCache.size > 500) for (const [k, v] of sightCache) if (nowMs - v.atMs > ttl) sightCache.delete(k);
  return sight;
}

/** Kenntnisstufe, mit der die Partei ein Objekt auf Feld col/row jetzt sieht (null = außerhalb jeder Sicht). */
export function liveAt(sight: Sight, col: number, row: number, target: "object" | "fleet" = "object"): IntelLevel | null {
  const { x, y } = hexCenterXY(col, row);
  return liveLevelAt(sight.sensors, x, y, target);
}

/** Bester Sensor (Name der Quelle) für einen Punkt, für „Stand: … (Quelle)“. */
export function sourceAt(sight: Sight, x: number, y: number): string {
  let best: Sensor | null = null;
  for (const s of sight.sensors) {
    if ((s.x - x) ** 2 + (s.y - y) ** 2 > s.km * s.km) continue;
    if (!best || (best.kind === "radar" && s.kind === "ausguck")) best = s;
  }
  return best?.label ?? "Sensor";
}
