// Missionsplanung Lagebild Stufe 2: Patrouille (2–4 Wegpunkte auf See antippen, Dauer 4/8/12 h), Aufklärungskampagne
// (bis zu 4 Ziele nacheinander), Radarposten errichten (freie Küste oder eigenes Feld) und Angriff auf einen fremden
// Posten. Handyfreundlich: Karte antippen fügt hinzu, Antippen eines Punkts (oder seines Chips) entfernt ihn.
// Gerechnet und geprüft wird auf dem Server (intel.preview / intel.launch).
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryClient, trpc, trpcClient, type BaseData, type MapData, type Balance } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { fmtSeconds, fmtTime } from "../lib/time.ts";
import { unitTone } from "../lib/info.ts";
import type { Target } from "../App.tsx";
import { HexMap } from "../screens/LazyHexMap.tsx";
import { terrainAt } from "@tidefront/world";
import { Icon, IconTile } from "../icons.tsx";
import { ActionBar, Button, Card, ErrorLine, Segments, SmallButton, Stepper } from "../ui.tsx";
import { ActionRemedy, ReasonInline, ReasonLine, hasRemedy } from "./Remedy.tsx";

export type IntelOpKind = "patrouille" | "kampagne" | "radarposten" | "postenangriff";
type Hex = { col: number; row: number };

const HINT: Record<IntelOpKind, string> = {
  patrouille: "Tippe 2–4 Seefelder als Wegpunkte an. Der Verband fährt sie im Kreis ab und erkennt alles im Umkreis (Schiffe 100 km, Drohnen 200 km).",
  kampagne: "Tippe bis zu 4 Ziele an (fremde Häfen, Nester, Rohstofffelder). Jedes Ziel bekommt ein Lagebild; unterwegs Erkennung um die Route.",
  radarposten: "Tippe ein freies Küstenfeld oder ein eigenes Rohstofffeld an. Der Posten sieht 250 km weit und braucht Treibstoff.",
  postenangriff: "Fremder Radarposten: Truppen mit Landungsschiff schlagen die Besatzung, dann fällt die Anlage.",
};

/** Einheiten, die für die Art in Frage kommen (Patrouille: nur Liste der Balance). */
function allowedUnits(op: IntelOpKind, balance: Balance): (id: string) => boolean {
  const patrol = balance.intel?.patrol?.units ?? [];
  return (id) => !balance.units[id]?.covert && (op !== "patrouille" || patrol.includes(id));
}

