// Missionen im Detail: Infoblatt für einen Verband (Tipp auf der Karte) und Rückruf-Bestätigung.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type MapData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime } from "../lib/time.ts";
import { Bar, Button, ErrorLine, Sheet, UnitChips } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { spyKindText } from "./SpyPlan.tsx";
import { hexAtXY, hexCenterXY } from "@tidefront/world";

type MissionData = BaseData["missions"][number];

export function targetName(map: MapData | undefined, col: number, row: number): string {
  const b = map?.bases.find((x) => x.col === col && x.row === row);
  // Kein doppeltes „Hafen Hafen …“, wenn der Name schon so beginnt.
  if (b) return /^hafen\b/i.test(b.name) ? b.name : `Hafen ${b.name}`;
  const n = map?.nests.find((x) => x.col === col && x.row === row);
  if (n) return `Nest Stufe ${n.level}`;
  return `Feld ${col}/${row}`;
}

/** Bestätigung des Rückrufs: Rückkehr nach der bereits gefahrenen Zeit, Treibstoff ist verbraucht. */
export function RecallSheet({ mission, name, now, onClose }: { mission: MissionData; name: string; now: number; onClose: () => void }) {
  const cmd = useCommand(
    (i: { key: string; missionId: number }) => trpcClient.mission.recall.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.world.pathFilter().queryKey],
  );
  const elapsed = Math.max(0, now - mission.departAtMs);
  return (
    <Sheet open onClose={onClose} title={`${label(mission.type)} zurückrufen?`} icon={<Icon id={mission.type} size={48} />}>
      <div className="text-sm space-y-2 mb-3">
        <p>Der Verband kehrt sofort um und ist nach der bereits gefahrenen Zeit wieder daheim.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-paper border border-rule p-2">
          <span className="text-slate-400">Ziel</span><span className="text-right">{name}</span>
          <span className="text-slate-400">Unterwegs seit</span><span className="text-right">{fmtDuration(elapsed)}</span>
          <span className="text-slate-400">Wieder daheim</span><span className="text-right">etwa {fmtTime(now + elapsed)}</span>
        </div>
        <p className="text-brass-300">Der Treibstoff ist verbraucht und wird nicht erstattet.{mission.type === "ueberfall" ? " Der Nachtschild bleibt für diese Nacht aufgehoben." : ""}</p>
      </div>
      <ErrorLine text={cmd.error} />
      <div className="flex gap-2">
        <Button kind="secondary" className="flex-1" onClick={onClose}>Weiterfahren</Button>
        <Button kind="danger" className="flex-1" disabled={cmd.busy} onClick={async () => { const r = await cmd.run({ missionId: mission.id }); if (r?.ok) onClose(); }}>
          Zurückrufen
        </Button>
      </div>
    </Sheet>
  );
}

/** Phase und Zeiten einer Mission für Anzeige und Fortschritt. */
export function missionPhase(m: MissionData, now: number) {
  const outbound = m.status === "outbound";
  const start = outbound ? m.departAtMs : m.arriveAtMs;
  const end = outbound ? m.arriveAtMs : m.returnAtMs;
  return { outbound, start, end, progress: Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start))) };
}

