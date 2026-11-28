// Reiter „Basis“ (Navigationsumbau nach 0.38): zwei Unterreiter.
//   Lage – Startseite „Was steht an?“: Fortschritt, Alarm, Rückkehrkarte, Wartet auf dich (mit „Alle abholen“),
//          Nächster Schritt, Unterwegs, Als Nächstes, Weltpolitik, Aufträge, Zuletzt passiert (components/lage/LageTab.tsx).
//   Hafen – Hafen-Kopf, Bauhof, Gebäude, Zeitleiste, Versorgung, Schutz (screens/Base.tsx).
// Über beiden: Angriffs-, Sabotage-, Weltereignis-, Blockade- und Saisonende-Banner (auf jeder Basis-Seite sichtbar).
import type { BaseData } from "../lib/trpc.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { label } from "../lib/names.ts";
import { isThreat } from "../lib/expansion.ts"; // Mehrere Häfen: eigene Verlegung ist kein Angriff
import { Icon } from "../icons.tsx";
import { CountsLine, SegmentPanel, Segments } from "../ui.tsx";
import { SabotageBanner } from "../components/Intel.tsx";
import { WorldEventBanner } from "../components/WorldEvents.tsx";
import { BlockadeBanner } from "../components/Naval.tsx";
import { SeasonEndBanner } from "../components/Season.tsx";
import { QuestBar } from "../components/QuestBar.tsx";
import type { GuideAction } from "../components/Guide.tsx";
import { LageTab } from "../components/lage/LageTab.tsx";
import { BaseScreen } from "./Base.tsx";
import type { Target } from "../App.tsx";

export type BasisTab = "lage" | "hafen";

export function BasisScreen(props: {
  base: BaseData;
  asOf: number;
  sub: BasisTab;
  setSub: (t: BasisTab) => void;
  /** Zahl neuer dringender Lage-Einträge (wie an der Navigation). */
  lageCount: number;
  sheet: string | null;
  setSheet: (id: string | null) => void;
  onGuide: (a: GuideAction) => void;
  onTroops: () => void;
  onResearch: () => void;
  onShowOnMap: (t: Target) => void;
  onSeasonEnd: () => void;
  unreadMsgs: number;
  seenReport: number;
}) {
  const { base, sub, setSub } = props;
  const now = useNow();
  return (
    <div>
      <SeasonEndBanner onOpen={props.onSeasonEnd} />
      {base.incoming.filter(isThreat).map((i) => (
        <div key={i.id} className="rounded-xl bg-red-950 border border-siegel border-l-4 p-3 mb-3 flex gap-3 items-center" role="alert">
          <Icon id={i.type === "kartell" ? "kartell" : "ueberfall"} size={40} />
          <div className="text-sm">
            <strong className="text-siegel uppercase font-display text-xs">{label(i.type)} im Anmarsch</strong>
            <div className="font-serif text-lg leading-tight">Ankunft in <span className="mono">{fmtDuration(i.arriveAtMs - now)}</span></div>
            {i.units && <div className="text-xs text-ink2"><CountsLine counts={i.units} /></div>}
          </div>
        </div>
      ))}
      <SabotageBanner base={base} now={now} />
      <WorldEventBanner onMap={props.onShowOnMap} />
      <BlockadeBanner />

      <Segments label="Basis" value={sub} onChange={setSub} controls items={[
        { id: "lage", label: "Lage", badge: props.lageCount },
        { id: "hafen", label: "Hafen", badge: 0 },
      ]} />
      <SegmentPanel label="Basis" value={sub}>
        {sub === "lage" ? (
          <LageTab onShowOnMap={props.onShowOnMap} unreadMsgs={props.unreadMsgs} seenReport={props.seenReport} base={base} onGuide={props.onGuide}
            quests={<QuestBar base={base} onAction={props.onGuide} />} />
        ) : (
          <BaseScreen key={base.id} base={base} asOf={props.asOf} sheet={props.sheet} setSheet={props.setSheet} onTroops={props.onTroops} onResearch={props.onResearch} />
        )}
      </SegmentPanel>
    </div>
  );
}
