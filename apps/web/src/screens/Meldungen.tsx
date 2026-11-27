// Meldungen (Navigationsumbau nach 0.38): vier Reiter – Berichte, Nachrichten, Allianz, Rangliste. Die Rangliste hat
// einen inneren Schalter Wertung · Bilanz · Erfolge (Kampfbilanz der Saison, Abzeichen).
// Umgezogen: Lage → Basis (Startseite), Lagebild → Karte („Sichtungen“), Allianz kam aus Truppen hierher.
import { useState } from "react";
import { SegmentPanel, Segments } from "../ui.tsx";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import { BattleStatsScreen } from "./BattleStats.tsx";
import { AchievementsScreen, useAchievements } from "./Achievements.tsx"; // Erfolge
import { AllianceScreen } from "./Alliance.tsx";
import type { Target } from "../App.tsx";

/** Unterreiter samt der Abschnitte der Rangliste (bilanz, erfolge = Rangliste mit innerem Schalter). */
export type MeldungenTab = "berichte" | "nachrichten" | "allianz" | "rangliste" | "bilanz" | "erfolge";
type Outer = "berichte" | "nachrichten" | "allianz" | "rangliste";
type Inner = "rangliste" | "bilanz" | "erfolge";

const TABS: { id: Outer; label: string }[] = [
  { id: "berichte", label: "Berichte" },
  { id: "nachrichten", label: "Nachrichten" },
  { id: "allianz", label: "Allianz" },
  { id: "rangliste", label: "Rangliste" },
];
const INNER: { id: Inner; label: string }[] = [
  { id: "rangliste", label: "Wertung" },
  { id: "bilanz", label: "Bilanz" },
  { id: "erfolge", label: "Erfolge" },
];

export const outerOf = (t: MeldungenTab): Outer => (t === "bilanz" || t === "erfolge" ? "rangliste" : t);

export function MeldungenScreen(props: {
  sub: MeldungenTab;
  setSub: (t: MeldungenTab) => void;
  unread: { berichte: number; nachrichten: number };
  onShowOnMap: (t: Target) => void;
}) {
  const [compose, setCompose] = useState<Draft | null>(null);
  const ach = useAchievements();
  const { sub, setSub } = props;
  const outer = outerOf(sub);
  const inner: Inner = sub === "bilanz" || sub === "erfolge" ? sub : "rangliste";
  const erfolge = ach.data?.claimable ?? 0;
  const items = TABS.map((t) => ({ ...t, badge: t.id === "berichte" || t.id === "nachrichten" ? props.unread[t.id] : t.id === "rangliste" ? erfolge : 0 }));
  return (
    <div>
      <Segments label="Meldungen" value={outer} onChange={setSub} items={items} controls />
      <SegmentPanel label="Meldungen" value={outer}>
        {outer === "berichte" ? <ReportsScreen />
          : outer === "nachrichten" ? <MessagesScreen setCompose={setCompose} />
          : outer === "allianz" ? <AllianceScreen onCompose={setCompose} />
          : (
            <div>
              <div role="tablist" aria-label="Rangliste" className="flex gap-1.5 mb-3">
                {INNER.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={inner === t.id} onClick={() => setSub(t.id)}
                    className={`tap flex-1 rounded-full border px-3 text-[13px] font-serif flex items-center justify-center gap-1.5 ${inner === t.id ? "border-ink bg-card text-ink" : "border-rule text-ink2"}`}>
                    {t.label}
                    {t.id === "erfolge" && erfolge > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-siegel text-white text-[11px] mono grid place-items-center">{erfolge}</span>}
                  </button>
                ))}
              </div>
              {inner === "bilanz" ? <BattleStatsScreen /> : inner === "erfolge" ? <AchievementsScreen /> : <RankingScreen onCompose={setCompose} onShowOnMap={props.onShowOnMap} />}
            </div>
          )}
      </SegmentPanel>
      {compose && <ComposeSheet draft={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
