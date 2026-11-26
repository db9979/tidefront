// Saison: Leiste (Saison N, verbleibende Zeit), Hinweis kurz vor Saisonende, Hinweis in der Hafenwahl.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Bar } from "../ui.tsx";

const DAY = 86400000;

export const AWARD_LABEL: Record<string, string> = {
  gold: "Gold", silber: "Silber", bronze: "Bronze",
  best_ausbau: "Bester Ausbau", best_militaer: "Stärkstes Militär", best_kampf: "Bester Kämpfer", best_beute: "Größte Beute",
};
export const AWARD_MARK: Record<string, string> = { gold: "①", silber: "②", bronze: "③" };

export function awardTone(a: string): string {
  return a === "gold" ? "text-amber-300" : a === "silber" ? "text-slate-200" : a === "bronze" ? "text-orange-300" : "text-sea-300";
}

function remaining(endsAtMs: number, now: number): string {
  const ms = endsAtMs - now;
  if (ms <= 0) return "endet gleich";
  const days = Math.floor(ms / DAY);
  return days >= 2 ? `noch ${days} Tage` : `noch ${fmtDuration(ms)}`;
}

/** Saisonleiste für die Rangliste. */
export function SeasonBar({ season }: { season: { number: number; startsAtMs: number; endsAtMs: number } | null }) {
  const now = useNow(60000);
  if (!season) return null;
  const share = (now - season.startsAtMs) / Math.max(1, season.endsAtMs - season.startsAtMs);
  return (
    <div className="panel rounded-2xl p-3 mb-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="font-display font-bold uppercase text-sm">Saison {season.number}</span>
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
    <button type="button" onClick={onOpen} className="tap w-full text-left rounded-2xl p-3 mb-3 border border-red-500/60 bg-red-950/60 text-sm">
      <strong>Saison {s.number} endet {remaining(s.endsAtMs, now).replace("noch ", "in ")}.</strong>{" "}
      <span className="text-slate-300">Danach wird die Welt zurückgesetzt. Zur Rangliste →</span>
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
    <div className="mt-2 rounded-lg border border-sea-400/50 bg-navy-950/70 p-2 text-xs text-slate-200" role="status">
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