/** Feld, auf dem der Verband gerade fährt (gerade Linie Heimathafen ↔ Ziel wie auf der Karte). */
export function missionHex(m: MissionData, home: { col: number; row: number }, now: number): { col: number; row: number } {
  const ph = missionPhase(m, now);
  const a = hexCenterXY(home.col, home.row);
  const b = hexCenterXY(m.target.col, m.target.row);
  const t = ph.outbound ? ph.progress : 1 - ph.progress;
  return hexAtXY(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

/** Infoblatt eines Verbands: Auftrag, Ziel, Truppen, Zeiten, Fortschritt, Ladung, Rückruf. */
export function MissionSheet({ mission, now, home, onClose, onShowTarget }: {
  mission: MissionData;
  now: number;
  home: { col: number; row: number };
  onClose: () => void;
  onShowTarget?: (t: { col: number; row: number }) => void;
}) {
  const map = useQuery(trpc.world.map.queryOptions());
  const [recall, setRecall] = useState(false);
  const m = mission;
  const ph = missionPhase(m, now);
  const name = m.target.kind === "kartell" ? "Kartell-Informanten" : targetName(map.data, m.target.col, m.target.row);
  const kind = m.spy ? spyKindText(m.spy.kind) : label(m.type);
  const phase = ph.outbound ? "Hinfahrt" : m.recalled ? "Zurückgerufen – auf dem Heimweg" : "Rückfahrt";
  const units = ph.outbound ? m.units : m.returning ?? m.units;
  const lost = !ph.outbound && m.returning
    ? Object.fromEntries(Object.entries(m.units).map(([k, v]) => [k, v - (m.returning?.[k] ?? 0)]).filter(([, v]) => (v as number) > 0))
    : null;
  const cargo = m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) ? m.cargoHome : null;
  const total = Object.values(units ?? {}).reduce((a, b) => a + b, 0);
  if (recall && ph.outbound) return <RecallSheet mission={m} name={name} now={now} onClose={() => { setRecall(false); onClose(); }} />;
  return (
    <Sheet open onClose={onClose} title={<>{kind} <span className="text-ink2 font-sans text-sm">· {phase}</span></>} icon={<Icon id={m.type} size={48} />}>
      <div className="text-sm space-y-3">
        <div className="rounded-xl bg-paper border border-rule p-2">
          <div className="flex justify-between gap-2 text-xs text-ink2 mono">
            <span>{ph.outbound ? "Heimathafen" : name}</span>
            <span>{ph.outbound ? name : "Heimathafen"}</span>
          </div>
          <Bar value={ph.progress} tone={ph.outbound ? "red" : "sea"} />
          <div className="mt-1 font-semibold">
            {ph.outbound ? `Ankunft in ${fmtDuration(ph.end - now)}` : `Daheim in ${fmtDuration(ph.end - now)}`}
            <span className="text-ink2 font-normal"> · {fmtTime(ph.end)} Uhr</span>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
          <span className="text-slate-400">Auftrag</span><span className="text-right">{kind}{m.spy?.building ? ` (${label(m.spy.building)})` : ""}</span>
          <span className="text-slate-400">Ziel</span>
          <span className="text-right">
            {onShowTarget && m.target.kind !== "kartell"
              ? <button type="button" className="tap underline text-sea-300" onClick={() => { onShowTarget({ col: m.target.col, row: m.target.row }); onClose(); }}>{name}</button>
              : name}
          </span>
          {m.target.kind !== "kartell" && (<><span className="text-slate-400">Position</span><span className="text-right mono text-xs">Feld {m.target.col}/{m.target.row} · von {home.col}/{home.row}</span></>)}
          <span className="text-slate-400">Abfahrt</span><span className="text-right">{fmtTime(m.departAtMs)} Uhr</span>
          <span className="text-slate-400">Ankunft am Ziel</span><span className="text-right">{fmtTime(m.arriveAtMs)} Uhr{!ph.outbound ? " (erreicht)" : ""}</span>
          <span className="text-slate-400">Zurück daheim</span><span className="text-right">{m.recalled && ph.outbound ? "–" : `${fmtTime(m.returnAtMs)} Uhr`}</span>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink2 mb-1">{ph.outbound ? "Verband" : "Heimkehrer"} · {fmtNum(total)} Einheiten</div>
          <UnitChips counts={units} />
          {lost && Object.keys(lost).length > 0 && <div className="text-xs text-siegel mt-1">Verloren: <UnitChips counts={lost as Record<string, number>} /></div>}
        </div>
        {cargo && <div><div className="text-xs uppercase tracking-wider text-ink2 mb-1">Ladung</div><UnitChips counts={cargo} /></div>}
        {m.reportId && <p className="text-xs text-slate-400">Der Bericht zu dieser Mission liegt unter Meldungen.</p>}
        {ph.outbound && m.arriveAtMs > now && (
          <Button kind="secondary" className="w-full" onClick={() => setRecall(true)}>Zurückrufen</Button>
        )}
      </div>
    </Sheet>
  );
}
