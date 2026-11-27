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
  type TargetMods,
} from "@tidefront/game-core";
import { hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseModifiers } from "./modifiers.ts";
import { weatherModifiers } from "./weather.ts";
import { getSetting, setSetting } from "./settings.ts";
import { withSite } from "./store.ts";
import { mobileSensors } from "./intel-mobile.ts"; // Lagebild Stufe 2
import { partySatBases, satelliteSensors } from "./intel-sat.ts"; // Lagebild Stufe 3: Satellitenstreifen
import { clearCounterCache, counterWorld, objectMods, type CounterWorld } from "./intel-counter.ts"; // Stufe 3: Gegenmittel

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
  /** Häfen der Partei (für bewegte Sensoren und Sonar; nur im Zwischenspeicher). */
  bases?: { id: number; playerId: number; name: string; col: number; row: number; state: BaseState; isHome: boolean }[];
  /** Stufe 3: Gegenmittel der Welt (Tarnnetze, Störsender, Tarnanstrich, Funkdisziplin); null ohne intel.counter. */
  counter?: CounterWorld | null;
  /** Stufe 3: Häfen der Partei mit Satelliten (frisch je Abruf). */
  satBases?: { id: number; playerId: number; name: string; col: number; row: number; state: BaseState }[];
}

const sightCache = new Map<string, Sight>();
const fogCache = { value: true, atMs: Number.NaN };

/** Sicht-Zwischenspeicher leeren (Einstellung geändert, Tests). */
export function clearSightCache(): void {
  sightCache.clear();
  clearCounterCache();
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

/**
 * Sicht der Partei eines Spielers. Die Hafensensoren (Ausguck, Radar) werden cacheSeconds zwischengespeichert (Uhr der
 * Spiellogik); bewegte Sensoren (Stufe 2: Verbände auf See, Patrouillen, Posten) kommen bei jedem Abruf frisch dazu –
 * zwei kleine Abfragen, dafür stimmen Position und neue Missionen sofort.
 */
export async function sightOf(db: DbOrTx, playerId: number, nowMs: number): Promise<Sight> {
  const ib = intelRules();
  const { party, members } = await partyOf(db, playerId);
  let hit = sightCache.get(party);
  const ttl = (ib?.cacheSeconds ?? 60) * 1000;
  if (!(hit && nowMs >= hit.atMs && nowMs - hit.atMs < ttl && hit.members.length === members.length && members.every((m) => hit!.members.includes(m)))) {
    const rows = ib ? await db.select().from(tables.base).where(inArray(tables.base.playerId, members)) : [];
    const bases = rows.map((b) => ({ ...b, state: b.state as BaseState }));
    const sensors = ib ? bases.flatMap((b) => sensorsOfBase(b, nowMs, ib)) : [];
    const keys = party.startsWith("a:") ? [party, ...members.map((m) => `p:${m}`)] : [party];
    hit = { party, members, keys, sensors, atMs: nowMs, bases };
    sightCache.set(party, hit);
    // Der Speicher wächst höchstens mit der Zahl der Parteien; alte Einträge räumen.
    if (sightCache.size > 500) for (const [k, v] of sightCache) if (nowMs - v.atMs > ttl) sightCache.delete(k);
  }
  if (!ib) return hit;
  const satBases = await partySatBases(db, members);
  const sensors = [...hit.sensors, ...(await mobileSensors(db, members, hit.bases ?? [], nowMs, ib)), ...satelliteSensors(satBases, nowMs, ib)];
  return { ...hit, sensors, satBases, counter: await counterWorld(db, nowMs) };
}

/**
 * Kenntnisstufe, mit der die Partei ein Objekt auf Feld col/row jetzt sieht (null = außerhalb jeder Sicht).
 * Stufe 3: owner/kind für die Gegenmittel (Tarnnetz des Besitzers, Störsender in der Nähe); mods ersetzt beides.
 */
export function liveAt(sight: Sight, col: number, row: number, target: "object" | "fleet" = "object", who?: { ownerId: number | null; kind: "base" | "field" | "post" | "other" } | TargetMods): IntelLevel | null {
  const { x, y } = hexCenterXY(col, row);
  const mods = who && "kind" in who ? objectMods(sight.counter, new Set(sight.members), x, y, who.ownerId, who.kind) : (who as TargetMods | undefined) ?? objectMods(sight.counter, new Set(sight.members), x, y, null, "other");
  return liveLevelAt(sight.sensors, x, y, target, mods);
}

/** Bester Sensor (Name der Quelle) für einen Punkt, für „Stand: … (Quelle)“. Sonar nur für U-Boote. */
export function sourceAt(sight: Sight, x: number, y: number): string {
  let best: Sensor | null = null;
  for (const s of sight.sensors) {
    if (s.kind === "sonar") continue;
    if (s.strip ? x < s.strip.x0 || x > s.strip.x1 : (s.x - x) ** 2 + (s.y - y) ** 2 > s.km * s.km) continue;
    if (!best || ((best.kind === "radar" || best.kind === "posten") && s.kind !== "radar" && s.kind !== "posten")) best = s;
  }
  return best?.label ?? "Sensor";
}
