// Wochenziele: drei größere Ziele je Woche (Montag 0:00 Uhr bis Sonntag) mit Fortschritt, Belohnung und Abholen;
// Wochenbonus bei allen dreien. Kompakte Karte auf der Basis unter den Tagesbefehlen.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Badge, Bar, ErrorLine, ResChips } from "../ui.tsx";
import { RewardClaim, lostNote, type RewardStorage } from "./RewardClaim.tsx";

type Weekly = Outputs["achievements"]["weekly"];
type Goal = Weekly["goals"][number];

const invalidate = () => [trpc.achievements.pathFilter().queryKey, trpc.base.pathFilter().queryKey];

/** Wochenziele des Spielers; auch für den Zähler an der Navigation nutzbar. */
export function useWeekly(enabled = true) {
  return useQuery({ ...trpc.achievements.weekly.queryOptions(), enabled, refetchInterval: 120000 });
}

/** onExpandStorage: Weg zum Lagerkomplex (im Blatt: erst schließen); sonst App-Navigation. */
export function WeeklyGoals({ onExpandStorage }: { onExpandStorage?: () => void } = {}) {
  const q = useWeekly();
  const now = useNow();
  const [note, setNote] = useState<string | null>(null);
  const claim = useCommand((i: { key: string; id: number }) => trpcClient.achievements.claimWeekly.mutate(i), invalidate);
  const w = q.data;
  const expired = !!w && now >= w.nextWeekAtMs;
  const { refetch } = q;
  useEffect(() => {
    if (expired) void refetch();
  }, [expired, refetch]);
  if (!w || !w.hasBase) return null;

  const onClaim = async (g: Goal) => {
    setNote(null);
    const r = await claim.run({ id: g.id });
    if (r?.ok) setNote((r.bonus ? "Belohnung abgeholt – und der Wochenbonus für alle drei Ziele!" : "Belohnung abgeholt.") + lostNote(r.lost));
  };
  const doneCount = w.goals.filter((g) => g.claimed).length;
  // Wochenbonus kommt mit dem letzten noch offenen Ziel dieser Woche (wie claimWeekly auf dem Server).
  const bonusWith = (g: Goal) => !w.bonus.paid && g.week === w.week && w.goals.length >= 3 && w.goals.every((x) => x.claimed || x.id === g.id);

  return (
    <section className="panel rounded-xl p-3.5 mb-3" aria-label="Wochenziele">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2">Wochenziele</h2>
        <span className="text-xs text-slate-400 mono flex items-center gap-1" title="Neue Ziele am Montag um 0:00 Uhr">
          <Icon id="uhr" size={14} /> neu in {fmtDuration(w.nextWeekAtMs - now)}
        </span>
      </div>

      <ol className="divide-y divide-navy-700">
        {[...w.goals, ...w.older].map((g) => <GoalItem key={g.id} g={g} busy={claim.busy} older={g.week !== w.week}
          storage={w.storage} bonus={bonusWith(g) ? w.bonus.reward : null} onExpand={onExpandStorage} onClaim={() => void onClaim(g)} />)}
      </ol>

      <div className="mt-2 pt-2 border-t border-dotted border-rule text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-serif text-[15px] whitespace-nowrap">Wochenbonus</span>
        {w.bonus.paid ? <Badge tone="green">erhalten</Badge> : <span className="text-ink2">alle drei abholen ({doneCount}/3):</span>}
        {!w.bonus.paid && <ResChips values={w.bonus.reward} />}
      </div>
      {note && <p className="text-sm text-moos mt-2" role="status">{note}</p>}
      <ErrorLine text={claim.error} code={claim.code} />
    </section>
  );
}

function GoalItem({ g, busy, older, storage, bonus, onExpand, onClaim }: {
  g: Goal; busy: boolean; older: boolean; storage: RewardStorage; bonus: Record<string, number> | null; onExpand?: () => void; onClaim: () => void;
}) {
  return (
    <li className="py-2 flex gap-3">
      <IconTile id={g.icon} size={40} tone={g.done ? "land" : "gebaeude"} />
      <div className="flex-1 min-w-0">
        {older && <div className="text-[11px] text-ink2">Woche ab {g.week.slice(8, 10)}.{g.week.slice(5, 7)}.</div>}
        <div className={`font-serif text-[15px] leading-tight ${g.claimed ? "text-slate-400 line-through" : ""}`}>{g.text}</div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1"><Bar value={g.target > 0 ? g.progress / g.target : 0} tone={g.done ? "green" : "brass"} /></div>
          <span className="text-[11px] mono text-ink2 shrink-0">{fmtNum(g.progress)}/{fmtNum(g.target)}</span>
        </div>
        <div className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ResChips values={g.reward} />
        </div>
        {g.done && !g.claimed && <RewardClaim storage={storage} rewards={[g.reward, bonus]} busy={busy} onClaim={onClaim} onExpand={onExpand} />}
        {g.claimed && <div className="mt-1"><Badge tone="green">abgeholt</Badge></div>}
      </div>
    </li>
  );
}
