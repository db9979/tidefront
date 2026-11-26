// Einklappbare Legende der Kartenzeichen.
import { useState, type ReactNode } from "react";
import { TacticalIcon } from "./TacticalIcon.tsx";

const ITEMS: { icon: ReactNode; text: string }[] = [
  { icon: <TacticalIcon kind="own" />, text: "Eigener Stützpunkt" },
  { icon: <TacticalIcon kind="other" />, text: "Anderer Spieler, gestrichelter Ring: geschützt" },
  { icon: <TacticalIcon kind="nest" level={3} />, text: "Piratennest, Stufe I–V" },
  { icon: <TacticalIcon kind="nestEmpty" level={2} />, text: "Nest verlassen, wird neu besetzt" },
  { icon: <TacticalIcon kind="wreck" />, text: "Wrackfeld, bergbar" },
  { icon: <TacticalIcon kind="port" />, text: "Handelshafen der Börse" },
  { icon: <><TacticalIcon kind="ship" size={22} /><TacticalIcon kind="shipBack" size={22} /></>, text: "Eigener Verband: Hinfahrt, Rückfahrt" },
  { icon: <Hatch d="M2 14 L14 2 M7 16 L16 7 M0 9 L9 0" color="#18273a" />, text: "Wetter: Wolken (Schraffur)" },
  { icon: <Hatch d="M2 14 L9 4 L16 14 M6 14 L13 4" color="#a8331f" />, text: "Sturm: Schiffe langsamer, Flugzeuge bleiben am Boden" },
  { icon: <Hatch d="M1 6 H4 M7 6 H10 M13 6 H16 M1 11 H4 M7 11 H10 M13 11 H16" color="#2d5b7a" />, text: "Nebel: Radar und Aufklärung schlechter" },
];

function Hatch({ d, color }: { d: string; color: string }) {
  return <svg width="22" height="18" viewBox="0 0 17 16" aria-hidden="true"><path d={d} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" /></svg>;
}

export function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-2 bottom-2 right-2 pointer-events-none flex justify-start">
      <div className="pointer-events-auto rounded-[3px] bg-card border border-ink max-w-full">
        <button type="button" className="tap px-3 text-[11px] font-display uppercase tracking-[0.12em] text-ink w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾ Legende" : "▸ Legende"}
        </button>
        {open && (
          <ul className="px-3 pb-3 space-y-1.5 text-xs text-ink">
            {ITEMS.map((i) => (
              <li key={i.text} className="flex items-center gap-2"><span className="flex w-12 justify-center">{i.icon}</span><span>{i.text}</span></li>
            ))}
            <li className="text-ink2 pt-1">Feld antippen für Details · ziehen zum Schwenken · zwei Finger oder +/− zum Zoomen</li>
          </ul>
        )}
      </div>
    </div>
  );
}
