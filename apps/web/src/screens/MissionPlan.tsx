import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type BaseData, type Balance } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { Icon, IconTile } from "../icons.tsx";
import { unitTone } from "../lib/info.ts";
import { fmtSeconds, fmtTime } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "./LazyHexMap.tsx";
import { ActionBar, BackButton, Button, Card, ErrorLine, Loading, Stepper, SmallButton } from "../ui.tsx";
import { MapGate } from "../components/MapGate.tsx"; // Mini-Karte erst nach Antippen bedienbar
import { ActionRemedy, ReasonInline, ReasonLine, hasRemedy } from "../components/Remedy.tsx"; // „Was hilft?“
import { RouteWeather } from "../components/RouteWeather.tsx"; // Wetter auf der Route (v1.6)
// Komfort: Vorlagen, Wiederholen, Probekampf
import { fitUnits, isPlanType, type PlanPreset } from "../lib/plan-request.ts";
import { TemplateBar, shortText } from "../components/Templates.tsx";
import { ProbeCard } from "../components/SimLauncher.tsx";
// Weltereignisse als Ziel
import { KIND_TITLE, useWorldEvents } from "../components/WorldEvents.tsx";
// Nachrichtendienst: Spionageaufträge
import { SpyPlan } from "../components/SpyPlan.tsx";
// Admirale: Führung des Verbands
import { AdmiralPick } from "../components/Admirals.tsx";
// Allianz-Ops: Stationieren, als Sammelangriff eröffnen
import { RaidOpenCard } from "../components/AllianceOps.tsx";
import { HoldHours, MineWarning } from "../components/Naval.tsx"; // See: Minen/Blockade/Konvoi
import { FieldTargetLine, StayAllToggle, fieldsRules, useFields } from "../components/Fields.tsx"; // Felder
import { ExpansionTargetLine, OriginLine, OwnHarborPick } from "../components/ExpansionPlan.tsx"; // Mehrere Häfen
import { buildingLevel, expansionRules } from "../lib/expansion.ts";
import { IntelOpsPlan, type IntelOpKind } from "../components/IntelOpsPlan.tsx"; // Lagebild Stufe 2

const TYPES = [
  { id: "ueberfall", text: "Überfall", hint: "Kampf am Ziel, Beute bei Sieg" },
  { id: "aufklaerung", text: "Aufklärung", hint: "Lagebild ohne Kampf" },
  { id: "transport", text: "Transport", hint: "Ladung an einen Stützpunkt" },
  { id: "spionage", text: "Spionage", hint: "Spione des Nachrichtendiensts: Erkunden, Sabotage, Desinformation, Kartell" },
  { id: "stationierung", text: "Stationieren", hint: "Truppen verteidigen den Hafen eines Verbündeten mit, bis du sie zurückrufst" }, // Allianz-Ops
  // See: Minen/Blockade/Konvoi (Abfangen nur mit einem Konvoi als Ziel, über die Karte)
  { id: "minen", text: "Minen legen", hint: "Minenleger legen ein Minenfeld auf offener See nahe dem eigenen Hafen" },
  { id: "raeumen", text: "Minen räumen", hint: "Minenräumer räumen fremde Minenfelder auf dem Zielfeld" },
  { id: "blockade", text: "Blockade", hint: "Bewaffnete Schiffe liegen vor einem fremden Hafen: Produktion, Lieferungen und Börse des Ziels leiden" },
  { id: "abfangen", text: "Abfangen", hint: "Konvoi eines Kriegsgegners auf See abfangen: Kampf gegen das Geleit, Beute aus der Ladung" },
  { id: "besetzen", text: "Besetzen", hint: "Rohstofffeld einnehmen: Seekampf gegen Wache oder Besatzung, danach bleibt eine Besatzung und der Ertrag fließt per Konvoi" }, // Felder
  // Mehrere Häfen
  { id: "gruendung", text: "Gründen", hint: "Ein Kolonieschiff gründet auf einem freien Küstenfeld einen Außenposten; das Schiff wird dabei verbraucht" },
  { id: "verlegung", text: "Verlegen", hint: "Einheiten (und Admiral) ziehen dauerhaft in einen anderen eigenen Hafen" },
  // Lagebild Stufe 2
  { id: "patrouille", text: "Patrouille", hint: "Schiffe oder Drohnen fahren 4–12 h über 2–4 Wegpunkte und erkennen alles im Umkreis" },
  { id: "kampagne", text: "Kampagne", hint: "Aufklärung von bis zu 4 Zielen nacheinander, je Ziel ein Lagebild" },
  { id: "radarposten", text: "Radarposten", hint: "Pioniere und ein Landungsschiff errichten auf einer Küste einen Radarposten (250 km)" },
  { id: "postenangriff", text: "Posten angreifen", hint: "Angriff auf einen fremden Radarposten" },
] as const;
/** Neulinge (nur Heimathafen, Kommandozentrale bis Stufe NEWBIE_KZ) sehen zuerst nur diese Arten; der Rest liegt hinter „Weitere Missionsarten“. */
const BASIC_TYPES = new Set<string>(["ueberfall", "aufklaerung"]);
const NEWBIE_KZ = 3;
const INTEL_OPS = new Set<string>(["patrouille", "kampagne", "radarposten", "postenangriff"]); // Lagebild Stufe 2
/** Nur mit passendem Ziel angeboten – dann auch für Neulinge sichtbar. */
const CONTEXT_TYPES = new Set<string>(["abfangen", "besetzen", "postenangriff"]);
type PlanKind = (typeof TYPES)[number]["id"];

