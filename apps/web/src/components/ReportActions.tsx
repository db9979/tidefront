// Hauptaktionen am Bericht: „Im Kampfsimulator öffnen“ (Kämpfe und aufgeklärte Ziele), bei Aufklärung zusätzlich
// „Angreifen planen“, Entfernung und Probekampf mit dem eigenen Bestand. „Wiederholen“ bleibt als Nebenaktion (Repeat.tsx).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hexDistanceKm } from "@tidefront/world";
import { trpc } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { requestPlan } from "../lib/plan-request.ts";
import { Icon } from "../icons.tsx";
import { Button, Card } from "../ui.tsx";
import { ProbeCard } from "./SimLauncher.tsx";
import type { ProbeTarget } from "./BattleSim.tsx";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

/** Aufgeklärtes Ziel mit Kampfkraft (Nest mit Besatzung oder Hafen-Lagebild); sonst null. */
export function scoutTarget(kind: string, d: Obj): { kind: "nest"; level: number } | { kind: "base"; name: string } | null {
  if (kind !== "aufklaerung") return null;
  const nest = obj(d.nest);
  if (nest) return nest.empty !== true && obj(nest.garrison) ? { kind: "nest", level: Number(nest.level ?? 1) } : null;
  return obj(d.scout) ? { kind: "base", name: typeof d.targetName === "string" ? d.targetName : "Ziel" } : null;
}

/** Aufklärung: Angriff planen, Entfernung, Probekampf mit dem Bestand daheim. */
function ScoutActions({ reportId, target }: { reportId: number; target: NonNullable<ReturnType<typeof scoutTarget>> }) {
  const rep = useQuery(trpc.comfort.repeat.queryOptions({ reportId }));
  const baseQ = useQuery(trpc.base.get.queryOptions());
  const base = { data: baseQ.data?.base ?? undefined };
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const at = rep.data ? { col: rep.data.col, row: rep.data.row } : null;
  const home = useMemo(() => Object.fromEntries((base.data?.units ?? []).filter((u) => u.home > 0).map((u) => [u.id, u.home])), [base.data]);
  if (!at) return null;
  const km = base.data ? Math.round(hexDistanceKm(base.data, at)) : null;
  const probe: ProbeTarget = target.kind === "nest" ? { kind: "nest", level: target.level, empty: false } : { kind: "base", col: at.col, row: at.row, name: target.name };
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => requestPlan({ target: at, type: "ueberfall" })}>Angreifen planen</Button>
        <span className="text-xs text-ink2">Feld {at.col}/{at.row}{km !== null ? ` · ${fmtNum(km)} km vom Hafen` : ""}</span>
      </div>
      {base.data && meta.data && (
        <div className="mt-3">
          <ProbeCard balance={meta.data.balance} base={base.data} units={home} target={probe} onScout={() => requestPlan({ target: at, type: "aufklaerung" })} />
        </div>
      )}
    </>
  );
}

export function ReportActions({ r, onSim }: { r: { id: number; kind: string; role: string; data: Obj; simulable?: boolean }; onSim: () => void }) {
  const target = r.role === "attacker" ? scoutTarget(r.kind, r.data) : null;
  if (!r.simulable && !target) return null;
  return (
    <Card>
      <div className="flex items-center gap-3 mb-2">
        <Icon id="korvette" size={32} />
        <p className="text-sm text-ink2 flex-1 min-w-0">
          {target ? "Ziel durchrechnen: dein Bestand daheim gegen das aufgeklärte Ziel – frei änderbar." : "Den Kampf mit denselben Verbänden, Anlagen und Bedingungen nachstellen – und z. B. mit mehr Einheiten probieren."}
        </p>
      </div>
      <Button kind={target ? "secondary" : "primary"} className="w-full mb-2" onClick={onSim}>Im Kampfsimulator öffnen</Button>
      {target && <ScoutActions reportId={r.id} target={target} />}
    </Card>
  );
}
