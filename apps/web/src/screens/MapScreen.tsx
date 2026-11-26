import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { terrainAt } from "@tidefront/world";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { fmtNum, label } from "../lib/names.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "./HexMap.tsx";
import { Button, Loading } from "../ui.tsx";

const TERRAIN: Record<string, string> = { sea: "Meer", coast: "Küste", land: "Land" };

export function MapScreen({ base, focus, onPlan }: { base: BaseData; focus: Target | null; onPlan: (t: Target) => void }) {
  const map = useQuery({ ...trpc.world.map.queryOptions(), refetchInterval: 60000 });
  const [sel, setSel] = useState<Target | null>(focus);
  const now = useNow();
  const center = useMemo(() => focus ?? { col: base.col, row: base.row }, [focus, base.col, base.row]);
  if (!map.data) return <Loading />;
  const at = (t: Target | null) => {
    if (!t) return null;
    return {
      base: map.data.bases.find((b) => b.col === t.col && b.row === t.row),
      nest: map.data.nests.find((n) => n.col === t.col && n.row === t.row),
      wreck: map.data.wrecks.find((w) => w.col === t.col && w.row === t.row),
    };
  };
  const info = at(sel);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <HexMap data={map.data} selected={sel} onSelect={setSel} center={center} />
      </div>
      {sel && info && (
        <div className="p-3 bg-navy-900 border-t border-navy-700">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm min-w-0">
              <div className="text-xs text-slate-400">Feld {sel.col}/{sel.row} · {TERRAIN[terrainAt(sel.col, sel.row) ?? "sea"]}</div>
              {info.base && (
                <div>
                  <strong>{info.base.name}</strong> ({info.base.own ? "dein Stützpunkt" : info.base.owner})
                  {info.base.protection && <div className="text-emerald-300 text-xs">🛡 {label(info.base.protection)}</div>}
                </div>
              )}
              {info.nest && (
                <div>
                  <strong>Piratennest Stufe {info.nest.level}</strong>
                  {info.nest.empty && <div className="text-xs text-slate-400">verlassen, neu besetzt in {fmtDuration((info.nest.respawnAtMs ?? now) - now)}</div>}
                </div>
              )}
              {info.wreck && <div className="text-xs text-orange-300">Wrackfeld: {fmtNum(info.wreck.stahl)} Stahl, {fmtNum(info.wreck.elektronik)} Elektronik</div>}
              {!info.base && !info.nest && !info.wreck && <div className="text-slate-400">Hier ist nichts.</div>}
            </div>
            <Button kind="ghost" onClick={() => setSel(null)}>✕</Button>
          </div>
          {(info.nest || (info.base && !info.base.own)) && (
            <Button className="w-full mt-2" onClick={() => onPlan(sel)}>Mission planen</Button>
          )}
        </div>
      )}
      {!sel && (
        <div className="p-2 bg-navy-900 border-t border-navy-700 text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
          <span><span className="inline-block w-3 h-3 bg-brass-400 align-middle" /> dein Stützpunkt</span>
          <span><span className="inline-block w-3 h-3 bg-red-500 align-middle" /> andere</span>
          <span><span className="inline-block w-3 h-3 rounded-full bg-purple-600 align-middle" /> Nest (Stufe)</span>
          <span><span className="inline-block w-3 h-3 bg-orange-400 rotate-45 align-middle" /> Wrack</span>
        </div>
      )}
    </div>
  );
}
