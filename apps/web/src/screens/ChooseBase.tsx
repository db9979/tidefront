import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isCoast } from "@tidefront/world";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { HexMap } from "./HexMap.tsx";
import { Button, ErrorLine, Loading } from "../ui.tsx";

export function ChooseBase() {
  const map = useQuery(trpc.world.map.queryOptions());
  const [sel, setSel] = useState<{ col: number; row: number } | null>(null);
  const [name, setName] = useState("");
  const [nightHour, setNightHour] = useState<number | null>(23);
  const cmd = useCommand(
    (i: { key: string; col: number; row: number; name: string; nightShieldStartHour: number | null; tzOffsetMinutes: number }) => trpcClient.base.choose.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.world.pathFilter().queryKey],
  );
  const taken = useMemo(() => {
    const s = new Set<string>();
    for (const b of map.data?.bases ?? []) s.add(`${b.col},${b.row}`);
    for (const n of map.data?.nests ?? []) s.add(`${n.col},${n.row}`);
    return s;
  }, [map.data]);
  if (!map.data) return <Loading />;
  const free = sel !== null && isCoast(sel.col, sel.row) && !taken.has(`${sel.col},${sel.row}`);

  return (
    <div className="h-full flex flex-col max-w-xl mx-auto">
      <div className="p-3 bg-navy-900 border-b border-navy-700">
        <h1 className="font-semibold">Wähle ein Küstenfeld für deinen Stützpunkt</h1>
        <p className="text-xs text-slate-400">Hell umrandete Felder sind freie Küste. Ziehen zum Verschieben, zwei Finger zum Zoomen.</p>
      </div>
      <div className="flex-1 min-h-0">
        <HexMap data={map.data} selectMode selected={sel} onSelect={setSel} />
      </div>
      <div className="p-3 bg-navy-900 border-t border-navy-700">
        {!sel && <p className="text-sm text-slate-300">Tippe ein Küstenfeld an.</p>}
        {sel && !free && <p className="text-sm text-red-300">Dieses Feld ist keine freie Küste.</p>}
        {sel && free && (
          <div className="space-y-2">
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
  );
}
