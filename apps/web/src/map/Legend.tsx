// Einklappbare Legende der Kartenzeichen: Häfen nach Verhältnis, Kartell und See, Übersichtspunkte, Wetter mit Fronten.
import { MAP_BTN } from "./controls.ts";
import { useState, type ReactNode } from "react";
import { TacticalIcon } from "./TacticalIcon.tsx";
import { Icon } from "../icons.tsx"; // Felder

type Item = { icon: ReactNode; text: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Häfen",
    items: [
      { icon: <TacticalIcon kind="own" />, text: "Eigener Hafen" },
      { icon: <TacticalIcon kind="ally" />, text: "Allianzmitglied (grün, Doppelring)" },
      { icon: <TacticalIcon kind="pact" />, text: "Paktpartner: Nichtangriffspakt (ocker)" },
      { icon: <TacticalIcon kind="war" />, text: "Kriegsgegner (rot, Peilstriche)" },
      { icon: <TacticalIcon kind="other" />, text: "Neutraler Spieler; gestrichelter Ring: geschützt" },
    ],
  },
  {
    title: "Kartell und See",
    items: [
      { icon: <TacticalIcon kind="nest" level={3} />, text: "Piratennest (Kartell), Stufe I–V" },
      { icon: <TacticalIcon kind="nest" level={6} />, text: "Inselfestung des Kartells, Stufe VI (Spätspiel)" },
      { icon: <UnknownNestMark />, text: "Piratennest, Stufe unbekannt (keine Sicht) – erst aufklären" },
      { icon: <TacticalIcon kind="nestEmpty" level={2} />, text: "Nest verlassen, wird neu besetzt" },
      { icon: <TacticalIcon kind="wreck" />, text: "Wrackfeld, bergbar" },
      { icon: <TacticalIcon kind="port" />, text: "Handelshafen der Börse" },
      { icon: <><TacticalIcon kind="ship" size={22} /><TacticalIcon kind="shipBack" size={22} /></>, text: "Eigener Verband: Hinfahrt, Rückfahrt – antippen für Details" },
      { icon: <><ConvoyMark fill="#2d5b7a" /><ConvoyMark fill="#a8331f" /></>, text: "Konvoi (Börse, Vertrag, Handel, Transport, Feldertrag) mit gestrichelter Route über Wasser: blau eigener, rot Kriegsgegner (abfangbar), dunkel mit Geleit – antippen für Details" },
      { icon: <ConvoyMark fill="#fbf8f0" />, text: "Heller Konvoi mit Schild „Konvoi · klein/mittel/groß“: fremder Konvoi in Sensorreichweite, ohne Route; Ladung genau erst mit Lagebild" },
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
    // Lagebild: Kartennebel, Sensoren, fremde Verbände
    title: "Lagebild",
    items: [
      { icon: <FogSwatch />, text: "Graublauer Schleier: außerhalb jeder Sicht – Stufen, Schutz, Wracks und Verbände dort unbekannt" },
      { icon: <SensorRing />, text: "Gestrichelter Kreis mit zart getönter Fläche: Reichweite von Ausguck (Tinte) und Radar (blau), auch der Allianz" },
      { icon: <UnknownNest />, text: "Nest mit „?“: nur die Position ist bekannt – Stufe erst mit Sicht oder Aufklärung" },
      { icon: <span className="opacity-50 flex"><TacticalIcon kind="nest" level={2} /></span>, text: "Blass: bekannt, aber nicht live (Stand im Feld-Blatt); sehr blass: veraltet (über 24 h)" },
      { icon: <FleetArrow />, text: "Pfeil: fremder Verband mit Kurs; K/M/G = klein, mittel, groß; Farbe nur mit Erkennung" },
      // Lagebild Stufe 2
      { icon: <SensorRing />, text: "Kreis um deinen Verband auf See: Bordsicht, wandert mit (Kriegsschiff 105 km = eigenes Feld und alle Nachbarfelder, Transporter 40, Drohne 200); der Nebel hellt mit auf" },
      { icon: <Icon id="patrouille" size={22} />, text: "Rote gestrichelte Runde: deine Patrouille auf Station; nummerierte Ringe: Wegpunkte bzw. Ziele beim Planen" },
      { icon: <PostMark />, text: "Mast im Kreis: Radarposten (blau eigener, rot fremder; blass: ohne Treibstoff oder nicht live)" },
      { icon: <SonarRing />, text: "Grüner Kreis: Sonar – nur U-Boote werden darin sichtbar" },
      // Lagebild Stufe 3
      { icon: <StripMark />, text: "Zwei senkrechte Strichlinien: Streifen deines Satelliten – kurz gestrichelt live (20 min), lang gestrichelt mit Uhrzeit: nächster Überflug" },
      { icon: <Icon id="stoersender" size={22} />, text: "Blitz am fremden Hafen: Störsender, von deinem Radar erkannt – dein Radar sieht dort bis zu 50 % weniger weit" },
    ],
  },
  {
    title: "Übersicht (weit herausgezoomt)",
    items: [
      { icon: <><TacticalIcon kind="dotAlly" size={18} /><TacticalIcon kind="dotPact" size={18} /></>, text: "Punkt: Hafen von Allianz (grün) oder Paktpartner (ocker)" },
      { icon: <><TacticalIcon kind="dotWar" size={18} /><TacticalIcon kind="dotOther" size={18} /></>, text: "Punkt: Kriegsgegner (rot, größer) oder neutral (blau)" },
      { icon: <TacticalIcon kind="dotNest" size={18} />, text: "Raute: Piratennest, größer = höhere Stufe" },
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

function FogSwatch() {
  return <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true"><rect x="1" y="2" width="20" height="14" fill="#5d6f82" fillOpacity={0.3} stroke="#5d6f82" strokeOpacity={0.5} /></svg>;
}

function SensorRing() {
  return <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="#2d5b7a" strokeWidth={1.3} strokeDasharray="3 3" /></svg>;
}

function UnknownNest() {
  return (
    <svg width="22" height="22" viewBox="-12 -12 24 24" aria-hidden="true">
      <polygon points="0,-10 10,0 0,10 -10,0" fill="#fbf8f0" stroke="#18273a" strokeOpacity={0.7} strokeWidth={1.2} />
      <text x="0" y="3.5" textAnchor="middle" fontSize="10" fontWeight="600" fill="#18273a" fontFamily="Fraunces, Georgia, serif">?</text>
    </svg>
  );
}

function FleetArrow() {
  return (
    <svg width="24" height="26" viewBox="-12 -12 24 26" aria-hidden="true">
      <circle r="10" fill="#fbf8f0" stroke="#18273a" strokeWidth={1.2} />
      <polygon points="0,-8 5,5 0,2 -5,5" fill="#18273a" transform="rotate(45)" />
      <text x="0" y="13" textAnchor="middle" fontSize="7" fontWeight="600" fill="#18273a" fontFamily="'IBM Plex Mono', monospace">M</text>
    </svg>
  );
}

/** Wie map/symbols.ts nestSymbol(null): hohle Tintenraute mit „?“ (UI-06). */
export function UnknownNestMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-13 -13 26 26" aria-hidden="true">
      <path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill="#fbf8f0" fillOpacity={0.85} stroke="#18273a" strokeOpacity={0.7} strokeWidth={1.2} />
      <text x="0" y="4" textAnchor="middle" fontSize="11" fontFamily="Fraunces, serif" fontWeight="600" fill="#18273a">?</text>
    </svg>
  );
}

function ConvoyMark({ fill }: { fill: string }) {
  return (
    <svg width="22" height="16" viewBox="-11 -8 22 16" aria-hidden="true">
      <path d="M-9 0 H9 L6 4.5 H-7 Z" fill={fill} stroke="#18273a" strokeWidth={1} />
      <rect x="-5" y="-4" width="4" height="4" fill="#fbf8f0" stroke="#18273a" strokeWidth={0.9} />
      <rect x="0" y="-3" width="3.5" height="3" fill="#fbf8f0" stroke="#18273a" strokeWidth={0.9} />
      <path d="M5.5 0 V-6" stroke="#18273a" strokeWidth={1} />
    </svg>
  );
}

function Hatch({ d, color }: { d: string; color: string }) {
  return <svg width="22" height="18" viewBox="0 0 17 16" aria-hidden="true"><path d={d} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" /></svg>;
}

/**
 * Legende als Inhalt des Blatts „Ebenen“ (UX 0.43, B6 / K-1, K-3): früher eine schwebende Tafel hinter einem kleinen „i“,
 * die über Reiterwechsel offen blieb und kein Esc kannte – das Blatt schließt mit Esc, Klick daneben und Ziehen.
 */
export function LegendBody() {
  return (
    <div className="text-xs text-ink" data-testid="map-legend">
      {GROUPS.map((g) => (
        <section key={g.title} className="pt-1.5">
          <h3 className="font-display text-[11px] uppercase tracking-[0.12em] text-ink2 border-b border-rule pb-0.5 mb-1">{g.title}</h3>
          <ul className="space-y-1.5">
            {g.items.map((i) => (
              <li key={i.text} className="flex items-center gap-2"><span className="flex w-12 shrink-0 justify-center">{i.icon}</span><span className="min-w-0">{i.text}</span></li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-ink2 pt-2">Feld antippen für Details · ziehen zum Schwenken · zwei Finger oder +/− zum Zoomen.</p>
    </div>
  );
}

function PostMark() {
  return (
    <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
      <circle r="9" fill="#fbf8f0" stroke="#2d5b7a" strokeWidth={1.3} />
      <path d="M0 5 V-3 M-4 -6 Q0 -1 4 -6" fill="none" stroke="#2d5b7a" strokeWidth={1.5} />
    </svg>
  );
}

function StripMark() {
  return <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M5 1 V21 M17 1 V21" stroke="#18273a" strokeWidth={1.3} strokeDasharray="3 2" /><rect x="5" y="1" width="12" height="20" fill="#18273a" fillOpacity={0.06} /></svg>;
}

function SonarRing() {
  return <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="#3d6b4f" strokeWidth={1.3} strokeDasharray="3 3" /></svg>;
}
