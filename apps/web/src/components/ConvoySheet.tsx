// See: Konvoi-Blatt auf der Karte (Antippen eines Konvois): Art, Absender → Empfänger, Ladung (eigene genau, fremde
// mit Lagebild genau, sonst Größenklasse), Geleit, Ankunft, Route. Für Kriegsgegner „Abfangen“ mit Abfangpunkt aus
// der Vorschau des Servers (previewIntercept) für alle Schiffe daheim; geplant und gestartet wird in der
// Missionsplanung (launchIntercept). Regeln: docs/REGELN-SEE.md, Abschnitt Konvois.
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData, type Outputs } from "../lib/trpc.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime } from "../lib/time.ts";
import { routeKmOf } from "../lib/convoy.ts";
import { Button, CountsLine } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import type { Target } from "../App.tsx";

type Convoy = Outputs["naval"]["view"]["convoys"][number];
type Counts = Record<string, number>;

const KIND: Record<string, string> = {
  boerse: "Börsenkonvoi", vertrag: "Vertragskonvoi", handel: "Handelskonvoi", transport: "Transport", feld: "Feldertrag",
};
const SIZE: Record<string, string> = { klein: "klein", mittel: "mittel", gross: "groß" };
const REL: Record<string, string> = { own: "eigener", krieg: "Kriegsgegner", allianz: "Allianz", pakt: "Paktpartner", neutral: "neutral" };

const resLine = (m: Counts | null | undefined) => {
  const parts = Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`);
  return parts.length > 0 ? parts.join(", ") : "nichts";
};

/** Überschrift eines Konvois (Art und Verhältnis). */
export function convoyTitle(c: Convoy): string {
  const kind = c.kind ? KIND[c.kind] ?? "Konvoi" : "Konvoi (gesichtet)";
  if (c.own) return kind;
  return c.enemy ? `Feindlicher ${kind}` : `Fremder ${kind}`;
}

/** Blatt zu einem Konvoi. */
export function ConvoyCard({ c, now, base, onPlan }: { c: Convoy; now: number; base?: BaseData; onPlan: (t: Target) => void }) {
  const last = c.events.at(-1);
  const route = c.route && c.route.length >= 2 ? c.route : null;
  return (
    <div className="flex items-start gap-2" data-convoy={c.id}>
      <Icon id="konvoi" size={22} />
      <div className="min-w-0 flex-1">
        <strong>{convoyTitle(c)}</strong>
        {c.relation && c.relation !== "own" && <span className="text-ink2"> · {REL[c.relation] ?? c.relation}</span>}
        {(c.sender || c.recipient) && (
          <span className="block">{c.sender ?? "?"} → {c.recipient ?? "?"}{c.recipientBase ? ` (${c.recipientBase})` : ""}</span>
        )}
        <span className="block">
          Ladung: {c.cargo ? resLine(c.cargo) : <>Größe {SIZE[c.size] ?? c.size} <span className="text-ink2">(genau erst mit Lagebild – Spionage im Zielhafen)</span></>}
        </span>
        <span className="block text-ink2">
          {c.escort ? (Object.keys(c.escort).length > 0 ? <>Geleit: <CountsLine counts={c.escort} /></> : "ohne Geleitschutz") : c.escorted === null ? "Geleit unbekannt" : c.escorted ? "mit Geleitschutz" : "ohne Geleitschutz"}
        </span>
        {c.arriveAtMs !== null && <span className="block">Ankunft in {fmtDuration(c.arriveAtMs - now)} ({fmtTime(c.arriveAtMs)})</span>}
        {route ? (
          <span className="block text-ink2">Route: Seeweg {fmtNum(Math.round(routeKmOf(route)))} km, {route.length} Wegpunkte, Feld {route[0][0]}/{route[0][1]} → {route[route.length - 1][0]}/{route[route.length - 1][1]}</span>
        ) : (
          <span className="block text-ink2">Kurs {c.heading}° · Feld {c.at.col}/{c.at.row}</span>
        )}
        {c.intel && <span className="block text-[11px] text-ink2">{c.intel.level === "sichtung" ? "Sichtung" : "Erkennung"} durch {c.intel.source}</span>}
        {last && <span className={`block ${last.escortHeld ? "text-moos" : "text-siegel"}`}>{last.by === "kartell" ? "Kartell" : last.by === "minen" ? "Minen" : last.name} griff an: {last.escortHeld ? "abgewehrt" : `verloren ${resLine(last.lost)}`}</span>}
        {c.enemy && <InterceptBox c={c} base={base} onPlan={onPlan} />}
      </div>
    </div>
  );
}

/** Abfangen (nur Kriegsgegner): Abfangpunkt und Ankunft mit allen Schiffen daheim, dann Missionsplanung. */
function InterceptBox({ c, base, onPlan }: { c: Convoy; base?: BaseData; onPlan: (t: Target) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const units: Counts = {};
  for (const u of base?.units ?? []) if (u.home > 0 && meta.data?.balance.units[u.id]?.branch === "see") units[u.id] = u.home;
  const any = Object.keys(units).length > 0;
  const q = useQuery({
    ...trpc.mission.preview.queryOptions({ type: "abfangen", units, col: c.at.col, row: c.at.row, convoyId: c.id }),
    enabled: any,
  });
  const p = q.data;
  return (
    <div className="mt-1 rounded-[3px] border border-siegel/60 bg-inset p-2">
      {!any ? <span className="block text-ink2">Keine Schiffe daheim zum Abfangen.</span>
        : !p ? <span className="block text-ink2">Abfangpunkt wird berechnet …</span>
          : p.ok && "intercept" in p && p.intercept ? (
            <span className="block">
              Abfangpunkt Feld {p.intercept.col}/{p.intercept.row} · Ankunft {fmtTime(p.arriveAtMs)} (alle Schiffe daheim)
              <span className="block text-ink2">{c.escorted ? "Mit Geleit: Seekampf gegen den Geleitschutz – erst bei Sieg Beute." : "Ohne Geleit: kampflos, Beute bis zum Laderaum."}</span>
            </span>
          ) : <span className="block text-siegel">{p.ok ? "Kein Abfangpunkt." : errorText(p.code)}</span>}
      <Button className="mt-1" onClick={() => onPlan({ col: c.at.col, row: c.at.row, convoyId: c.id })}>Abfangen</Button>
    </div>
  );
}
