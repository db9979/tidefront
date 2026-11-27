// Missionen im Detail: Infoblatt für einen Verband (Tipp auf der Karte) und Rückruf-Bestätigung.
import { departureKind } from "../lib/departure.ts";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type MapData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label, nOf } from "../lib/names.ts";
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
  if (n) return n.level == null ? "Piratennest (Stufe unbekannt)" : `Nest Stufe ${n.level}`; // Lagebild: Stufe nur mit Sicht
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
      <ErrorLine text={cmd.error} code={cmd.code} />
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

/** Missionsleiste unter der Karte (nicht modal, die Karte bleibt sichtbar): Auftrag, Fortschritt, Position, Truppen, Zeiten, Rückruf. */
export function MissionPanel({ mission, now, home, onClose, onShowTarget }: {
  mission: MissionData;
  now: number;
  home: { col: number; row: number };
  onClose: () => void;
  onShowTarget?: (t: { col: number; row: number }) => void;
}) {
  const map = useQuery(trpc.world.map.queryOptions());
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [recall, setRecall] = useState(false);
  const [more, setMore] = useState(false);
  const m = mission;
  const ph = missionPhase(m, now);
  const name = m.target.kind === "kartell" ? "Kartell-Informanten" : targetName(map.data, m.target.col, m.target.row);
  const kind = m.spy ? spyKindText(m.spy.kind) : label(m.type);
  const air = departureKind(m.units ?? {}, meta.data?.balance) === "luft"; // Flug statt Fahrt
  const phase = ph.outbound ? (air ? "Hinflug" : "Hinfahrt") : m.recalled ? "zurückgerufen, auf dem Heimweg" : air ? "Rückflug" : "Rückfahrt";
  const units = ph.outbound ? m.units : m.returning ?? m.units;
  const lost = !ph.outbound && m.returning
    ? Object.fromEntries(Object.entries(m.units).map(([k, v]) => [k, v - (m.returning?.[k] ?? 0)]).filter(([, v]) => (v as number) > 0))
    : null;
  const cargo = m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) ? m.cargoHome : null;
  const total = Object.values(units ?? {}).reduce((a, b) => a + b, 0);
  const at = missionHex(m, home, now);
  return (
    // Missionsleiste auf der Karte: höchstens 45 % der Höhe, Inhalt scrollt, Knöpfe fest unten.
    <div className="shrink-0 max-h-[45%] min-h-0 flex flex-col bg-card border-t-[3px] border-double border-ink shadow-[0_-8px_24px_rgba(24,39,58,0.12)] text-sm">
      <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pt-2.5 pb-1">
      <div className="flex items-start gap-2">
        <Icon id={m.type} size={36} />
        <div className="flex-1 min-w-0">
          <div className="font-serif text-[18px] leading-tight">{kind} <span className="text-ink2 font-sans text-xs">· {phase}</span></div>
          <div className="text-xs text-ink2 mono">Jetzt bei Feld {at.col}/{at.row} · {nOf(total, "Einheit", "Einheiten")}</div>
        </div>
        <button type="button" className="tap rounded-[4px] border border-navy-600 text-slate-300" onClick={onClose} aria-label="Schließen">✕</button>
      </div>
      <div className="mt-2">
        <div className="flex justify-between gap-2 text-[11px] text-ink2 mono">
          <span>{ph.outbound ? "Heimathafen" : name}</span>
          <span>{ph.outbound ? name : "Heimathafen"}</span>
        </div>
        <Bar value={ph.progress} tone={ph.outbound ? "red" : "sea"} />
        <div className="mt-1 font-semibold">
          {ph.outbound ? `Ankunft in ${fmtDuration(ph.end - now)}` : `Daheim in ${fmtDuration(ph.end - now)}`}
          <span className="text-ink2 font-normal"> · {fmtTime(ph.end)} Uhr</span>
        </div>
      </div>
      <div className="mt-1"><UnitChips counts={units} /></div>
      {lost && Object.keys(lost).length > 0 && <div className="text-xs text-siegel mt-1">Verloren: <UnitChips counts={lost as Record<string, number>} /></div>}
      {cargo && <div className="text-xs mt-1">Ladung: <UnitChips counts={cargo} /></div>}
      {more && (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 items-center mt-2 text-xs">
          <span className="text-slate-400">Ziel</span><span className="text-right">{name}{m.target.kind !== "kartell" ? ` (Feld ${m.target.col}/${m.target.row})` : ""}</span>
          <span className="text-slate-400">Heimathafen</span><span className="text-right">Feld {home.col}/{home.row}</span>
          <span className="text-slate-400">Abfahrt</span><span className="text-right">{fmtTime(m.departAtMs)} Uhr</span>
          <span className="text-slate-400">Ankunft am Ziel</span><span className="text-right">{fmtTime(m.arriveAtMs)} Uhr{!ph.outbound ? " (erreicht)" : ""}</span>
          <span className="text-slate-400">Zurück daheim</span><span className="text-right">{m.recalled && ph.outbound ? "–" : `${fmtTime(m.returnAtMs)} Uhr`}</span>
          {m.reportId && <span className="col-span-2 text-slate-400">Der Bericht liegt unter Meldungen.</span>}
        </div>
      )}
      </div>
      <div className="shrink-0 flex flex-wrap gap-2 px-3 pb-3 pt-2 border-t border-rule">
        <Button kind="secondary" className="flex-1" onClick={() => setMore((v) => !v)}>{more ? "Weniger" : "Zeiten"}</Button>
        {onShowTarget && m.target.kind !== "kartell" && <Button kind="secondary" className="flex-1" onClick={() => onShowTarget({ col: m.target.col, row: m.target.row })}>Ziel zeigen</Button>}
        {ph.outbound && m.arriveAtMs > now && <Button kind="secondary" className="flex-1" onClick={() => setRecall(true)}>{"Zurück\u00ADrufen"}</Button>}
      </div>
      {recall && ph.outbound && <RecallSheet mission={m} name={name} now={now} onClose={() => setRecall(false)} />}
    </div>
  );
}
