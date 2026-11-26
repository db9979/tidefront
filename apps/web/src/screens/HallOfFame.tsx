// Ruhmeshalle: vergangene Saisons mit Podium, Kategoriebesten und eigenem Ergebnis.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { Card } from "../ui.tsx";
import { AWARD_LABEL, AWARD_MARK, awardTone } from "../components/Season.tsx";

const BEST = ["best_ausbau", "best_militaer", "best_kampf", "best_beute"] as const;

export function HallOfFame() {
  const q = useQuery({ ...trpc.season.hall.queryOptions(), staleTime: 300000 });
  const seasons = q.data ?? [];
  return (
    <Card title="Ruhmeshalle">
      {seasons.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Saison beendet. Am Saisonende werden hier Sieger und Auszeichnungen festgehalten.</p>
      ) : (
        <ul className="space-y-3">
          {seasons.map((s) => (
            <li key={s.number} className="rounded-xl bg-navy-950/50 border border-navy-600 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <strong className="font-serif text-base">Saison {s.number}</strong>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {new Date(s.startsAtMs).toLocaleDateString("de-DE")} – {new Date(s.finishedAtMs).toLocaleDateString("de-DE")} · {s.players} Spieler
                </span>
              </div>
              {s.podium.length === 0 ? <p className="text-xs text-slate-400">Keine Wertung.</p> : (
                <ol className="text-sm space-y-0.5 mb-2">
                  {s.podium.map((p) => {
                    const medal = p.awards.find((a) => AWARD_MARK[a]) ?? "";
                    return (
                      <li key={p.playerId} className="flex items-center gap-2">
                        <span className={`w-5 text-center ${awardTone(medal)}`}>{AWARD_MARK[medal] ?? p.rank}</span>
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="font-mono tabular-nums text-slate-300">{fmtNum(p.total)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {BEST.map((b) => (
                  <div key={b} className="contents">
                    <dt className="text-slate-400">{AWARD_LABEL[b]}</dt>
                    <dd className="text-right truncate">{s.best[b] ? `${s.best[b]!.name} (${fmtNum(s.best[b]!.value)})` : "–"}</dd>
                  </div>
                ))}
              </dl>
              {s.own && (
                <div className="mt-2 pt-2 border-t border-navy-600 text-xs">
                  <span className="text-slate-400">Du: </span>
                  <strong className="tabular-nums">Platz {s.own.rank}</strong>
                  <span className="text-slate-400 tabular-nums"> · {fmtNum(s.own.total)} Punkte</span>
                  {s.own.awards.length > 0 && (
                    <span> · {s.own.awards.map((a) => <span key={a} className={`${awardTone(a)} mr-1`}>{AWARD_LABEL[a] ?? a}</span>)}</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
