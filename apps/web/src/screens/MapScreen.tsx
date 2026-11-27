import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hexCenter, hexDistanceKm, nearestTradePort, terrainAt } from "@tidefront/world";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtDuration, fmtSeconds, useNow } from "../lib/time.ts";
import { countLabel, fmtNum, label } from "../lib/names.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "./LazyHexMap.tsx";
import { Button, Loading } from "../ui.tsx";
import { MapLegend } from "../map/Legend.tsx";
import { MAP_BTN } from "../map/controls.ts";
import { Icon } from "../icons.tsx";
import { RELATION_HEX, TacticalIcon, relationKind } from "../map/TacticalIcon.tsx";
import { fmtPosition } from "../map/coords.ts";
import { MissionPanel, missionHex } from "../components/MissionSheet.tsx";
import { WeatherChip, WeatherLine } from "../map/WeatherChip.tsx";
// Weltereignisse
import { WorldEventCard, useWorldEvents } from "../components/WorldEvents.tsx";
import { NavalSheet, navalAt, useNaval } from "../components/Naval.tsx"; // See: Minen/Blockade/Konvoi
import { FieldSheet, fieldAt, fieldsRules, useFields } from "../components/Fields.tsx"; // Felder
import { FoundingButton, FoundingInfo, OwnHarborActions } from "../components/HarborMapSheet.tsx"; // Mehrere Häfen
import { FleetLines, IntelStand, UnknownLine } from "../components/IntelStand.tsx"; // Lagebild
import { expansionRules, isFreeCoast, isThreat } from "../lib/expansion.ts";

const TERRAIN: Record<string, string> = { sea: "Offene See", coast: "Küste", land: "Binnenland" };
const RELATION_TEXT: Record<string, string> = {
  own: "",
  allianz: "Allianzmitglied – kein Überfall möglich",
  pakt: "Paktpartner – Nichtangriffspakt, kein Überfall möglich",
  krieg: "Kriegsgegner",
  neutral: "Neutral",
};
const LEVEL_TEXT =["", "schwach besetzt", "kleine Bande", "befestigt", "Festung", "Hauptquartier", "Inselfestung – Spätspiel"];

