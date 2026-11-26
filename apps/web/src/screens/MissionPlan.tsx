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
import { Button, Card, ErrorLine, Loading, Stepper } from "../ui.tsx";
import { RouteWeather } from "../components/RouteWeather.tsx"; // Wetter auf der Route (v1.6)
// Komfort: Vorlagen, Wiederholen, Probekampf
import { fitUnits, type PlanPreset } from "../lib/plan-request.ts";
import { TemplateBar, shortText } from "../components/Templates.tsx";
import { ProbeCard } from "../components/SimLauncher.tsx";
// Weltereignisse als Ziel
import { KIND_TITLE, useWorldEvents } from "../components/WorldEvents.tsx";
// Nachrichtendienst: Spionageaufträge
import { SpyPlan } from "../components/SpyPlan.tsx";

const TYPES = [
  { id: "ueberfall", text: "Überfall", hint: "Kampf am Ziel, Beute bei Sieg" },
  { id: "aufklaerung", text: "Aufklärung", hint: "Lagebild ohne Kampf" },
  { id: "transport", text: "Transport", hint: "Ladung an einen Stützpunkt" },
  { id: "spionage", text: "Spionage", hint: "Spione des Nachrichtendiensts: Erkunden, Sabotage, Desinformation, Kartell" },
] as const;

/** Bestätigung nach dem Auslaufen, passend zur Art der Mission. */
const SENT_TEXT: Record<string, string> = {
  ueberfall: "Den Kampfbericht findest du nach der Ankunft unter „Meldungen“, die Fahrt auf der Karte.",
  aufklaerung: "Das Lagebild findest du nach der Ankunft unter „Meldungen“, die Fahrt auf der Karte.",
  transport: "Die Ladung wird bei Ankunft gutgeschrieben; die Bestätigung erscheint unter „Meldungen“.",
};