/** Bestätigung nach dem Auslaufen, passend zur Art der Mission. */
const SENT_TEXT: Record<string, string> = {
  ueberfall: "Den Kampfbericht findest du nach der Ankunft unter „Meldungen“, die Fahrt auf der Karte.",
  aufklaerung: "Das Lagebild findest du nach der Ankunft unter „Meldungen“, die Fahrt auf der Karte.",
  transport: "Die Ladung wird bei Ankunft gutgeschrieben; die Bestätigung erscheint unter „Meldungen“.",
  stationierung: "Die Truppen verteidigen den Hafen des Verbündeten ab der Ankunft mit. Zurückrufen unter „Truppen“.",
  sammelangriff: "Deine Allianz kann jetzt beitreten (Allianz → Angriffe). Zur Frist laufen alle gemeinsam aus.",
  minen: "Das Minenfeld liegt nach der Ankunft; der Bericht erscheint unter „Meldungen“.",
  raeumen: "Der Räumbericht erscheint nach der Ankunft unter „Meldungen“.",
  blockade: "Nach der Ankunft beginnt die Blockade; das Ziel wird benachrichtigt.",
  abfangen: "Der Kampfbericht erscheint nach dem Abfangen unter „Meldungen“.",
  besetzen: "Nach dem Sieg hält deine Besatzung das Feld; den Ertrag und den Rückruf findest du unter „Truppen“ → Meine Felder.", // Felder
  gruendung: "Bei Ankunft entsteht dein Außenposten; wechsle dann oben in der Kopfleiste dorthin.",
  verlegung: "Bei Ankunft gehören die Einheiten zum Zielhafen; die Bestätigung erscheint unter „Meldungen“.",
  patrouille: "Ab dem ersten Wegpunkt fährt der Verband seine Runde; was er sieht, steht auf der Karte und unter „Meldungen“ → Lagebild.",
  kampagne: "Je Ziel kommt ein Lagebild unter „Meldungen“; der Verband fährt danach zum nächsten Ziel.",
  radarposten: "Bei Ankunft steht der Posten; verwalten unter „Meldungen“ → Lagebild.",
  postenangriff: "Den Kampfbericht findest du nach der Ankunft unter „Meldungen“.",
};

