// KI-Spieler: Nestwahl nach dem ganzen Verband (Welle 2, AN-09/ST-06). Früher fuhr der Freibeuter mit dem gerade daheim
// liegenden Teil seines Verbands laufend gegen Nester 1–3 (38 % Leerfahrten, Nest 6 erst Tag 35), obwohl der ganze
// Verband Stufe 4–5 sicher schlug. Jetzt: je Hafen alle NEST_TOP_HOURS die höchste Stufe bestimmen, die der ganze
// Verband (daheim und unterwegs, ohne Heimwache) laut Probekampf schafft; überfallen werden nur Nester ab
// min(diese Stufe, höchstes erreichbares bekanntes Nest) − NEST_TOP_SLACK (bots-war.ts raidNest). Ist der Verband
// unterwegs, wartet der Bot lieber, statt mit Resten Kleinkram anzufahren.
import type { BaseState, Counts, Modifiers } from "@tidefront/game-core";
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
export function nestTopLevel(c: TurnCtx, base: { id: number; state: BaseState }, guard: number, mods: Modifiers): number {
  const key = String(base.id);
  const hit = c.state.nestTop?.[key];
  let top = hit && c.nowMs - hit.atMs < NEST_TOP_HOURS * 3600000 ? hit.level : -1;
  if (top < 0) {
    const all: Counts = { ...base.state.units };
    for (const [id, n] of Object.entries(base.state.unitsAway ?? {})) all[id] = (all[id] ?? 0) + n;
    const force = strikeForce({ ...base.state, units: all }, guard);
    top = topNestLevel(force, mods, c.cfg.probeRuns, c.cfg.probeWinRate, Math.min(MAX_LEVEL, c.cfg.nestMaxLevel ?? MAX_LEVEL));
    c.state.nestTop = { ...(c.state.nestTop ?? {}), [key]: { level: top, atMs: c.nowMs } };
  }
  return top;
}
