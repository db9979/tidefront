// Meldungen (UX 0.43, Entscheidungen E-2a/E-6a): vier kurze Reiter – Berichte · Post · Allianz · Saison; die Zahl
// steht als Punkt am Reiter (passt bei 390 px), die genaue Zahl im Namen für Screenreader. Saison bündelt Rangliste
// (Wertung mit Filterchips), Kampfbilanz, Erfolge und Welt (Weltpolitik mit Kalender als Zeitleiste) als Ebene 2.
// Schlüssel bleiben: „nachrichten“ = Post, „rangliste“/„bilanz“/„erfolge“/„welt“ = Abschnitte der Saison, „saison“
// öffnet die Wertung. Umgezogen: Lage → Basis (Startseite), Lagebild → Karte („Sichtungen“).
import { useState } from "react";
import { SegmentPanel, Segments } from "../ui.tsx";
import { ReportsScreen } from "./Reports.tsx";
import { ComposeSheet, MessagesScreen, type Draft } from "./Messages.tsx";
import { RankingScreen } from "./Ranking.tsx";
import { BattleStatsScreen } from "./BattleStats.tsx";
import { AchievementsScreen, useAchievements } from "./Achievements.tsx"; // Erfolge
import { AllianceScreen } from "./Alliance.tsx";
import { PolitikPanel } from "../components/politik/PolitikPanel.tsx"; // Weltpolitik-Details (Saison → Welt)
import type { Target } from "../App.tsx";

/** Unterreiter samt der Abschnitte der Saison (rangliste, bilanz, erfolge, welt; saison = Wertung). */
export type MeldungenTab = "berichte" | "nachrichten" | "allianz" | "saison" | "rangliste" | "bilanz" | "erfolge" | "welt";
type Outer = "berichte" | "nachrichten" | "allianz" | "saison";
type Inner = "rangliste" | "bilanz" | "erfolge" | "welt";
/** Alle gültigen Werte (Adresse ?sub=, Push-Ziele). „post“ ist ein Alias für „nachrichten“. */
export const MELDUNGEN_SUBS: readonly string[] = ["nachrichten", "allianz", "saison", "rangliste", "bilanz", "erfolge", "welt", "post"];
export const asMeldungenTab = (s: string): MeldungenTab => (s === "post" ? "nachrichten" : s as MeldungenTab);

const TABS: { id: Outer; label: string; name: string }[] = [
  { id: "berichte", label: "Berichte", name: "Berichte" },
  { id: "nachrichten", label: "Post", name: "Post" },
  { id: "allianz", label: "Allianz", name: "Allianz" },
  { id: "saison", label: "Saison", name: "Saison" },
];
const INNER: { id: Inner; label: string }[] = [
  { id: "rangliste", label: "Wertung" },
  { id: "bilanz", label: "Bilanz" },
  { id: "erfolge", label: "Erfolge" },
  { id: "welt", label: "Welt" },
];

export const outerOf = (t: MeldungenTab): Outer => (t === "rangliste" || t === "bilanz" || t === "erfolge" || t === "welt" ? "saison" : t);

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
  const inner: Inner = sub === "bilanz" || sub === "erfolge" || sub === "welt" ? sub : "rangliste";
  const erfolge = ach.data?.claimable ?? 0;
  // M-1: Zahl als Punkt (dot); die Zahl selbst bleibt in badge für Screenreader und Tests.
  const items = TABS.map((t) => ({ id: t.id, label: t.label, badge: t.id === "berichte" || t.id === "nachrichten" ? props.unread[t.id] : t.id === "saison" ? erfolge : 0, dot: true }));
  return (
    <div>
      <Segments label="Meldungen" value={outer} onChange={setSub} items={items} controls />
      <SegmentPanel label="Meldungen" value={outer}>
        {outer === "berichte" ? <ReportsScreen />
          : outer === "nachrichten" ? <MessagesScreen setCompose={setCompose} />
          : outer === "allianz" ? <AllianceScreen onCompose={setCompose} />
          : (
            <div data-testid="saison">
              {/* Ebene 2 als umbrechende Filterchips (N-2): alle sichtbar, kein Scrollpfeil. */}
              <div role="tablist" aria-label="Saison" className="flex flex-wrap gap-1.5 mb-3">
                {INNER.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={inner === t.id} onClick={() => setSub(t.id)}
                    className={`tap rounded-full border px-3.5 text-[13px] font-serif flex items-center justify-center gap-1.5 ${inner === t.id ? "border-ink bg-card text-ink" : "border-rule text-ink2"}`}>
                    {t.label}
                    {t.id === "erfolge" && erfolge > 0 && <span className="w-2 h-2 rounded-full bg-siegel" aria-label={`${erfolge} abholbereit`} />}
                  </button>
                ))}
              </div>
              {inner === "bilanz" ? <BattleStatsScreen />
                : inner === "erfolge" ? <AchievementsScreen />
                : inner === "welt" ? <PolitikPanel full />
                : <RankingScreen onCompose={setCompose} onShowOnMap={props.onShowOnMap} />}
            </div>
          )}
      </SegmentPanel>
      {compose && <ComposeSheet draft={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
