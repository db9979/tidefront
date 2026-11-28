// Untere Einträge der Desktop-Leiste (UX-0.43 B4/X-2): Saison, Handbuch, Einstellungen, Verwaltung (nur Admins).
// Gleiche Bauform wie die Reiter darüber; die gerade offene Ansicht trägt aria-current.
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc.ts";
import { Icon } from "../icons.tsx";

export type RailItem = "saison" | "handbuch" | "settings" | "admin";

function Entry({ id, label, icon, mark, current, onPick, keys }: { id: RailItem; label: string; icon?: string; mark?: string; current: boolean; onPick: (i: RailItem) => void; keys?: string }) {
  return (
    <button type="button" onClick={() => onPick(id)} data-testid={`rail-${id}`} aria-current={current ? "page" : undefined}
      title={keys ? `${label} (Taste ${keys})` : label} aria-keyshortcuts={keys}
      className={`tap relative flex flex-col items-center justify-center text-[10px] tracking-[-0.01em] leading-tight py-2 px-0.5 ${current ? "text-ink font-semibold" : "text-ink2"}`}>
      {current && <span className="absolute -right-[3px] inset-y-[18%] w-[3px] bg-siegel" />}
      {icon ? <Icon id={icon} size={22} /> : <span aria-hidden className="w-[22px] h-[22px] grid place-items-center font-serif text-lg leading-none">{mark}</span>}
      <span className="mt-0.5 whitespace-nowrap">{label}</span>
    </button>
  );
}

export function RailFooter({ current, onPick }: { current: RailItem | null; onPick: (i: RailItem) => void }) {
  const me = useQuery(trpc.auth.me.queryOptions());
  return (
    <div className="mt-auto flex flex-col gap-0.5 pt-2 pb-2 border-t border-rule" role="group" aria-label="Weitere Ansichten">
      <Entry id="saison" label="Saison" mark="⚑" current={current === "saison"} onPick={onPick} />
      <Entry id="handbuch" label="Handbuch" mark="?" current={current === "handbuch"} onPick={onPick} keys="?" />
      <Entry id="settings" label="Einstellungen" icon="zahnrad" current={current === "settings"} onPick={onPick} keys="," />
      {me.data?.player?.isAdmin && <Entry id="admin" label="Verwaltung" mark="§" current={current === "admin"} onPick={onPick} />}
    </div>
  );
}
