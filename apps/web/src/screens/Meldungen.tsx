// Meldungen: sechs Reiter – Berichte, Bilanz (Kampfbilanz der Saison), Erfolge (Abzeichen), Nachrichten, Rangliste
// (mit Spielerübersicht und Ruhmeshalle), Allianz. Die Reiterleiste ist waagerecht scrollbar.
import { useState } from "react";
import { HScroll } from "../components/HScroll.tsx";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import { AllianceScreen } from "./Alliance.tsx";
import { BattleStatsScreen } from "./BattleStats.tsx";
import { AchievementsScreen } from "./Achievements.tsx"; // Erfolge
import type { Target } from "../App.tsx";

export type MeldungenTab = "berichte" | "bilanz" | "erfolge" | "nachrichten" | "rangliste" | "allianz";

const TABS: { id: MeldungenTab; label: string }[] = [
  { id: "berichte", label: "Berichte" },
  { id: "bilanz", label: "Bilanz" },
  { id: "erfolge", label: "Erfolge" }, // Erfolge (Abzeichen)
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
      <div className="mb-3 sticky -top-3 -mx-3 z-10 bg-paper border-b border-rule">
        <HScroll className="gap-1 px-3 pt-1" role="tablist" label="Meldungen" watch={sub}>
          {TABS.map((t) => {
            const n = t.id === "berichte" || t.id === "nachrichten" ? props.unread[t.id] : 0;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={sub === t.id} onClick={() => setSub(t.id)}
                className={`tap flex-auto shrink-0 px-3 whitespace-nowrap text-[14px] font-serif flex items-center justify-center gap-1.5 border-b-[3px] -mb-px ${sub === t.id ? "border-siegel text-ink" : "border-transparent text-ink2"}`}>
                <span>{t.label}</span>
                {n > 0 && <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-siegel text-white text-[11px] font-sans mono grid place-items-center">{n}</span>}
              </button>
            );
          })}
        </HScroll>
      </div>
      {sub === "berichte" ? <ReportsScreen /> : sub === "bilanz" ? <BattleStatsScreen /> : sub === "erfolge" ? <AchievementsScreen /> : sub === "nachrichten" ? (
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
