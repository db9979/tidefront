// KI-Spieler und Lagebild: Bots sehen genau so viel wie Menschen (dieselbe Kartenansicht, gleiche Sensoren und
// gespeichertes Wissen). Der Freibeuter klärt fehlende Ziele (Nester, Felder ohne Erkennung) mit der vorhandenen
// Mission „aufklaerung“ auf; andere Spielweisen greifen nur an, was sie sehen oder kennen.
import { hexDistanceKm } from "@tidefront/world";
import type { BaseState } from "@tidefront/game-core";
import { launchMission, type LaunchInput } from "./commands.ts";
import { missionPreview } from "./views.ts";
import { mapViewFor } from "./intel-map.ts";
import { botsConfig } from "./bots-core.ts";
import type { TurnCtx } from "./bots-war.ts";
import type { BaseRow } from "./store.ts";

export type BotMap = Awaited<ReturnType<typeof mapViewFor>>;

const maps = new WeakMap<TurnCtx, BotMap>();

/** Kartenansicht des Bots, einmal je Zug (speichert auch seine Live-Sichtungen wie bei Menschen). */
export async function botMap(c: TurnCtx): Promise<BotMap> {
  const hit = maps.get(c);
  if (hit) return hit;
  const v = await mapViewFor(c.engine.db, c.bot.id, c.nowMs);
  maps.set(c, v);
  return v;
}

/** Klärt der Bot unbekannte Ziele selbst auf? (Freibeuter; die anderen warten auf Sicht.) */
export function scoutsUnknown(c: TurnCtx): boolean {
  return c.bot.profile === "freibeuter";
}

/** Aufklärer: Drohne, sonst Korvette (je ein Stück), sonst null. */
function scoutUnit(state: BaseState): string | null {
  if ((state.units.aufklaerungsdrohne ?? 0) > 0) return "aufklaerungsdrohne";
  if ((state.units.korvette ?? 0) > 0) return "korvette";
  return null;
}

/**
 * Aufklärung gegen das nächste unbekannte Ziel in Reichweite (höchstens einmal je reconMaxAgeHours und Ziel).
 * key unterscheidet Zielarten im Bot-Zustand (z. B. "n12" für Nest 12, "f3" für Feld 3).
 */
export async function scoutNearest(
  c: TurnCtx,
  base: BaseRow & { state: BaseState },
  targets: { key: string; col: number; row: number; fieldId?: number; label: string }[],
  rangeKm: number,
): Promise<boolean> {
  const unit = scoutUnit(base.state);
  if (!unit) return false;
  const maxAge = botsConfig().reconMaxAgeHours * 3600000;
  const open = targets
    .filter((t) => { const sent = c.state.recon?.[t.key]; return !sent || c.nowMs - sent >= maxAge; })
    .map((t) => ({ ...t, d: hexDistanceKm(base, t) }))
    .filter((t) => t.d <= rangeKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  for (const t of open) {
    const input: LaunchInput = { type: "aufklaerung", units: { [unit]: 1 }, col: t.col, row: t.row, baseId: base.id, ...(t.fieldId !== undefined ? { fieldId: t.fieldId } : {}) };
    if (!(await missionPreview(c.engine, c.bot.id, input)).ok) continue;
    const r = await launchMission(c.engine, c.bot.id, c.key("scout"), input);
    if (!r.ok) continue;
    c.state.recon = { ...(c.state.recon ?? {}), [t.key]: c.nowMs };
    c.log.push(`Aufklärung: ${t.label} (${Math.round(t.d)} km, Lage unbekannt).`);
    return true;
  }
  return false;
}
