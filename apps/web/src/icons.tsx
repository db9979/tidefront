// Einheitlicher Icon-Satz als SVG (64×64). Farben: Rumpfgrau, Stahlblau, Messing, Akzent je Gattung.
import type { ReactNode } from "react";

const HULL = "#9fb3c8";
const DARK = "#1c2c3f";
const STEEL = "#5f7a96";
const BRASS = "#f2c14e";
const SEA = "#3fa7d6";
const RED = "#e5484d";
const GREEN = "#6fbf73";
const OLIVE = "#7d8f4a";

const P: Record<string, ReactNode> = {
  // ---------------------------------------------------------- Ressourcen
  stahl: (
    <>
      <path d="M10 40 L22 28 H54 L42 40 Z" fill="#c9d6e3" />
      <path d="M10 40 H42 V50 H10 Z" fill={STEEL} />
      <path d="M42 40 L54 28 V38 L42 50 Z" fill="#46607a" />
      <path d="M16 22 L26 12 H52 L42 22 Z" fill="#c9d6e3" opacity="0.7" />
    </>
  ),
  treibstoff: (
    <>
      <rect x="16" y="10" width="32" height="44" rx="6" fill="#c0503c" />
      <rect x="16" y="20" width="32" height="4" fill="#8a3326" />
      <rect x="16" y="40" width="32" height="4" fill="#8a3326" />
      <path d="M32 26 C27 33 26 36 32 39 C38 36 37 33 32 26 Z" fill={BRASS} />
    </>
  ),
  elektronik: (
    <>
      <rect x="16" y="16" width="32" height="32" rx="4" fill="#2f6f5e" />
      <rect x="24" y="24" width="16" height="16" rx="2" fill={GREEN} />
      {[20, 28, 36, 44].map((v) => (
        <g key={v} fill={BRASS}>
          <rect x={v - 1.5} y="9" width="3" height="7" />
          <rect x={v - 1.5} y="48" width="3" height="7" />
          <rect x="9" y={v - 1.5} width="7" height="3" />
          <rect x="48" y={v - 1.5} width="7" height="3" />
        </g>
      ))}
    </>
  ),
  proviant: (
    <>
      <path d="M10 26 L32 16 L54 26 L32 36 Z" fill="#d9b26b" />
      <path d="M10 26 V44 L32 54 V36 Z" fill="#a67c3d" />
      <path d="M54 26 V44 L32 54 V36 Z" fill="#8a6430" />
      <path d="M21 21 L43 31 V38" stroke="#5c3f18" strokeWidth="3" fill="none" />
    </>
  ),
  credits: (
    <>
      <circle cx="32" cy="32" r="22" fill={BRASS} />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#b8892a" strokeWidth="3" />
      <path d="M36 23 A9 9 0 1 0 36 41" stroke="#8a6420" strokeWidth="4" fill="none" strokeLinecap="round" />
    </>
  ),
  strom: <path d="M36 6 L16 36 H30 L26 58 L48 26 H34 Z" fill={BRASS} />,

  // ---------------------------------------------------------- Gebäude
  kommandozentrale: (
    <>
      <rect x="12" y="34" width="40" height="20" fill={STEEL} />
      <rect x="24" y="18" width="16" height="36" fill={HULL} />
      <rect x="28" y="24" width="8" height="6" fill={SEA} />
      <path d="M32 18 V6" stroke={DARK} strokeWidth="2" />
      <path d="M32 6 L44 10 L32 14 Z" fill={RED} />
      <rect x="16" y="40" width="5" height="5" fill={SEA} />
      <rect x="43" y="40" width="5" height="5" fill={SEA} />
    </>
  ),
  stahlwerk: (
    <>
      <path d="M8 54 V32 L20 24 V32 L32 24 V32 L44 24 V54 Z" fill={STEEL} />
      <rect x="46" y="12" width="7" height="42" fill="#46607a" />
      <circle cx="50" cy="8" r="4" fill="#8899aa" opacity="0.7" />
      <rect x="14" y="40" width="24" height="6" fill="#f08a3c" />
    </>
  ),
  raffinerie: (
    <>
      <rect x="8" y="30" width="18" height="24" rx="9" fill={HULL} />
      <rect x="28" y="22" width="18" height="32" rx="9" fill="#c9d6e3" />
      <rect x="48" y="10" width="6" height="44" fill={STEEL} />
      <path d="M51 10 C47 4 55 2 51 -2" stroke="#f08a3c" strokeWidth="3" fill="none" />
      <rect x="28" y="34" width="18" height="4" fill="#c0503c" />
    </>
  ),
  chipfabrik: (
    <>
      <rect x="8" y="24" width="48" height="30" fill="#2f6f5e" />
      <path d="M8 24 L20 14 L32 24 L44 14 L56 24" fill="#3d8a75" />
      <rect x="22" y="32" width="20" height="14" rx="2" fill={GREEN} />
      <path d="M26 32 V28 M32 32 V28 M38 32 V28" stroke={BRASS} strokeWidth="2" />
    </>
  ),
  versorgungshof: (
    <>
      <path d="M8 30 L24 18 L40 30 V54 H8 Z" fill="#a6553a" />
      <rect x="18" y="38" width="12" height="16" fill="#5c2c1d" />
      <rect x="42" y="20" width="14" height="34" rx="7" fill="#d9b26b" />
      <path d="M4 56 H60" stroke={OLIVE} strokeWidth="4" />
    </>
  ),
  kraftwerk: (
    <>
      <path d="M12 54 L16 22 H36 L40 54 Z" fill={HULL} />
      <path d="M14 22 Q26 30 38 22" fill="#c9d6e3" />
      <ellipse cx="26" cy="14" rx="10" ry="6" fill="#e6eef7" opacity="0.6" />
      <path d="M50 22 L42 38 H48 L45 52 L56 34 H50 L53 22 Z" fill={BRASS} />
    </>
  ),
  lagerkomplex: (
    <>
      <path d="M6 28 L32 12 L58 28 V54 H6 Z" fill={STEEL} />
      <rect x="14" y="34" width="36" height="20" fill="#46607a" />
      <path d="M14 39 H50 M14 44 H50 M14 49 H50" stroke="#2c4257" strokeWidth="2" />
    </>
  ),
  tiefbunker: (
    <>
      <path d="M6 54 Q32 6 58 54 Z" fill="#6b7480" />
      <path d="M18 54 Q32 26 46 54 Z" fill="#4a525c" />
      <rect x="26" y="40" width="12" height="14" rx="2" fill={DARK} />
      <circle cx="35" cy="47" r="1.6" fill={BRASS} />
    </>
  ),
  werft: (
    <>
      <path d="M10 44 H54 L48 54 H16 Z" fill={HULL} />
      <rect x="14" y="10" width="4" height="34" fill={BRASS} />
      <path d="M14 12 H46" stroke={BRASS} strokeWidth="4" />
      <path d="M40 14 V30" stroke={DARK} strokeWidth="2" />
      <rect x="36" y="30" width="8" height="6" fill={DARK} />
      <path d="M4 58 Q16 54 28 58 T52 58 T64 58" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  kaserne: (
    <>
      <path d="M6 30 L32 14 L58 30 Z" fill={OLIVE} />
      <rect x="10" y="30" width="44" height="24" fill="#5e6e36" />
      <rect x="27" y="38" width="10" height="16" fill={DARK} />
      <path d="M32 18 l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8Z" fill={BRASS} />
    </>
  ),
  flugfeld: (
    <>
      <path d="M22 58 L28 6 H36 L42 58 Z" fill="#4a525c" />
      <path d="M32 12 V18 M32 26 V32 M32 40 V46" stroke="#e6eef7" strokeWidth="2" />
      <path d="M50 18 L46 34 L38 38 L46 38 L44 46 L48 46 L52 38 L58 36 L52 34 Z" fill={HULL} />
    </>
  ),
  radarstation: (
    <>
      <path d="M28 54 L32 34 L36 54 Z" fill={STEEL} />
      <path d="M14 30 A20 20 0 0 1 46 12 L32 30 Z" fill={HULL} />
      <circle cx="32" cy="30" r="3" fill={BRASS} />
      <path d="M46 34 A14 14 0 0 0 52 22 M52 40 A22 22 0 0 0 60 22" stroke={GREEN} strokeWidth="2.5" fill="none" />
    </>
  ),
  hafenkommandantur: (
    <>
      <rect x="8" y="28" width="30" height="26" fill="#c9d6e3" />
      <path d="M6 28 L23 16 L40 28 Z" fill="#c0503c" />
      <rect x="18" y="38" width="10" height="16" fill={DARK} />
      <path d="M50 14 V44 M43 22 H57 M42 38 Q50 50 58 38" stroke={BRASS} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="12" r="3.5" fill="none" stroke={BRASS} strokeWidth="3" />
    </>
  ),

  // ---------------------------------------------------------- Schiffe
  korvette: (
    <>
      <path d="M4 40 H60 L52 50 H12 Z" fill={HULL} />
      <rect x="24" y="30" width="16" height="10" fill="#c9d6e3" />
      <rect x="30" y="20" width="3" height="10" fill={STEEL} />
      <path d="M44 36 H54" stroke={DARK} strokeWidth="3" />
      <path d="M2 56 Q14 52 26 56 T50 56 T64 56" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  zerstoerer: (
    <>
      <path d="M2 40 H62 L54 50 H8 Z" fill={STEEL} />
      <rect x="18" y="28" width="22" height="12" fill={HULL} />
      <rect x="24" y="16" width="4" height="12" fill="#46607a" />
      <rect x="32" y="22" width="6" height="6" fill="#46607a" />
      <path d="M44 35 H58 M6 35 H16" stroke={DARK} strokeWidth="3" />
      <path d="M2 56 Q14 52 26 56 T50 56 T64 56" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  landungsschiff: (
    <>
      <path d="M4 36 H60 V46 L54 52 H8 L4 46 Z" fill={OLIVE} />
      <rect x="44" y="24" width="12" height="12" fill={HULL} />
      <rect x="10" y="30" width="30" height="6" fill="#5e6e36" />
      <path d="M2 58 Q14 54 26 58 T50 58 T64 58" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  schnellboot: (
    <>
      <path d="M8 40 H58 L50 48 H14 Z" fill="#3b3b44" />
      <rect x="26" y="32" width="12" height="8" fill="#55555f" />
      <path d="M32 32 V18" stroke={DARK} strokeWidth="2" />
      <path d="M32 18 H42 V26 H32 Z" fill="#111" />
      <circle cx="37" cy="22" r="2" fill="#fff" />
      <path d="M2 54 Q14 50 26 54 T50 54 T64 54" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),

  // ---------------------------------------------------------- Bodentruppen
  schuetzen: (
    <>
      <path d="M12 34 Q12 14 32 14 Q52 14 52 34 Z" fill={OLIVE} />
      <rect x="8" y="34" width="48" height="6" rx="3" fill="#5e6e36" />
      <path d="M20 44 L44 44 L40 54 H24 Z" fill="#d9b48c" />
    </>
  ),
  pioniere: (
    <>
      <path d="M14 34 Q14 16 32 16 Q50 16 50 34 Z" fill="#c9a33a" />
      <rect x="10" y="34" width="44" height="6" rx="3" fill="#9a7b26" />
      <path d="M44 6 L56 18 M50 12 L28 34" stroke={HULL} strokeWidth="4" strokeLinecap="round" />
      <path d="M20 44 L44 44 L40 54 H24 Z" fill="#d9b48c" />
    </>
  ),
  kampfpanzer: (
    <>
      <rect x="6" y="40" width="52" height="12" rx="6" fill="#4a5530" />
      {[14, 24, 34, 44].map((x) => <circle key={x} cx={x + 2} cy="46" r="3.5" fill="#2e351d" />)}
      <path d="M12 40 L16 30 H48 L52 40 Z" fill={OLIVE} />
      <rect x="24" y="22" width="16" height="10" rx="3" fill="#5e6e36" />
      <rect x="38" y="25" width="22" height="4" fill="#5e6e36" />
    </>
  ),
  piratenmiliz: (
    <>
      <circle cx="32" cy="28" r="16" fill="#e6e1d3" />
      <circle cx="26" cy="27" r="4" fill="#111" />
      <circle cx="38" cy="27" r="4" fill="#111" />
      <path d="M28 36 H36 M30 36 V40 M34 36 V40" stroke="#111" strokeWidth="2" />
      <path d="M14 50 L50 58 M50 50 L14 58" stroke="#e6e1d3" strokeWidth="5" strokeLinecap="round" />
    </>
  ),

  // ---------------------------------------------------------- Flugzeuge
  abfangjaeger: (
    <>
      <path d="M32 4 L36 20 L58 36 V42 L36 34 L35 50 L42 56 V60 L32 56 L22 60 V56 L29 50 L28 34 L6 42 V36 L28 20 Z" fill={HULL} />
      <path d="M32 10 L34 20 H30 Z" fill={SEA} />
    </>
  ),
  jagdbomber: (
    <>
      <path d="M32 4 L37 22 L58 34 V40 L37 34 L36 50 L42 56 V60 L32 56 L22 60 V56 L28 50 L27 34 L6 40 V34 L27 22 Z" fill={STEEL} />
      <ellipse cx="16" cy="40" rx="3" ry="6" fill={RED} />
      <ellipse cx="48" cy="40" rx="3" ry="6" fill={RED} />
    </>
  ),
  aufklaerungsdrohne: (
    <>
      <path d="M8 30 H56 L50 36 H14 Z" fill={HULL} />
      <rect x="26" y="24" width="12" height="16" rx="5" fill={STEEL} />
      <circle cx="32" cy="42" r="4" fill={SEA} stroke={DARK} strokeWidth="2" />
      <path d="M32 46 L20 58 M32 46 L44 58" stroke={GREEN} strokeWidth="2" opacity="0.7" />
    </>
  ),

  // ---------------------------------------------------------- Anlagen
  kuestenbatterie: (
    <>
      <path d="M6 54 L14 38 H50 L58 54 Z" fill="#6b7480" />
      <rect x="20" y="28" width="22" height="12" rx="4" fill={STEEL} />
      <rect x="38" y="30" width="22" height="5" fill="#46607a" />
      <path d="M2 60 Q14 56 26 60 T50 60" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  flakstellung: (
    <>
      <path d="M8 54 L14 42 H50 L56 54 Z" fill="#6b7480" />
      <rect x="24" y="34" width="16" height="10" rx="3" fill={STEEL} />
      <path d="M30 36 L44 10 M34 38 L50 14" stroke="#46607a" strokeWidth="4" strokeLinecap="round" />
      <circle cx="52" cy="8" r="3" fill={BRASS} />
    </>
  ),
  bunkerlinie: (
    <>
      <path d="M4 54 V34 L14 28 H50 L60 34 V54 Z" fill="#7a828c" />
      <rect x="14" y="38" width="10" height="4" fill={DARK} />
      <rect x="40" y="38" width="10" height="4" fill={DARK} />
      <path d="M4 46 H60" stroke="#5a626c" strokeWidth="2" />
    </>
  ),
  minensperre: (
    <>
      <circle cx="32" cy="36" r="14" fill="#3b3b44" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="30" y="14" width="4" height="8" fill="#55555f" transform={`rotate(${a} 32 36)`} />
      ))}
      <circle cx="27" cy="31" r="3" fill="#8899aa" />
      <path d="M4 50 Q16 46 28 50 T52 50 T64 50" stroke={SEA} strokeWidth="3" fill="none" opacity="0.6" />
    </>
  ),

  // ---------------------------------------------------------- Missionen und Sonstiges
  ueberfall: (
    <>
      <path d="M12 12 L44 44 M52 12 L20 44" stroke={HULL} strokeWidth="6" strokeLinecap="round" />
      <path d="M38 48 L48 38 M26 48 L16 38" stroke={BRASS} strokeWidth="6" strokeLinecap="round" />
    </>
  ),
  aufklaerung: (
    <>
      <circle cx="20" cy="36" r="12" fill={DARK} stroke={HULL} strokeWidth="5" />
      <circle cx="44" cy="36" r="12" fill={DARK} stroke={HULL} strokeWidth="5" />
      <rect x="26" y="28" width="12" height="8" fill={HULL} />
      <circle cx="17" cy="33" r="3" fill={SEA} />
      <circle cx="41" cy="33" r="3" fill={SEA} />
    </>
  ),
  transport: (
    <>
      <rect x="14" y="16" width="16" height="14" fill="#d9b26b" />
      <rect x="32" y="20" width="14" height="10" fill="#c0503c" />
      <path d="M6 32 H58 L52 44 H12 Z" fill={OLIVE} />
      <path d="M2 52 Q14 48 26 52 T50 52 T64 52" stroke={SEA} strokeWidth="3" fill="none" />
    </>
  ),
  kartell: (
    <>
      <path d="M14 6 V58" stroke="#8a6430" strokeWidth="4" />
      <path d="M16 8 H54 L46 20 L54 32 H16 Z" fill="#111" />
      <circle cx="33" cy="17" r="5" fill="#e6e1d3" />
      <path d="M26 26 L40 22 M26 22 L40 26" stroke="#e6e1d3" strokeWidth="2.5" />
    </>
  ),
  schild: (
    <>
      <path d="M32 6 L54 14 V30 C54 44 44 54 32 58 C20 54 10 44 10 30 V14 Z" fill={SEA} />
      <path d="M32 12 L48 18 V30 C48 40 41 48 32 52 Z" fill="#7cc6e8" />
    </>
  ),
  uhr: (
    <>
      <circle cx="32" cy="32" r="22" fill="none" stroke={HULL} strokeWidth="5" />
      <path d="M32 18 V32 L42 38" stroke={BRASS} strokeWidth="5" strokeLinecap="round" fill="none" />
    </>
  ),
  "nav-karte": (
    <>
      <path d="M6 14 L22 8 L42 14 L58 8 V50 L42 56 L22 50 L6 56 Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 8 V50 M42 14 V56" stroke="currentColor" strokeWidth="4" />
    </>
  ),
  "nav-bericht": (
    <>
      <path d="M14 8 H44 L52 16 V56 H14 Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 26 H44 M22 36 H44 M22 46 H36" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  "nav-boerse": (
    <>
      <path d="M32 8 V56 M14 56 H50 M10 20 H54" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M10 20 L4 38 Q10 44 16 38 Z M54 20 L48 38 Q54 44 60 38 Z" fill="currentColor" />
    </>
  ),
  "nav-truppen": (
    <>
      <path d="M12 34 Q12 12 32 12 Q52 12 52 34 Z" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M6 36 H58" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M22 44 L32 54 L42 44" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  "nav-basis": (
    <>
      <circle cx="32" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M32 17 V56 M22 26 H42 M10 38 Q14 56 32 56 Q50 56 54 38" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  ),
  anker: (
    <>
      <circle cx="32" cy="12" r="5" fill="none" stroke={BRASS} strokeWidth="4" />
      <path d="M32 17 V54 M22 26 H42 M12 38 Q16 54 32 54 Q48 54 52 38" stroke={BRASS} strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  ),
};

export function hasIcon(id: string): boolean {
  return id in P;
}

/** Icon ohne Hintergrund. */
export function Icon({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" style={{ overflow: "visible" }}>
      {P[id] ?? <circle cx="32" cy="32" r="14" fill={STEEL} />}
    </svg>
  );
}

const TILE: Record<string, string> = {
  see: "from-sky-900 to-navy-800",
  land: "from-lime-950 to-navy-800",
  luft: "from-slate-700 to-navy-800",
  gebaeude: "from-navy-600 to-navy-800",
  anlage: "from-stone-700 to-navy-800",
  feind: "from-red-950 to-navy-800",
};

/** Icon auf einer gerundeten Kachel mit Verlauf. */
export function IconTile({ id, size = 48, tone = "gebaeude" }: { id: string; size?: number; tone?: keyof typeof TILE }) {
  return (
    <div
      className={`shrink-0 rounded-xl bg-gradient-to-br ${TILE[tone]} border border-white/10 shadow-inner grid place-items-center`}
      style={{ width: size, height: size }}
    >
      <Icon id={id} size={Math.round(size * 0.74)} />
    </div>
  );
}
