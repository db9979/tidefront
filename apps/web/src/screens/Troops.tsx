// Truppen mit Segment-Schalter (Muster wie Meldungen), Wahl geräteweit gemerkt:
//   Einsatz   – Mission planen, laufende Missionen, Eingehend (eigene Verlegungen/Transporte), Gäste, Admirale (eingeklappt), zuletzt heimgekehrt, Simulator-Link
//   Ausbilden – Werft, Kaserne, Flugfeld, Nachrichtendienst (components/TrainRow.tsx)
//   Abwehr    – Verteidigungsanlagen
// Forschung ist ein Knopf im Kopf. Neue Karten: Missionsbezogenes nach „Einsatz“, Einheiten nach „Ausbilden“.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { label } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Button, Card, Loading, Segments, UnitChips, useSegment } from "../ui.tsx";
import { ReasonLine } from "../components/Remedy.tsx"; // „Was hilft?“
import { Icon } from "../icons.tsx";
import { RecentMissions } from "../components/Repeat.tsx";
import { FreeSimCard } from "../components/SimLauncher.tsx";
import { spyKindText } from "../components/SpyPlan.tsx"; // Nachrichtendienst
import { RecallSheet, missionHex, targetName } from "../components/MissionSheet.tsx";
export { targetName };
import { AdmiralsCard } from "../components/Admirals.tsx"; // Admirale
import { OpsMissionLine, StationedGuestsCard } from "../components/AllianceOps.tsx"; // Allianz-Ops
import { LiftBlockade } from "../components/Naval.tsx"; // See: Blockade aufheben
import { TrainGroup } from "../components/TrainRow.tsx";
import { FieldMissionLine, MyFieldsCard } from "../components/Fields.tsx"; // Felder
import { IncomingCard } from "../components/Incoming.tsx"; // Mehrere Häfen: Eingehend

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
  const [recallId, setRecallId] = useState<number | null>(null);
  const [seg, setSeg] = useSegment<Seg>("truppen", SEGS.map((x) => x.id), "einsatz");
  if (!meta.data) return <Loading />;
  const balance = meta.data.balance;
  const training = (ids: string[]) => base.trainingQueue.filter((o) => ids.includes(o.builtIn)).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h1 className="font-display text-xl font-bold uppercase">Truppen</h1>
        <ResearchButton base={base} now={now} onOpen={onResearch} />
      </div>
      <Segments label="Truppen" value={seg} onChange={setSeg}
        items={SEGS.map((x) => ({ ...x, badge: x.id === "ausbilden" ? training(TRAIN_GROUPS.map((g) => g.builtIn)) : x.id === "abwehr" ? training(["anlagen"]) : 0 }))} />

      {seg === "einsatz" && <>
      <Button className="w-full mb-3" onClick={onPlan}>Mission planen</Button>
      {base.activeMissions >= base.missionSlots && <ReasonLine code="no_mission_slot" className="text-sm text-brass-300 -mt-1 mb-3" />}
      <Card title={`Missionen ${base.activeMissions}/${base.missionSlots}`}>
        {base.missions.length === 0 && <p className="text-sm text-slate-400">Keine laufenden Missionen. Plane einen Überfall auf ein Piratennest über die Karte oder „Mission planen“.</p>}
        <ul className="divide-y divide-navy-700">
          {base.missions.map((m) => (
            <li key={m.id} className="py-2 text-sm flex gap-3">
              <Icon id={m.type} size={36} />
              <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2">
                <strong>{m.spy ? spyKindText(m.spy.kind) : m.allianceRaidId ? label("sammelangriff") : label(m.type)} {m.status === "returning" ? (m.recalled ? "· zurückgerufen" : "· Rückfahrt") : ""}</strong>
                <button type="button" className="tap text-sea-300 underline text-xs" onClick={() => onShowOnMap({ col: m.target.col, row: m.target.row })}>
                  {m.target.kind === "kartell" ? "Kartell-Informanten" : targetName(map.data, m.target.col, m.target.row)}
                </button>
              </div>
              <div className="text-xs text-slate-300"><UnitChips counts={m.status === "returning" || m.status === "stationed" ? m.returning : m.units} /></div>
              {m.type === "besetzen" && m.status === "stationed" ? <FieldMissionLine missionId={m.id} /> : m.status === "staged" || m.status === "stationed" ? <OpsMissionLine m={m} /> : m.status === "holding" ? (
                <>
                  <div className="text-sea-300">Blockade läuft</div>
                  <LiftBlockade missionId={m.id} />
                </>
              ) : (
              <button
                type="button"
                className="tap text-sea-300 text-left underline underline-offset-4 decoration-dotted"
                onClick={() => onShowOnMap({ ...missionHex(m, { col: base.col, row: base.row }, now), missionId: m.id })}
              >
                {m.status === "outbound" ? `Ankunft in ${fmtDuration(m.arriveAtMs - now)}` : `Rückkehr in ${fmtDuration(m.returnAtMs - now)}`} · auf der Karte zeigen
              </button>)}
              {m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) && (
                <div className="text-xs text-brass-400">Ladung: <UnitChips counts={m.cargoHome} /></div>
              )}
              {m.status === "outbound" && m.arriveAtMs > now && (
                <div className="mt-1"><Button kind="secondary" onClick={() => setRecallId(m.id)}>Zurückrufen</Button></div>
              )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <IncomingCard base={base} now={now} />{/* Mehrere Häfen: eigene Verlegungen/Transporte */}
      <MyFieldsCard base={base} onShowOnMap={onShowOnMap} />{/* Felder */}
      <StationedGuestsCard base={base} now={now} />
      <AdmiralsCard />
      <RecentMissions />
      <div className="mb-3"><FreeSimCard balance={balance} base={base} asLink /></div>
      </>}
      {(() => {
        const m = base.missions.find((x) => x.id === recallId && x.status === "outbound");
        return m ? <RecallSheet mission={m} name={targetName(map.data, m.target.col, m.target.row)} now={now} onClose={() => setRecallId(null)} /> : null;
      })()}

      {seg === "ausbilden" && TRAIN_GROUPS.map((g) => <TrainGroup key={g.builtIn} builtIn={g.builtIn} title={g.title} base={base} balance={balance} now={now} />)}
      {seg === "abwehr" && <TrainGroup builtIn="anlagen" title="Verteidigungsanlagen" base={base} balance={balance} now={now} />}
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

type MissionData = BaseData["missions"][number];

