import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hexCenter, hexDistanceKm, nearestTradePort, terrainAt } from "@tidefront/world";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtDuration, fmtSeconds, useNow } from "../lib/time.ts";
import { countLabel, fmtNum, label } from "../lib/names.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "./LazyHexMap.tsx";
import { Button, Loading } from "../ui.tsx";
import { MapLegend } from "../map/Legend.tsx";
import { TacticalIcon } from "../map/TacticalIcon.tsx";
import { fmtPosition } from "../map/coords.ts";

const TERRAIN: Record<string, string> = { sea: "Offene See", coast: "Küste", land: "Binnenland" };
const LEVEL_TEXT = ["", "schwach besetzt", "kleine Bande", "befestigt", "Festung", "Hauptquartier"];

export function MapScreen({ base, focus, onPlan }: { base: BaseData; focus: Target | null; onPlan: (t: Target) => void }) {
  const map = useQuery({ ...trpc.world.map.queryOptions(), refetchInterval: 60000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [sel, setSel] = useState<Target | null>(focus);
  const [recenter, setRecenter] = useState(0);
  const [centerOn, setCenterOn] = useState<Target>(focus ?? { col: base.col, row: base.row });
  const now = useNow();
  const home = useMemo(() => ({ col: base.col, row: base.row }), [base.col, base.row]);
  const alert = base.incoming.some((i) => i.type !== "transport");
  if (!map.data) return <Loading />;
  const at = (t: Target) => ({
    base: map.data.bases.find((b) => b.col === t.col && b.row === t.row),
    nest: map.data.nests.find((n) => n.col === t.col && n.row === t.row),
    wreck: map.data.wrecks.find((w) => w.col === t.col && w.row === t.row),
  });
  const info = sel ? at(sel) : null;
  const units = meta.data?.balance.units;
  const dist = sel ? hexDistanceKm(home, sel) : 0;
  const eta = (id: string) => {
    const v = units?.[id]?.speedKmh;
    return v ? fmtSeconds((dist / v) * 3600) : "–";
  };
  const garrison = info?.nest && meta.data ? meta.data.balance.pirates.nestLevels[String(info.nest.level)] : null;
  const isHome = !!info?.base?.own;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <HexMap
          data={map.data}
          selected={sel}
          onSelect={setSel}
          center={centerOn}
          recenter={recenter}
          home={home}
          missions={base.missions}
          alert={alert}
        />
        <div className="absolute left-2 top-6 flex flex-col gap-1.5 items-start">
          <button
            type="button"
            className="tap rounded-[4px] bg-navy-800/95 border border-ink text-ink px-3 text-[11px] font-mono uppercase tracking-widest backdrop-blur-sm flex items-center gap-2"
            onClick={() => { setCenterOn(home); setRecenter((n) => n + 1); }}
          >
            <TacticalIcon kind="own" size={20} /> Mein Hafen
          </button>
          {alert && (
            <div className="rounded-[4px] bg-red-950/85 border border-[#ff8080] text-[#ffb0b0] px-2 py-1 text-[11px] font-mono uppercase tracking-wider animate-pulse">
              Feindkontakt – Angriff im Anmarsch
            </div>
          )}
        </div>
        {sel && (
          <div className="absolute right-2 bottom-2 rounded-[4px] bg-navy-800/95 border border-navy-600 px-2 py-1 text-[11px] font-mono text-ink2 pointer-events-none">
            {(() => { const c = hexCenter(sel.col, sel.row); return fmtPosition(c.lat, c.lon); })()}
          </div>
        )}
        {!sel && <MapLegend />}
      </div>
      {sel && info && (
        <div className="p-3 bg-navy-800/95 border-t border-navy-600">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm min-w-0 flex-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                {TERRAIN[terrainAt(sel.col, sel.row) ?? "sea"]} · Feld {sel.col}/{sel.row}
                {!isHome && ` · ${fmtNum(dist)} km`}
              </div>
              {info.base && (
                <div className="mt-1">
                  <div className="text-base font-semibold flex items-center gap-2">
                    <TacticalIcon kind={info.base.own ? "own" : "other"} size={26} /> {info.base.name}
                  </div>
                  <div className="text-xs text-slate-300">{info.base.own ? "Dein Stützpunkt" : `Stützpunkt von ${info.base.owner}`}</div>
                  {info.base.protection && <div className="text-emerald-300 text-xs">{label(info.base.protection)} – kein Überfall möglich</div>}
                  {isHome && <div className="text-xs text-slate-400">Nächster Handelshafen: {nearestTradePort(home).name} ({fmtNum(nearestTradePort(home).distanceKm)} km)</div>}
                </div>
              )}
              {info.nest && (
                <div className="mt-1">
                  <div className="text-base font-semibold flex items-center gap-2">
                    <TacticalIcon kind={info.nest.empty ? "nestEmpty" : "nest"} level={info.nest.level} size={30} />
                    <span>Piratennest Stufe {info.nest.level} <span className="text-xs font-normal text-slate-400">{LEVEL_TEXT[info.nest.level]}</span></span>
                  </div>
                  {info.nest.empty ? (
                    <div className="text-xs text-slate-400">Verlassen – neu besetzt in {fmtDuration((info.nest.respawnAtMs ?? now) - now)}</div>
                  ) : garrison ? (
                    <div className="text-xs text-slate-300 mt-0.5">
                      <div>
                        Besatzung:{" "}
                        {Object.entries(garrison).filter(([k, v]) => k !== "loot" && typeof v === "number" && v > 0).map(([k, v]) => `${fmtNum(v as number)} ${countLabel(k, v as number)}`).join(", ")}
                      </div>
                      <div className="text-emerald-300">
                        Beute: {Object.entries(garrison.loot as Record<string, number>).map(([r, v]) => `${fmtNum(v)} ${label(r)}`).join(", ")}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              {info.wreck && (
                <div className="text-xs text-slate-300 mt-1 flex items-start gap-2">
                  <TacticalIcon kind="wreck" size={20} />
                  <span>Wrackfeld: {fmtNum(info.wreck.stahl)} Stahl, {fmtNum(info.wreck.elektronik)} Elektronik – jede Mission hierher birgt es mit freiem Laderaum.</span>
                </div>
              )}
              {!info.base && !info.nest && !info.wreck && (
                <div className="text-slate-400 mt-1">Hier ist nichts. Ziele sind Piratennester (rote Raute) und fremde Stützpunkte.</div>
              )}
              {!isHome && (info.base || info.nest) && (
                <div className="text-xs text-slate-400 mt-1">Fahrzeit etwa: Korvette {eta("korvette")}, Landungsschiff {eta("landungsschiff")}</div>
              )}
            </div>
            <button type="button" className="tap rounded-[4px] border border-navy-600 text-slate-300" onClick={() => setSel(null)} aria-label="Schließen">✕</button>
          </div>
          {(info.nest || (info.base && !info.base.own)) && (
            <Button className="w-full mt-2" onClick={() => onPlan(sel)}>Mission planen</Button>
          )}
        </div>
      )}
    </div>
  );
}