export function MissionPlan({ base, initialTarget, onClose, preset }: { base: BaseData; initialTarget: Target | null; onClose: () => void; onPickOnMap?: () => void; preset?: PlanPreset }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const map = useQuery(trpc.world.map.queryOptions());
  const [type, setType] = useState<PlanKind>(preset?.type ?? initialTarget?.expansion ?? initialTarget?.naval ?? initialTarget?.fieldMission ?? initialTarget?.intelOp ?? (initialTarget?.postId ? "postenangriff" : initialTarget?.convoyId ? "abfangen" : "ueberfall"));
  const [holdHours, setHoldHours] = useState(4); // See: Blockade
  const [stayAll, setStayAll] = useState(false); // Felder: ganzer Verband bleibt
  const fieldsQ = useFields(); // Felder: Feldzeichen auf der Zielkarte
  const fieldLayer = useMemo(() => (fieldsQ.data && meta.data ? { list: fieldsQ.data.fields, linkKm: fieldsRules(meta.data.balance)?.zoneLinkKm ?? 450 } : undefined), [fieldsQ.data, meta.data]);
  const [target, setTarget] = useState<Target | null>(initialTarget);
  // Vorbelegung („Wiederholen“) auf die Einheiten daheim gekürzt; note erklärt die Kürzung.
  const [first] = useState(() => fitUnits(preset?.units ?? {}, Object.fromEntries(base.units.map((u) => [u.id, u.home]))));
  const [units, setUnits] = useState<Record<string, number>>(first.units);
  const [note, setNote] = useState<string | null>(shortText(first.short));
  const [cargo, setCargo] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<{ arriveAtMs: number; type: string } | null>(null);
  const [admiralId, setAdmiralId] = useState<number | null>(null); // Admirale
  // Art: nach der Auswahl auf eine Zeile mit „ändern“ eingeklappt (vorbelegt = schon gewählt).
  const [whyOpen, setWhyOpen] = useState(false); // „Was hilft?“ in der Vorschau
  const [barOpen, setBarOpen] = useState(false); // … und über der Aktionsleiste (grauer Knopf)
  const [moreTypes, setMoreTypes] = useState(false);
  const [typeOpen, setTypeOpen] = useState(!preset?.type && !initialTarget?.naval && !initialTarget?.convoyId && !initialTarget?.expansion && !initialTarget?.intelOp && !initialTarget?.postId);
  // Frische Bestände beim Öffnen
  useEffect(() => {
    void queryClient.invalidateQueries(trpc.base.pathFilter());
  }, []);
  const worldEvents = useWorldEvents(!!target?.eventId);
  const launch = useCommand(
    (i: { key: string; type: string; units: Record<string, number>; col: number; row: number; cargo?: Record<string, number>; eventId?: number; blockadeId?: number; convoyId?: number; holdHours?: number; admiralId?: number; fieldId?: number; stayAll?: boolean }) => trpcClient.mission.launch.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.admiral.pathFilter().queryKey], // Admirale: Status
  );

  // Besetzen: nur Schiffe (Seekampf, Server-Code field_ships_only) – Land- und Lufteinheiten sind gar nicht wählbar und zählen nicht mit.
  const landOk = (id: string) => type !== "besetzen" || meta.data?.balance.units[id]?.branch === "see";
  const chosen = useMemo(() => Object.fromEntries(Object.entries(units).filter(([id, n]) => n > 0 && landOk(id))), [units, type, meta.data]);
  const cargoSent = type === "transport" || type === "verlegung" ? Object.fromEntries(Object.entries(cargo).filter(([, n]) => n > 0)) : undefined;
  const naval = target?.blockadeId ? { blockadeId: target.blockadeId } : target?.convoyId ? { convoyId: target.convoyId } : type === "blockade" ? { holdHours } : target?.fieldId ? { fieldId: target.fieldId, ...(type === "besetzen" ? { stayAll } : {}) } : {}; // See, Felder
  const input = target ? { type, units: chosen, col: target.col, row: target.row, cargo: cargoSent, ...(target.eventId ? { eventId: target.eventId } : {}), ...(admiralId ? { admiralId } : {}), ...naval } : null;
  const event = target?.eventId ? worldEvents.data?.events.find((e) => e.id === target.eventId) : undefined;
  const preview = useQuery({
    ...trpc.mission.preview.queryOptions(input ?? { type, units: {}, col: 0, row: 0 }),
    enabled: !!input && Object.keys(chosen).length > 0 && type !== "spionage",
    placeholderData: keepPreviousData,
  });

  if (!meta.data || !map.data) return <Loading cards={3} />;
  const balance = meta.data.balance;
  const xRules = expansionRules(balance); // Mehrere Häfen
  const offered = TYPES.filter((t) => (t.id !== "abfangen" || target?.convoyId) && (t.id !== "postenangriff" || target?.postId) && (!INTEL_OPS.has(t.id) || !!balance.intel?.patrol) && (t.id !== "besetzen" || target?.fieldId) && (t.id !== "verlegung" || base.bases.length > 1) && (t.id !== "gruendung" || base.bases.length < xRules.maxBases));
  const hideAdvanced = !moreTypes && base.isHome && base.bases.length === 1 && buildingLevel(base, "kommandozentrale") <= NEWBIE_KZ;
  const ownTarget = target ? base.bases.find((b) => b.col === target.col && b.row === target.row && b.id !== base.id) : undefined;
  let cp = 0, troops = 0, space = 0, cargoCap = 0;
  for (const [id, n] of Object.entries(chosen)) {
    const d = balance.units[id];
    cp += (d.commandPoints ?? 0) * n;
    if (d.branch === "land") troops += (d.size ?? 0) * n;
    space += (d.troopSpace ?? 0) * n;
    cargoCap += (d.cargo ?? 0) * n;
  }
  const tInfo = target && !target.eventId && !target.blockadeId && !target.convoyId ? {
    base: map.data.bases.find((b) => b.col === target.col && b.row === target.row),
    nest: map.data.nests.find((n) => n.col === target.col && n.row === target.row),
  } : null;
  const p = preview.data;
  // „Was hilft?“: Verband und Entfernung für konkrete Zahlen (Treibstoff, Kommandopunkte, Reichweite).
  const why = { units: chosen, cargo: cargoSent, type, distanceKm: p && "distanceKm" in p ? p.distanceKm : undefined };

  if (sent) {
    return (
      <Card title={sent.type === "sammelangriff" ? "Sammelangriff eröffnet" : "Mission gestartet"}>
        <div className="flex items-center gap-3"><Icon id={sent.type} size={48} /><p>{sent.type === "sammelangriff" ? "Dein Verband ist gebunden. Ankunft frühestens" : "Der Verband hat abgelegt. Ankunft am Ziel"} {fmtTime(sent.arriveAtMs)}. {SENT_TEXT[sent.type] ?? ""}</p></div>
        <Button className="mt-3 w-full" onClick={onClose}>Fertig</Button>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-xl font-bold uppercase">Mission planen</h1>
        <BackButton onClick={onClose} />
      </div>

      <Card title="Art" right={!typeOpen ? <SmallButton className="-my-3" onClick={() => setTypeOpen(true)}>Ändern</SmallButton> : undefined}>
        {!typeOpen ? (
          <div className="flex items-center gap-2">
            <Icon id={type} size={30} />
            <span className="font-semibold">{TYPES.find((t) => t.id === type)!.text}</span>
            <span className="text-xs text-ink2 min-w-0 truncate">{TYPES.find((t) => t.id === type)!.hint}</span>
          </div>
        ) : <>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {offered.filter((t) => !hideAdvanced || BASIC_TYPES.has(t.id) || CONTEXT_TYPES.has(t.id) || t.id === type).map((t) => (
            <button key={t.id} type="button" onClick={() => { setType(t.id); setTypeOpen(false); }} className={`tap rounded-xl px-1 py-2 text-sm flex flex-col items-center gap-1 border ${type === t.id ? "border-sea-400 bg-sea-400/10 font-semibold reticle" : "border-navy-600 bg-navy-900"}`}>
              <Icon id={t.id} size={32} />
              {t.text}
            </button>
          ))}
        </div>
        {hideAdvanced && offered.some((t) => !BASIC_TYPES.has(t.id) && !CONTEXT_TYPES.has(t.id) && t.id !== type) && (
          <SmallButton className="mt-2 w-full" expanded={false} onClick={() => setMoreTypes(true)}>Weitere Missionsarten ▾</SmallButton>
        )}
        <p className="text-xs text-slate-400 mt-1">{TYPES.find((t) => t.id === type)!.hint}</p>
        </>}
      </Card>

      {type === "spionage" ? <SpyPlan base={base} map={map.data} target={target} setTarget={setTarget} center={initialTarget ?? { col: base.col, row: base.row }} onClose={onClose} />
        : INTEL_OPS.has(type) ? <IntelOpsPlan op={type as IntelOpKind} base={base} map={map.data} initial={initialTarget} onSent={(at) => setSent({ arriveAtMs: at, type })} /> : <>

      <Card title="Ziel">
        <OriginLine base={base} />
        {(type === "transport" || type === "verlegung") && <OwnHarborPick base={base} target={target} onPick={setTarget} />}
        <MapGate className="h-56 rounded-lg overflow-hidden mb-2">
          <HexMap data={map.data} selected={target} onSelect={(h) => { const f = fieldsQ.data?.fields.find((x) => x.col === h.col && x.row === h.row); setTarget(f ? { ...h, fieldId: f.id } : h); }} center={initialTarget ?? { col: base.col, row: base.row }} fields={fieldLayer} />
        </MapGate>
        <p className="text-sm">
          {!target && "„Karte bedienen“ und Ziel auf der Karte antippen."}
          {target?.blockadeId && <>Blockadeverband vor dem Hafen – nur Überfall; Seekampf auf dem Feld.<br /></>}
          {target?.convoyId && <>Feindlicher Konvoi – Abfangpunkt wird berechnet.<br /></>}
          {target?.fieldId && <FieldTargetLine fieldId={target.fieldId} />}
          {target?.eventId && <>Weltereignis <strong>{event ? KIND_TITLE[event.kind] : "…"}</strong>{event?.siege ? ` vor ${event.siege.name}` : ""} – nur Überfall; {event?.kind === "schatzschiff" ? "Abfangpunkt wird berechnet." : "Kampf auf See."}<br /></>}
          {target && (type === "gruendung" || ownTarget || type === "verlegung") && <ExpansionTargetLine type={type} base={base} map={map.data} target={target} fields={fieldsQ.data?.fields} units={chosen} />}
          {target && type !== "gruendung" && type !== "verlegung" && !ownTarget && !target.eventId && !target.blockadeId && !target.convoyId && tInfo?.base && <>Stützpunkt <strong>{tInfo.base.name}</strong> ({tInfo.base.owner}){tInfo.base.protection && <span className="text-messing"> · geschützt: {label(tInfo.base.protection)}</span>}</>}
          {target && !target.eventId && !target.blockadeId && !target.convoyId && tInfo?.nest && (tInfo.nest.level === null ? <>Piratennest – <strong>Lage unbekannt</strong> (Stufe und Zustand erst mit Sicht oder Aufklärung)</> : <>Piratennest Stufe <strong>{tInfo.nest.level}</strong>{tInfo.nest.empty ? " (verlassen)" : ""}</>)}
          {target && type !== "gruendung" && type !== "verlegung" && !target.eventId && !target.blockadeId && !target.convoyId && !tInfo?.base && !tInfo?.nest && !target.fieldId && <span className="text-slate-400">Feld {target.col}/{target.row}: kein Ziel</span>}
        </p>
      </Card>

      {type === "blockade" && <HoldHours value={holdHours} onChange={setHoldHours} />}
      {type === "besetzen" && <StayAllToggle value={stayAll} onChange={setStayAll} balance={balance} fieldId={target?.fieldId} />}
      {target && Object.keys(chosen).length > 0 && type !== "aufklaerung" && <MineWarning col={target.col} row={target.row} units={chosen} />}

      {type !== "stationierung" && <TemplateBar base={base} units={chosen} type={isPlanType(type) ? type : "ueberfall"} onApply={(u, t, n) => { setUnits(u); if (t) setType(t); setNote(n); }} />}

      <Card title="Verband">
        {note && <p className="text-xs text-messing mb-1">{note}</p>}
        <ul className="divide-y divide-navy-700">
          {base.units.filter((u) => u.home > 0 && !balance.units[u.id]?.covert && landOk(u.id)).map((u) => (
            <li key={u.id} className="py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1"><IconTile id={u.id} size={36} tone={unitTone(balance, u.id)} /><div className="min-w-0 break-words leading-tight">{label(u.id)}<div className="text-xs text-slate-400">{fmtNum(u.home)} daheim</div></div></div>
              <Stepper value={units[u.id] ?? 0} max={u.home} onChange={(v) => setUnits({ ...units, [u.id]: v })} />
            </li>
          ))}
        </ul>
        {base.units.every((u) => u.home === 0) && <p className="text-sm text-slate-400">Keine Einheiten daheim.</p>}
        <div className="text-xs text-slate-300 mt-2 grid grid-cols-2 gap-1">
          <span>Kommandopunkte</span><span className={`text-right ${cp > base.commandPoints ? "text-red-300" : ""}`}>{fmtNum(cp, 1)}/{fmtNum(base.commandPoints)}</span>
          <span>Truppen / Platz</span><span className={`text-right ${troops > space ? "text-red-300" : ""}`}>{fmtNum(troops)}/{fmtNum(space)}</span>
          <span>Ladekapazität</span><span className="text-right">{fmtNum(cargoCap)}</span>
        </div>
      </Card>

      {(type === "transport" || type === "verlegung") && (
        <Card title="Ladung">
          {balance.resources.map((r) => (
            <div key={r} className="py-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 min-w-0 flex-1"><Icon id={r} size={20} /><span className="min-w-0 break-words leading-tight">{label(r)} <span className="text-xs text-slate-400 whitespace-nowrap">({fmtNum(base.resources[r] ?? 0)})</span></span></span>
              <Stepper value={cargo[r] ?? 0} max={Math.floor(base.resources[r] ?? 0)} onChange={(v) => setCargo({ ...cargo, [r]: v })} />
            </div>
          ))}
        </Card>
      )}

      <AdmiralPick value={admiralId} onChange={setAdmiralId} />{/* Admirale führen auch Feld- und Weltereignis-Verbände */}

      {/* Lagebild: ohne Erkennung keine Stärke und kein Probekampf */}
      {type === "ueberfall" && tInfo?.nest && tInfo.nest.level !== null && !tInfo.nest.empty && Object.keys(chosen).length > 0 && (
        <Strength balance={balance} units={chosen} level={tInfo.nest.level} />
      )}
      {type === "ueberfall" && target && Object.keys(chosen).length > 0 && ((tInfo?.nest && tInfo.nest.level !== null) || (tInfo?.base && tInfo.base.id !== base.id)) && (
        <ProbeCard
          key={`${target.col}/${target.row}`}
          balance={balance}
          base={base}
          units={chosen}
          target={tInfo.nest && tInfo.nest.level !== null ? { kind: "nest", level: tInfo.nest.level, empty: !!tInfo.nest.empty } : { kind: "base", col: target.col, row: target.row, name: tInfo.base!.name }}
          onScout={() => setType("aufklaerung")}
        />
      )}

      <Card title="Vorschau">
        {!target || Object.keys(chosen).length === 0 ? (
          <p className="text-sm text-slate-400">Ziel und Einheiten wählen.</p>
        ) : !p ? (
          <p className="text-sm text-slate-400">Berechne …</p>
        ) : (
          <div className="text-sm">
            {"distanceKm" in p && <div>Entfernung {fmtNum(p.distanceKm)} km</div>}
            {p.ok ? (
              <>
                <div>Reisezeit {fmtSeconds(p.travelSeconds)} je Richtung</div>
                <div>Treibstoff {fmtNum(p.fuelCost)} (hin und zurück)</div>
                <div>Ankunft {fmtTime(p.arriveAtMs)} · zurück {fmtTime(p.returnAtMs)}</div>
                {"intercept" in p && p.intercept && <div>Abfangpunkt Feld {p.intercept.col}/{p.intercept.row}</div>}
                {"weather" in p && p.weather && balance.weather && <RouteWeather w={p.weather} wb={balance.weather} factor={"weatherFactor" in p ? p.weatherFactor : 1} />}
              </>
            ) : (
              <div className="text-red-300">
                <ReasonLine code={p.code} detail={why} className="" text={`${errorText(p.code)}${p.code === "target_protected" && tInfo?.base?.protection ? ` Grund: ${label(tInfo.base.protection)}. Ein Überfall ist erst danach möglich.` : ""}`} open={whyOpen} onOpenChange={setWhyOpen} />
                {"weather" in p && p.weather && balance.weather && <RouteWeather w={p.weather} wb={balance.weather} />}
              </div>
            )}
          </div>
        )}
      </Card>
      {type === "ueberfall" && target && Object.keys(chosen).length > 0 && (tInfo?.base || tInfo?.nest || target.eventId) && (
        <RaidOpenCard balance={balance} target={target} units={chosen} ok={!!p?.ok} travelSeconds={p?.ok ? p.travelSeconds : null} onDone={(at) => setSent({ arriveAtMs: at, type: "sammelangriff" })} />
      )}
      {/* Fixierte Leiste: Kurzfassung „n Einheiten · Dauer“ und Auslaufen (Details in „Vorschau“). */}
      <ActionBar>
        <ErrorLine text={launch.error} code={launch.code} detail={why} />
        {p && !p.ok && <ActionRemedy code={p.code} detail={why} open={barOpen} onClose={() => setBarOpen(false)} />}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="font-semibold truncate">{unitCount(Object.values(chosen).reduce((a, b) => a + b, 0))}{ownTarget ? ` → ${ownTarget.name}` : target ? ` · ${type === "gruendung" ? "Außenposten " : "Feld "}${target.col}/${target.row}` : ""}</div>
            {p && !p.ok && target && Object.keys(chosen).length > 0
              ? <ReasonInline code={p.code} open={barOpen} onToggle={() => setBarOpen(!barOpen)} />
              : <div className="text-xs text-ink2 truncate">{!target ? "Ziel wählen" : Object.keys(chosen).length === 0 ? "Einheiten wählen" : !p ? "Berechne …" : p.ok ? `Fahrt ${fmtSeconds(p.travelSeconds)} · ${fmtNum(p.fuelCost)} Treibstoff` : errorText(p.code)}</div>}
          </div>
          <Button
            className="shrink-0"
            disabled={!p?.ok || launch.busy || !target}
            onBlocked={p && !p.ok && hasRemedy(p.code) ? () => setBarOpen(!barOpen) : undefined}
            onClick={async () => {
              if (!input) return;
              const r = await launch.run(input);
              if (r && r.ok) setSent({ arriveAtMs: r.arriveAtMs, type });
            }}
          >
            {type === "gruendung" ? "Gründen" : type === "verlegung" ? "Verlegen" : "Auslaufen"}
          </Button>
        </div>
      </ActionBar>
      </>}
    </div>
  );
}

