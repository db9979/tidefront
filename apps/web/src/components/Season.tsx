// Saison: Leiste (Saison N, verbleibende Zeit), Hinweis kurz vor Saisonende, Hinweis in der Hafenwahl.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Bar } from "../ui.tsx";

const DAY = 86400000;

export const AWARD_LABEL: Record<string, string> = {
  gold: "Gold", silber: "Silber", bronze: "Bronze",
  best_ausbau: "Bester Ausbau", best_militaer: "Stärkstes Militär", best_kampf: "Bester Kämpfer", best_beute: "Größte Beute",
  best_befehle: "Pflichtbewusstester Kapitän", best_oekostrom: "Grünster Hafen",
};
export const AWARD_MARK: Record<string, string> = { gold: "①", silber: "②", bronze: "③" };

export function awardTone(a: string): string {
  return a === "gold" ? "text-amber-300" : a === "silber" ? "text-slate-200" : a === "bronze" ? "text-orange-300" : "text-sea-300";
}

function remaining(endsAtMs: number, now: number): string {
  const ms = endsAtMs - now;
  if (ms <= 0) return "endet gleich";
  return `noch ${fmtDuration(ms)}`; // einheitlich: „noch 5 T 3 h“
}

/** Saisonleiste für die Rangliste. */
/** Saisontag (1-basiert) und Länge in Tagen (UX 0.43: „Tag 5/42“ statt eines leeren Balkens an Tag 1). */
export function seasonDay(season: { startsAtMs: number; endsAtMs: number }, now: number): { day: number; days: number } {
  const days = Math.max(1, Math.round((season.endsAtMs - season.startsAtMs) / DAY));
  return { day: Math.min(days, Math.max(1, Math.floor((now - season.startsAtMs) / DAY) + 1)), days };
}

export function SeasonBar({ season }: { season: { number: number; startsAtMs: number; endsAtMs: number } | null }) {
  const now = useNow(60000);
  if (!season) return null;
  const share = (now - season.startsAtMs) / Math.max(1, season.endsAtMs - season.startsAtMs);
  return (
    <div className="panel rounded-xl p-3 mb-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="font-serif text-lg">Saison {season.number} <span className="mono text-sm text-ink2" data-testid="season-day">· Tag {seasonDay(season, now).day}/{seasonDay(season, now).days}</span></span>
        <span className="text-xs text-slate-300 tabular-nums">
          {remaining(season.endsAtMs, now)} · Ende {new Date(season.endsAtMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
        </span>
      </div>
      <Bar value={share} tone={season.endsAtMs - now < 3 * DAY ? "red" : "sea"} />
    </div>
  );
}

/** Hinweis auf der Basis, wenn weniger als drei Tage der Saison bleiben. */
export function SeasonEndBanner({ onOpen }: { onOpen: () => void }) {
  const q = useQuery({ ...trpc.season.current.queryOptions(), staleTime: 60000 });
  const now = useNow(60000);
  const s = q.data?.season;
  if (!s || s.endsAtMs - now >= 3 * DAY) return null;
  return (
    <button type="button" onClick={onOpen} className="tap w-full text-left rounded-xl p-3 mb-3 border border-siegel border-l-4 bg-red-950 text-sm">
      <strong>Saison {s.number} endet {remaining(s.endsAtMs, now).replace("noch ", "in ")}.</strong>{" "}
      <span className="text-slate-300">Danach wird die Welt zurückgesetzt. Zur Saison →</span>
    </button>
  );
}

/** Hinweis in der Hafenwahl nach einem Saisonwechsel: neue Saison und eigener Platz der Vorsaison. */
export function NewSeasonNotice() {
  const q = useQuery(trpc.season.current.queryOptions());
  const d = q.data;
  if (!d?.season || !d.lastSeason || d.lastSeason.number !== d.season.number - 1) return null;
  const r = d.lastResult;
  if (!r && d.serverNow - d.season.startsAtMs > 3 * DAY) return null;
  return (
    <div className="mt-2 rounded-lg border border-see/50 bg-paper p-2 text-xs text-ink" role="status">
      <strong className="text-sea-300">Saison {d.season.number} hat begonnen.</strong>{" "}
      {r ? (
        <>Dein Platz in Saison {r.seasonNumber}: <strong className="tabular-nums">{r.rank} von {r.of}</strong> ({r.total} Punkte)
          {r.awards.length > 0 && <> · {r.awards.map((a) => AWARD_LABEL[a] ?? a).join(", ")}</>}.</>
      ) : (
        <>Die Welt ist neu – wähle deinen Hafen.</>
      )}
    </div>
  );
}
