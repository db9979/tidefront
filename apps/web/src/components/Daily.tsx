// Tagesbefehle: drei Befehle des Tages (leicht, mittel, schwer) mit Fortschritt, Belohnung, Abholen,
// einmal täglich neu würfeln, Countdown bis zum Tageswechsel und Serienanzeige. Liegt auf der Basis.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { IconTile, Icon } from "../icons.tsx";
import { Badge, Bar, Button, ErrorLine, ResChips } from "../ui.tsx";

type Daily = Outputs["daily"]["get"];
type Challenge = Daily["challenges"][number];

const TIER_TONE: Record<string, "green" | "sea" | "red"> = { leicht: "green", mittel: "sea", schwer: "red" };
const invalidate = () => [trpc.daily.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.social.ranking.pathFilter().queryKey];

/** Tagesbefehle des Spielers; auch für den Zähler an der Navigation genutzt. */
export function useDaily(enabled = true) {
  return useQuery({ ...trpc.daily.get.queryOptions(), enabled, refetchInterval: 60000 });
}

export function DailyOrders() {
  const q = useDaily();
  const now = useNow();
  const [note, setNote] = useState<string | null>(null);
  const claim = useCommand((i: { key: string; id: number }) => trpcClient.daily.claim.mutate(i), invalidate);
  const reroll = useCommand((i: { key: string; slot: number }) => trpcClient.daily.reroll.mutate(i), invalidate);
  const d = q.data;
  // Tageswechsel: neue Befehle laden.
  const expired = !!d && now >= d.nextDayAtMs;
  const { refetch } = q;
  useEffect(() => {
    if (expired) void refetch();
  }, [expired, refetch]);
  if (!d || !d.hasBase) return null;

  const onClaim = async (c: Challenge) => {
    setNote(null);
    const r = await claim.run({ id: c.id });
    if (r?.ok) {
      const parts = [`Belohnung abgeholt: +${r.points} Punkte.`];
      if (r.streak) parts.push(`Tag ${r.streak} der Serie.`);
      if (r.bonus) parts.push(`Serienbonus: +${r.bonus.points} Punkte und Nachschub.`);
      setNote(parts.join(" "));
    }
  };

  const s = d.streak;
  const busy = claim.busy || reroll.busy;
  return (
    <section className="panel rounded-xl p-3.5 mb-3" aria-label="Tagesbefehle">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2">Tagesbefehle</h2>
        <span className="text-xs text-slate-400 mono flex items-center gap-1" title="Neue Befehle um 0:00 Uhr">
          <Icon id="uhr" size={14} /> neu in {fmtDuration(d.nextDayAtMs - now)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mb-2 pb-2 border-b border-dotted border-rule">
        <span className="font-serif text-[17px] leading-none whitespace-nowrap">Serie {s.length} {s.length === 1 ? "Tag" : "Tage"}</span>
        {s.todayDone && <Badge tone="green">heute erfüllt</Badge>}
        <span className="text-xs text-ink2 ml-auto text-right whitespace-nowrap">
          Bonus an Tag {s.nextMilestone}: +{s.nextBonusPoints} Punkte
        </span>
      </div>

      <ol className="divide-y divide-navy-700">
        {d.challenges.map((c) => (
          <ChallengeItem
            key={c.id}
            c={c}
            busy={busy}
            canReroll={d.rerollAvailable && !c.done}
            onClaim={() => void onClaim(c)}
            onReroll={() => { setNote(null); void reroll.run({ slot: c.slot }); }}
          />
        ))}
      </ol>

      {d.older.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dotted border-rule">
          <div className="text-[11px] uppercase tracking-wider text-ink2 mb-1">Noch abzuholen</div>
          <ol className="divide-y divide-navy-700">
            {d.older.map((c) => (
              <ChallengeItem key={c.id} c={c} busy={busy} canReroll={false} onClaim={() => void onClaim(c)} onReroll={() => {}} older />
            ))}
          </ol>
        </div>
      )}

      {note && <p className="text-sm text-moos mt-2" role="status">{note}</p>}
      <ErrorLine text={claim.error ?? reroll.error} code={claim.error ? claim.code : reroll.code} />
      <p className="text-[11px] text-slate-500 mt-2">
        Befehle in dieser Saison: <span className="mono">{fmtNum(d.seasonPoints)}</span> Punkte.
        {d.rerollAvailable ? " Einen offenen Befehl darfst du heute neu würfeln." : ""}
      </p>
    </section>
  );
}

function ChallengeItem(props: { c: Challenge; busy: boolean; canReroll: boolean; onClaim: () => void; onReroll: () => void; older?: boolean }) {
  const { c } = props;
  return (
    <li className="py-2 flex gap-3">
      <IconTile id={c.icon} size={44} tone={c.done ? "land" : "gebaeude"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Badge tone={TIER_TONE[c.tier] ?? "slate"}>{c.tier}</Badge>
          {props.older && <span className="text-[11px] text-ink2">vom {c.day.slice(8, 10)}.{c.day.slice(5, 7)}.</span>}
          {c.rerolled && <span className="text-[11px] text-ink2">neu gewürfelt</span>}
        </div>
        <div className={`font-serif text-[15.5px] leading-tight ${c.claimed ? "text-slate-400 line-through" : ""}`}>{c.text}</div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1"><Bar value={c.target > 0 ? c.progress / c.target : 0} tone={c.done ? "green" : "brass"} /></div>
          <span className="text-[11px] mono text-ink2 shrink-0">{fmtNum(c.progress)}/{fmtNum(c.target)}</span>
        </div>
        <div className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <ResChips values={c.reward} />
          <span className="mono text-messing">+{c.points + c.bonusPoints} Pkt.</span>
        </div>
        <div className="mt-1.5 flex gap-2">
          {c.done && !c.claimed && <Button className="flex-1" disabled={props.busy} onClick={props.onClaim}>Abholen</Button>}
          {c.claimed && <Badge tone="green">abgeholt</Badge>}
          {props.canReroll && (
            <Button kind="ghost" className="px-3" disabled={props.busy} onClick={props.onReroll}>Neu würfeln</Button>
          )}
        </div>
      </div>
    </li>
  );
}
