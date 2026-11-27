// Lagebild Stufe 3 (docs/REGELN-LAGEBILD.md 6): Gegenmittel beim Abruf der Sicht. Weltweit einmal je cacheSeconds aus
// allen Häfen gelesen: Störsender (Stufe, Strom), Tarnnetze und Tarnanstrich je Spieler (Forschung). Daraus je Ziel die
// Wirkung auf die fremden Sensoren (TargetMods): Tarnnetz (Ausguck und optischer Satellit nur Sichtung), Störsender
// (fremdes Radar im Umkreis kürzer), Tarnanstrich (Verbände nur aus Flugzeugen), Funkdisziplin des Admirals.
import { isNotNull } from "drizzle-orm";
import {
  camoActive, counterOf, jammerFactorAt, jammerReduction, paintFactor, powerAt, techLevel,
  type BaseState, type Counts, type CounterBalance, type Jammer, type TargetMods,
} from "@tidefront/game-core";
import { hexCenterXY } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import { baseModifiers } from "./modifiers.ts";

export interface CounterJammer extends Jammer {
  baseId: number;
  level: number;
}

/** Gegenmittel der ganzen Welt zu einem Zeitpunkt. */
export interface CounterWorld {
  cb: CounterBalance;
  atMs: number;
  jammers: CounterJammer[];
  /** Tarnnetze und Tarnanstrich je Spieler (höchste Stufe über seine Häfen; Forschung liegt im Heimathafen). */
  camo: Map<number, number>;
  paint: Map<number, number>;
  /** Missionen mit einem Admiral der Spezialisierung „Aufklärung“ (Funkdisziplin). */
  quiet: Set<number>;
}

let cache: CounterWorld | null = null;

export function clearCounterCache(): void {
  cache = null;
}

/** Gegenmittel der Welt (cacheSeconds zwischengespeichert); null ohne Balance-Block intel.counter. */
export async function counterWorld(db: DbOrTx, nowMs: number): Promise<CounterWorld | null> {
  const cb = counterOf(balance.intel);
  if (!cb) return null;
  const ttl = (balance.intel?.cacheSeconds ?? 60) * 1000;
  if (cache && nowMs >= cache.atMs && nowMs - cache.atMs < ttl) return cache;
  const rows = await db.select({ id: tables.base.id, playerId: tables.base.playerId, col: tables.base.col, row: tables.base.row, state: tables.base.state }).from(tables.base);
  const jammers: CounterJammer[] = [];
  const camo = new Map<number, number>();
  const paint = new Map<number, number>();
  for (const r of rows) {
    const state = r.state as BaseState;
    camo.set(r.playerId, Math.max(camo.get(r.playerId) ?? 0, techLevel(state, cb.camoTech)));
    paint.set(r.playerId, Math.max(paint.get(r.playerId) ?? 0, techLevel(state, cb.paintTech)));
    const level = state.buildings[cb.jammer] ?? 0;
    if (level < 1) continue;
    const powered = powerAt(state, state.resUpdatedAt, balance, baseModifiers(state)).served.radar >= 0.999;
    jammers.push({ ...hexCenterXY(r.col, r.row), playerId: r.playerId, baseId: r.id, level, reduction: jammerReduction(level, powered, cb) });
  }
  const quiet = new Set<number>();
  const admirals = await db.select({ missionId: tables.admiral.missionId, spec1: tables.admiral.spec1, spec2: tables.admiral.spec2 }).from(tables.admiral).where(isNotNull(tables.admiral.missionId));
  for (const a of admirals) if (a.missionId !== null && (a.spec1 === cb.admiralSpec || a.spec2 === cb.admiralSpec)) quiet.add(a.missionId);
  cache = { cb, atMs: nowMs, jammers, camo, paint, quiet };
  return cache;
}

/** Wirkung der Gegenmittel auf ein Objekt (Hafen, Feld, Posten mit Besitzer; Nester und Wracks nur Störsender). */
export function objectMods(cw: CounterWorld | null | undefined, party: ReadonlySet<number>, x: number, y: number, ownerId: number | null, kind: "base" | "field" | "post" | "other"): TargetMods | undefined {
  if (!cw) return undefined;
  const radarFactor = jammerFactorAt(x, y, cw.jammers, party, cw.cb);
  const camouflaged = ownerId !== null && kind !== "other" && !party.has(ownerId) && camoActive(cw.camo.get(ownerId) ?? 0, kind, cw.cb);
  return { radarFactor, camouflaged };
}

/** Wirkung auf einen fremden Verband: Störsender am Ort, Funkdisziplin (Admiral), Tarnanstrich bei reinen Flugverbänden. */
export function fleetMods(
  cw: CounterWorld | null | undefined, party: ReadonlySet<number>, x: number, y: number,
  m: { id: number; playerId: number | null }, units: Counts, defs: Record<string, { branch?: string } | undefined>,
): TargetMods | undefined {
  if (!cw) return undefined;
  let radarFactor = jammerFactorAt(x, y, cw.jammers, party, cw.cb);
  if (cw.quiet.has(m.id)) radarFactor *= cw.cb.admiralRadarFactor;
  const active = Object.entries(units).filter(([, n]) => n > 0);
  const onlyAir = active.length > 0 && active.every(([id]) => defs[id]?.branch === "luft");
  const sightFactor = onlyAir && m.playerId !== null ? paintFactor(cw.paint.get(m.playerId) ?? 0, cw.cb) : 1;
  return { radarFactor, sightFactor };
}

/**
 * Störsender, die fremdes Radar der Partei erkennt (Nachteil des Störsenders): Hafen mit Störsender im Umkreis
 * jammerRevealKm um einen eigenen Radar-Sensor (Hafen, Posten) oder in einem live Radarsatelliten-Streifen.
 */
export function revealedJammers(cw: CounterWorld | null | undefined, party: ReadonlySet<number>, sensors: readonly { kind: string; x: number; y: number; strip?: { x0: number; x1: number } }[]): Set<number> {
  const out = new Set<number>();
  if (!cw) return out;
  const r2 = cw.cb.jammerRevealKm ** 2;
  for (const j of cw.jammers) {
    if (party.has(j.playerId)) continue;
    for (const s of sensors) {
      const hit = s.strip ? s.kind === "radarsatellit" && j.x >= s.strip.x0 && j.x <= s.strip.x1
        : (s.kind === "radar" || s.kind === "posten") && (s.x - j.x) ** 2 + (s.y - j.y) ** 2 <= r2;
      if (hit) { out.add(j.baseId); break; }
    }
  }
  return out;
}
