// Truppen mit Segment-Schalter (Muster wie Meldungen), Wahl geräteweit gemerkt:
//   Einsatz   – Kopf „Flotte daheim“ (Gattungen, Kommandopunkte, Missionsplätze, Mission planen), laufende Missionen,
//               lohnende Ziele (nächste Nester), Eingehend, Gäste, Kacheln (Admirale, Felder, Vorlagen, Simulator),
//               zuletzt heimgekehrt – Bausteine in components/einsatz/
//   Ausbilden – Werft, Kaserne, Flugfeld, Nachrichtendienst (components/TrainRow.tsx)
//   Abwehr    – Verteidigungsanlagen
// Die Allianz liegt seit dem Navigationsumbau (nach 0.38) unter Meldungen → Allianz.
// Forschung ist ein Knopf im Kopf. Neue Karten: Missionsbezogenes nach „Einsatz“, Einheiten nach „Ausbilden“.
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Loading, SegmentPanel, Segments, useSegment } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { RecentMissions } from "../components/Repeat.tsx";
import { targetName } from "../components/MissionSheet.tsx";
export { targetName };
import { StationedGuestsCard } from "../components/AllianceOps.tsx"; // Allianz-Ops
import { TrainGroup } from "../components/TrainRow.tsx";
import { IncomingCard } from "../components/Incoming.tsx"; // Mehrere Häfen: Eingehend
import { FleetHead } from "../components/einsatz/FleetHead.tsx";
import { MissionsCard } from "../components/einsatz/MissionCards.tsx";
import { TargetsCard } from "../components/einsatz/Targets.tsx";
import { EinsatzTiles } from "../components/einsatz/Tiles.tsx";

type Seg = "einsatz" | "ausbilden" | "abwehr";
const SEGS: { id: Seg; label: string }[] = [
  { id: "einsatz", label: "Einsatz" },
  { id: "ausbilden", label: "Ausbilden" },
  { id: "abwehr", label: "Abwehr" },
];
const TRAIN_GROUPS: { builtIn: string; title: string }[] = [
  { builtIn: "werft", title: "Werft" },
  { builtIn: "kaserne", title: "Kaserne" },
  { builtIn: "flugfeld", title: "Flugfeld" },
  { builtIn: "nachrichtendienst", title: "Nachrichtendienst" },
];

export function TroopsScreen({ base, onPlan, onShowOnMap, onResearch }: { base: BaseData; onPlan: () => void; onShowOnMap: (t: Target) => void; onResearch: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const now = useNow();
  const map = useQuery(trpc.world.map.queryOptions());
  const [seg, setSeg] = useSegment<Seg>("truppen", SEGS.map((x) => x.id), "einsatz");
  if (!meta.data) return <Loading cards={3} />;
  const balance = meta.data.balance;
  const training = (ids: string[]) => base.trainingQueue.filter((o) => ids.includes(o.builtIn)).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h1 className="font-display text-xl font-bold uppercase">Truppen</h1>
        <ResearchButton base={base} now={now} onOpen={onResearch} />
      </div>
      <Segments label="Truppen" value={seg} onChange={setSeg} controls
        items={SEGS.map((x) => ({ ...x, badge: x.id === "ausbilden" ? training(TRAIN_GROUPS.map((g) => g.builtIn)) : x.id === "abwehr" ? training(["anlagen"]) : 0 }))} />

      <SegmentPanel label="Truppen" value={seg}>
      {seg === "einsatz" && <>
        <FleetHead base={base} balance={balance} onPlan={onPlan} onTrain={() => setSeg("ausbilden")} />
        <EinsatzTiles base={base} balance={balance} onShowOnMap={onShowOnMap} />{/* UX 0.43 (U-3): Kachelreihe direkt unter „Flotte daheim“ */}
        {base.missions.length > 0 && <MissionsCard base={base} map={map.data} now={now} onShowOnMap={onShowOnMap} />}
        <TargetsCard base={base} balance={balance} map={map.data} onShowOnMap={onShowOnMap} />
        {base.missions.length === 0 && <MissionsCard base={base} map={map.data} now={now} onShowOnMap={onShowOnMap} />}
        <IncomingCard base={base} now={now} />{/* Mehrere Häfen: eigene Verlegungen/Transporte */}
        <StationedGuestsCard base={base} now={now} />
        <RecentMissions />
      </>}

      {seg === "ausbilden" && TRAIN_GROUPS.map((g) => <TrainGroup key={g.builtIn} builtIn={g.builtIn} title={g.title} base={base} balance={balance} now={now} />)}
      {seg === "abwehr" && <TrainGroup builtIn="anlagen" title="Verteidigungsanlagen" base={base} balance={balance} now={now} />}
      </SegmentPanel>
    </div>
  );
}

/** Forschung im Kopf: Knopf mit Kurzstatus (läuft noch …, Durchbruch als Siegel). */
function ResearchButton({ base, now, onOpen }: { base: BaseData; now: number; onOpen: () => void }) {
  const r = base.research;
  if (!r) return null;
  const o = r.order;
  return (
    <button type="button" onClick={onOpen} className="tap relative rounded-lg btn-secondary px-3 flex items-center gap-1.5 text-sm">
      <Icon id="forschungsamt" size={22} />
      <span className="font-display uppercase text-[12px] tracking-[0.1em]">Forschung</span>
      {o && <span className="mono text-[11px] text-ink2">{o.finishesAt <= now ? "fertig" : fmtDuration(o.finishesAt - now)}</span>}
      {r.pendingChoice && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rotate-45 bg-siegel" title="Durchbruch: Belohnung wählen" />}
    </button>
  );
}


