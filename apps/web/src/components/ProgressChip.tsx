// Fortschritts-Chip der Desktop-Kopfleiste (UX-0.43 E-1: am Desktop zusätzlich in der Kopfleiste):
// „Platz 3 von 8 · 420 bis Platz 2 · Tag 5/42“ aus der vorhandenen Ranglisten-Abfrage (social.ranking, gleicher Cache
// wie die Rangliste). Antippen öffnet die Saison (Meldungen → Saison bzw. Rangliste).
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { useNow } from "../lib/time.ts";

const DAY = 86400000;

export interface ProgressParts { rank: number; of: number; gap: number | null; day: number | null; days: number | null }

/** Platz, Abstand zum nächsten Platz und Saisontag aus der Rangliste; null ohne eigene Zeile. */
export function progressParts(
  d: { rows: { rank: number; total: number; own: boolean }[]; season: { startsAtMs: number; endsAtMs: number } | null },
  now: number,
): ProgressParts | null {
  const own = d.rows.find((r) => r.own);
  if (!own) return null;
  const ahead = d.rows.filter((r) => r.rank < own.rank).sort((a, b) => b.rank - a.rank)[0];
  const s = d.season;
  return {
    rank: own.rank,
    of: d.rows.length,
    gap: ahead ? Math.max(0, Math.ceil(ahead.total - own.total)) : null,
    day: s ? Math.min(Math.max(1, Math.floor((now - s.startsAtMs) / DAY) + 1), Math.round((s.endsAtMs - s.startsAtMs) / DAY)) : null,
    days: s ? Math.round((s.endsAtMs - s.startsAtMs) / DAY) : null,
  };
}

export function progressText(p: ProgressParts): string {
  const parts = [`Platz ${p.rank} von ${p.of}`];
  if (p.gap !== null && p.rank > 1) parts.push(`${fmtNum(p.gap)} bis Platz ${p.rank - 1}`);
  if (p.day !== null && p.days !== null) parts.push(`Tag ${p.day}/${p.days}`);
  return parts.join(" · ");
}

export function ProgressChip({ onOpen }: { onOpen: () => void }) {
  const q = useQuery({ ...trpc.social.ranking.queryOptions(), refetchInterval: 60000, staleTime: 30000 });
  const now = useNow(60000);
  const p = q.data ? progressParts(q.data, now) : null;
  if (!p) return null;
  const text = progressText(p);
  return (
    <button type="button" onClick={onOpen} data-testid="progress-chip" title="Saison öffnen"
      aria-label={`${text} – Saison öffnen`}
      className="tap shrink-0 self-center rounded-full border border-ink bg-card px-3 h-9 text-[13px] font-serif whitespace-nowrap flex items-center gap-1.5">
      <span aria-hidden className="font-display text-[11px] uppercase tracking-[0.1em] text-ink2">Saison</span>
      <span className="mono hidden xl:inline">{text}</span>
      <span className="mono xl:hidden">Platz {p.rank}/{p.of}{p.day !== null ? ` · Tag ${p.day}/${p.days}` : ""}</span>
    </button>
  );
}
