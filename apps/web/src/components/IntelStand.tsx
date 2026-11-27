// Lagebild: Stand einer Angabe im Feld-Blatt („Stand: vor 5 h, Radar Hafen X“) und fremde Verbände auf einem Feld.
// Live-Angaben (jetzt im Sensorbereich) brauchen keinen Stand; veraltete stehen in Klammern (docs/REGELN-LAGEBILD.md).
import type { MapData } from "../lib/trpc.ts";
import { fmtAgo } from "../lib/time.ts";

export type IntelTag = { age: "live" | "bekannt" | "veraltet"; atMs: number; source: string; level: string } | null | undefined;
export type MapFleet = MapData["fleets"][number];

const LEVEL_TEXT: Record<string, string> = { sichtung: "Sichtung", erkennung: "Erkennung", lagebild: "Lagebild" };
const SIZE_TEXT: Record<string, string> = { klein: "klein (bis 10 Einheiten)", mittel: "mittel (bis 40)", gross: "groß (über 40)" };
const REL_TEXT: Record<string, string> = { allianz: "Allianz", pakt: "Paktpartner", krieg: "Kriegsgegner", neutral: "neutral", kartell: "Kartell" };

/** „vor 5 h“ (unter einer Stunde in Minuten) – einheitlich über fmtAgo (lib/time.ts). */
export function agoText(atMs: number, now: number): string {
  return fmtAgo(atMs, now);
}

/** Zeile „Stand: vor X (Quelle)“ für bekanntes oder veraltetes Wissen; live: kleine Quellenangabe. */
export function IntelStand({ tag, now }: { tag: IntelTag; now: number }) {
  if (!tag) return null;
  if (tag.age === "live") return <div className="text-[11px] text-ink2">Live: {tag.source} ({LEVEL_TEXT[tag.level] ?? tag.level})</div>;
  const text = `Stand: ${agoText(tag.atMs, now)} (${tag.source})`;
  return (
    <div className={`text-[11px] ${tag.age === "veraltet" ? "text-ink2 italic" : "text-ink"}`} data-testid="intel-stand">
      {tag.age === "veraltet" ? `(${text} – veraltet)` : text}
    </div>
  );
}

/** Hinweis für Objekte ohne Sicht: nur Position bekannt. */
export function UnknownLine({ what }: { what: string }) {
  return <div className="text-xs text-ink2" data-testid="lage-unbekannt">Nur die Position ist bekannt: {what} erst mit Sicht (Ausguck, Radar) oder nach einer Aufklärung.</div>;
}

/** Fremde Verbände auf dem gewählten Feld. */
export function FleetLines({ fleets, now }: { fleets: MapFleet[]; now: number }) {
  if (fleets.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {fleets.map((f) => (
        <div key={f.id} className="text-xs">
          <div className="font-semibold">
            Fremder Verband: {SIZE_TEXT[f.size] ?? f.size}, Kurs {String(f.heading).padStart(3, "0")}°
          </div>
          <div className="text-ink2">{f.owner ? `${f.owner} (${REL_TEXT[f.relation ?? "neutral"] ?? f.relation})` : "Besitzer unbekannt (nur Sichtung)"}</div>
          <IntelStand tag={f.intel} now={now} />
        </div>
      ))}
    </div>
  );
}
