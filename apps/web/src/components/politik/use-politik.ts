// Weltpolitik (docs/REGELN-WELTPOLITIK.md): gemeinsame Abfragen der Oberfläche. politik.overview (Kalender, wirkende
// Regler, Seerat, Paktangebote) und politik.ki (Ansehen je KI-Spieler, Gesuche); live über lib/live.ts (market,
// alliance, season) und zusätzlich minütlich.
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../../lib/trpc.ts";

export type PolitikOverview = Outputs["politik"]["overview"];
export type PolitikKi = Outputs["politik"]["ki"];
export type EffectLine = PolitikOverview["lines"][number];
export type EffectKey = EffectLine["key"];

export function usePolitik(enabled = true) {
  return useQuery({ ...trpc.politik.overview.queryOptions(), enabled, refetchInterval: 60000 });
}

export function usePolitikKi(enabled = true) {
  return useQuery({ ...trpc.politik.ki.queryOptions(), enabled, refetchInterval: 60000 });
}

export const politikInvalidate = () => [
  trpc.politik.pathFilter().queryKey, trpc.lage.pathFilter().queryKey, trpc.daily.pathFilter().queryKey, trpc.contracts.pathFilter().queryKey,
  trpc.alliance.pathFilter().queryKey,
];

export const LEVEL_TEXT: Record<string, string> = { misstraut: "Misstraut", bekannt: "Bekannt", vertraut: "Vertraut" };
export const LEVEL_TONE: Record<string, "red" | "slate" | "green"> = { misstraut: "red", bekannt: "slate", vertraut: "green" };

/** Prozentpunkte mit Vorzeichen: „+2 Pp“, „−2 Pp“, „±0“. */
export function pp(x: number): string {
  const v = Math.round(x * 1000) / 10;
  if (v === 0) return "±0";
  return `${v > 0 ? "+" : "−"}${String(Math.abs(v)).replace(".", ",")} Pp`;
}

export const REASON_TEXT: Record<string, string> = {
  vertrag: "Liefervertrag erfüllt", gesuch: "Gesuch erfüllt", strafe: "Vertragsstrafe", ueberfall: "Überfall auf ihn",
  paktbruch: "Paktbruch", zerfall: "Zerfall (5 % je Tag)",
};
