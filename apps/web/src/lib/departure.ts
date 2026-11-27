// Wortwahl beim Losschicken eines Verbands: Schiffe laufen aus, reine Luftverbände starten, Spione reisen.
import type { Balance } from "./trpc.ts";

export type DepartureKind = "see" | "luft" | "spion";

export interface DepartureWords {
  kind: DepartureKind;
  /** Knopf: „Auslaufen“ / „Starten“ / „Losschicken“. */
  verb: string;
  /** Kurzzeile: „Fahrt“ / „Flug“ / „Reise“. */
  trip: string;
  /** „bei Abfahrt“ / „beim Start“ / „bei Abreise“. */
  at: string;
}

const WORDS: Record<DepartureKind, Omit<DepartureWords, "kind">> = {
  see: { verb: "Auslaufen", trip: "Fahrt", at: "bei Abfahrt" },
  luft: { verb: "Starten", trip: "Flug", at: "beim Start" },
  spion: { verb: "Losschicken", trip: "Reise", at: "bei Abreise" },
};

/** Art des Verbands aus den gewählten Einheiten: nur Flugzeuge/Drohnen → Luft, nur Spione → Spion, sonst See. */
export function departureKind(units: Record<string, number>, balance: Balance | undefined): DepartureKind {
  const ids = Object.entries(units).filter(([, n]) => n > 0).map(([id]) => id);
  if (ids.length === 0) return "see";
  if (ids.every((id) => id === "spion")) return "spion";
  if (ids.every((id) => balance?.units[id]?.branch === "luft")) return "luft";
  return "see";
}

export function departureWords(units: Record<string, number>, balance: Balance | undefined): DepartureWords {
  const kind = departureKind(units, balance);
  return { kind, ...WORDS[kind] };
}
