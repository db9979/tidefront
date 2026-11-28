// Fortschrittszeile oben auf der Lage (UX 0.43, Entscheidung E-1a): „Platz 3 von 8 · 420 bis Platz 2 · Tag 5/42“,
// darunter die Serie der Tagesbefehle („Serie 4 Tage · morgen Bonus“, components/Daily.tsx). Antippen öffnet
// Meldungen → Saison. Daten: social.ranking (zwischengespeichert) und daily.get (ohnehin geladen).
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../../lib/trpc.ts";
import { fmtNum } from "../../lib/names.ts";
import { useNow } from "../../lib/time.ts";
import { useNav } from "../../lib/nav.ts";
import { Icon } from "../../icons.tsx";
import { useDaily } from "../Daily.tsx";
import { seasonDay } from "../Season.tsx";

export function useProgress() {
  const q = useQuery({ ...trpc.social.ranking.queryOptions(), refetchInterval: 5 * 60000 });
  const now = useNow(60000);
  const d = q.data;
  if (!d) return null;
  const rows = [...d.rows].sort((a, b) => a.rank - b.rank);
  const own = rows.find((r) => r.own);
  const above = own ? rows.filter((r) => r.rank < own.rank).at(-1) : undefined;
  return {
    rank: own?.rank ?? null,
    of: rows.length,
    gap: own && above ? Math.max(1, Math.ceil(above.total - own.total)) : null,
    aboveRank: above?.rank ?? null,
    day: d.season ? seasonDay(d.season, now) : null,
  };
}

/** Kurztext für Lage und Desktop-Kopf. */
export function progressText(p: NonNullable<ReturnType<typeof useProgress>>): string {
  const parts: string[] = [];
  if (p.rank !== null) parts.push(`Platz ${p.rank} von ${p.of}`);
  if (p.gap !== null && p.aboveRank !== null) parts.push(`${fmtNum(p.gap)} bis Platz ${p.aboveRank}`);
  else if (p.rank === 1) parts.push("an der Spitze");
  if (p.day) parts.push(`Tag ${p.day.day}/${p.day.days}`);
  return parts.join(" · ");
}

export function ProgressLine() {
  const nav = useNav();
  const p = useProgress();
  const daily = useDaily().data;
  if (!p || (p.rank === null && !p.day)) return null;
  const s = daily?.hasBase ? daily.streak : null;
  const bonusTomorrow = s && s.todayDone && s.nextMilestone === s.length + 1;
  const streak = s && s.length > 0
    ? `Serie ${s.length} ${s.length === 1 ? "Tag" : "Tage"}${bonusTomorrow ? " · morgen Bonus" : s.todayDone ? "" : " · heute noch offen"}`
    : null;
  return (
    <button type="button" data-testid="lage-progress" onClick={() => nav.go({ to: "meldungen", sub: "saison" })}
      className="tap w-full text-left flex items-center gap-2.5 px-1 py-1.5 mb-2 border-b border-dotted border-rule">
      <Icon id="hafenmeister" size={22} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold leading-snug">{progressText(p)}</span>
        {streak && <span className="block text-xs text-ink2 truncate" data-testid="lage-streak">{streak}</span>}
      </span>
      <span aria-hidden className="text-ink2">›</span>
    </button>
  );
}
