// Weltereignisse des Kartells: Info-Blatt auf der Karte, Banner auf der Basis, Zusatz im Kampfbericht.
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Button, Card, CountsLine } from "../ui.tsx";
import { FinaleBanner, FinaleCard } from "./Finale.tsx";

export type WorldEventsData = Outputs["worldEvents"]["list"];
export type WorldEventInfo = WorldEventsData["events"][number];

export const KIND_TITLE: Record<string, string> = { schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerungsring", finale: "Kartell-Armada" };
const OUTCOME: Record<string, string> = {
  defeated: "besiegt", escaped: "entkommen", expired: "abgezogen", withdrawn: "abgezogen", test: "beendet",
};

export function useWorldEvents(enabled = true) {
  return useQuery({ ...trpc.worldEvents.list.queryOptions(), enabled, refetchInterval: 60000 });
}

function resLine(m: Record<string, number>): string {
  const parts = Object.entries(m).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`);
  return parts.length > 0 ? parts.join(", ") : "–";
}

/** Was das Ereignis tut, in einem Satz. */
function blurb(e: WorldEventInfo): string {
  if (e.kind === "schatzschiff") return "Läuft in einen Kartellhafen ein. Nur der erste Verband, der den Begleitschutz versenkt, erhält die Beute – der Abfangpunkt wird beim Planen berechnet.";
  if (e.kind === "grossflotte") {
    return e.status === "announced"
      ? "Sammelt sich und greift danach nacheinander die Häfen der Region an. Jeder Angriff auf See schwächt sie dauerhaft; Beute anteilig zum Schaden."
      : "Greift die Häfen der Region an. Angriffe auf See schwächen sie weiter; Beute anteilig zum Schaden.";
  }
  return `Sperrt Börsenkäufe und drosselt die Produktion um ${Math.round((e.siege?.penalty ?? 0.3) * 100)} %. Andere Spieler – oder der Besitzer aus einem anderen eigenen Hafen – brechen den Ring mit einem Überfall; Beute anteilig zum Schaden.`;
}

/** Info-Blatt (Kartenpanel): Besatzung, Restzeit, Belohnung, Beteiligte, Knopf „Mission planen“. */
export function WorldEventCard({ e, onPlan }: { e: WorldEventInfo; onPlan: () => void }) {
  if (e.finale) return <FinaleCard e={e} onPlan={onPlan} />; // Saisonfinale
  return <EventCard e={e} onPlan={onPlan} />;
}

function EventCard({ e, onPlan }: { e: WorldEventInfo; onPlan: () => void }) {
  const now = useNow();
  const ended = e.status === "ended";
  const ownSiege = e.siege?.own ?? false;
  // Mehrere Häfen: aus dem belagerten Hafen selbst nicht, aus einem anderen eigenen Hafen schon.
  const ownHere = e.siege?.ownHere ?? false;
  const time = ended ? null
    : e.status === "announced" ? `läuft aus in ${fmtDuration(e.activeAtMs - now)}`
    : e.kind === "grossflotte" ? "greift an" : `noch ${fmtDuration(e.endsAtMs - now)}`;
  return (
    <div className="mt-1">
      <div className="font-serif text-[19px] leading-tight">
        {KIND_TITLE[e.kind]}{e.siege ? ` vor ${e.siege.name}` : ""}
        <em className="block text-[13px] text-siegel">{ended ? `${OUTCOME[e.outcome ?? ""] ?? "beendet"}${e.winner ? ` – ${e.winner}` : ""}` : time}</em>
      </div>
      <p className="text-xs text-ink2 mt-1">{blurb(e)}</p>
      <div className="text-xs mt-1 space-y-0.5">
        <div><span className="text-ink2">Besatzung: </span><CountsLine counts={e.units} />
          {Object.keys(e.initialUnits).some((k) => (e.initialUnits[k] ?? 0) > (e.units[k] ?? 0)) && <span className="text-ink2"> (anfangs <CountsLine counts={e.initialUnits} />)</span>}
        </div>
        <div><span className="text-ink2">{e.kind === "schatzschiff" ? "Beute: " : "Beutepool: "}</span><span className="text-moos">{resLine(e.reward)}</span></div>
        {e.targets.length > 0 && (
          <div><span className="text-ink2">Ziele: </span>{e.targets.map((t) => `${t.name}${t.own ? " (du)" : ""}${t.status === "attacked" ? " ✓" : t.status === "skipped" ? " (geschützt)" : ""}`).join(" → ")}</div>
        )}
        {e.contributors.length > 0 && (
          <div><span className="text-ink2">Beteiligte: </span>{e.contributors.map((c) => `${c.name}${c.own ? " (du)" : ""} ${fmtNum(c.hp)} LP`).join(", ")}</div>
        )}
        {e.distanceKm !== null && <div className="text-ink2">Entfernung zu deinem Hafen etwa {fmtNum(e.distanceKm)} km</div>}
      </div>
      {!ended && !ownHere && <Button className="w-full mt-2" onClick={onPlan}>Mission planen</Button>}
      {!ended && ownHere && <p className="text-xs text-siegel mt-2">Dein eigener Hafen – aus ihm selbst kannst du den Ring nicht brechen. Wechsle in einen anderen deiner Häfen oder bitte Mitspieler um Hilfe.</p>}
      {!ended && ownSiege && !ownHere && <p className="text-xs text-ink2 mt-2">Dein eigener Hafen – du greifst aus einem anderen deiner Häfen an.</p>}
    </div>
  );
}

/** Banner auf der Basis: eigener Hafen belagert oder Ereignis in der Nähe. */
/** onMap: Karte auf das Ereignis zentrieren und sein Blatt öffnen (TST-07). */
export function WorldEventBanner({ onMap }: { onMap: (t: { col: number; row: number; eventId: number }) => void }) {
  const q = useWorldEvents();
  const now = useNow();
  if (!q.data) return null;
  const { ownSiege, nearby, events } = q.data;
  const near = events.filter((e) => nearby.includes(e.id) && !(e.siege?.own) && !e.finale);
  const finale = events.find((e) => e.finale && e.status !== "ended"); // Saisonfinale: Banner für alle
  if (!ownSiege && near.length === 0 && !finale) return null;
  return (
    <div className="mb-3 space-y-2">
      {ownSiege && (
        <div className="rounded-xl bg-red-950 border border-siegel border-l-4 p-3 text-sm" role="alert">
          <strong className="text-siegel uppercase font-display text-xs">Belagerungsring vor deinem Hafen</strong>
          <div className="font-serif text-lg leading-tight">noch <span className="mono">{fmtDuration(ownSiege.endsAtMs - now)}</span></div>
          <div className="text-xs text-ink2">Keine Börsenkäufe, Produktion −{Math.round((1 - ownSiege.productionFactor) * 100)} %. Brich den Ring aus einem anderen deiner Häfen oder bitte Mitspieler um Hilfe.</div>
        </div>
      )}
      {finale && <FinaleBanner e={finale} onMap={() => onMap({ col: finale.col, row: finale.row, eventId: finale.id })} />}
      {near.map((e) => (
        <button key={e.id} type="button" onClick={() => onMap({ col: e.col, row: e.row, eventId: e.id })} className="tap w-full text-left rounded-xl bg-card border border-siegel border-l-4 p-3 text-sm">
          <strong className="text-siegel uppercase font-display text-xs">Weltereignis in der Nähe: {KIND_TITLE[e.kind]}</strong>
          <div className="text-xs text-ink2">
            {e.targets.some((t) => t.own) ? "Dein Hafen ist ein Ziel der Großflotte. " : ""}
            {e.status === "announced" ? `Läuft aus in ${fmtDuration(e.activeAtMs - now)}.` : e.kind === "grossflotte" ? "Greift an." : `Noch ${fmtDuration(e.endsAtMs - now)}.`}
            {" "}Beute: {resLine(e.reward)} · auf der Karte zeigen
          </div>
        </button>
      ))}
    </div>
  );
}

/** Zusatz im Kampfbericht gegen ein Ereignis. */
export function WorldEventReportNote({ kind, data }: { kind: string; data: Record<string, unknown> }) {
  const we = data.worldEvent as { kind?: string; destroyed?: boolean; destroyedHp?: number; initialHp?: number; remaining?: Record<string, number> } | undefined;
  if (kind === "weltereignis_leer") return <Card title="Weltereignis"><p>{String(data.text ?? "Bei Ankunft war niemand mehr da.")} Der Verband kehrt um.</p></Card>;
  if (!we) return null;
  if (we.kind === "finale") return <FinaleReportNote we={we as FinaleNote} />; // Saisonfinale
  const share = we.initialHp ? Math.round(((we.destroyedHp ?? 0) / we.initialHp) * 100) : 0;
  return (
    <Card title={KIND_TITLE[we.kind ?? ""] ?? "Weltereignis"}>
      <p className="text-sm">
        {we.destroyed ? "Der Kartellverband ist vernichtet." : <>Verbleibend: <CountsLine counts={we.remaining} />.</>}
        {we.destroyedHp !== undefined && ` Dein Schaden: ${fmtNum(we.destroyedHp)} Lebenspunkte (${share} % der Anfangsstärke).`}
      </p>
      <p className="text-xs text-ink2 mt-1">Auf See ertrinkt die Miliz mit ihren Booten. Beute: {we.kind === "schatzschiff" ? "nur für den ersten Sieger" : "anteilig zum Schaden"}, begrenzt durch den Laderaum.</p>
    </Card>
  );
}

type FinaleNote = { destroyed?: boolean; sectorDestroyed?: boolean; destroyedHp?: number; initialHp?: number; remaining?: Record<string, number>; sector?: Record<string, number>; flagship?: boolean; treasure?: Record<string, number> };

/** Saisonfinale im Kampfbericht: Abschnitt, Schaden, Rest der Armada, Schatz. */
function FinaleReportNote({ we }: { we: FinaleNote }) {
  const share = we.initialHp ? Math.round(((we.destroyedHp ?? 0) / we.initialHp) * 1000) / 10 : 0;
  return (
    <Card title="Saisonfinale: Kartell-Armada">
      <p className="text-sm">
        {we.flagship ? "Abschnitt: das Flaggschiff „Leviathan“" : <>Abschnitt: <CountsLine counts={we.sector} /></>}.
        {we.destroyedHp !== undefined && ` Dein Schaden: ${fmtNum(we.destroyedHp)} Lebenspunkte (${share.toLocaleString("de-DE")} % der Armada).`}
        {we.destroyed ? " Der Leviathan ist versenkt!" : <> Verbleibend: <CountsLine counts={we.remaining} />.</>}
      </p>
      {we.treasure && <p className="text-sm text-moos mt-1">Schatz des Leviathan: {resLine(we.treasure)}</p>}
      <p className="text-xs text-ink2 mt-1">Beute ohne Laderaumgrenze, gutgeschrieben bei der Heimkehr. Kampfpunkte aus Armada-Kämpfen zählen zur Hälfte.</p>
    </Card>
  );
}
