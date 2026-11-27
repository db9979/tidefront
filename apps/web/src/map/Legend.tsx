// Einklappbare Legende der Kartenzeichen: Häfen nach Verhältnis, Kartell und See, Übersichtspunkte, Wetter mit Fronten.
import { useState, type ReactNode } from "react";
import { TacticalIcon } from "./TacticalIcon.tsx";
import { Icon } from "../icons.tsx"; // Felder

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
    // Felder: Rohstofffelder auf See
    title: "Rohstofffelder",
    items: [
      { icon: <><Icon id="oelfeld" size={22} /><Icon id="erzbucht" size={22} /></>, text: "Ölfeld (Treibstoff), Erzbucht (Stahl); Punkte darunter: Stufe 1–3" },
      { icon: <><Icon id="fischgrund" size={22} /><Icon id="elektronikwrack" size={22} /></>, text: "Fischgrund (Proviant), Elektronik-Wrack (Elektronik)" },
      { icon: <FieldRing dashed color="#a8331f" />, text: "Rot gestrichelt: vom Kartell bewacht; grau: frei" },
      { icon: <><FieldRing color="#18273a" /><FieldRing color="#3d6b4f" /></>, text: "Ring in Besitzerfarbe wie die Häfen; Linien und Hof: Einflusszone einer Allianz" },
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
      { icon: <PressureIcon />, text: "Isobaren um Tief (T: Wind, Wolken, Sturm) und Hoch (H: ruhig, klar)" },
      { icon: <FrontIcon kind="kalt" />, text: "Kaltfront (blau, Dreiecke): Schauerband, dahinter kühler und klarer; Zeichen zeigen die Zugrichtung" },
      { icon: <FrontIcon kind="warm" />, text: "Warmfront (rot, Halbkreise): breiter Wolkenschirm mit Regen voraus" },
      { icon: <FrontIcon kind="okklusion" />, text: "Okklusion (violett): Kaltfront hat die Warmfront eingeholt, dichte Wolken am alternden Tief" },
      { icon: <VaneIcon pennant={false} />, text: "Windfahne: Pfeil zeigt, wohin der Wind weht; je Strich stärker, zwei Striche ab 6 Bft (Schiffe langsamer)" },
      { icon: <VaneIcon pennant />, text: "Wimpel an der Windfahne: Sturm ab 9 Bft" },
      { icon: <StormFlag />, text: "Sturmwimpel: Schiffe langsamer, Flugzeuge schwächer, am eigenen Hafen bleiben sie am Boden; rötlicher Ton: Schiffe gebremst" },
      { icon: <Hatch d="M2 14 L14 2 M7 16 L16 7 M0 9 L9 0" color="#8c96a3" />, text: "Wolken, Striche darunter: Regen; Wolken schwächen den Luftschlag" },
      { icon: <Hatch d="M1 6 H4 M7 6 H10 M13 6 H16 M1 11 H4 M7 11 H10 M13 11 H16" color="#2d5b7a" />, text: "Nebel: Aufklärung ungenau, Radar am eigenen Hafen kürzer" },
    ],
  },
];

function PressureIcon() {
  return (
    <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
      <ellipse cx="17" cy="9" rx="15" ry="7.5" fill="none" stroke="#18273a" strokeOpacity={0.5} strokeWidth={1} />
      <ellipse cx="17" cy="9" rx="9" ry="4.5" fill="none" stroke="#18273a" strokeOpacity={0.5} strokeWidth={1} />
      <text x="17" y="12.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#a8331f" fontFamily="Fraunces, Georgia, serif">T</text>
    </svg>
  );
}

const FRONT_HEX = { kalt: "#2f5fa3", warm: "#a8331f", okklusion: "#6b4a7a" } as const;

/** Frontzeichen wie auf der Karte: Linie mit Dreiecken, Halbkreisen oder beidem im Wechsel. */
function FrontIcon({ kind }: { kind: keyof typeof FRONT_HEX }) {
  const c = FRONT_HEX[kind];
  const tri = (x: number) => <path key={`t${x}`} d={`M${x - 4} 12 L${x + 4} 12 L${x} 5.5 Z`} fill={c} />;
  const half = (x: number) => <path key={`h${x}`} d={`M${x - 4} 12 A4 4 0 0 1 ${x + 4} 12 Z`} fill={c} />;
  const marks = [8, 18, 28].map((x, i) => (kind === "kalt" || (kind === "okklusion" && i % 2 === 0) ? tri(x) : half(x)));
  return (
    <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
      <path d="M1 12 H33" stroke={c} strokeWidth={2} strokeLinecap="round" />
      {marks}
    </svg>
  );
}

function VaneIcon({ pennant }: { pennant: boolean }) {
  return (
    <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
      <path d="M3 12 H27 M22 8.5 L27 12 L22 15.5" fill="none" stroke="#18273a" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      {pennant ? <path d="M3 12 L5 3 L8 12 Z" fill="#18273a" /> : <path d="M4 12 L6 4 M8 12 L10 4 M12 12 L13 8" fill="none" stroke="#18273a" strokeWidth={1.3} strokeLinecap="round" />}
    </svg>
  );
}

function StormFlag() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <path d="M6 1 V17" stroke="#18273a" strokeWidth={1.3} />
      <path d="M6 1.5 L17 4 L6 6.5 Z M6 8.5 L17 11 L6 13.5 Z" fill="#a8331f" />
    </svg>
  );
}

function FieldRing({ color, dashed }: { color: string; dashed?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#fbf8f0" stroke={color} strokeWidth={1.8} strokeDasharray={dashed ? "3 2" : undefined} /></svg>;
}

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
