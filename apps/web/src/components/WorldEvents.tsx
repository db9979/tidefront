// Weltereignisse des Kartells: Info-Blatt auf der Karte, Banner auf der Basis, Zusatz im Kampfbericht.
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Button, Card, CountsLine } from "../ui.tsx";

export type WorldEventsData = Outputs["worldEvents"]["list"];
export type WorldEventInfo = WorldEventsData["events"][number];

export const KIND_TITLE: Record<string, string> = { schatzschiff: "Schatzschiff", grossflotte: "Großflotte", belagerung: "Belagerungsring" };
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
  return `Sperrt Börsenkäufe und drosselt die Produktion um ${Math.round((e.siege?.penalty ?? 0.3) * 100)} %. Andere Spieler brechen den Ring mit einem Überfall; Beute anteilig zum Schaden.`;
}

/** Info-Blatt (Kartenpanel): Besatzung, Restzeit, Belohnung, Beteiligte, Knopf „Mission planen“. */
export function WorldEventCard({ e, onPlan }: { e: WorldEventInfo; onPlan: () => void }) {
  const now = useNow();
  const ended = e.status === "ended";
  const ownSiege = e.siege?.own ?? false;
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
      {!ended && !ownSiege && <Button className="w-full mt-2" onClick={onPlan}>Mission planen</Button>}
      {ownSiege && <p className="text-xs text-siegel mt-2">Dein eigener Hafen – nur andere Spieler können den Ring brechen.</p>}
    </div>
  );
}

/** Banner auf der Basis: eigener Hafen belagert oder Ereignis in der Nähe. */
export function WorldEventBanner({ onMap }: { onMap: () => void }) {
  const q = useWorldEvents();
  const now = useNow();
  if (!q.data) return null;
  const { ownSiege, nearby, events } = q.data;
  const near = events.filter((e) => nearby.includes(e.id) && !(e.siege?.own));
  if (!ownSiege && near.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {ownSiege && (
        <div className="rounded-xl bg-red-950 border border-siegel border-l-4 p-3 text-sm" role="alert">
          <strong className="text-siegel uppercase font-display text-xs">Belagerungsring vor deinem Hafen</strong>
          <div className="font-serif text-lg leading-tight">noch <span className="mono">{fmtDuration(ownSiege.endsAtMs - now)}</span></div>
          <div className="text-xs text-ink2">Keine Börsenkäufe, Produktion −{Math.round((1 - ownSiege.productionFactor) * 100)} %. Bitte Mitspieler, den Ring zu brechen.</div>
        </div>
      )}
      {near.map((e) => (
        <button key={e.id} type="button" onClick={onMap} className="tap w-full text-left rounded-xl bg-card border border-siegel border-l-4 p-3 text-sm">
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
