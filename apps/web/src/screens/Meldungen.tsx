// Meldungen: drei Reiter – Berichte, Nachrichten, Rangliste (mit Spielerübersicht und Ruhmeshalle).
import { useState } from "react";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import type { Target } from "../App.tsx";

export type MeldungenTab = "berichte" | "nachrichten" | "rangliste";

const TABS: { id: MeldungenTab; label: string }[] = [
  { id: "berichte", label: "Berichte" },
  { id: "nachrichten", label: "Nachrichten" },
  { id: "rangliste", label: "Rangliste" },
];

export function MeldungenScreen(props: {
  sub: MeldungenTab;
  setSub: (t: MeldungenTab) => void;
  unread: { berichte: number; nachrichten: number };
  onShowOnMap: (t: Target) => void;
}) {
  const [compose, setCompose] = useState<Draft | null>(null);
  const { sub, setSub } = props;
  return (
    <div>
      <div className="flex rounded-xl bg-navy-950/70 p-0.5 mb-3 sticky top-0 z-10 backdrop-blur" role="tablist" aria-label="Meldungen">
        {TABS.map((t) => {
          const n = t.id === "rangliste" ? 0 : props.unread[t.id];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={sub === t.id} onClick={() => setSub(t.id)}
              className={`tap flex-1 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${sub === t.id ? "bg-ink text-paper" : "text-slate-400"}`}>
              {t.label}
              {n > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] grid place-items-center tabular-nums">{n}</span>}
            </button>
          );
        })}
      </div>
      {sub === "berichte" ? <ReportsScreen /> : sub === "nachrichten" ? (
        <MessagesScreen setCompose={setCompose} />
      ) : (
        <RankingScreen onCompose={setCompose} onShowOnMap={props.onShowOnMap} />
      )}
      {compose && <ComposeSheet draft={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
