// Meldungen: vier Reiter – Berichte, Nachrichten, Rangliste (mit Spielerübersicht und Ruhmeshalle), Allianz.
import { useState } from "react";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import { AllianceScreen } from "./Alliance.tsx";
import type { Target } from "../App.tsx";

export type MeldungenTab = "berichte" | "nachrichten" | "rangliste" | "allianz";

const TABS: { id: MeldungenTab; label: string }[] = [
  { id: "berichte", label: "Berichte" },
  { id: "nachrichten", label: "Nachrichten" },
  { id: "rangliste", label: "Rangliste" },
  { id: "allianz", label: "Allianz" },
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
      <div className="flex overflow-x-auto mb-3 sticky -top-3 -mx-3 px-3 pt-1 z-10 bg-paper border-b border-rule" role="tablist" aria-label="Meldungen">
        {TABS.map((t) => {
          const n = t.id === "rangliste" || t.id === "allianz" ? 0 : props.unread[t.id];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={sub === t.id} onClick={() => setSub(t.id)}
              className={`tap flex-1 shrink-0 px-1.5 whitespace-nowrap text-[14px] font-serif flex items-center justify-center gap-1.5 border-b-[3px] -mb-px ${sub === t.id ? "border-siegel text-ink" : "border-transparent text-ink2"}`}>
              {t.label}
              {n > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-siegel text-white text-[11px] font-sans mono grid place-items-center">{n}</span>}
            </button>
          );
        })}
      </div>
      {sub === "berichte" ? <ReportsScreen /> : sub === "nachrichten" ? (
        <MessagesScreen setCompose={setCompose} />
      ) : sub === "rangliste" ? (
        <RankingScreen onCompose={setCompose} onShowOnMap={props.onShowOnMap} />
      ) : (
        <AllianceScreen onCompose={setCompose} />
      )}
      {compose && <ComposeSheet draft={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
