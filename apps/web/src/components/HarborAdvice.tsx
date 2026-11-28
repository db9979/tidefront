// Basis → Hafen „Empfohlen als Nächstes“ (UX 0.43, B5 / H-1): bis zu drei Bauvorschläge mit Begründung über dem
// Bauhof (dieselbe Empfehlung wie „Nächster Schritt“ auf der Lage: lage.get → advice, game-core/build-advice.ts).
// Antippen öffnet das Gebäudeblatt. Die grüne Raute auf den Kacheln markiert nur noch diese Empfehlungen.
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { adviceReason } from "./lage/NextStep.tsx";

/** Empfohlene Gebäude des aktiven Hafens (für die Raute auf den Kacheln). */
export function useHarborAdvice(base: BaseData) {
  const q = useQuery({ ...trpc.lage.get.queryOptions(), refetchInterval: 60000 });
  return q.data?.advice.find((a) => a.baseId === base.id)?.options ?? [];
}

export function HarborAdvice({ base, onOpen }: { base: BaseData; onOpen: (id: string) => void }) {
  const options = useHarborAdvice(base);
  if (options.length === 0) return null;
  return (
    <section className="panel rounded-xl p-3 mb-3" aria-label="Empfohlen" data-testid="harbor-advice">
      <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2 mb-1 flex items-center gap-1.5">
        <span className="diamond bg-moos" aria-hidden /> Empfohlen als Nächstes
      </h2>
      <ul>
        {options.map((o) => {
          const missing = Object.entries(o.missing).filter(([, n]) => n > 0);
          return (
            <li key={o.buildingId} className="border-b border-dotted border-rule last:border-b-0">
              <button type="button" className="tap w-full flex items-center gap-2.5 py-1.5 text-left" onClick={() => onOpen(o.buildingId)}>
                <Icon id={o.buildingId} size={28} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm"><strong className="font-semibold">{label(o.buildingId)} {o.level}</strong> <span className="text-ink2">· {adviceReason(o)}</span></span>
                  <span className="block text-xs text-ink2 truncate">{fmtDuration(o.durationMs)}{missing.length > 0 ? ` · fehlt ${missing.map(([r, n]) => `${fmtNum(n)} ${label(r)}`).join(", ")}` : " · bezahlbar"}</span>
                </span>
                <span aria-hidden className="text-ink2">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
