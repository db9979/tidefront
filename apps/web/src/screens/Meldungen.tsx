// Meldungen: sieben Reiter – Lage (Lagezentrum, Startseite: alles Anstehende aller Häfen), Berichte, Lagebild (Sichtungen, fremde Patrouillen, Sensoren, Radarposten), Bilanz
// (Kampfbilanz der Saison), Erfolge (Abzeichen), Nachrichten, Rangliste (mit Spielerübersicht und Ruhmeshalle).
// Die Allianz liegt seit 0.23 unter Truppen → Allianz (näher an Stationieren/Sammelangriff, kürzere Reiterleiste).
import { useState } from "react";
import { SegmentPanel, Segments } from "../ui.tsx";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import { BattleStatsScreen } from "./BattleStats.tsx";
import { AchievementsScreen } from "./Achievements.tsx"; // Erfolge
import { LagebildTab } from "../components/LagebildTab.tsx"; // Lagebild Stufe 2
import type { Target } from "../App.tsx";
import { LageTab } from "../components/lage/LageTab.tsx"; // Lagezentrum

export type MeldungenTab = "lage" | "berichte" | "lagebild" | "bilanz" | "erfolge" | "nachrichten" | "rangliste";

const TABS: { id: MeldungenTab; label: string }[] = [
  { id: "lage", label: "Lage" }, // Lagezentrum
  { id: "berichte", label: "Berichte" },
  { id: "lagebild", label: "Lagebild" }, // Lagebild Stufe 2
  { id: "bilanz", label: "Bilanz" },
  { id: "erfolge", label: "Erfolge" }, // Erfolge (Abzeichen)
  { id: "nachrichten", label: "Nachrichten" },
  { id: "rangliste", label: "Rangliste" },
];

export function MeldungenScreen(props: {
  sub: MeldungenTab;
  setSub: (t: MeldungenTab) => void;
  unread: { berichte: number; nachrichten: number };
  /** Lagezentrum: Zahl Dringendes am Reiter, höchste gelesene Berichts-ID (neu markieren). */
  urgent?: number;
  seenReport?: number;
  onShowOnMap: (t: Target) => void;
}) {
  const [compose, setCompose] = useState<Draft | null>(null);
  const { sub, setSub } = props;
  const items = TABS.map((t) => ({ ...t, badge: t.id === "berichte" || t.id === "nachrichten" ? props.unread[t.id] : t.id === "lage" ? props.urgent ?? 0 : 0 }));
  return (
    <div>
      <Segments label="Meldungen" value={sub} onChange={setSub} items={items} controls />
      <SegmentPanel label="Meldungen" value={sub}>
        {sub === "lage" ? <LageTab onShowOnMap={props.onShowOnMap} onSub={setSub} unreadMsgs={props.unread.nachrichten} seenReport={props.seenReport ?? 0} /> : sub === "berichte" ? <ReportsScreen /> : sub === "lagebild" ? <LagebildTab onShowOnMap={props.onShowOnMap} /> : sub === "bilanz" ? <BattleStatsScreen /> : sub === "erfolge" ? <AchievementsScreen /> : sub === "nachrichten" ? (
          <MessagesScreen setCompose={setCompose} />
        ) : (
          <RankingScreen onCompose={setCompose} onShowOnMap={props.onShowOnMap} />
        )}
      </SegmentPanel>
      {compose && <ComposeSheet draft={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