export function MissionPlan({ base, initialTarget, onClose, preset }: { base: BaseData; initialTarget: Target | null; onClose: () => void; onPickOnMap?: () => void; preset?: PlanPreset }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const map = useQuery(trpc.world.map.queryOptions());
  const [type, setType] = useState<"ueberfall" | "aufklaerung" | "transport" | "spionage">(preset?.type ?? "ueberfall");
  const [target, setTarget] = useState<Target | null>(initialTarget);
  // Vorbelegung („Wiederholen“) auf die Einheiten daheim gekürzt; note erklärt die Kürzung.
  const [first] = useState(() => fitUnits(preset?.units ?? {}, Object.fromEntries(base.units.map((u) => [u.id, u.home]))));
  const [units, setUnits] = useState<Record<string, number>>(first.units);
  const [note, setNote] = useState<string | null>(shortText(first.short));
  const [cargo, setCargo] = useState<Record<string, number>>({});
  const [sent, setSent] = useState<{ arriveAtMs: number; type: string } | null>(null);
  // Frische Bestände beim Öffnen
  useEffect(() => {
    void queryClient.invalidateQueries(trpc.base.pathFilter());
  }, []);
  const worldEvents = useWorldEvents(!!target?.eventId);
  const launch = useCommand(
    (i: { key: string; type: string; units: Record<string, number>; col: number; row: number; cargo?: Record<string, number>; eventId?: number }) => trpcClient.mission.launch.mutate(i),
    () => [trpc.base.pathFilter().queryKey],
  );

  const chosen = useMemo(() => Object.fromEntries(Object.entries(units).filter(([, n]) => n > 0)), [units]);
  const cargoSent = type === "transport" ? Object.fromEntries(Object.entries(cargo).filter(([, n]) => n > 0)) : undefined;
  const input = target ? { type, units: chosen, col: target.col, row: target.row, cargo: cargoSent, ...(target.eventId ? { eventId: target.eventId } : {}) } : null;
  const event = target?.eventId ? worldEvents.data?.events.find((e) => e.id === target.eventId) : undefined;
  const preview = useQuery({
    ...trpc.mission.preview.queryOptions(input ?? { type, units: {}, col: 0, row: 0 }),
    enabled: !!input && Object.keys(chosen).length > 0 && type !== "spionage",
    placeholderData: keepPreviousData,
  });

  if (!meta.data || !map.data) return <Loading />;
  const balance = meta.data.balance;
  let cp = 0, troops = 0, space = 0, cargoCap = 0;
  for (const [id, n] of Object.entries(chosen)) {
    const d = balance.units[id];
    cp += (d.commandPoints ?? 0) * n;
    if (d.branch === "land") troops += (d.size ?? 0) * n;
    space += (d.troopSpace ?? 0) * n;
    cargoCap += (d.cargo ?? 0) * n;
  }
  const tInfo = target && !target.eventId ? {
    base: map.data.bases.find((b) => b.col === target.col && b.row === target.row),
    nest: map.data.nests.find((n) => n.col === target.col && n.row === target.row),
  } : null;
  const p = preview.data;

  if (sent) {
    return (
      <Card title="Mission gestartet">
        <div className="flex items-center gap-3"><Icon id={sent.type} size={48} /><p>Der Verband hat abgelegt. Ankunft am Ziel {fmtTime(sent.arriveAtMs)}. {SENT_TEXT[sent.type] ?? ""}</p></div>
        <Button className="mt-3 w-full" onClick={onClose}>Fertig</Button>
      </Card>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-xl font-bold uppercase">Mission planen</h1>
        <Button kind="ghost" onClick={onClose}>Schließen</Button>
      </div>

      <Card title="Art">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => setType(t.id)} className={`tap rounded-xl px-1 py-2 text-sm flex flex-col items-center gap-1 border ${type === t.id ? "border-sea-400 bg-sea-400/10 font-semibold reticle" : "border-navy-600 bg-navy-900"}`}>
              <Icon id={t.id} size={32} />
              {t.text}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1">{TYPES.find((t) => t.id === type)!.hint}</p>
      </Card>

      {type === "spionage" ? <SpyPlan base={base} map={map.data} target={target} setTarget={setTarget} center={initialTarget ?? { col: base.col, row: base.row }} onClose={onClose} /> : <>

      <Card title="Ziel">
        <div className="h-56 rounded-lg overflow-hidden mb-2">
          <HexMap data={map.data} selected={target} onSelect={setTarget} center={initialTarget ?? { col: base.col, row: base.row }} />
        </div>
        <p className="text-sm">
          {!target && "Ziel auf der Karte antippen."}
          {target?.eventId && <>Weltereignis <strong>{event ? KIND_TITLE[event.kind] : "…"}</strong>{event?.siege ? ` vor ${event.siege.name}` : ""} – nur Überfall; {event?.kind === "schatzschiff" ? "Abfangpunkt wird berechnet." : "Kampf auf See."}<br /></>}
          {target && !target.eventId && tInfo?.base && <>Stützpunkt <strong>{tInfo.base.name}</strong> ({tInfo.base.owner}){tInfo.base.protection && <span className="text-messing"> · geschützt: {label(tInfo.base.protection)}</span>}</>}
          {target && !target.eventId && tInfo?.nest && <>Piratennest Stufe <strong>{tInfo.nest.level}</strong>{tInfo.nest.empty ? " (verlassen)" : ""}</>}
          {target && !target.eventId && !tInfo?.base && !tInfo?.nest && <span className="text-slate-400">Feld {target.col}/{target.row}: kein Ziel</span>}
        </p>
      </Card>

      <TemplateBar base={base} units={chosen} type={type} onApply={(u, t, n) => { setUnits(u); if (t) setType(t); setNote(n); }} />

      <Card title="Verband">
        {note && <p className="text-xs text-messing mb-1">{note}</p>}
        <ul className="divide-y divide-navy-700">
          {base.units.filter((u) => u.home > 0 && !balance.units[u.id]?.covert).map((u) => (
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

      {type === "transport" && (
        <Card title="Ladung">
          {balance.resources.map((r) => (
            <div key={r} className="py-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 min-w-0 flex-1"><Icon id={r} size={20} /><span className="min-w-0 break-words leading-tight">{label(r)} <span className="text-xs text-slate-400 whitespace-nowrap">({fmtNum(base.resources[r] ?? 0)})</span></span></span>
              <Stepper value={cargo[r] ?? 0} max={Math.floor(base.resources[r] ?? 0)} onChange={(v) => setCargo({ ...cargo, [r]: v })} />
            </div>
          ))}
        </Card>
      )}

      {type === "ueberfall" && tInfo?.nest && !tInfo.nest.empty && Object.keys(chosen).length > 0 && (
        <Strength balance={balance} units={chosen} level={tInfo.nest.level} />
      )}
      {type === "ueberfall" && target && Object.keys(chosen).length > 0 && (tInfo?.nest || (tInfo?.base && tInfo.base.id !== base.id)) && (
        <ProbeCard
          key={`${target.col}/${target.row}`}
          balance={balance}
          base={base}
          units={chosen}
          target={tInfo.nest ? { kind: "nest", level: tInfo.nest.level, empty: tInfo.nest.empty } : { kind: "base", col: target.col, row: target.row, name: tInfo.base!.name }}
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
                {"weather" in p && p.weather && <RouteWeather w={p.weather} factor={"weatherFactor" in p ? p.weatherFactor : 1} />}
              </>
            ) : (
              <div className="text-red-300">
                {errorText(p.code)}
                {p.code === "target_protected" && tInfo?.base?.protection ? ` Grund: ${label(tInfo.base.protection)}. Ein Überfall ist erst danach möglich.` : ""}
                {"weather" in p && p.weather && <RouteWeather w={p.weather} />}
              </div>
            )}
          </div>
        )}
        <Button
          className="w-full mt-3"
          disabled={!p?.ok || launch.busy || !target}
          onClick={async () => {
            if (!input) return;
            const r = await launch.run(input);
            if (r && r.ok) setSent({ arriveAtMs: r.arriveAtMs, type });
          }}
        >
          Auslaufen
        </Button>
        <ErrorLine text={launch.error} />
      </Card>
      </>}
    </div>
  );
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
