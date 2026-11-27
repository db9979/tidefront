// Lagezentrum (Meldungen → Lage): gemeinsame Typen und kleine Helfer für lage.ts und lage-wait.ts.
// Entscheidung „Lagezentrum“ (packages/game-core/ENTSCHEIDUNGEN-5.md).
import type { BaseRow } from "./store.ts";

/** Sprungziel einer Zeile; die Oberfläche (apps/web/src/components/lage) setzt es um. */
export type LageJump =
  | { to: "map"; col: number; row: number; baseId: number | null; missionId?: number; convoyId?: number; eventId?: number }
  | { to: "building"; baseId: number; id: string }
  | { to: "base"; baseId: number }
  | { to: "research" }
  | { to: "troops"; baseId: number; seg: "einsatz" | "ausbilden" | "abwehr" }
  | { to: "contracts" }
  | { to: "report"; id: number }
  | { to: "rewards"; where: "basis" | "erfolge" };

export interface LageRow {
  /** Stabiler Schlüssel (React, Tests). */
  key: string;
  /** Art (für Tests und Gruppierung), z. B. angriff, ankunft, rueckkehr, konvoi, bau, ausbildung, vertrag, nachfrist. */
  kind: string;
  /** Zeitpunkt (Countdown), null bei Zuständen ohne Termin. */
  atMs: number | null;
  icon: string;
  text: string;
  /** Zweite Zeile: Hafen, Herkunft, Vorwarnzeit … */
  sub: string | null;
  /** alarm: rot (Angriff, Nachfrist, Mangel), gut: grün (abholbereit). */
  tone: "alarm" | "gut" | null;
  /** Zählt für die Zahl am Navigationszeichen „Meldungen“. */
  urgent: boolean;
  /** Fortschrittsbalken (Unterwegs): von–bis. */
  progress: { fromMs: number; toMs: number } | null;
  jump: LageJump | null;
}

export interface LageUrgent {
  attacks: number;
  grace: number;
  idleQueues: number;
  /** Serverseitig gezählte abholbare Belohnungen (Erfolge, Wochenziele); Tagesbefehle/Auftragsbuch zählt die Oberfläche. */
  rewards: number;
  /** Schlüssel der dringenden Einträge: die Oberfläche zählt nur, was seit dem letzten Öffnen der Lage neu ist. */
  keys: string[];
}

export const HOUR_MS = 3_600_000;
/** „Gleich / heute“: Termine bis so weit voraus. */
export const SOON_MS = 24 * HOUR_MS;

export function row(r: Partial<LageRow> & Pick<LageRow, "key" | "kind" | "icon" | "text">): LageRow {
  return { atMs: null, sub: null, tone: null, urgent: false, progress: null, jump: null, ...r };
}

/** Hafenname für die zweite Zeile – nur mit mehreren Häfen nötig, sonst null. */
export function harborSub(bases: BaseRow[], id: number | null | undefined): string | null {
  if (bases.length < 2 || id == null) return null;
  return bases.find((b) => b.id === id)?.name ?? null;
}
