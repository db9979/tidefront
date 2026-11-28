// KI-Spieler: Nestwahl nach dem ganzen Verband (Welle 2, AN-09/ST-06). Früher fuhr der Freibeuter mit dem gerade daheim
// liegenden Teil seines Verbands laufend gegen Nester 1–3 (38 % Leerfahrten, Nest 6 erst Tag 35), obwohl der ganze
// Verband Stufe 4–5 sicher schlug. Jetzt: je Hafen alle NEST_TOP_HOURS die höchste Stufe bestimmen, die der ganze
// Verband (daheim und unterwegs, ohne Heimwache) laut Probekampf schafft; überfallen werden nur Nester ab
// min(diese Stufe, höchstes erreichbares bekanntes Nest) − NEST_TOP_SLACK (bots-war.ts raidNest). Ist der Verband
// unterwegs, wartet der Bot lieber, statt mit Resten Kleinkram anzufahren.
import { and, eq, inArray } from "drizzle-orm";
import type { BaseState, Counts, Modifiers } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import type { NestLagebild } from "./nest-live.ts";
import { nestProbeOk, strikeForce, type TurnCtx } from "./bots-war.ts";

/** Neu bestimmen nach so vielen Stunden. */
export const NEST_TOP_HOURS = 6;
/** Überfallen werden Nester ab (höchste machbare Stufe − NEST_TOP_SLACK). */
export const NEST_TOP_SLACK = 1;
const MAX_LEVEL = 6;

/** Höchste Neststufe (1–6, 0 = keine), die dieser Verband ohne genaues Lagebild sicher schafft. */
export function topNestLevel(force: Counts, mods: Modifiers, runs: number, winRate: number, maxLevel = MAX_LEVEL): number {
  for (let lv = maxLevel; lv >= 1; lv--) if (nestProbeOk({ units: force, modifiers: mods }, { level: lv }, 0, runs, winRate)) return lv;
  return 0;
}

/** Höchste machbare Stufe für Überfälle aus diesem Hafen (zwischengespeichert im Bot-Zustand). */
export function nestTopLevel(c: TurnCtx, base: { id: number; state: BaseState }, guard: number, mods: Modifiers, shipGuard = guard): number {
  const key = String(base.id);
  const hit = c.state.nestTop?.[key];
  let top = hit && c.nowMs - hit.atMs < NEST_TOP_HOURS * 3600000 ? hit.level : -1;
  if (top < 0) {
    const all: Counts = { ...base.state.units };
    for (const [id, n] of Object.entries(base.state.unitsAway ?? {})) all[id] = (all[id] ?? 0) + n;
    const force = strikeForce({ ...base.state, units: all }, guard, shipGuard);
    top = topNestLevel(force, mods, c.cfg.probeRuns, c.cfg.probeWinRate, Math.min(MAX_LEVEL, c.cfg.nestMaxLevel ?? MAX_LEVEL));
    c.state.nestTop = { ...(c.state.nestTop ?? {}), [key]: { level: top, atMs: c.nowMs } };
  }
  return top;
}

/** Inselfestung (v1.35): so lange wartet die KI höchstens auf heimkehrende Verbände, danach doppelt so lange nicht. */
export const TOP_NEST_WAIT_HOURS = 8;
const HOUR_MS = 3600000;

type NestRef = { id: number; level: number; lagebild?: NestLagebild | null };

/**
 * Inselfestung (Stufe 6, v1.35, Zielfenster Tag 35–38): Schafft der Verband daheim das nächste Nest 6 nicht, wohl aber
 * zusammen mit den eigenen Überfallverbänden, die gerade zu diesem Hafen zurückkehren, wartet die KI höchstens
 * TOP_NEST_WAIT_HOURS auf sie, statt mit dem Rest wieder Stufe 5 anzufahren (Saisonlauf v1.34: nie ein Sieg über Nest 6).
 * Feldbesatzungen zählen nicht (sie bleiben draußen). Rückgabe: true = diesmal kein Nestüberfall aus diesem Hafen.
 */
export async function waitForTopNest(
  c: TurnCtx, base: { id: number; state: BaseState }, force: Counts, mods: Modifiers, nests: NestRef[], guard: number, shipGuard: number,
): Promise<boolean> {
  const top = nests.find((n) => n.level >= MAX_LEVEL);
  if (!top) return false;
  const key = String(base.id);
  const waitedUntil = c.state.topNestWait?.[key];
  if (waitedUntil !== undefined && c.nowMs >= waitedUntil && c.nowMs < waitedUntil + 2 * TOP_NEST_WAIT_HOURS * HOUR_MS) return false; // Pause nach dem Warten
  if (nestProbeOk({ units: force, modifiers: mods }, top, c.nowMs, c.cfg.probeRuns, c.cfg.probeWinRate)) return false; // reicht schon
  const rows = await c.engine.db.select({ status: tables.mission.status, plan: tables.mission.plan, returning: tables.mission.returning })
    .from(tables.mission).where(and(eq(tables.mission.playerId, c.bot.id), eq(tables.mission.baseId, base.id), eq(tables.mission.type, "ueberfall"),
      inArray(tables.mission.status, ["outbound", "returning"])));
  if (rows.length === 0) return false;
  const all: Counts = { ...base.state.units };
  for (const r of rows) {
    const u = (r.status === "returning" ? r.returning : (r.plan as { units?: Counts }).units) as Counts | null;
    for (const [id, n] of Object.entries(u ?? {})) all[id] = (all[id] ?? 0) + n;
  }
  const combined = strikeForce({ ...base.state, units: all }, guard, shipGuard);
  if (!nestProbeOk({ units: combined, modifiers: mods }, top, c.nowMs, c.cfg.probeRuns, c.cfg.probeWinRate)) return false;
  if (waitedUntil === undefined || c.nowMs >= waitedUntil) {
    c.state.topNestWait = { ...(c.state.topNestWait ?? {}), [key]: c.nowMs + TOP_NEST_WAIT_HOURS * HOUR_MS };
    c.log.push("Sammelt den Verband für die Inselfestung (Stufe 6).");
  }
  return true;
}
