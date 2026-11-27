// Abhilfe zu Sperr- und Fehlermeldungen: Hinweis, was der Spieler tun kann, und Sprungziele in der App.
import type { Balance as CoreBalance } from "@tidefront/game-core";
import type { BaseData } from "../trpc.ts";

/** Sprungziel in der App (App.tsx setzt es um). */
export type NavTarget =
  | { to: "building"; id: string } // Basis mit Gebäude-Blatt
  | { to: "base" } // Basis (z. B. Schutz und Nachtschild)
  | { to: "research" }
  // side/qty: Order vorbelegen (z. B. „Proviant verkaufen“ bei 0 Talern).
  | { to: "market"; resource?: string; seg?: "handel" | "spieler" | "vertraege"; /* vertraege: Lagezentrum */ side?: "buy" | "sell"; qty?: number }
  | { to: "troops"; seg: "einsatz" | "ausbilden" | "abwehr" }
  | { to: "map" }
  | { to: "meldungen"; sub: "berichte" | "erfolge" | "nachrichten" | "rangliste" | "allianz" | "lagebild" };

export interface RemedyAction { label: string; go: NavTarget }

/** Eine fehlende Menge mit Bestand, Bedarf und Wartezeit (z. B. Ressourcen für einen Ausbau). */
export interface RemedyItem { id: string; label: string; have: number; need: number; eta?: string }

export interface Remedy {
  /** Konkreter, handlungsleitender Satz (mit Zahlen, wo der Client sie kennt). */
  hint: string;
  /** Kurzfassung für den eingeklappten Kopf (eine Zeile), z. B. „Fehlt: 49 Elektronik · ca. 1 h 14 min“. */
  summary?: string;
  /** Fehlende Mengen als Fortschrittszeilen (statt sie im Fließtext aufzuzählen). */
  items?: RemedyItem[];
  actions?: RemedyAction[];
}

/** Zusatzangaben der auslösenden Stelle (z. B. Kosten des Ausbaus, gewählter Verband). */
export interface RemedyDetail {
  /** Kosten der abgelehnten Aktion (Ausbau, Ausbildung, Forschung, Admiral). */
  cost?: Record<string, number> | null;
  /** Betroffenes Gebäude (Ausbau) bzw. Baugebäude (Ausbildung). */
  building?: string;
  /** Betroffene Einheit oder Anlage (Ausbildung). */
  unit?: string;
  /** Gewählter Verband (Missionen). */
  units?: Record<string, number>;
  /** Ladung (Transport, Verlegung). */
  cargo?: Record<string, number>;
  /** Entfernung zum Ziel in km (Missionsvorschau). */
  distanceKm?: number;
  /** Ressource (Börse, Spielerhandel). */
  resource?: string;
  /** Menge (Börse). */
  qty?: number;
  /** Technik (Forschung). */
  tech?: string;
  /** Missionsart bzw. Auftragsart (Spionage). */
  type?: string;
}

export interface RemedyCtx {
  base: BaseData | null;
  balance: CoreBalance | null;
  detail: RemedyDetail;
  now: number;
}

export type RemedyFn = (ctx: RemedyCtx) => Remedy | null;
export type RemedyTable = Record<string, RemedyFn>;
