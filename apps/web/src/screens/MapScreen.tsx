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
import { RELATION_HEX, TacticalIcon, relationKind } from "../map/TacticalIcon.tsx";
import { fmtPosition } from "../map/coords.ts";
// Weltereignisse
import { WorldEventCard, useWorldEvents } from "../components/WorldEvents.tsx";

const TERRAIN: Record<string, string> = { sea: "Offene See", coast: "Küste", land: "Binnenland" };
const RELATION_TEXT: Record<string, string> = {
  own: "",
  allianz: "Allianzmitglied – kein Überfall möglich",
  pakt: "Paktpartner – Nichtangriffspakt, kein Überfall möglich",
  krieg: "Kriegsgegner",
  neutral: "Neutral",
};
const LEVEL_TEXT =["", "schwach besetzt", "kleine Bande", "befestigt", "Festung", "Hauptquartier"];

export function MapScreen({ base, focus, onPlan }: { base: BaseData; focus: Target | null; onPlan: (t: Target) => void }) {
  const map = useQuery({ ...trpc.world.map.queryOptions(), refetchInterval: 60000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const worldEvents = useWorldEvents();
  const [sel, setSel] = useState<Target | null>(focus);
  const [recenter, setRecenter] = useState(0);
  const [centerOn, setCenterOn] = useState<Target>(focus ?? { col: base.col, row: base.row });
  // Wetterschicht (v1.6): abschaltbar, Wahl bleibt im Gerät.
  const [showWeather, setShowWeather] = useState(() => localStorage.getItem("tf-wetter") !== "aus");
  const now = useNow();
  const home = useMemo(() => ({ col: base.col, row: base.row }), [base.col, base.row]);
  const alert = base.incoming.some((i) => i.type !== "transport");
  if (!map.data) return <Loading />;
  const at = (t: Target) => ({
    base: map.data.bases.find((b) => b.col === t.col && b.row === t.row),
    nest: map.data.nests.find((n) => n.col === t.col && n.row === t.row),
    wreck: map.data.wrecks.find((w) => w.col === t.col && w.row === t.row),
    event: worldEvents.data?.events.find((e) => e.col === t.col && e.row === t.row),
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
          events={worldEvents.data?.events}
          weather={showWeather ? meta.data?.balance.weather : null}
        />
        <div className="absolute left-2 top-6 flex flex-col gap-1.5 items-start">
          <button
            type="button"
            className="tap rounded-[3px] bg-card border border-ink text-ink px-3 text-[11px] font-display uppercase tracking-[0.12em] flex items-center gap-2"
            onClick={() => { setCenterOn(home); setRecenter((n) => n + 1); }}
          >
            <TacticalIcon kind="own" size={20} /> Mein Hafen
          </button>
          <button
            type="button"
            aria-pressed={showWeather}
            className={`tap rounded-[3px] bg-card border px-3 text-[11px] font-display uppercase tracking-[0.12em] ${showWeather ? "border-ink text-ink" : "border-rule text-ink2"}`}
            onClick={() => setShowWeather((v) => { localStorage.setItem("tf-wetter", v ? "aus" : "an"); return !v; })}
          >
            Wetter {showWeather ? "an" : "aus"}
          </button>
          {alert && (
            <div className="rounded-[3px] bg-card border border-siegel border-l-4 text-siegel px-2 py-1 text-[11px] font-display uppercase tracking-wider">
              Feindkontakt – Angriff im Anmarsch
            </div>
          )}
        </div>
        {sel && (
          <div className="absolute right-2 bottom-2 rounded-[3px] bg-card border border-rule px-2 py-1 text-[11px] mono text-ink2 pointer-events-none">
            {(() => { const c = hexCenter(sel.col, sel.row); return fmtPosition(c.lat, c.lon); })()}
          </div>
        )}
        {!sel && <MapLegend />}
      </div>
      {sel && info && (
        <div className="p-3 pt-2.5 bg-card border-t-[3px] border-double border-ink shadow-[0_-8px_24px_rgba(24,39,58,0.12)]">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm min-w-0 flex-1">
              <div className="text-[11px] mono tracking-wide text-ink2">
                {TERRAIN[terrainAt(sel.col, sel.row) ?? "sea"]} · Feld {sel.col}/{sel.row}
                {!isHome && ` · ${fmtNum(dist)} km`}
              </div>
              {info.base && (
                <div className="mt-1">
                  <div className="font-serif text-[19px] leading-tight flex items-center gap-2 mt-0.5">
                    <TacticalIcon kind={info.base.own ? "own" : relationKind(info.base.relation)} size={26} /> {info.base.name}
                  </div>
                  <div className="text-xs text-slate-300">{info.base.own ? "Dein Stützpunkt" : `Stützpunkt von ${info.base.owner}`}</div>
                  {!info.base.own && (
                    <div className="text-xs font-semibold" style={{ color: RELATION_HEX[info.base.relation] }}>{RELATION_TEXT[info.base.relation]}</div>
                  )}
                  {info.base.protection ? (
                    <div className="text-emerald-300 text-xs">Schutz: {label(info.base.protection)} – kein Überfall möglich</div>
                  ) : !info.base.own && info.base.relation !== "allianz" && info.base.relation !== "pakt" && <div className="text-siegel text-xs">Kein Schutz aktiv – Überfall möglich</div>}
                  {isHome && <div className="text-xs text-slate-400">Nächster Handelshafen: {nearestTradePort(home).name} ({fmtNum(nearestTradePort(home).distanceKm)} km)</div>}
                </div>
              )}
              {info.nest && (
                <div className="mt-1">
                  <div className="font-serif text-[19px] leading-tight flex items-center gap-2 mt-0.5">
                    <TacticalIcon kind={info.nest.empty ? "nestEmpty" : "nest"} level={info.nest.level} size={30} />
                    <span>Piratennest Stufe {info.nest.level} <em className="block text-[13px] text-ink2">{LEVEL_TEXT[info.nest.level]}</em></span>
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
              {info.event && (
                <WorldEventCard e={info.event} onPlan={() => onPlan({ col: info.event!.col, row: info.event!.row, eventId: info.event!.id })} />
              )}
              {!info.base && !info.nest && !info.wreck && !info.event && (
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
