// Einklappbare Legende der Kartensymbole (statische SVG-Nachbildungen der Pixi-Symbole).
import { useState, type ReactNode } from "react";

const ITEMS: { icon: ReactNode; text: string }[] = [
  {
    icon: (
      <svg viewBox="-16 -16 32 32" className="w-6 h-6"><polygon points="12,5 5,12 -5,12 -12,5 -12,-5 -5,-12 5,-12 12,-5" fill="#f2c14e" stroke="#0b1726" strokeWidth="2.5" /><polygon points="0,-8 2,-3 7,-3 3,1 5,6 0,3 -5,6 -3,1 -7,-3 -2,-3" fill="#0b1726" /></svg>
    ),
    text: "Dein Stützpunkt",
  },
  {
    icon: <svg viewBox="-14 -14 28 28" className="w-6 h-6"><polygon points="-11,-12 11,-12 11,1 0,13 -11,1" fill="#e5484d" stroke="#fff" strokeWidth="2" /></svg>,
    text: "Andere Spieler (grüner Ring: geschützt)",
  },
  {
    icon: (
      <svg viewBox="-16 -16 32 32" className="w-6 h-6"><circle r="13" fill="#161616" stroke="#e8742f" strokeWidth="2.5" /><circle cy="-2" r="5.5" fill="#f5f1e6" /><path d="M-8 6 8 -2 M-8 -2 8 6" stroke="#f5f1e6" strokeWidth="2.2" /></svg>
    ),
    text: "Piratennest, Zahl = Stufe 1–5 (grau: verlassen)",
  },
  {
    icon: <svg viewBox="-12 -12 24 24" className="w-6 h-6"><polygon points="-9,1 -2,1 -4,6 -8,6" fill="#e8893a" /><polygon points="1,-1 9,-4 8,5 2,5" fill="#c96a24" /></svg>,
    text: "Wrackfeld (bergbar)",
  },
  {
    icon: <svg viewBox="-12 -12 24 24" className="w-6 h-6"><circle r="10" fill="#0b1726" stroke="#7cc6e8" strokeWidth="1.5" /><path d="M0 -3 V6 M-3.5 -1 H3.5" stroke="#e6eef7" strokeWidth="1.6" /><circle cy="-5" r="1.8" fill="none" stroke="#e6eef7" strokeWidth="1.4" /></svg>,
    text: "Handelshafen der Börse",
  },
  {
    icon: <svg viewBox="-12 -8 24 16" className="w-6 h-6"><polygon points="-9,-4 6,-4 11,0 6,4 -9,4" fill="#f2c14e" stroke="#0b1726" strokeWidth="1.5" /></svg>,
    text: "Deine Flotte (gelb: Hinfahrt, grün: Rückfahrt)",
  },
];

export function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-2 bottom-2 right-2 pointer-events-none flex justify-start">
      <div className="pointer-events-auto rounded-xl bg-navy-900/90 border border-navy-600 shadow-lg backdrop-blur max-w-full">
        <button type="button" className="tap px-3 text-sm text-sea-300 font-semibold w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "▾ Legende" : "▸ Legende"}
        </button>
        {open && (
          <ul className="px-3 pb-3 space-y-1.5 text-xs text-slate-200">
            {ITEMS.map((i) => (
              <li key={i.text} className="flex items-center gap-2">{i.icon}<span>{i.text}</span></li>
            ))}
            <li className="text-slate-400 pt-1">Feld antippen für Details · ziehen zum Schwenken · zwei Finger oder +/− zum Zoomen</li>
          </ul>
        )}
      </div>
    </div>
  );
}
