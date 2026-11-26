import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { COLS, QUICK_PICKS, ROWS, hexAtLonLat, hexDistanceKm, hexIndex, nearestTradePort, terrainMap } from "@tidefront/world";
import { queryClient, trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { HexMap } from "./HexMap.tsx";
import { Button, ErrorLine, Loading } from "../ui.tsx";
import { NewSeasonNotice } from "../components/Season.tsx";

type Hex = { col: number; row: number };

export function ChooseBase() {
  const map = useQuery(trpc.world.map.queryOptions());
  const [sel, setSel] = useState<Hex | null>(null);
  const [view, setView] = useState<{ center: Hex; n: number }>({ center: hexAtLonLat(-8, 49), n: 0 });
  const [name, setName] = useState("");
  const [nightHour, setNightHour] = useState<number | null>(23);
  const [showHelp, setShowHelp] = useState(true);
  const cmd = useCommand(
    (i: { key: string; col: number; row: number; name: string; nightShieldStartHour: number | null; tzOffsetMinutes: number }) => trpcClient.base.choose.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.world.pathFilter().queryKey],
  );
  const free = useMemo(() => {
    const taken = new Set<string>();
    for (const b of map.data?.bases ?? []) taken.add(`${b.col},${b.row}`);
    for (const n of map.data?.nests ?? []) taken.add(`${n.col},${n.row}`);
    const t = terrainMap();
    const out = new Set<string>();
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (t[hexIndex(col, row)] === "coast" && !taken.has(`${col},${row}`)) out.add(`${col},${row}`);
    }
    return out;
  }, [map.data]);
  if (!map.data) return <Loading />;
  const isFree = sel !== null && free.has(`${sel.col},${sel.row}`);

  const quick = (lon: number, lat: number) => {
    const target = hexAtLonLat(lon, lat);
    let best: Hex | null = null;
    let bestD = Infinity;
    for (const key of free) {
      const [col, row] = key.split(",").map(Number);
      const d = hexDistanceKm(target, { col, row });
      if (d < bestD) { bestD = d; best = { col, row }; }
    }
    if (best) {
      setSel(best);
      setView((v) => ({ center: best!, n: v.n + 1 }));
      setShowHelp(false);
    }
  };

  const facts = (h: Hex) => {
    const nests = map.data.nests.map((n) => ({ n, d: hexDistanceKm(h, n) })).sort((a, b) => a.d - b.d);
    const near = nests.filter((x) => x.d < 900);
    const others = map.data.bases.map((b) => hexDistanceKm(h, b)).sort((a, b) => a - b);
    return { near, nearest: nests[0], port: nearestTradePort(h), other: others[0] };
  };
  const f = sel && isFree ? facts(sel) : null;

  return (
    <div className="h-full flex flex-col max-w-xl mx-auto">
      <div className="p-3 bg-navy-900 border-b border-navy-700">
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-semibold text-brass-400">Wo gründest du deinen Hafen?</h1>
          <button type="button" className="text-xs text-sea-300 underline min-h-[44px] -my-3 px-1" onClick={async () => { await trpcClient.auth.logout.mutate(); queryClient.clear(); location.reload(); }}>Abmelden</button>
        </div>
        <p className="text-xs text-slate-300">Gelb markierte Felder sind freie Küste. Tippe eines an oder nimm einen Vorschlag.</p>
        <NewSeasonNotice />
      </div>
      <div className="flex-1 min-h-0 relative">
        <HexMap data={map.data} selectMode free={free} selected={sel} onSelect={(h) => { setSel(h); setShowHelp(false); }} center={view.center} recenter={view.n} zoom={0.3} />
        {showHelp && (
          <div className="absolute inset-x-2 bottom-2 rounded-xl bg-navy-900/95 border border-navy-600 p-3 text-xs text-slate-200 shadow-xl">
            <div className="font-semibold text-sm text-sea-300 mb-1">Worauf es ankommt</div>
            <ul className="space-y-1 list-disc pl-4">
              <li><b>Piratennester (☠) in der Nähe</b> bringen schnelle Beute – kurze Fahrten, wenig Treibstoff.</li>
              <li><b>Ein Handelshafen (⚓) in der Nähe</b> verkürzt Lieferungen der Börse.</li>
              <li><b>Abstand zu anderen Spielern</b> gibt Ruhe; Nähe macht Handel und Überfälle möglich.</li>
              <li>Die ersten 7 Tage schützt dich der Anfängerschutz.</li>
            </ul>
            <button type="button" className="tap w-full mt-2 rounded-lg bg-navy-700" onClick={() => setShowHelp(false)}>Verstanden</button>
          </div>
        )}
      </div>
      <div className="bg-navy-900 border-t border-navy-700">
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1" role="list" aria-label="Schnellwahl">
          {QUICK_PICKS.map((q) => (
            <button key={q.name} type="button" role="listitem" onClick={() => quick(q.lon, q.lat)}
              className="tap shrink-0 rounded-lg bg-navy-800 border border-navy-600 px-3 py-1 text-left active:bg-navy-700">
              <div className="text-sm font-semibold">{q.name}</div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap">{q.hint}</div>
            </button>
          ))}
        </div>
        <div className="p-3 pt-2">
          {!sel && <p className="text-sm text-slate-300">Schnellwahl oben oder ein gelbes Feld auf der Karte antippen.</p>}
          {sel && !isFree && <p className="text-sm text-red-300">Dieses Feld ist keine freie Küste – wähle ein gelb markiertes Feld.</p>}
          {sel && isFree && f && (
            <div className="space-y-2">
              <div className="text-xs text-slate-300 grid grid-cols-2 gap-x-2 gap-y-0.5">
                <span>☠ Nester im Umkreis 900 km</span><span className="text-right">{f.near.length} (nächstes St. {f.nearest?.n.level}, {fmtNum(f.nearest?.d ?? 0)} km)</span>
                <span>⚓ Handelshafen</span><span className="text-right">{f.port.name}, {fmtNum(f.port.distanceKm)} km</span>
                <span>⛨ Nächster Spieler</span><span className="text-right">{f.other === undefined ? "keiner" : `${fmtNum(f.other)} km`}</span>
              </div>
              <input className="w-full h-12 rounded-lg bg-navy-950 border border-navy-600 px-3" placeholder="Name des Stützpunkts" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                Nachtschild ab
                <select className="h-11 rounded-lg bg-navy-950 border border-navy-600 px-2" value={nightHour ?? ""} onChange={(e) => setNightHour(e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">kein Nachtschild</option>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00 Uhr</option>)}
                </select>
              </label>
              <Button
                className="w-full"
                disabled={cmd.busy || name.trim().length < 2}
                onClick={() => void cmd.run({ col: sel.col, row: sel.row, name: name.trim(), nightShieldStartHour: nightHour, tzOffsetMinutes: -new Date().getTimezoneOffset() })}
              >
                Stützpunkt gründen
              </Button>
            </div>
          )}
          <ErrorLine text={cmd.error} />
        </div>
      </div>
    </div>
  );
}
