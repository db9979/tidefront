// Truppen → Einsatz, „Unterwegs“: laufende Missionen als Karten (Art, Ziel, Fortschritt Hin-/Rückfahrt, Restzeit,
// Verband, Zurückrufen). Leer: ruhiger Hafen als Zeichnung, ein Satz und ein Knopf.
import { useState } from "react";
import type { BaseData, MapData } from "../../lib/trpc.ts";
import type { Target } from "../../App.tsx";
import { label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { Badge, Bar, Card, SmallButton, UnitChips } from "../../ui.tsx";
import { spyKindText } from "../SpyPlan.tsx"; // Nachrichtendienst
import { RecallSheet, missionHex, missionPhase, targetName } from "../MissionSheet.tsx";
import { OpsMissionLine } from "../AllianceOps.tsx"; // Allianz-Ops
import { LiftBlockade } from "../Naval.tsx"; // See: Blockade aufheben
import { FieldMissionLine } from "../Fields.tsx"; // Felder
import { CalmHarborArt } from "./art.tsx";

type MissionData = BaseData["missions"][number];

function title(m: MissionData): string {
  return m.spy ? spyKindText(m.spy.kind) : m.allianceRaidId ? label("sammelangriff") : label(m.type);
}

function phaseBadge(m: MissionData) {
  if (m.status === "outbound") return <Badge tone="sea">Hinfahrt</Badge>;
  if (m.status === "returning") return <Badge tone={m.recalled ? "brass" : "slate"}>{m.recalled ? "zurückgerufen" : "Rückfahrt"}</Badge>;
  if (m.status === "holding") return <Badge tone="red">Blockade</Badge>;
  if (m.status === "stationed") return <Badge tone="green">vor Ort</Badge>;
  if (m.status === "staged") return <Badge tone="brass">bereit</Badge>;
  return null;
}

export function MissionsCard({ base, map, now, onShowOnMap }: { base: BaseData; map: MapData | undefined; now: number; onShowOnMap: (t: Target) => void }) {
  const [recallId, setRecallId] = useState<number | null>(null);
  const recall = base.missions.find((x) => x.id === recallId && x.status === "outbound");
  return (
    <Card title={`Unterwegs ${base.activeMissions}/${base.missionSlots}`}>
      {base.missions.length === 0 ? (
        <div className="flex items-center gap-3">
          <CalmHarborArt width={112} />
          <div className="flex-1 min-w-0">
            <p className="font-serif italic text-[15px] leading-snug">Alle Schiffe liegen im Hafen.</p>
            <SmallButton className="mt-1" onClick={() => onShowOnMap({ col: base.col, row: base.row })}>Ziel auf der Karte</SmallButton>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {base.missions.map((m) => (
            <MissionItem key={m.id} m={m} base={base} map={map} now={now} onShowOnMap={onShowOnMap} onRecall={() => setRecallId(m.id)} />
          ))}
        </ul>
      )}
      {recall && <RecallSheet mission={recall} name={targetName(map, recall.target.col, recall.target.row)} now={now} onClose={() => setRecallId(null)} />}
    </Card>
  );
}

function MissionItem({ m, base, map, now, onShowOnMap, onRecall }: { m: MissionData; base: BaseData; map: MapData | undefined; now: number; onShowOnMap: (t: Target) => void; onRecall: () => void }) {
  const moving = m.status === "outbound" || m.status === "returning";
  const ph = missionPhase(m, now);
  const left = (m.status === "outbound" ? m.arriveAtMs : m.returnAtMs) - now;
  const where = m.target.kind === "kartell" ? "Kartell-Informanten" : targetName(map, m.target.col, m.target.row);
  const units = m.status === "returning" || m.status === "stationed" ? m.returning : m.units;
  return (
    <li className="rounded-[3px] border border-rule bg-card p-2.5" data-mission={m.id}>
      <div className="flex items-start gap-2.5">
        <div className="grid place-items-center w-11 h-11 border border-rule bg-[#f6f1e5] rounded-[3px] shrink-0"><Icon id={m.type} size={34} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <strong className="font-serif text-[15px] leading-tight truncate">{title(m)}</strong>
            {phaseBadge(m)}
          </div>
          <div className="text-xs text-ink2 truncate">→ {where}</div>
        </div>
      </div>

      {moving && (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="mono">{m.status === "outbound" ? "Ankunft" : "Zurück"} in {fmtDuration(Math.max(0, left))}</span>
            <span className="text-ink2" aria-hidden="true">{m.status === "outbound" ? "Hafen → Ziel" : "Ziel → Hafen"}</span>
          </div>
          <Bar value={ph.progress} tone={m.status === "returning" ? "brass" : "sea"} />
        </div>
      )}

      <div className="text-xs mt-2"><UnitChips counts={units} /></div>
      {m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) && (
        <div className="text-xs text-brass-400 mt-1">Ladung: <UnitChips counts={m.cargoHome} /></div>
      )}

      {m.type === "besetzen" && m.status === "stationed" ? <div className="text-sm mt-1"><FieldMissionLine missionId={m.id} /></div>
        : m.status === "staged" || m.status === "stationed" ? <div className="text-sm mt-1"><OpsMissionLine m={m} /></div>
        : m.status === "holding" ? <div className="text-sm mt-1"><div className="text-sea-300">Blockade läuft</div><LiftBlockade missionId={m.id} /></div>
        : null}

      <div className="flex justify-end gap-1 -mb-1.5 -mr-1.5 mt-1">
        <SmallButton onClick={() => onShowOnMap(moving ? { ...missionHex(m, { col: base.col, row: base.row }, now), missionId: m.id } : { col: m.target.col, row: m.target.row })}>Auf der Karte</SmallButton>
        {m.status === "outbound" && m.arriveAtMs > now && <SmallButton onClick={onRecall}>Zurückrufen</SmallButton>}
      </div>
    </li>
  );
}