export function IntelOpsPlan({ op, base, map, initial, onSent }: {
  op: IntelOpKind; base: BaseData; map: MapData; initial: Target | null; onSent: (arriveAtMs: number) => void;
}) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  // Vorbelegung: das angetippte Feld (Patrouille nur auf See, Kampagne nur mit Ziel).
  const [points, setPoints] = useState<Hex[]>(() => (initial && !initial.postId && (op !== "patrouille" || terrainAt(initial.col, initial.row) === "sea") ? [{ col: initial.col, row: initial.row }] : []));
  const [hours, setHours] = useState(4);
  const [units, setUnits] = useState<Record<string, number>>(op === "radarposten" ? { pioniere: 5, landungsschiff: 1 } : op === "kampagne" ? {} : {});
  const [whyOpen, setWhyOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const chosen = useMemo(() => Object.fromEntries(Object.entries(units).filter(([, n]) => n > 0)), [units]);
  const max = op === "patrouille" ? 4 : op === "kampagne" ? (meta.data?.balance.intel?.campaign?.maxTargets ?? 4) : 1;
  const input = op === "patrouille" ? { op, units: chosen, waypoints: points, hours }
    : op === "kampagne" ? { op, units: chosen, targets: points }
    : op === "postenangriff" ? { op, units: chosen, postId: initial?.postId ?? 0 }
    : { op, units: chosen, col: points[0]?.col, row: points[0]?.row };
  const ready = Object.keys(chosen).length > 0 && (op === "postenangriff" ? !!initial?.postId : points.length > 0);
  const preview = useQuery({ ...trpc.intel.preview.queryOptions(input), enabled: ready, placeholderData: keepPreviousData });
  const launch = useCommand((i: typeof input & { key: string }) => trpcClient.intel.launch.mutate(i), () => [trpc.base.pathFilter().queryKey, trpc.world.map.pathFilter().queryKey]);
  if (!meta.data) return null;
  const balance = meta.data.balance;
  const ok = allowedUnits(op, balance);
  const p = ready ? preview.data : undefined;
  const why = { units: chosen, distanceKm: p && p.ok ? p.distanceKm : undefined };

  const tap = (h: Hex) => {
    if (op === "postenangriff") return;
    const i = points.findIndex((x) => x.col === h.col && x.row === h.row);
    if (i >= 0) setPoints(points.filter((_, k) => k !== i));
    else if (max === 1) setPoints([h]);
    else if (points.length < max) setPoints([...points, h]);
  };
  const name = (h: Hex) => {
    const b = map.bases.find((x) => x.col === h.col && x.row === h.row);
    if (b) return b.name;
    if (map.nests.some((n) => n.col === h.col && n.row === h.row)) return "Piratennest";
    return `Feld ${h.col}/${h.row}`;
  };

  return (
    <>
      <Card title={op === "patrouille" ? `Wegpunkte ${points.length}/4` : op === "kampagne" ? `Ziele ${points.length}/${max}` : "Standort"}>
        <p className="text-xs text-ink2 mb-2">{HINT[op]}</p>
        <div className="h-64 rounded-lg overflow-hidden mb-2" data-testid="intel-map">
          <HexMap data={map} selected={op === "postenangriff" && initial ? initial : null} onSelect={tap} center={initial ?? { col: base.col, row: base.row }} marks={{ list: op === "postenangriff" && initial ? [initial] : points, loop: op === "patrouille" }} />
        </div>
        {points.length > 0 && op !== "postenangriff" && (
          <div className="flex flex-wrap gap-1" aria-label="Gewählte Punkte">
            {points.map((h, i) => (
              <SmallButton key={`${h.col}/${h.row}`} onClick={() => setPoints(points.filter((_, k) => k !== i))}>{i + 1} · {name(h)} ✕</SmallButton>
            ))}
            {points.length > 1 && <SmallButton onClick={() => setPoints([])}>Alle entfernen</SmallButton>}
          </div>
        )}
      </Card>

      {op === "patrouille" && (
        <Card title="Dauer auf Station">
          <Segments label="Dauer" value={String(hours)} onChange={(v) => setHours(Number(v))} items={(balance.intel?.patrol?.hours ?? [4, 8, 12]).map((h) => ({ id: String(h), label: `${h} h` }))} />
          <p className="text-xs text-ink2 mt-1">Drohnen fliegen höchstens {balance.intel?.patrol?.droneMaxHours ?? 6} h und {fmtNum(balance.intel?.patrol?.droneMaxRangeKm ?? 800)} km weit. Abfangjäger fremder Häfen schießen sie in deren Radarreichweite ab.</p>
        </Card>
      )}

      <Card title="Verband">
        <ul className="divide-y divide-navy-700">
          {base.units.filter((u) => u.home > 0 && ok(u.id)).map((u) => (
            <li key={u.id} className="py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1"><IconTile id={u.id} size={36} tone={unitTone(balance, u.id)} /><div className="min-w-0 break-words leading-tight">{label(u.id)}<div className="text-xs text-slate-400">{fmtNum(u.home)} daheim</div></div></div>
              <Stepper value={units[u.id] ?? 0} max={u.home} onChange={(v) => setUnits({ ...units, [u.id]: v })} />
            </li>
          ))}
        </ul>
        {!base.units.some((u) => u.home > 0 && ok(u.id)) && <p className="text-sm text-slate-400">Keine passenden Einheiten daheim.</p>}
      </Card>

      <Card title="Vorschau">
        {!ready ? <p className="text-sm text-slate-400">{op === "postenangriff" ? "Einheiten wählen." : "Punkte und Einheiten wählen."}</p>
          : !p ? <p className="text-sm text-slate-400">Berechne …</p>
          : p.ok ? (
            <div className="text-sm space-y-0.5" data-testid="intel-preview">
              <div>Entfernung {fmtNum(p.distanceKm)} km · Hinfahrt {fmtSeconds(p.travelSeconds)}</div>
              <div>Treibstoff {fmtNum(p.fuelCost)} (ganze Fahrt)</div>
              <div>Ankunft {fmtTime(p.arriveAtMs)} · zurück etwa {fmtTime(p.returnAtMs)}</div>
              {p.sightKm !== null && <div>Sicht {fmtNum(p.sightKm)} km{p.sonarKm ? ` · Sonar ${fmtNum(p.sonarKm)} km` : ""}</div>}
              {p.turnPoints && p.turnPoints.some((t) => t.km > 0) && <div data-testid="campaign-turns">Aufklärung auf Sicht: Umkehr je {fmtNum(Math.round(Math.max(...p.turnPoints.map((t) => t.km))))} km vor dem Ziel, Lagebild dort</div>}
              {p.cost ? <div>Baukosten {Object.entries(p.cost as Record<string, number>).map(([r, v]) => `${fmtNum(v)} ${label(r)}`).join(", ")}</div> : null}
            </div>
          ) : <ReasonLine code={p.code} detail={why} className="text-sm text-red-300" text={errorText(p.code)} open={whyOpen} onOpenChange={setWhyOpen} />}
      </Card>

      <ActionBar>
        <ErrorLine text={launch.error} code={launch.code} detail={why} />
        {p && !p.ok && <ActionRemedy code={p.code} detail={why} open={barOpen} onClose={() => setBarOpen(false)} />}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="font-semibold truncate"><Icon id={op === "postenangriff" ? "ueberfall" : op === "kampagne" ? "aufklaerung" : op} size={16} /> {label(op === "postenangriff" ? "ueberfall" : op)}</div>
            {p && !p.ok ? <ReasonInline code={p.code} open={barOpen} onToggle={() => setBarOpen(!barOpen)} />
              : <div className="text-xs text-ink2 truncate">{!ready ? "Punkte und Einheiten wählen" : !p ? "Berechne …" : p.ok ? `Fahrt ${fmtSeconds(p.travelSeconds)} · ${fmtNum(p.fuelCost)} Treibstoff` : ""}</div>}
          </div>
          <Button className="shrink-0" disabled={!p?.ok || launch.busy} onBlocked={p && !p.ok && hasRemedy(p.code) ? () => setBarOpen(!barOpen) : undefined}
            onClick={async () => {
              const r = await launch.run(input);
              if (r && r.ok) { void queryClient.invalidateQueries(trpc.intel.pathFilter()); onSent(r.arriveAtMs); }
            }}>
            {op === "radarposten" ? "Errichten" : op === "postenangriff" ? "Angreifen" : "Auslaufen"}
          </Button>
        </div>
      </ActionBar>
    </>
  );
}
