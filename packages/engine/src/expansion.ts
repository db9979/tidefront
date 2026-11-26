// Mehrere Häfen je Spieler: Gründung eines Außenpostens und Verlegung zwischen eigenen Häfen.
// P0 (Fundament): nur Stub – die Missionsarten sind bekannt, aber noch abgeschaltet ("expansion_off").
// P1 ersetzt launchExpansion, previewExpansion und expansionArrive.
import type { Counts, ResourceMap } from "@tidefront/game-core";
import type { DbOrTx, Tx } from "@tidefront/db";
import { hexDistanceKm } from "@tidefront/world";
import { GameError } from "./context.ts";
import type { HandlerResult } from "./events.ts";
import type { MissionRowLike, Notes } from "./naval-common.ts";
import type { BaseRow } from "./store.ts";
import type { missionWeather } from "./weather.ts";

/** Missionsart: Kolonieschiff gründet auf einem freien Küstenfeld einen neuen Hafen. */
export const FOUNDING_TYPE = "gruendung";
/** Missionsart: Einheiten (und Admiral) dauerhaft in einen anderen eigenen Hafen verlegen. */
export const TRANSFER_TYPE = "verlegung";

/** Eingabe einer Gründung/Verlegung (Teilmenge von LaunchInput). */
export interface ExpansionInput {
  type: string;
  units: Counts;
  col: number;
  row: number;
  cargo?: ResourceMap;
  admiralId?: number;
}

export function isExpansionType(type: string): boolean {
  return type === FOUNDING_TYPE || type === TRANSFER_TYPE;
}

function fail(code: string): never {
  throw new GameError(code);
}

/** Auslaufen einer Gründung/Verlegung aus dem gesperrten Hafen `own` (in runCommand). */
export async function launchExpansion(
  _tx: Tx,
  _playerId: number,
  _own: BaseRow,
  _input: ExpansionInput,
  _nowMs: number,
  _notify: Notes,
): Promise<{ ok: true; missionId: number; arriveAtMs: number }> {
  return fail("expansion_off");
}

/** Antwort der Vorschau (Form wie missionPreview; P1 ergänzt den ok-true-Fall). */
export type ExpansionPreview = { ok: false; code: string; distanceKm: number; weather?: ReturnType<typeof missionWeather> };

/** Vorschau einer Gründung/Verlegung. */
export async function previewExpansion(
  _db: DbOrTx,
  _playerId: number,
  own: BaseRow,
  input: ExpansionInput,
  _nowMs: number,
): Promise<ExpansionPreview> {
  return { ok: false as const, code: "expansion_off", distanceKm: hexDistanceKm(own, input) };
}

/** Ankunft einer Gründung/Verlegung (mission_arrive, Weiche in handlers.ts). */
export async function expansionArrive(_tx: Tx, _m: MissionRowLike, _dueMs: number): Promise<HandlerResult> {
  return fail("expansion_off");
}
