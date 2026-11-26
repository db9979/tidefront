// Symbolsatz im Stil „Lagezentrum“: einfarbige Seitenrisse (Schiffe, Panzer), Draufsichten (Flugzeuge),
// technische Piktogramme (Gebäude, Anlagen). Farbe nur als Signal. 64×64.
import type { ReactNode } from "react";

const L = "#d5dde4"; // helle Fläche
const M = "#8e9cab"; // mittlere Fläche
const D = "#3d4a57"; // Schatten, Details
const W = "#4fb3d9"; // Glas, Wasser, Signal freundlich
const A = "#c08a3e"; // Signal Warnung, Messing
const R = "#a84a44"; // Signal feindlich
const G = "#6e9a7c"; // Signal Elektronik

const WATER = <path d="M2 50 H62" stroke={W} strokeWidth="1" opacity="0.6" />;

const P: Record<string, ReactNode> = {
  // ---------------------------------------------------------- Ressourcen (Piktogramme mit Kennfarbe)
  stahl: (
    <>
      <path d="M8 40 L20 30 H56 L44 40 Z" fill={L} />
      <path d="M8 40 H44 V48 H8 Z" fill={M} />
      <path d="M44 40 L56 30 V38 L44 48 Z" fill={D} />
      <path d="M14 26 L24 18 H52 L42 26 Z" fill={M} opacity="0.7" />
    </>
  ),
  treibstoff: (
    <>
      <rect x="18" y="10" width="28" height="44" rx="3" fill={A} />
      <path d="M18 20 H46 M18 32 H46 M18 44 H46" stroke="#6b4a1c" strokeWidth="2" />
      <rect x="36" y="12" width="6" height="3" fill="#6b4a1c" />
    </>
  ),
  elektronik: (
    <>
      <rect x="16" y="16" width="32" height="32" fill="#2e4a3c" stroke={G} strokeWidth="1.5" />
      <rect x="25" y="25" width="14" height="14" fill={G} />
      {[22, 29, 36, 43].map((v) => (
        <path key={v} d={`M${v - 1} 9 V16 M${v - 1} 48 V55 M9 ${v - 1} H16 M48 ${v - 1} H55`} stroke={M} strokeWidth="2" />
      ))}
    </>
  ),
  proviant: (
    <>
      <path d="M10 24 H54 V50 H10 Z" fill="#7b7258" />
      <path d="M10 24 L16 16 H48 L54 24" fill="#968c6c" />
      <path d="M10 33 H54 M10 42 H54 M24 24 V50 M40 24 V50" stroke="#4d4634" strokeWidth="1.5" />
    </>
  ),
  credits: (
    <>
      <circle cx="32" cy="32" r="20" fill="none" stroke={A} strokeWidth="3" />
      <path d="M38 24 A10 10 0 1 0 38 40 M22 30 H36 M22 34 H36" stroke={A} strokeWidth="3" fill="none" />
    </>
  ),
  strom: <path d="M36 6 L18 36 H30 L26 58 L46 26 H34 Z" fill={A} />,

  // ---------------------------------------------------------- Gebäude (technische Piktogramme)
  kommandozentrale: (
    <>
      <path d="M10 54 V36 H54 V54" fill={M} />
      <path d="M24 54 V18 H40 V54" fill={L} />
      <path d="M28 24 H36 M28 30 H36 M28 36 H36 M28 42 H36" stroke={W} strokeWidth="2" />
      <path d="M32 18 V6 M26 9 H38" stroke={L} strokeWidth="2" />
      <path d="M14 42 H20 M44 42 H50" stroke={D} strokeWidth="3" />
    </>
  ),
  stahlwerk: (
    <>
      <path d="M6 54 V34 L18 26 V34 L30 26 V34 L42 26 V54 Z" fill={M} />
      <rect x="45" y="10" width="7" height="44" fill={L} />
      <path d="M45 18 H52 M45 26 H52" stroke={D} strokeWidth="1.5" />
      <rect x="12" y="42" width="26" height="4" fill={A} opacity="0.8" />
    </>
  ),
  raffinerie: (
    <>
      <rect x="6" y="30" width="18" height="24" fill={L} />
      <ellipse cx="15" cy="30" rx="9" ry="3" fill={M} />
      <rect x="28" y="20" width="16" height="34" fill={M} />
      <ellipse cx="36" cy="20" rx="8" ry="3" fill={L} />
      <path d="M50 54 V8 M47 14 H53 M47 24 H53 M47 34 H53" stroke={L} strokeWidth="2.5" />
      <path d="M24 44 H28 M44 40 H48" stroke={D} strokeWidth="2" />
    </>
  ),
  chipfabrik: (
    <>
      <path d="M6 54 V24 L18 16 L30 24 L42 16 L58 24 V54 Z" fill={M} />
      <rect x="12" y="32" width="40" height="6" fill={W} opacity="0.8" />
      <rect x="12" y="42" width="40" height="6" fill={W} opacity="0.5" />
    </>
  ),
  versorgungshof: (
    <>
      <path d="M6 54 V32 L22 20 L38 32 V54 Z" fill={M} />
      <rect x="17" y="40" width="10" height="14" fill={D} />
      <rect x="42" y="16" width="14" height="38" fill={L} />
      <ellipse cx="49" cy="16" rx="7" ry="3" fill={M} />
    </>
  ),
  kraftwerk: (
    <>
      <path d="M8 54 Q14 34 12 18 H32 Q30 34 36 54 Z" fill={L} />
      <path d="M12 18 Q22 22 32 18" fill="none" stroke={M} strokeWidth="2" />
      <path d="M42 54 V20 M38 26 H46 M38 34 H46" stroke={M} strokeWidth="2.5" />
      <path d="M52 22 L46 34 H51 L48 44 L56 30 H51 L54 22 Z" fill={A} />
    </>
  ),
  lagerkomplex: (
    <>
      <path d="M4 54 V28 L32 14 L60 28 V54 Z" fill={M} />
      <rect x="12" y="34" width="40" height="20" fill={D} />
      <path d="M12 39 H52 M12 44 H52 M12 49 H52" stroke={M} strokeWidth="1.5" />
    </>
  ),
  tiefbunker: (
    <>
      <path d="M4 54 Q32 8 60 54 Z" fill={M} />
      <path d="M16 54 Q32 28 48 54 Z" fill={D} />
      <rect x="27" y="40" width="10" height="14" fill="#1a232c" />
      <path d="M2 54 H62" stroke={L} strokeWidth="2" />
    </>
  ),
  werft: (
    <>
      <path d="M8 42 H54 L50 50 H12 Z" fill={M} />
      <path d="M14 42 V8 H46 M40 8 V22" stroke={L} strokeWidth="3" fill="none" />
      <path d="M14 14 L22 8" stroke={L} strokeWidth="2" />
      <rect x="37" y="22" width="6" height="5" fill={A} />
      {WATER}
    </>
  ),
  kaserne: (
    <>
      <rect x="4" y="30" width="56" height="24" fill={M} />
      <path d="M2 30 L32 16 L62 30 Z" fill={L} />
      <path d="M10 38 H18 M24 38 H32 M38 38 H46 M50 38 H56" stroke={W} strokeWidth="3" opacity="0.8" />
      <rect x="28" y="44" width="8" height="10" fill={D} />
    </>
  ),
  flugfeld: (
    <>
      <path d="M4 56 L26 8 H38 L60 56 Z" fill={D} />
      <path d="M32 14 V20 M32 28 V34 M32 42 V48" stroke={L} strokeWidth="2" />
      <path d="M50 14 L48 24 L40 28 L48 29 L47 34 L50 33 L53 29 L60 28 L52 24 Z" fill={L} />
    </>
  ),
  radarstation: (
    <>
      <path d="M26 56 L32 30 L38 56 Z" fill={M} />
      <path d="M12 28 A22 22 0 0 1 48 10 L32 30 Z" fill={L} />
      <circle cx="32" cy="30" r="2.5" fill={W} />
      <path d="M46 38 A14 14 0 0 0 52 26 M50 44 A22 22 0 0 0 60 26" stroke={W} strokeWidth="2" fill="none" />
    </>
  ),
  hafenkommandantur: (
    <>
      <rect x="6" y="28" width="30" height="26" fill={L} />
      <path d="M4 28 L21 18 L38 28 Z" fill={M} />
      <path d="M12 36 H18 M24 36 H30 M12 44 H18 M24 44 H30" stroke={W} strokeWidth="2.5" />
      <path d="M50 14 V44 M44 22 H56 M42 38 Q50 50 58 38" stroke={L} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="11" r="3" fill="none" stroke={L} strokeWidth="2.5" />
    </>
  ),

  // ---------------------------------------------------------- Schiffe (Seitenriss, Bug rechts)
  korvette: (
    <>
      <path d="M3 40 H50 L61 34 L59 40 L54 46 H8 Z" fill={M} />
      <path d="M3 40 H59" stroke={L} strokeWidth="1" />
      <path d="M22 40 V33 H32 V29 H38 V33 H42 V40 Z" fill={L} />
      <path d="M35 29 V18 M31 22 H39 M33 25 H37" stroke={L} strokeWidth="1.5" />
      <rect x="46" y="35" width="5" height="4" fill={L} />
      <path d="M50 36 H56" stroke={L} strokeWidth="1.5" />
      <rect x="12" y="36" width="6" height="4" fill={D} />
      {WATER}
    </>
  ),
  zerstoerer: (
    <>
      <path d="M2 40 H52 L62 33 L60 40 L55 47 H6 Z" fill={M} />
      <path d="M2 40 H60" stroke={L} strokeWidth="1" />
      <path d="M16 40 V32 H24 V26 H30 V32 H40 V40 Z" fill={L} />
      <path d="M27 26 V13 M23 16 H31 M24 20 H30" stroke={L} strokeWidth="1.5" />
      <rect x="33" y="28" width="4" height="4" fill={D} />
      <rect x="44" y="35" width="6" height="5" fill={L} />
      <path d="M49 36 H57" stroke={L} strokeWidth="1.5" />
      <rect x="7" y="35" width="6" height="5" fill={L} />
      <path d="M8 36 H2" stroke={L} strokeWidth="1.5" />
      {WATER}
    </>
  ),
  landungsschiff: (
    <>
      <path d="M3 36 H58 V42 L55 47 H7 L3 42 Z" fill={M} />
      <path d="M58 36 L62 40 V42 H58" fill={D} />
      <path d="M5 36 V25 H17 V36 Z" fill={L} />
      <path d="M11 25 V15 M8 18 H14" stroke={L} strokeWidth="1.5" />
      <rect x="22" y="31" width="8" height="5" fill={D} />
      <rect x="32" y="31" width="8" height="5" fill={D} />
      <rect x="42" y="31" width="8" height="5" fill={D} />
      {WATER}
    </>
  ),
  schnellboot: (
    <>
      <path d="M10 41 H48 L58 36 L55 43 L52 46 H14 Z" fill={M} />
      <path d="M24 41 V35 H34 L38 41 Z" fill={L} />
      <path d="M30 35 V27" stroke={L} strokeWidth="1.5" />
      <path d="M30 27 H37 V31 H30" fill={R} />
      <path d="M44 38 H50" stroke={L} strokeWidth="1.5" />
      {WATER}
    </>
  ),

  // ---------------------------------------------------------- Bodentruppen
  schuetzen: (
    <>
      <path d="M12 36 Q13 18 32 17 Q51 18 52 36 Z" fill={M} />
      <path d="M8 36 H56 L54 40 H10 Z" fill={L} />
      <path d="M18 26 Q32 22 46 26" stroke={D} strokeWidth="1.5" fill="none" />
      <path d="M22 40 L24 50 M42 40 L40 50" stroke={D} strokeWidth="2" />
    </>
  ),
  pioniere: (
    <>
      <path d="M12 38 Q13 22 30 21 Q47 22 48 38 Z" fill={M} />
      <path d="M8 38 H52 L50 42 H10 Z" fill={L} />
      <path d="M40 8 L58 26" stroke={L} strokeWidth="3" />
      <path d="M54 22 L60 16 L62 22 L58 28 Z" fill={L} />
      <path d="M18 12 L30 24" stroke={A} strokeWidth="2.5" />
    </>
  ),
  kampfpanzer: (
    <>
      <rect x="6" y="38" width="48" height="10" rx="5" fill={D} />
      {[12, 20, 28, 36, 44].map((x) => <circle key={x} cx={x + 2} cy="43" r="3" fill={M} />)}
      <path d="M6 38 L12 31 H48 L56 38 Z" fill={M} />
      <path d="M20 31 L23 24 H40 L45 31 Z" fill={L} />
      <path d="M42 26 H63" stroke={L} strokeWidth="2.5" />
      <path d="M28 24 V20 H32" stroke={L} strokeWidth="1.5" fill="none" />
    </>
  ),
  piratenmiliz: (
    <>
      <path d="M12 36 Q13 20 32 19 Q51 20 52 36 Z" fill="#5a4a40" />
      <path d="M8 36 H56 L54 40 H10 Z" fill="#7a6658" />
      <path d="M40 10 L56 50" stroke={L} strokeWidth="2" />
      <path d="M36 14 H46" stroke={A} strokeWidth="3" />
    </>
  ),

  // ---------------------------------------------------------- Flugzeuge (Draufsicht, Nase oben)
  abfangjaeger: (
    <>
      <path d="M32 4 L35 14 L36 26 L58 38 V42 L36 38 L35 50 L42 56 V59 L32 56 L22 59 V56 L29 50 L28 38 L6 42 V38 L28 26 L29 14 Z" fill={M} />
      <path d="M32 6 L34 16 H30 Z" fill={W} />
      <path d="M32 18 V52" stroke={L} strokeWidth="1" />
    </>
  ),
  jagdbomber: (
    <>
      <path d="M32 4 L36 16 L37 24 L60 36 V41 L37 36 L36 50 L44 56 V59 L32 56 L20 59 V56 L28 50 L27 36 L4 41 V36 L27 24 L28 16 Z" fill={M} />
      <path d="M32 6 L34 16 H30 Z" fill={W} />
      <rect x="14" y="38" width="3" height="9" fill={D} />
      <rect x="47" y="38" width="3" height="9" fill={D} />
      <rect x="21" y="34" width="3" height="9" fill={D} />
      <rect x="40" y="34" width="3" height="9" fill={D} />
    </>
  ),
  aufklaerungsdrohne: (
    <>
      <path d="M30 8 H34 L35 27 L62 29 V32 L35 33 L34 50 L42 53 V56 H22 V53 L30 50 L29 33 L2 32 V29 L29 27 Z" fill={M} />
      <circle cx="32" cy="12" r="2.5" fill={W} />
    </>
  ),

  // ---------------------------------------------------------- Anlagen
  kuestenbatterie: (
    <>
      <path d="M4 52 L10 38 H46 L52 52 Z" fill={M} />
      <path d="M16 38 L20 30 H38 L42 38 Z" fill={L} />
      <path d="M36 33 L62 25" stroke={L} strokeWidth="3" />
      <path d="M2 52 H62" stroke={D} strokeWidth="2" />
      {WATER}
    </>
  ),
  flakstellung: (
    <>
      <path d="M8 54 L14 44 H50 L56 54 Z" fill={M} />
      <rect x="24" y="36" width="16" height="8" fill={L} />
      <path d="M30 38 L46 10 M34 40 L52 14" stroke={L} strokeWidth="3" />
    </>
  ),
  bunkerlinie: (
    <>
      <path d="M2 54 V34 L12 28 H52 L62 34 V54 Z" fill={M} />
      <path d="M12 28 H52" stroke={L} strokeWidth="2" />
      <rect x="12" y="38" width="10" height="3" fill="#1a232c" />
      <rect x="42" y="38" width="10" height="3" fill="#1a232c" />
      <path d="M2 54 H62" stroke={D} strokeWidth="2" />
    </>
  ),
  minensperre: (
    <>
      <circle cx="32" cy="30" r="12" fill={D} stroke={M} strokeWidth="1.5" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x="30.5" y="12" width="3" height="7" fill={M} transform={`rotate(${a} 32 30)`} />
      ))}
      <path d="M32 42 V58" stroke={M} strokeWidth="1.5" strokeDasharray="2 2" />
      <path d="M2 24 H62" stroke={W} strokeWidth="1" opacity="0.5" />
    </>
  ),

  // ---------------------------------------------------------- Missionen und Lage (Taktikzeichen)
  ueberfall: (
    <>
      <path d="M8 46 Q20 18 46 18" stroke={L} strokeWidth="3" fill="none" />
      <path d="M40 10 L56 18 L40 26 Z" fill={L} />
      <path d="M8 46 Q24 30 48 30" stroke={L} strokeWidth="1.5" fill="none" opacity="0.5" />
    </>
  ),
  aufklaerung: (
    <>
      <path d="M4 32 Q32 8 60 32 Q32 56 4 32 Z" fill="none" stroke={L} strokeWidth="2.5" />
      <circle cx="32" cy="32" r="8" fill={W} />
      <circle cx="32" cy="32" r="3" fill="#0d131a" />
    </>
  ),
  transport: (
    <>
      <path d="M6 32 H48" stroke={L} strokeWidth="3" />
      <path d="M44 22 L60 32 L44 42 Z" fill={L} />
      <rect x="10" y="18" width="12" height="10" fill="none" stroke={M} strokeWidth="2" />
      <rect x="24" y="18" width="12" height="10" fill="none" stroke={M} strokeWidth="2" />
    </>
  ),
  kartell: (
    <>
      <path d="M32 6 L58 32 L32 58 L6 32 Z" fill="#ff8080" stroke="#2a0a0a" strokeWidth="2" />
      <path d="M22 22 L42 42 M42 22 L22 42" stroke="#2a0a0a" strokeWidth="3" />
    </>
  ),
  schild: (
    <>
      <path d="M32 6 L54 14 V30 C54 44 44 54 32 58 C20 54 10 44 10 30 V14 Z" fill="none" stroke={W} strokeWidth="3" />
      <path d="M22 32 L29 39 L43 24" stroke={W} strokeWidth="3" fill="none" />
    </>
  ),
  uhr: (
    <>
      <circle cx="32" cy="32" r="22" fill="none" stroke={M} strokeWidth="3" />
      <path d="M32 18 V32 L42 38" stroke={L} strokeWidth="3" fill="none" />
    </>
  ),
  "nav-karte": (
    <>
      <path d="M6 14 L22 8 L42 14 L58 8 V50 L42 56 L22 50 L6 56 Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M22 8 V50 M42 14 V56" stroke="currentColor" strokeWidth="3.5" />
    </>
  ),
  "nav-bericht": (
    <>
      <path d="M14 8 H44 L52 16 V56 H14 Z" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M22 26 H44 M22 36 H44 M22 46 H36" stroke="currentColor" strokeWidth="3.5" />
    </>
  ),
  "nav-boerse": (
    <>
      <path d="M8 50 L22 34 L32 42 L54 16" stroke="currentColor" strokeWidth="3.5" fill="none" strokeLinejoin="round" />
      <path d="M44 16 H54 V26" stroke="currentColor" strokeWidth="3.5" fill="none" />
      <path d="M6 56 H58" stroke="currentColor" strokeWidth="3.5" />
    </>
  ),
  "nav-truppen": (
    <>
      <rect x="8" y="16" width="48" height="32" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M8 16 L56 48 M56 16 L8 48" stroke="currentColor" strokeWidth="3" />
    </>
  ),
  "nav-basis": (
    <>
      <circle cx="32" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M32 17 V56 M22 26 H42 M10 38 Q14 56 32 56 Q50 56 54 38" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ),
  anker: (
    <>
      <circle cx="32" cy="12" r="5" fill="none" stroke={L} strokeWidth="3.5" />
      <path d="M32 17 V54 M22 26 H42 M12 38 Q16 54 32 54 Q48 54 52 38" stroke={L} strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ),
};

export function hasIcon(id: string): boolean {
  return id in P;
}

/** Symbol ohne Hintergrund. */
export function Icon({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" style={{ overflow: "visible" }}>
      {P[id] ?? <circle cx="32" cy="32" r="12" fill={M} />}
    </svg>
  );
}

/** Kennstreifen links nach Zugehörigkeit (NATO-Farben gedämpft). */
const TONE: Record<string, string> = {
  see: "#4fb3d9",
  land: "#8ea27a",
  luft: "#9fb2c4",
  gebaeude: "#6c7d8e",
  anlage: "#a39782",
  feind: "#d36b65",
};

/** Symbol auf einer dunklen Kachel mit dünnem Rahmen und Kennstreifen. */
export function IconTile({ id, size = 48, tone = "gebaeude" }: { id: string; size?: number; tone?: keyof typeof TONE }) {
  return (
    <div
      className="shrink-0 relative grid place-items-center bg-navy-900 border border-white/10"
      style={{ width: size, height: size, borderRadius: 4, boxShadow: `inset 3px 0 0 ${TONE[tone]}` }}
    >
      <Icon id={id} size={Math.round(size * 0.78)} />
    </div>
  );
}
