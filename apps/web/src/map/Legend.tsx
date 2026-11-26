// Einklappbare Legende der Kartenzeichen: Häfen nach Verhältnis, Kartell und See, Übersichtspunkte, Wetter.
import { useState, type ReactNode } from "react";
import { TacticalIcon } from "./TacticalIcon.tsx";

type Item = { icon: ReactNode; text: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Häfen",
    items: [
      { icon: <TacticalIcon kind="own" />, text: "Eigener Stützpunkt" },
      { icon: <TacticalIcon kind="ally" />, text: "Allianzmitglied (grün, Doppelring)" },
      { icon: <TacticalIcon kind="pact" />, text: "Paktpartner: Nichtangriffspakt (ocker)" },
      { icon: <TacticalIcon kind="war" />, text: "Kriegsgegner (rot, Peilstriche)" },
      { icon: <TacticalIcon kind="other" />, text: "Neutraler Spieler; gestrichelter Ring: geschützt" },
    ],
  },
  {
    title: "Kartell und See",
    items: [
      { icon: <TacticalIcon kind="nest" level={3} />, text: "Kartellnest (Piraten), Stufe I–V" },
      { icon: <TacticalIcon kind="nestEmpty" level={2} />, text: "Nest verlassen, wird neu besetzt" },
      { icon: <TacticalIcon kind="wreck" />, text: "Wrackfeld, bergbar" },
      { icon: <TacticalIcon kind="port" />, text: "Handelshafen der Börse" },
      { icon: <><TacticalIcon kind="ship" size={22} /><TacticalIcon kind="shipBack" size={22} /></>, text: "Eigener Verband: Hinfahrt, Rückfahrt – antippen für Details" },
    ],
  },
  {
    title: "Übersicht (weit herausgezoomt)",
    items: [
      { icon: <><TacticalIcon kind="dotAlly" size={18} /><TacticalIcon kind="dotPact" size={18} /></>, text: "Punkt: Hafen von Allianz (grün) oder Paktpartner (ocker)" },
      { icon: <><TacticalIcon kind="dotWar" size={18} /><TacticalIcon kind="dotOther" size={18} /></>, text: "Punkt: Kriegsgegner (rot, größer) oder neutral (blau)" },
      { icon: <TacticalIcon kind="dotNest" size={18} />, text: "Raute: Kartellnest, größer = höhere Stufe" },
      { icon: <TacticalIcon kind="dotPort" size={18} />, text: "Hohler Ring: Handelshafen" },
    ],
  },
  {
    title: "Wetter (Knopf „Wetter an/aus“)",
    items: [
      { icon: <Hatch d="M2 14 L14 2 M7 16 L16 7 M0 9 L9 0" color="#18273a" />, text: "Wolken (Schraffur)" },
      { icon: <Hatch d="M2 14 L9 4 L16 14 M6 14 L13 4" color="#a8331f" />, text: "Sturm: Schiffe langsamer, Flugzeuge bleiben am Boden" },
      { icon: <Hatch d="M1 6 H4 M7 6 H10 M13 6 H16 M1 11 H4 M7 11 H10 M13 11 H16" color="#2d5b7a" />, text: "Nebel: Radar und Aufklärung schlechter" },
    ],
  },
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
          <div className="px-3 pb-3 text-xs text-ink max-h-[min(60vh,480px)] overflow-y-auto">
            {GROUPS.map((g) => (
              <section key={g.title} className="pt-1.5">
                <h3 className="font-display text-[10px] uppercase tracking-[0.12em] text-ink2 border-b border-rule pb-0.5 mb-1">{g.title}</h3>
                <ul className="space-y-1.5">
                  {g.items.map((i) => (
                    <li key={i.text} className="flex items-center gap-2"><span className="flex w-12 shrink-0 justify-center">{i.icon}</span><span className="min-w-0">{i.text}</span></li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="text-ink2 pt-2">Feld antippen für Details · ziehen zum Schwenken · zwei Finger oder +/− zum Zoomen</p>
          </div>
        )}
      </div>
    </div>
  );
}
