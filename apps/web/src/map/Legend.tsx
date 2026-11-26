// Einklappbare Legende der Taktikzeichen.
import { useState, type ReactNode } from "react";
import { TacticalIcon } from "./TacticalIcon.tsx";

const ITEMS: { icon: ReactNode; text: string }[] = [
  { icon: <TacticalIcon kind="own" />, text: "Eigener Stützpunkt (freundlich)" },
  { icon: <TacticalIcon kind="other" />, text: "Anderer Spieler (neutral), gestrichelt: geschützt" },
  { icon: <TacticalIcon kind="nest" level={3} />, text: "Piratennest (feindlich), Stufe I–V" },
  { icon: <TacticalIcon kind="nestEmpty" level={2} />, text: "Nest verlassen, wird neu besetzt" },
  { icon: <TacticalIcon kind="wreck" />, text: "Wrackfeld, bergbar" },
  { icon: <TacticalIcon kind="port" />, text: "Handelshafen der Börse" },
  { icon: <><TacticalIcon kind="ship" size={22} /><TacticalIcon kind="shipBack" size={22} /></>, text: "Eigener Verband: Hinfahrt, Rückfahrt" },
];

export function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-2 bottom-2 right-2 pointer-events-none flex justify-start">
      <div className="pointer-events-auto rounded-[4px] bg-navy-800/95 border border-navy-600 backdrop-blur-sm max-w-full">
        <button type="button" className="tap px-3 text-[11px] font-mono uppercase tracking-widest text-slate-200 w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾ Legende" : "▸ Legende"}
        </button>
        {open && (
          <ul className="px-3 pb-3 space-y-1.5 text-xs text-slate-200">
            {ITEMS.map((i) => (
              <li key={i.text} className="flex items-center gap-2"><span className="flex w-12 justify-center">{i.icon}</span><span>{i.text}</span></li>
            ))}
            <li className="text-slate-400 pt-1">Feld antippen für Details · ziehen zum Schwenken · zwei Finger oder +/− zum Zoomen</li>
          </ul>
        )}
      </div>
    </div>
  );
}
