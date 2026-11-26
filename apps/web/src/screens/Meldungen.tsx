// Meldungen: sechs Reiter – Berichte, Bilanz (Kampfbilanz der Saison), Erfolge (Abzeichen), Nachrichten, Rangliste
// (mit Spielerübersicht und Ruhmeshalle), Allianz. Die Reiterleiste ist waagerecht scrollbar.
import { useEffect, useRef, useState } from "react";
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
  // Verlauf am Rand zeigt, dass es links/rechts weitere Reiter gibt.
  const bar = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const el = bar.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    measure();
    // Gewählten Reiter in den sichtbaren Bereich holen.
    bar.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [sub]);
  return (
    <div>
      <div className="mb-3 sticky -top-3 -mx-3 z-10 bg-paper border-b border-rule">
        <div ref={bar} onScroll={measure} className="flex gap-1 overflow-x-auto px-3 pt-1 [scrollbar-width:none]" role="tablist" aria-label="Meldungen">
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
        </div>
        {more.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-paper to-transparent" />}
        {more.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent" />}
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
