// Rangliste der laufenden Saison mit Spielerübersicht und Detail-Blatt; darunter die Ruhmeshalle.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Badge, Button, Card, Loading, Sheet, StatTable } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { SeasonBar } from "../components/Season.tsx";
import { HallOfFame } from "./HallOfFame.tsx";
import { InvitePanel } from "../components/Invite.tsx";
import type { Draft } from "./Messages.tsx";
import type { Target } from "../App.tsx";

type Row = Outputs["social"]["ranking"]["rows"][number];
type Sort = "total" | "ausbau" | "militaer" | "kampf" | "beute" | "befehle";

const SORTS: { id: Sort; label: string }[] = [
  { id: "total", label: "Gesamt" },
  { id: "ausbau", label: "Ausbau" },
  { id: "militaer", label: "Militär" },
  { id: "kampf", label: "Kampf" },
  { id: "beute", label: "Beute" },
  { id: "befehle", label: "Befehle" },
];

function ProtectionBadge({ p }: { p: string | null }) {
  if (!p) return <Badge tone="slate">ungeschützt</Badge>;
  return <Badge tone={p === "nachtschild" ? "sea" : "green"}>{label(p)}</Badge>;
}

export function RankingScreen({ onCompose, onShowOnMap }: { onCompose: (d: Draft) => void; onShowOnMap: (t: Target) => void }) {
  const q = useQuery({ ...trpc.social.ranking.queryOptions(), refetchInterval: 60000 });
  const [sort, setSort] = useState<Sort>("total");
  const [open, setOpen] = useState<Row | null>(null);
  const [invite, setInvite] = useState(false);
  if (!q.data) return <Loading />;
  const rows = [...q.data.rows].sort((a, b) => b[sort] - a[sort] || a.rank - b.rank);

  return (
    <div>
      <SeasonBar season={q.data.season} />
      {/* Reiter seitlich scrollbar; Verlauf und Pfeil rechts zeigen, dass es weitergeht. */}
      <div className="relative mb-2">
        <div className="flex gap-1 overflow-x-auto pr-8" role="tablist" aria-label="Wertung">
          {SORTS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} onClick={() => setSort(s.id)}
              className={`tap shrink-0 rounded-lg px-3 text-xs font-semibold ${sort === s.id ? "bg-ink text-paper" : "bg-navy-950/60 text-slate-400"}`}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="pointer-events-none absolute right-0 inset-y-0 w-8 grid place-items-center bg-linear-to-l from-paper via-paper/90 to-transparent text-ink2" aria-hidden="true">›</span>
      </div>
      <Card title={`Spieler (${rows.length})`} right={<span className="text-[11px] text-slate-500 tabular-nums">Stand {fmtTime(q.data.computedAtMs)}</span>}>
        {rows.length === 0 ? <p className="text-sm text-slate-400">Noch keine Spieler.</p> : (
          <ol className="divide-y divide-navy-600/70 -mx-1">
            {rows.map((r, i) => (
              <li key={r.playerId}>
                <button type="button" onClick={() => setOpen(r)}
                  className={`tap w-full flex items-center gap-2 px-1 py-2 text-left ${r.own ? "bg-sea-400/10 rounded-lg" : ""}`}>
                  <span className="w-7 text-right font-mono tabular-nums text-slate-400">{sort === "total" ? r.rank : i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.name}{r.own && <span className="text-sea-300 font-normal"> (du)</span>}</span>
                    <span className="block truncate text-xs text-slate-400">{r.base ? r.base.name : "kein Hafen"}</span>
                  </span>
                  {r.base?.protection && <Icon id="schild" size={16} className="shrink-0 opacity-70" />}
                  <span className="w-16 text-right font-mono tabular-nums">{fmtNum(r[sort])}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] text-slate-500 mt-2">1 Punkt je 100 Ressourcen Kostenwert, Befehle zählen ihre Punkte direkt. Antippen für Details.</p>
        <Button kind="secondary" className="w-full mt-3" onClick={() => setInvite(true)}>Freunde einladen</Button>
      </Card>
      <HallOfFame />
      <Sheet open={invite} onClose={() => setInvite(false)} title="Freunde einladen" icon={<Icon id="anker" size={28} />}>
        <InvitePanel playerName={q.data.rows.find((r) => r.own)?.name} />
      </Sheet>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} icon={<Icon id="anker" size={28} />}>
        {open && <PlayerDetail r={open} onCompose={(d) => { setOpen(null); onCompose(d); }} onShowOnMap={(t) => { setOpen(null); onShowOnMap(t); }} />}
      </Sheet>
    </div>
  );
}

function PlayerDetail({ r, onCompose, onShowOnMap }: { r: Row; onCompose: (d: Draft) => void; onShowOnMap: (t: Target) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          <span className="text-slate-400">Hafen </span><strong>{r.base?.name ?? "–"}</strong>
          {r.base && <span className="text-slate-400 font-mono tabular-nums"> · Feld {r.base.col}/{r.base.row}</span>}
        </span>
        {r.base && <ProtectionBadge p={r.base.protection} />}
      </div>
      <StatTable rows={[
        ["Rang", String(r.rank)],
        ["Ausbau", fmtNum(r.ausbau)],
        ["Militär", fmtNum(r.militaer)],
        ["Kampf", fmtNum(r.kampf)],
        ["Beute", fmtNum(r.beute)],
        ["Befehle", fmtNum(r.befehle)],
        ["Gesamt", fmtNum(r.total)],
      ]} />
      <div className="grid grid-cols-2 gap-2">
        <Button kind="secondary" disabled={r.own} onClick={() => onCompose({ to: { id: r.playerId, name: r.name }, subject: "", body: "" })}>
          Nachricht schreiben
        </Button>
        <Button kind="secondary" disabled={!r.base} onClick={() => r.base && onShowOnMap({ col: r.base.col, row: r.base.row })}>
          Auf Karte zeigen
        </Button>
      </div>
    </div>
  );
}