export function MapScreen({ base, focus, onPlan, onSwitchBase }: { base: BaseData; focus: Target | null; onPlan: (t: Target) => void; onSwitchBase: (id: number) => void }) {
  const map = useQuery({ ...trpc.world.map.queryOptions(), refetchInterval: 60000 });
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const worldEvents = useWorldEvents();
  const naval = useNaval();
  const fields = useFields(); // Felder
  const [sel, setSel] = useState<Target | null>(focus?.missionId ? null : focus);
  const [missionId, setMissionId] = useState<number | null>(focus?.missionId ?? null);
  const [recenter, setRecenter] = useState(0);
  const [centerOn, setCenterOn] = useState<Target>(focus ?? { col: base.col, row: base.row });
  // Wetterschicht (v1.6): abschaltbar, Wahl bleibt im Gerät.
  const [showWeather, setShowWeather] = useState(() => localStorage.getItem("tf-wetter") !== "aus");
  // Lagebild: Schicht „Sensoren“ (gestrichelte Reichweiten) an/aus, Wahl bleibt im Gerät.
  const [showSensors, setShowSensors] = useState(() => localStorage.getItem("tf-sensoren") !== "aus");
  const now = useNow();
  useEffect(() => {
    if (missionId === null) return;
    const m = base.missions.find((x) => x.id === missionId);
    if (!m) return;
    const t = setTimeout(() => { setCenterOn(missionHex(m, { col: base.col, row: base.row }, Date.now())); setRecenter((n) => n + 1); }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);
  const home = useMemo(() => ({ col: base.col, row: base.row }), [base.col, base.row]);
  const hasRadar = base.buildings.some((b) => b.id === "radarstation" && b.level > 0);
  const linkKm = fieldsRules(meta.data?.balance)?.zoneLinkKm ?? 450; // Felder: Zonenlinien
  const fieldLayer = useMemo(() => (fields.data ? { list: fields.data.fields, linkKm } : undefined), [fields.data, linkKm]);
  const alert = base.incoming.some(isThreat);
  // Mehrere Häfen: freies Küstenfeld (Gründung) – Reichweitenkreis um den aktiven Hafen.
  const freeCoast = !!sel && !!map.data && isFreeCoast(sel, map.data, fields.data?.fields);
  const harbors = useMemo(() => ({ active: home, rangeKm: freeCoast ? expansionRules(meta.data?.balance).maxRangeKm : null }), [home, freeCoast, meta.data]);
  if (!map.data) return <Loading />;
  const at = (t: Target) => ({
    base: map.data.bases.find((b) => b.col === t.col && b.row === t.row),
    nest: map.data.nests.find((n) => n.col === t.col && n.row === t.row),
    wreck: map.data.wrecks.find((w) => w.col === t.col && w.row === t.row),
    fleets: map.data.fleets.filter((f) => f.col === t.col && f.row === t.row), // Lagebild: fremde Verbände
    event: worldEvents.data?.events.find((e) => e.col === t.col && e.row === t.row),
    field: fieldAt(fields.data, t), // Felder
    naval: (() => { const n = navalAt(naval.data, t); return n.mines.length > 0 || !!n.blockade || n.convoys.length > 0; })(),
  });
  const info = sel ? at(sel) : null;
  const units = meta.data?.balance.units;
  const dist = sel ? hexDistanceKm(home, sel) : 0;
  const eta = (id: string) => {
    const v = units?.[id]?.speedKmh;
    return v ? fmtSeconds((dist / v) * 3600) : "–";
  };
  const garrison = info?.nest && info.nest.level !== null && meta.data ? meta.data.balance.pirates.nestLevels[String(info.nest.level)] : null;
  const isHome = info?.base?.id === base.id; // aktiver Hafen
  const otherOwn = info?.base?.own && !isHome ? info.base : null; // eigener, nicht aktiver Hafen

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <HexMap
          data={map.data}
          selected={sel}
          onSelect={setSel}
          onMissionTap={(id) => { setSel(null); setMissionId(id); }}
          focusMission={missionId}
          center={centerOn}
          recenter={recenter}
          home={home}
          missions={base.missions}
          alert={alert}
          events={worldEvents.data?.events}
          naval={naval.data}
          fields={fieldLayer}
          weather={showWeather ? meta.data?.balance.weather : null}
          harbors={harbors}
          showSensors={showSensors}
          controls={<>
            <button type="button" className={MAP_BTN} onClick={() => { setCenterOn(home); setRecenter((n) => n + 1); }} aria-label="Mein Hafen" title="Mein Hafen">
              <TacticalIcon kind="own" size={22} />
            </button>
            <button
              type="button"
              aria-pressed={showWeather}
              aria-label={showWeather ? "Wetter ausblenden" : "Wetter einblenden"}
              title={showWeather ? "Wetter aus" : "Wetter an"}
              className={`${MAP_BTN} ${showWeather ? "" : "opacity-60 !border-rule"}`}
              onClick={() => setShowWeather((v) => { localStorage.setItem("tf-wetter", v ? "aus" : "an"); return !v; })}
            >
              <Icon id="wolke" size={24} />
            </button>
            {map.data.intel.sensors.length > 0 && (
              <button
                type="button"
                aria-pressed={showSensors}
                aria-label={showSensors ? "Sensoren ausblenden" : "Sensoren einblenden"}
                title={showSensors ? "Sensoren aus" : "Sensoren an"}
                className={`${MAP_BTN} ${showSensors ? "" : "opacity-60 !border-rule"}`}
                onClick={() => setShowSensors((v) => { localStorage.setItem("tf-sensoren", v ? "aus" : "an"); return !v; })}
              >
                <Icon id="radarstation" size={24} />
              </button>
            )}
          </>}
        />
        {/* Links oben nur noch das kleine Wetterkärtchen (aufklappbar) und die Feindwarnung. */}
        <div className="absolute left-1.5 top-3 flex flex-col gap-1 items-start pointer-events-none">
          {showWeather && meta.data?.balance.weather && <div className="pointer-events-auto"><WeatherChip at={home} wb={meta.data.balance.weather} now={now} radar={hasRadar} /></div>}
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
      {(() => {
        const m = missionId !== null ? base.missions.find((x) => x.id === missionId) : undefined;
        return m ? (
          <MissionPanel
            mission={m}
            now={now}
            home={home}
            onClose={() => setMissionId(null)}
            onShowTarget={(t) => { setMissionId(null); setSel(t); setCenterOn(t); setRecenter((n) => n + 1); }}
          />
        ) : null;
      })()}
      {/* Infopanel: höchstens 45 % der Höhe (Karte bleibt ≥ 55 % sichtbar), Inhalt scrollt, Knöpfe und ✕ fest.
          Neue Abschnitte zum Feld (z. B. Felder) in den Scrollbereich, neue Aktionen in die Knopfleiste unten. */}
      {missionId === null && sel && info && (
        <div className="relative shrink-0 max-h-[45%] min-h-0 flex flex-col bg-card border-t-[3px] border-double border-ink shadow-[0_-8px_24px_rgba(24,39,58,0.12)]">
          <button type="button" className="tap absolute right-3 top-2.5 z-10 rounded-[4px] border border-navy-600 bg-card text-slate-300" onClick={() => setSel(null)} aria-label="Schließen">✕</button>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pt-2.5 pb-1">
            <div className="text-sm min-w-0 pr-12">
              <div className="text-[11px] mono tracking-wide text-ink2">
                {TERRAIN[terrainAt(sel.col, sel.row) ?? "sea"]} · Feld {sel.col}/{sel.row}
                {!isHome && ` · ${fmtNum(dist)} km`}
              </div>
              {info.base && (
                <div className="mt-1">
                  <div className="font-serif text-[19px] leading-tight flex items-center gap-2 mt-0.5">
                    <TacticalIcon kind={info.base.own ? "own" : relationKind(info.base.relation)} size={26} /> {info.base.name}
                  </div>
                  <div className="text-xs text-slate-300">{isHome ? (base.bases.length > 1 ? "Dein aktiver Hafen" : "Dein Stützpunkt") : info.base.own ? "Dein Hafen – zum Verwalten hierhin wechseln" : `Stützpunkt von ${info.base.owner}`}</div>
                  {!info.base.own && (
                    <div className="text-xs font-semibold" style={{ color: RELATION_HEX[info.base.relation] }}>{RELATION_TEXT[info.base.relation]}</div>
                  )}
                  {!info.base.known ? <UnknownLine what="Schutzstatus" /> : info.base.protection ? (
                    <div className="text-emerald-300 text-xs">Schutz: {label(info.base.protection)} – kein Überfall möglich</div>
                  ) : !info.base.own && info.base.relation !== "allianz" && info.base.relation !== "pakt" && <div className="text-siegel text-xs">Kein Schutz aktiv – Überfall möglich</div>}
                  <IntelStand tag={info.base.intel} now={now} />
                  {isHome && <div className="text-xs text-slate-400">Nächster Handelshafen: {nearestTradePort(home).name} ({fmtNum(nearestTradePort(home).distanceKm)} km)</div>}
                </div>
              )}
              {info.nest && info.nest.level === null && (
                <div className="mt-1">
                  <div className="font-serif text-[19px] leading-tight mt-0.5">Piratennest – Lage unbekannt</div>
                  <UnknownLine what="Stufe und Zustand" />
                </div>
              )}
              {info.nest && info.nest.level !== null && (
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
                        {Object.entries(garrison).filter(([k, v]) => k !== "loot" && k !== "respawnHours" && typeof v === "number" && v > 0).map(([k, v]) => `${fmtNum(v as number)} ${countLabel(k, v as number)}`).join(", ")}
                      </div>
                      <div className="text-emerald-300">
                        Beute: {Object.entries(garrison.loot as Record<string, number>).map(([r, v]) => `${fmtNum(v)} ${label(r)}`).join(", ")}
                      </div>
                      {typeof garrison.respawnHours === "number" && <div>Nach einem Sieg erst nach {garrison.respawnHours} Stunden wieder besetzt.</div>}
                    </div>
                  ) : null}
                  <IntelStand tag={info.nest.intel} now={now} />
                </div>
              )}
              {info.wreck && (
                <div className="text-xs text-slate-300 mt-1 flex items-start gap-2">
                  <TacticalIcon kind="wreck" size={20} />
                  <span>Wrackfeld: {fmtNum(info.wreck.stahl)} Stahl, {fmtNum(info.wreck.elektronik)} Elektronik – jede Mission hierher birgt es mit freiem Laderaum.<IntelStand tag={info.wreck.intel} now={now} /></span>
                </div>
              )}
              <FleetLines fleets={info.fleets} now={now} />
              {info.event && (
                <WorldEventCard e={info.event} onPlan={() => onPlan({ col: info.event!.col, row: info.event!.row, eventId: info.event!.id })} />
              )}
              {freeCoast && <FoundingInfo base={base} sel={sel} />}
              {meta.data?.balance.weather && terrainAt(sel.col, sel.row) !== "land" && <WeatherLine at={sel} wb={meta.data.balance.weather} now={now} home={home} radar={hasRadar} />}
              <NavalSheet data={naval.data} sel={sel} onPlan={onPlan} />
              <FieldSheet data={fields.data} sel={sel} onPlan={onPlan} />
              {!info.base && !info.nest && !info.wreck && !info.event && !info.naval && !info.field && !freeCoast && info.fleets.length === 0 && (
                <div className="text-slate-400 mt-1">Hier ist nichts. Ziele sind Piratennester (rote Raute), Rohstofffelder und fremde Stützpunkte.</div>
              )}
              {!isHome && (info.base || info.nest || info.field) && (
                <div className="text-xs text-slate-400 mt-1">Fahrzeit etwa: Korvette {eta("korvette")}, Landungsschiff {eta("landungsschiff")}</div>
              )}
            </div>
          </div>
          {(otherOwn || freeCoast || (info.nest || (info.base && !info.base.own)) || (!info.base && !info.nest && !info.field && terrainAt(sel.col, sel.row) === "sea" && naval.data?.rules.mines && hexDistanceKm(home, sel) <= naval.data.rules.mines.layRadiusKm)) && (
            <div className="shrink-0 px-3 pb-3 pt-2 border-t border-rule flex flex-wrap gap-2">
              {(info.nest || (info.base && !info.base.own)) && (
                <Button className="flex-1" onClick={() => onPlan(sel)}>Mission planen</Button>
              )}
              {otherOwn && <OwnHarborActions sel={otherOwn} onSwitch={onSwitchBase} onPlan={onPlan} />}
              {freeCoast && <FoundingButton base={base} sel={sel} onPlan={onPlan} />}
              {!info.base && !info.nest && !info.field && terrainAt(sel.col, sel.row) === "sea" && naval.data?.rules.mines && hexDistanceKm(home, sel) <= naval.data.rules.mines.layRadiusKm && (
                <Button kind="secondary" className="flex-1" onClick={() => onPlan({ ...sel, naval: "minen" })}>Minen legen</Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
