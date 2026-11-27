// Werkzeug für ausführliche Bericht-Mails: Abschnitts-Register (je Berichtsart bzw. Datenteil ein Renderer),
// Formatierung von Zahlen, Zeiten, Einheiten (mit Textsymbol) und Ressourcen. Neue Berichtsarten melden hier
// einen eigenen Abschnitt an (registerReportSection); ohne eigenen Abschnitt greift der Standard in mail-reports.ts.
import { balance } from "./context.ts";
import type { Cell, MailBlock } from "./mail-blocks.ts";
import { fmtInt, nameOf } from "./names.ts";

export type Counts = Record<string, number>;

/** Bericht aus Sicht des Lesers – dieselben Daten, die das Spiel ihm zeigt (views.reportGet). */
export interface ReportView {
  id: number;
  kind: string;
  title: string;
  atMs: number;
  role: "attacker" | "defender" | "recipient";
  winner: string | null;
  data: Record<string, unknown>;
}

/** Zusatzwissen des Lesers: Veteranenränge der eigenen Einheiten (wie im Spiel unter Truppen). */
export interface ReportCtx {
  veterans: Record<string, string>;
}

export interface SectionOut {
  blocks: MailBlock[];
  /** Betreff ohne Spielnamen; der erste Abschnitt mit Betreff gewinnt. */
  subject?: string;
  /** Kurzer Satz unter der Überschrift (und Vorschauzeile). */
  lead?: string;
}

export interface ReportSection {
  id: string;
  applies: (r: ReportView) => boolean;
  render: (r: ReportView, ctx: ReportCtx) => SectionOut | null;
}

const sections: ReportSection[] = [];

/** Meldet einen Abschnitt an; gleiche id ersetzt den alten (Reihenfolge bleibt). */
export function registerReportSection(s: ReportSection): void {
  const i = sections.findIndex((x) => x.id === s.id);
  if (i >= 0) sections[i] = s;
  else sections.push(s);
}

export function reportSections(): readonly ReportSection[] {
  return sections;
}

// ---------------------------------------------------------------- Formatierung

export const isCounts = (v: unknown): v is Counts =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "number");

export const counts = (v: unknown): Counts => (isCounts(v) ? v : {});

export function sum(c: Counts | null | undefined): number {
  let n = 0;
  for (const v of Object.values(c ?? {})) if (Number.isFinite(v) && v > 0) n += v;
  return n;
}

export const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : fallback);

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const int = (n: number) => fmtInt(Number.isFinite(n) ? n : 0);

/** „1 Anlage“ / „3 Anlagen“. */
export { nOf } from "./names.ts";

export const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : "0 %");

const TZ = () => process.env.TZ || "Europe/Berlin";

/** „Fr., 27.11., 14:05 Uhr“ in der Zeitzone des Servers. */
export function dateTime(ms: number): string {
  try {
    return `${new Date(ms).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ() })} Uhr`;
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Textsymbole statt Bilder (keine externen Abrufe; ︎ erzwingt die Textdarstellung statt Emoji). */
const BRANCH_SYMBOL: Record<string, string> = { see: "⚓︎", luft: "✈︎", land: "♞︎" };
const DEFENSE_SYMBOL = "▣";

/** Einheiten außerhalb von balance.units (Kartell). */
const EXTRA_BRANCH: Record<string, string> = { piratenmiliz: "land", schnellboot: "see" };

export function unitSymbol(id: string): string {
  const u = (balance.units as Record<string, { branch?: string } | undefined>)[id] ?? (EXTRA_BRANCH[id] ? { branch: EXTRA_BRANCH[id] } : undefined);
  if (u?.branch) return BRANCH_SYMBOL[u.branch] ?? "◆";
  if ((balance.defenses as Record<string, unknown> | undefined)?.[id]) return DEFENSE_SYMBOL;
  return "◆";
}

export const unitLabel = (id: string) => `${unitSymbol(id)} ${nameOf(id)}`;

export const isResource = (id: string) => (balance.resources as readonly string[]).includes(id);

/** „1.240 Stahl, 300 Treibstoff“ oder fallback. */
export function resText(c: Counts | null | undefined, fallback = "nichts", limit = 4): string {
  const parts = Object.entries(c ?? {}).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  if (!parts.length) return fallback;
  const shown = parts.slice(0, limit).map(([k, v]) => `${int(v)} ${nameOf(k)}`);
  return parts.length > limit ? `${shown.join(", ")} u. a.` : shown.join(", ");
}

/** Zeilen „Ressource | Menge“ in der Reihenfolge des Spiels; null ohne Inhalt. */
export function resourceRows(c: Counts | null | undefined, sign = ""): Cell[][] {
  const order = [...(balance.resources as readonly string[]), ...Object.keys(c ?? {}).filter((k) => !isResource(k))];
  return order.filter((k) => (c?.[k] ?? 0) >= 1).map((k) => [{ v: nameOf(k), icon: k }, `${sign}${int(c![k])}`]);
}

/** Erste Spalte einer Einheitenzeile: Textsymbol + Name (E-Mail), Symbol-ID für die App. */
export const unitCell = (id: string, vet?: string): Cell => ({ v: vet ? `${unitLabel(id)} · ${vet}` : unitLabel(id), icon: id });

/** Einheiten-Tabelle „Einheit | Anzahl“ (z. B. Lagebild), Anlagen nach Einheiten. */
export function unitRows(c: Counts, vets: Record<string, string> = {}): Cell[][] {
  return Object.entries(c)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => [unitCell(id, vets[id]), int(n)]);
}

export function unitTable(title: string | null, c: Counts, head = ["Einheit", "Anzahl"], caption?: string): MailBlock[] {
  const rows = unitRows(c);
  if (!rows.length) return title ? [{ type: "section", title }, { type: "text", text: "Keine.", tone: "muted" }] : [];
  return [...(title ? [{ type: "section", title } as MailBlock] : []), { type: "table", head, rows, caption, foot: rows.length > 1 ? ["Gesamt", int(sum(c))] : undefined }];
}

/** Bezeichnung einer Berichtsart für Kopfzeilen. */
const KIND_LABEL: Record<string, string> = {
  ueberfall: "Überfall", kartell: "Kartell-Überfall", aufklaerung: "Aufklärung", transport: "Lieferung", leer: "Piratennest",
  abgewiesen: "Kartell abgewiesen", weltereignis: "Weltereignis", weltereignis_leer: "Weltereignis", spionage: "Spionage",
  sabotage: "Sabotage", sammelangriff: "Sammelangriff", minen: "Minen", blockade: "Seeblockade", blockadekampf: "Blockadekampf",
  konvoi: "Konvoi", feld: "Rohstofffeld", gruendung: "Gründung", verlegung: "Verlegung", satellit: "Satellit",
  posten: "Radarposten", sichtung: "Sichtung", patrouille: "Patrouille", kampagne: "Aufklärungskampagne",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? nameOf(kind.replace(/_/g, " "));
}