/** „1 Einheit“, „3 Einheiten“. */
function unitCount(n: number): string {
  return `${fmtNum(n)} ${n === 1 ? "Einheit" : "Einheiten"}`;
}

/** Grobe Einschätzung gegen ein Nest: Feuerkraft zur See und an Land im Vergleich (keine Simulation). */
function Strength({ balance, units, level }: { balance: Balance; units: Record<string, number>; level: number }) {
  const nest = balance.pirates.nestLevels[String(level)] as Record<string, unknown> | undefined;
  if (!nest) return null;
  const all = { ...balance.units, ...balance.npcUnits } as Balance["units"];
  let sea = 0, land = 0, enemySea = 0, enemyLand = 0, space = 0, troops = 0, subs = 0, enemyHunt = 0, batteries = 0;
  for (const [id, n] of Object.entries(units)) {
    const u = all[id];
    if (!u) continue;
    // U-Boote: Torpedos wirken gegen Schnellboote nur mit ihrem (kleinen) Bonusfaktor.
    if (u.branch === "see") sea += u.attack.see * n * (u.submerged ? u.bonus.schnellboot ?? 1 : 1);
    if (u.submerged) subs += n;
    if (u.branch === "land") { land += u.attack.land * n; troops += (u.size ?? 0) * n; }
    space += (u.troopSpace ?? 0) * n;
  }
  for (const [id, v] of Object.entries(nest)) {
    if (typeof v !== "number" || v <= 0) continue;
    const u = all[id];
    const d = balance.defenses[id];
    if (u?.branch === "see") enemySea += u.attack.see * v;
    enemyHunt += ((u ?? d)?.attack?.uboot ?? 0) * v;
    if (d?.attack && d.attack.see > 0) batteries += v;
    if (u?.branch === "land") enemyLand += u.attack.land * v;
    if (d?.attack) { enemySea += d.attack.see * v; enemyLand += d.attack.land * v; }
  }
  const rows: [string, number, number][] = [["See", sea, enemySea], ["Land", land, enemyLand]];
  const noLanding = space === 0 || troops === 0;
  const ratio = Math.min(enemySea > 0 ? sea / enemySea : 9, enemyLand > 0 ? land / enemyLand : 9);
  const verdict = noLanding ? ["Ohne Landungsschiff und Truppen kein Sieg und keine Beute.", "text-red-300"] : ratio >= 1.6 ? ["Gute Aussichten.", "text-emerald-300"] : ratio >= 1 ? ["Knapp – mit Verlusten rechnen.", "text-brass-300"] : ["Riskant – der Verband ist wohl zu schwach.", "text-red-300"];
  return (
    <Card title="Einschätzung">
      <div className="space-y-2 text-sm">
        {rows.map(([name, own, enemy]) => (
          <div key={name}>
            <div className="flex justify-between text-xs text-slate-400"><span>Feuerkraft {name}</span><span className="tabular-nums">{fmtNum(own)} gegen {fmtNum(enemy)}</span></div>
            <div className="flex h-1.5 overflow-hidden bg-navy-950">
              <div className="bg-sea-400" style={{ width: `${(own / Math.max(1, own + enemy)) * 100}%` }} />
              <div className="bg-red-500 flex-1" />
            </div>
          </div>
        ))}
        <p className={`font-semibold ${verdict[1]}`}>{verdict[0]}</p>
        {subs > 0 && (
          <p className="text-xs text-slate-300">
            {enemyHunt > 0 ? "Das Nest hat U-Jagd: auch U-Boote können sinken." : "Das Nest hat keine U-Jagd: deine U-Boote sind dort nicht zu treffen."}
            {batteries > 0 ? " Küstenbatterien treffen sie nicht, werden aber auch nicht von Torpedos getroffen – sie schießen weiter auf die Schiffe über Wasser." : ""}
          </p>
        )}
        <p className="text-xs text-slate-400">Grobe Schätzung aus den Angriffswerten, ohne Zufall, Boni und Lebenspunkte. Eine Aufklärung zeigt die Besatzung genau.</p>
      </div>
    </Card>
  );
}
