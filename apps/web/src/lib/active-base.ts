// Mehrere Häfen: aktiver Hafen je Spieler (im Gerät gemerkt). Fehlt er oder ist er ungültig (Saisonwechsel, Hafen
// nicht mehr eigen → Server meldet "no_base"), gilt der Heimathafen: dann wird keine baseId gesendet.
import { useSyncExternalStore } from "react";

const key = (playerId: number) => `tf-active-base:${playerId}`;

let player: number | null = null;
let active: number | null = null;
const listeners = new Set<() => void>();

function read(playerId: number): number | null {
  try {
    const v = Number(localStorage.getItem(key(playerId)));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** Beim Anmelden/Spielerwechsel: gemerkten Hafen dieses Spielers laden. */
export function initActiveBase(playerId: number): void {
  if (player === playerId) return;
  player = playerId;
  active = read(playerId);
  emit();
}

/** Aktiver Hafen (null = Heimathafen). Für den tRPC-Link und Nicht-React-Code. */
export function activeBaseId(): number | null {
  return active;
}

/** Hafen wählen; null oder die ID des Heimathafens setzt auf „Heimathafen“ (keine baseId). */
export function setActiveBase(id: number | null): void {
  if (id === active) return;
  active = id;
  if (player !== null) {
    try {
      if (id === null) localStorage.removeItem(key(player));
      else localStorage.setItem(key(player), String(id));
    } catch { /* privater Modus: nur für diese Sitzung */ }
  }
  emit();
}

/** Rückfall auf den Heimathafen (ungültige ID, Server-Fehler no_base). */
export function resetActiveBase(): void {
  setActiveBase(null);
}

/** Fehler „Hafen nicht (mehr) eigen“ vom Server (Ausnahme oder Rückgabewert). */
export function isNoBase(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; code?: unknown };
  return e.message === "no_base" || e.code === "no_base";
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React: aktiver Hafen (null = Heimathafen), neu gezeichnet bei Wechsel. */
export function useActiveBaseId(): number | null {
  return useSyncExternalStore(subscribe, activeBaseId, activeBaseId);
}

/**
 * Hafenbezogene Prozeduren (nehmen `baseId` an): ganze Teilrouter und einzelne Pfade. Ohne baseId gilt serverseitig
 * der Heimathafen. base.choose (Erstwahl) und spielerweite Abfragen der Teilrouter bleiben außen vor.
 */
const BASE_ROUTERS = ["base.", "mission.", "market.", "espionage.", "research.", "admiral.", "allianceOps.", "naval.", "playerTrade.", "fields.", "worldEvents."];
const BASE_PATHS = new Set(["comfort.repeat", "comfort.recentMissions"]);
const NOT_BASE = new Set(["base.choose", "market.quote", "market.news"]);

export function isBasePath(path: string): boolean {
  if (NOT_BASE.has(path)) return false;
  return BASE_PATHS.has(path) || BASE_ROUTERS.some((p) => path.startsWith(p));
}

/** Eingabe mit baseId ergänzen, wenn sie fehlt (nur Objekte oder leere Eingabe). */
export function withBaseId(path: string, input: unknown, baseId: number | null): unknown {
  if (baseId === null || !isBasePath(path)) return input;
  if (input === undefined || input === null) return { baseId };
  if (typeof input !== "object" || Array.isArray(input)) return input;
  if ("baseId" in input && (input as { baseId?: unknown }).baseId !== undefined) return input;
  return { ...(input as Record<string, unknown>), baseId };
}

/** Abfragen, deren Cache beim Hafenwechsel verworfen wird (Schlüssel ohne baseId). */
export function isBaseQueryKey(queryKey: readonly unknown[]): boolean {
  const path = queryKey[0];
  return Array.isArray(path) && isBasePath(path.join("."));
}
