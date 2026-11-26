// Mehrere Häfen in der Missionsplanung: Ursprung (aktiver Hafen), Ziel „eigener Hafen“ für Transport/Verlegen und
// Zielzeile für eine Gründung.
import type { BaseData, MapData } from "../lib/trpc.ts";
import { COLONY_SHIP, isFreeCoast } from "../lib/expansion.ts";
import { label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";

/** Kurzzeile „Ab: Hafen“ – nur mit mehreren Häfen sinnvoll. */
export function OriginLine({ base }: { base: BaseData }) {
  if (base.bases.length < 2) return null;
  return (
    <p className="text-xs text-ink2 mb-1 flex items-center gap-1">
      <Icon id={base.isHome ? "heimathafen" : "gruendung"} size={14} /> Ab <strong className="text-ink">{base.name}</strong>
      {base.isHome ? " (Heimathafen)" : " (Außenposten)"}
    </p>
  );
}

/** Auswahl eines anderen eigenen Hafens als Ziel (Transport, Verlegen). */
export function OwnHarborPick({ base, target, onPick }: { base: BaseData; target: { col: number; row: number } | null; onPick: (t: { col: number; row: number }) => void }) {
  const others = base.bases.filter((b) => b.id !== base.id);
  if (others.length === 0) return <p className="text-xs text-ink2 mb-2">Du hast noch keinen weiteren Hafen. Gründe zuerst einen Außenposten.</p>;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Eigener Hafen als Ziel">
      {others.map((b) => {
        const on = target?.col === b.col && target.row === b.row;
        return (
          <button key={b.id} type="button" onClick={() => onPick({ col: b.col, row: b.row })} aria-pressed={on}
            className={`tap rounded-[3px] border px-2.5 text-sm flex items-center gap-1.5 ${on ? "border-ink bg-paper font-semibold reticle" : "border-rule"}`}>
            <Icon id={b.isHome ? "heimathafen" : "gruendung"} size={18} />{b.name}
          </button>
        );
      })}
    </div>
  );
}

/** Zielzeile einer Gründung bzw. eines eigenen Hafens (Verlegen/Transport). */
export function ExpansionTargetLine({ type, base, map, target, fields, units }: {
  type: string; base: BaseData; map: MapData; target: { col: number; row: number }; fields?: { col: number; row: number }[]; units: Record<string, number>;
}) {
  if (type === "gruendung") {
    const free = isFreeCoast(target, map, fields);
    return (
      <>
        {free ? <>Freies Küstenfeld {target.col}/{target.row} – hier entsteht der Außenposten.</> : <span className="text-siegel">Feld {target.col}/{target.row}: kein freies Küstenfeld.</span>}
        {!units[COLONY_SHIP] && <span className="block text-xs text-messing">Ein {label(COLONY_SHIP)} gehört in den Verband (Bau in der Werft{(base.units.find((u) => u.id === COLONY_SHIP)?.home ?? 0) > 0 ? "; eines liegt bereit" : ""}).</span>}
      </>
    );
  }
  const own = base.bases.find((b) => b.col === target.col && b.row === target.row && b.id !== base.id);
  if (type === "verlegung" && !own) return <span className="text-siegel">Ziel muss einer deiner anderen Häfen sein.</span>;
  return own ? <>Eigener Hafen <strong>{own.name}</strong>{own.isHome ? " (Heimathafen)" : ""}{type === "verlegung" ? " – die Einheiten bleiben dort." : ""}</> : null;
}
