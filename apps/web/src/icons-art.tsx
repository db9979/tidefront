// Symbolsatz „Seekarte“: Kupferstich – Tintenkontur, Schraffur als Schatten, Papier als Licht.
// Schiffe und Panzer im Seitenriss, Flugzeuge in Draufsicht, Gebäude im Aufriss. Raster 64×64.
import type { ReactNode, SVGAttributes } from "react";

export const INK = "#18273a";
export const PAPER = "#fbf8f0";
export const SIEGEL = "#a8331f";
export const SEE = "#2d5b7a";
export const MOOS = "#2f6b47";
export const MESSING = "#8a6424";

type P = SVGAttributes<SVGElement>;
const K = { stroke: INK, strokeWidth: 2.4, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const h: P = { fill: "url(#tf-h)", ...K };
const hd: P = { fill: "url(#tf-hd)", ...K };
const p: P = { fill: PAPER, ...K };
const ln: P = { fill: "none", ...K };
const red: P = { fill: SIEGEL, ...K, strokeWidth: 1.6 };
const WATER = <path d="M2 55 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0" fill="none" stroke={SEE} strokeWidth={1.8} strokeLinecap="round" />;
const GROUND = <path d="M2 56 H62" {...ln} strokeWidth={1.8} />;
const nav = (d: string, extra?: ReactNode) => (
  <>
    <path d={d} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" />
    {extra}
  </>
);

export const ART: Record<string, ReactNode> = {
  // ---------------------------------------------------------------- Ressourcen
  stahl: (<><path d="M7 45 L17 27 H47 L57 45 Z" {...h} /><path d="M17 27 L24 17 H40 L47 27 Z" {...p} /><path d="M7 45 H57" {...ln} /></>),
  treibstoff: (<><rect x="15" y="9" width="34" height="47" rx="4" {...h} /><path d="M15 23 H49 M15 42 H49" {...ln} /><rect x="35" y="5" width="8" height="5" {...p} /></>),
  elektronik: (<><path d="M24 10 V18 M32 10 V18 M40 10 V18 M24 46 V54 M32 46 V54 M40 46 V54 M10 24 H18 M10 32 H18 M10 40 H18 M46 24 H54 M46 32 H54 M46 40 H54" {...ln} /><rect x="18" y="18" width="28" height="28" {...p} /><rect x="26" y="26" width="12" height="12" {...h} /></>),
  proviant: (<><path d="M9 25 H55 V53 H9 Z" {...h} /><path d="M7 15 H57 V25 H7 Z" {...p} /><path d="M26 35 H38" {...ln} strokeWidth={3} /></>),
  credits: (<><circle cx="32" cy="32" r="22" {...p} /><circle cx="32" cy="32" r="16" fill="none" stroke={MESSING} strokeWidth={1.6} /><path d="M27 22 V42 M27 32 L37 22 M30 30 L38 42" fill="none" stroke={MESSING} strokeWidth={3} strokeLinecap="round" /></>),
  strom: <path d="M37 5 L16 36 H30 L25 59 L48 25 H34 Z" {...h} />,

  // ---------------------------------------------------------------- Gebäude (Aufriss)
  kommandozentrale: (<><path d="M6 56 V34 H58 V56 Z" {...h} /><path d="M23 56 V18 H41 V56 Z" {...p} /><path d="M28 25 H36 M28 32 H36 M28 39 H36 M28 46 H36" {...ln} strokeWidth={1.8} /><path d="M32 18 V5" {...ln} /><path d="M32 5 L44 8.5 L32 12 Z" {...red} />{GROUND}</>),
  stahlwerk: (<><path d="M5 56 V33 L17 26 V33 L29 26 V33 L41 26 V56 Z" {...h} /><path d="M45 56 V10 H52 V56 Z" {...p} /><path d="M11 40 H17 V48 H11 Z M22 40 H28 V48 H22 Z M33 40 H38 V48 H33 Z" {...p} strokeWidth={1.6} /><path d="M48.5 7 C47 3 51 2 54 -1" {...ln} strokeWidth={1.6} strokeDasharray="2 3" />{GROUND}</>),
  raffinerie: (<><path d="M5 56 V36 A9 4 0 0 1 23 36 V56 Z" {...h} /><path d="M26 56 V30 A8 3.5 0 0 1 42 30 V56 Z" {...p} /><path d="M47 56 V12 H53 V56 Z" {...h} /><path d="M45 20 H55 M45 30 H55 M45 40 H55" {...ln} strokeWidth={1.6} /><path d="M58 56 V8" {...ln} strokeWidth={1.8} /><path d="M58 7 C55 3 59 1 58 -2 C61 1 62 4 58 7 Z" {...red} />{GROUND}</>),
  chipfabrik: (<><path d="M4 56 V28 H60 V56 Z" {...p} /><path d="M13 28 V20 H26 V28 M38 28 V22 H51 V28" {...h} /><path d="M9 35 H55 M9 41 H55 M9 47 H55" {...ln} strokeWidth={1.6} />{GROUND}</>),
  versorgungshof: (<><path d="M4 56 V34 L20 21 L36 34 V56 Z" {...p} /><path d="M4 34 L20 21 L36 34 L32 36 L20 26 L8 36 Z" {...h} /><path d="M15 56 V44 H25 V56 M15 44 L25 56 M25 44 L15 56" {...ln} strokeWidth={1.6} /><path d="M42 56 V18 A7 5 0 0 1 56 18 V56 Z" {...h} /><path d="M42 30 H56 M42 42 H56" {...ln} strokeWidth={1.6} />{GROUND}</>),
  kraftwerk: (<><path d="M7 56 C11 44 11 30 8 16 H32 C29 30 29 44 33 56 Z" {...h} /><path d="M36 56 V34 H58 V56 Z" {...p} /><path d="M40 40 H45 M49 40 H54 M40 47 H45 M49 47 H54" {...ln} strokeWidth={1.6} /><path d="M13 13 C11 8 17 7 19 4 C21 7 27 6 28 10" {...ln} strokeWidth={1.6} strokeDasharray="2 3" />{GROUND}</>),
  lagerkomplex: (<><path d="M3 56 V32 L32 22 L61 32 V56 Z" {...p} /><path d="M3 32 L32 22 L61 32" {...ln} /><path d="M9 56 V40 H21 V56 Z M26 56 V40 H38 V56 Z M43 56 V40 H55 V56 Z" {...h} />{GROUND}</>),
  tiefbunker: (<><path d="M3 56 Q32 14 61 56 Z" {...h} /><path d="M24 56 V42 Q32 34 40 42 V56 Z" {...p} /><path d="M32 36 V56" {...ln} strokeWidth={1.6} />{GROUND}</>),
  werft: (<><path d="M10 56 V10 H44 M10 18 L18 10 M38 10 V24" {...ln} /><path d="M36 24 h4 v4 h-4 Z" {...p} strokeWidth={1.6} /><path d="M20 44 H60 L55 53 H25 Z" {...h} /><path d="M32 44 V36 H44 V44" {...p} strokeWidth={1.8} />{WATER}</>),
  kaserne: (<><path d="M4 56 V34 L32 20 L60 34 V56 Z" {...p} /><path d="M4 34 L32 20 L60 34 L56 37 L32 25 L8 37 Z" {...h} /><path d="M27 56 V44 H37 V56 M11 42 H19 V48 H11 Z M45 42 H53 V48 H45 Z" {...ln} strokeWidth={1.8} />{GROUND}</>),
  flugfeld: (<><path d="M6 48 Q6 22 30 22 Q54 22 54 48 Z" {...h} /><path d="M18 48 V36 H42 V48 Z" {...p} /><path d="M2 56 H62" {...ln} /><path d="M8 56 H16 M24 56 H32 M40 56 H48" stroke={PAPER} strokeWidth={1.4} /></>),
  radarstation: (<><path d="M32 56 V30 M22 56 L32 38 L42 56" {...ln} /><path d="M12 14 Q28 42 52 24 Z" {...p} /><path d="M18 18 Q28 34 46 25" {...ln} strokeWidth={1.4} /><path d="M32 22 L40 12" {...ln} strokeWidth={1.8} /><path d="M48 6 a10 10 0 0 1 8 10 M50 1 a16 16 0 0 1 11 15" fill="none" stroke={SEE} strokeWidth={1.8} strokeLinecap="round" />{GROUND}</>),
  hafenkommandantur: (<><path d="M8 56 V30 H44 V56 Z" {...p} /><path d="M4 30 L26 16 L48 30 Z" {...h} /><path d="M48 56 V14 H56 V56 Z" {...p} /><path d="M48.5 24 H55.5 M48.5 34 H55.5" stroke={SIEGEL} strokeWidth={3} /><path d="M46 14 H58 L56 9 H48 Z" {...hd} strokeWidth={1.6} /><path d="M20 56 V42 H32 V56 M14 36 H20 M32 36 H38" {...ln} strokeWidth={1.8} />{WATER}</>),

  // Strom (v1.6): Windpark, Solarfeld, Speicherwerk.
  windpark: (<><path d="M20 56 L22 23 L24 56 Z M44 56 L46 33 L48 56 Z" {...p} strokeWidth={1.8} /><path d="M22 22 L23 5 Q19 14 22 22 Z M22 22 L37 29 Q28 21 22 22 Z M22 22 L7 30 Q16 30 22 22 Z" {...h} strokeWidth={1.6} /><path d="M46 32 L47 20 Q43 26 46 32 Z M46 32 L56 37 Q51 31 46 32 Z M46 32 L36 38 Q42 37 46 32 Z" {...h} strokeWidth={1.4} /><circle cx="22" cy="22" r="2.2" fill={INK} /><circle cx="46" cy="32" r="1.8" fill={INK} />{GROUND}</>),
  solarfeld: (<><circle cx="50" cy="12" r="6" {...p} strokeWidth={1.8} /><path d="M50 2 V0 M60 12 H62 M57 5 L59 3 M41 5 L39 3" {...ln} strokeWidth={1.6} /><path d="M4 48 L13 33 H39 L30 48 Z" {...h} /><path d="M8.5 40.5 H34.5 M22 33 L17 48" {...ln} strokeWidth={1.4} /><path d="M27 56 L35 44 H60 L52 56 Z" {...p} /><path d="M31 50 H56 M47 44 L40 56" {...ln} strokeWidth={1.4} /><path d="M14 48 V56 M26 48 V56" {...ln} strokeWidth={1.8} />{GROUND}</>),
  speicherwerk: (<><path d="M6 56 V26 H58 V56 Z" {...p} /><path d="M12 32 H22 V50 H12 Z M27 32 H37 V50 H27 Z M42 32 H52 V50 H42 Z" {...h} strokeWidth={1.8} /><path d="M15 26 V21 H19 V26 M45 26 V21 H49 V26" {...ln} strokeWidth={1.8} /><path d="M34 4 L26 16 H32 L28 25 L38 12 H32 Z" {...red} />{GROUND}</>),

  forschungsamt: (<><path d="M6 56 V32 H58 V56 Z" {...p} /><path d="M18 32 A14 14 0 0 1 46 32 Z" {...h} /><path d="M33 22 L52 8" {...ln} strokeWidth={3.4} /><path d="M50 4 L56 12" {...ln} strokeWidth={1.8} /><path d="M13 40 H21 V48 H13 Z M43 40 H51 V48 H43 Z M28 56 V42 H36 V56" {...ln} strokeWidth={1.8} />{GROUND}</>),

  // ---------------------------------------------------------------- Forschung (Techniken und Würfel)
  wuerfel: (<><path d="M32 6 L56 18 V46 L32 58 L8 46 V18 Z" {...p} /><path d="M32 30 L56 18 V46 L32 58 Z" {...h} /><path d="M8 18 L32 30 L56 18 M32 30 V58" {...ln} /><ellipse cx="32" cy="18" rx="4" ry="2.4" fill={SIEGEL} /><circle cx="15" cy="30" r="2.6" fill={INK} /><circle cx="25" cy="44" r="2.6" fill={INK} /></>),
  turbine: (<><circle cx="32" cy="32" r="25" {...p} /><path d="M32 32 L32 9 Q43 13 41 24 Z M32 32 L55 32 Q51 43 40 41 Z M32 32 L32 55 Q21 51 23 40 Z M32 32 L9 32 Q13 21 24 23 Z" {...h} strokeWidth={1.8} /><circle cx="32" cy="32" r="4.5" fill={INK} /></>),
  sonar: (<><path d="M6 20 H58 L51 29 H13 Z" {...h} /><path d="M24 20 V12 H38 V20" {...p} strokeWidth={1.8} /><path d="M20 38 Q32 46 44 38 M13 45 Q32 57 51 45 M6 52 Q32 68 58 52" fill="none" stroke={SEE} strokeWidth={2.2} strokeLinecap="round" /><circle cx="32" cy="33" r="2.6" fill={SIEGEL} /></>),
  torpedo: (<><path d="M12 30 Q12 23 20 23 H50 Q59 23 61 30 Q59 37 50 37 H20 Q12 37 12 30 Z" {...h} /><path d="M12 30 L4 21 M12 30 L4 39 M50 23 V37" {...ln} strokeWidth={1.8} /><path d="M54 30 h3" stroke={SIEGEL} strokeWidth={3} strokeLinecap="round" />{WATER}</>),
  panzerung: (<><path d="M8 10 H56 V40 Q56 52 32 58 Q8 52 8 40 Z" {...h} /><path d="M8 24 H56 M32 10 V58" {...ln} strokeWidth={1.8} />{[14, 26, 38, 50].map((x) => <circle key={x} cx={x} cy={17} r={2.4} fill={PAPER} stroke={INK} strokeWidth={1.4} />)}</>),
  zahnrad: (<><path d="M28 5 H36 L37 12 L43 14 L48 9 L55 16 L50 21 L52 27 L59 28 V36 L52 37 L50 43 L55 48 L48 55 L43 50 L37 52 L36 59 H28 L27 52 L21 50 L16 55 L9 48 L14 43 L12 37 L5 36 V28 L12 27 L14 21 L9 16 L16 9 L21 14 L27 12 Z" {...h} /><circle cx="32" cy="32" r="9" {...p} /></>),
  tarnnetz: (<><path d="M5 55 Q11 21 32 17 Q53 21 59 55 Z" {...p} /><path d="M11 40 H53 M8 48 H56 M19 25 L45 55 M45 25 L19 55 M32 17 V55" {...ln} strokeWidth={1.3} /><path d="M16 32 q5 -5 10 0 M38 32 q5 -5 10 0 M27 46 q5 -5 10 0" stroke={MOOS} strokeWidth={3.2} fill="none" strokeLinecap="round" />{GROUND}</>),
  kran: (<><path d="M14 56 V8 M14 8 H56 M14 17 L23 8 M48 8 V28" {...ln} /><path d="M43 28 H53 V38 H43 Z" {...h} strokeWidth={1.8} /><path d="M6 56 H24 M30 56 V44 H46 V56" {...ln} strokeWidth={1.8} />{GROUND}</>),

  // ---------------------------------------------------------------- Schiffe (Seitenriss)
  korvette: (<><path d="M3 40 H61 L55 50 H11 Z" {...h} /><path d="M22 40 V31 H35 V24 H44 V31 H51 V40 Z" {...p} /><path d="M40 24 V12 M36 16 H44" {...ln} strokeWidth={1.8} /><path d="M9 38 H16 V40 M4 35.5 L12 37.5" {...ln} strokeWidth={2} />{WATER}</>),
  zerstoerer: (<><path d="M2 40 H62 L56 51 H10 Z" {...h} /><path d="M17 40 V30 H47 V40 Z" {...p} /><path d="M23 30 V23 H33 V30" {...p} /><path d="M37 30 V21 H43 V30 Z" {...hd} strokeWidth={1.8} /><path d="M28 23 V10 M24 14 H32" {...ln} strokeWidth={1.8} /><path d="M7 37.5 L14 38.5 M50 38.5 L57 37.5" {...ln} />{WATER}</>),
  landungsschiff: (<><path d="M2 38 H62 L60 50 H9 L2 44 Z" {...h} /><path d="M46 38 V22 H58 V38 Z" {...p} /><path d="M12 32 H40 V38 H12 Z" {...p} strokeWidth={1.8} /><path d="M52 22 V12 M2 38 V32 H8" {...ln} strokeWidth={1.8} /><path d="M49 27 H55" {...ln} strokeWidth={1.6} />{WATER}</>),
  uboot: (<><path d="M3 44 Q5 37 15 37 H50 Q59 37 62 43 Q59 49 50 50 H14 Q5 50 3 44 Z" {...h} /><path d="M26 37 V28 Q26 25 29 25 H39 L43 31 V37 Z" {...p} /><path d="M34 25 V10 H39 M30 25 V17" {...ln} strokeWidth={1.8} /><path d="M2 45 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0" fill="none" stroke={SEE} strokeWidth={1.8} strokeLinecap="round" />{WATER}</>),
  schnellboot: (<><path d="M6 43 H58 L50 51 H14 Z" {...h} /><path d="M24 43 L29 35 H41 L44 43 Z" {...p} /><path d="M35 35 V25" {...ln} strokeWidth={1.8} /><path d="M35 25 L44 27.5 L35 30 Z" {...red} /><path d="M1 49 H8 M2 45 H7" {...ln} strokeWidth={1.6} />{WATER}</>),

  // ---------------------------------------------------------------- Landeinheiten
  schuetzen: (<><path d="M14 58 C14 47 22 42 32 42 C42 42 50 47 50 58 Z" {...h} /><path d="M25 27 H39 V32 A7 7 0 0 1 25 32 Z" {...p} /><path d="M19 28 C19 17 25 11 32 11 C39 11 45 17 45 28 Z" {...h} /><path d="M47 14 L55 58" {...ln} strokeWidth={2.8} /></>),
  pioniere: (<><path d="M14 58 C14 47 22 42 32 42 C42 42 50 47 50 58 Z" {...h} /><path d="M25 27 H39 V32 A7 7 0 0 1 25 32 Z" {...p} /><path d="M19 28 C19 17 25 11 32 11 C39 11 45 17 45 28 Z" {...p} /><path d="M24 19 H40" {...ln} strokeWidth={1.8} /><path d="M52 12 V44" {...ln} strokeWidth={2.6} /><path d="M46 44 H58 L56 56 H48 Z" {...hd} /></>),
  kampfpanzer: (<><path d="M5 40 H59 L55 49 H9 Z" {...h} /><path d="M18 40 V32 L24 27 H41 L46 32 V40 Z" {...p} /><path d="M45 31 H62" {...ln} strokeWidth={3.2} /><path d="M9 49 H55" {...ln} />{[14, 23, 32, 41, 50].map((x) => <circle key={x} cx={x} cy={52} r={3.5} {...p} strokeWidth={1.8} />)}{GROUND}</>),
  piratenmiliz: (<><path d="M14 58 C14 47 22 42 32 42 C42 42 50 47 50 58 Z" {...h} /><path d="M25 26 H39 V31 A7 7 0 0 1 25 31 Z" {...p} /><path d="M20 27 C20 17 25 11 32 11 C39 11 44 17 44 27 L50 32 L43 31 Z" {...red} strokeWidth={2.2} /><path d="M50 18 Q58 34 50 56" {...ln} /></>),

  // ---------------------------------------------------------------- Luft (Draufsicht)
  abfangjaeger: (<><path d="M32 3 L36 20 L57 44 V49 L36 43 L35 54 L41 59 H23 L29 54 L28 43 L7 49 V44 L28 20 Z" {...h} /><ellipse cx="32" cy="21" rx="2.6" ry="6" {...p} strokeWidth={1.6} /></>),
  jagdbomber: (<><path d="M6 31 L28 24 V37 L6 40 Z M58 31 L36 24 V37 L58 40 Z" {...h} /><path d="M29 4 H35 L37 14 V52 L43 59 H21 L27 52 V14 Z" {...p} /><circle cx="18" cy="38" r="2.4" fill={INK} /><circle cx="46" cy="38" r="2.4" fill={INK} /></>),
  aufklaerungsdrohne: (<><path d="M3 26 H61 V31 H3 Z" {...h} /><path d="M30 8 H34 L35 54 H29 Z" {...p} /><path d="M23 51 H41" {...ln} /><circle cx="32" cy="14" r="2.6" fill={SEE} /></>),

  // ---------------------------------------------------------------- Anlagen
  kuestenbatterie: (<><path d="M38 38 L61 27" {...ln} strokeWidth={4} /><path d="M7 54 V43 Q7 34 19 34 H45 Q57 34 57 43 V54 Z" {...h} /><path d="M17 44 H38" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />{WATER}</>),
  flakstellung: (<><path d="M27 40 L19 9 M37 40 L45 9" {...ln} strokeWidth={3} /><circle cx="32" cy="42" r="7" {...p} /><path d="M8 56 Q8 44 32 44 Q56 44 56 56 Z" {...h} />{GROUND}</>),
  bunkerlinie: (<><path d="M3 56 L10 38 H22 L28 56 Z M23 56 L30 38 H42 L48 56 Z M43 56 L50 38 H58 L62 56" {...h} /><path d="M13 45 H19 M33 45 H39 M51 45 H56" stroke={INK} strokeWidth={2.6} strokeLinecap="round" /></>),
  minensperre: (<><path d="M32 41 V55" {...ln} strokeDasharray="2 3" /><path d="M32 8 V14 M32 46 V44 M14 28 H18 M46 28 H50 M19 15 L23 19 M45 15 L41 19 M19 41 L23 37 M45 41 L41 37" {...ln} /><circle cx="32" cy="28" r="13" {...h} />{WATER}</>),

  // ---------------------------------------------------------------- Missionen und Zeichen
  ueberfall: (<><circle cx="40" cy="24" r="16" {...p} /><circle cx="40" cy="24" r="8" fill="none" {...K} strokeWidth={1.6} /><path d="M6 58 L36 28" {...ln} strokeWidth={3.4} /><path d="M41 23 L27 27 L37 37 Z" {...red} /></>),
  aufklaerung: (<><path d="M4 32 Q32 8 60 32 Q32 56 4 32 Z" {...p} /><circle cx="32" cy="32" r="11" {...h} /><circle cx="32" cy="32" r="4.5" fill={INK} /></>),
  transport: (<><path d="M14 14 H44 V38 H14 Z" {...h} /><path d="M14 14 L18 8 H48 L44 14 M44 38 L48 32 V8" {...p} strokeWidth={2} /><path d="M4 50 H52" {...ln} strokeWidth={3} /><path d="M50 43 L60 50 L50 57 Z" fill={INK} /></>),
  kartell: (<><path d="M32 4 L60 32 L32 60 L4 32 Z" fill={SIEGEL} stroke={INK} strokeWidth={2} /><path d="M32 12 L52 32 L32 52 L12 32 Z" fill="none" stroke={PAPER} strokeWidth={1.4} /><path d="M23 23 L41 41 M41 23 L23 41" stroke={PAPER} strokeWidth={3.4} strokeLinecap="round" /></>),
  schild: (<><path d="M32 5 L54 13 V30 C54 45 44 54 32 59 C20 54 10 45 10 30 V13 Z" {...p} /><path d="M32 5 L54 13 V30 C54 45 44 54 32 59 Z" fill="url(#tf-h)" stroke="none" /><path d="M32 5 L54 13 V30 C54 45 44 54 32 59 C20 54 10 45 10 30 V13 Z" {...ln} /><path d="M21 32 L29 40 L44 23" fill="none" stroke={MOOS} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" /></>),
  uhr: (<><circle cx="32" cy="32" r="24" {...p} /><path d="M32 12 V15 M32 49 V52 M12 32 H15 M49 32 H52" {...ln} strokeWidth={1.8} /><path d="M32 18 V32 L43 38" {...ln} strokeWidth={3} /></>),
  // Abzeichen aus dem Auftragsbuch: Medaille mit Anker an zwei Bändern.
  hafenmeister: (<><path d="M20 4 L30 26 L24 30 L12 8 Z M44 4 L34 26 L40 30 L52 8 Z" {...hd} strokeWidth={1.8} /><circle cx="32" cy="41" r="18" {...h} /><circle cx="32" cy="41" r="12.5" {...p} strokeWidth={1.6} /><path d="M32 33 V50 M27 37 H37 M25 44 Q26 50 32 50 Q38 50 39 44" fill="none" stroke={MESSING} strokeWidth={2.4} strokeLinecap="round" /><circle cx="32" cy="31.5" r="1.8" fill={MESSING} /></>),
  anker: (<><circle cx="32" cy="11" r="5" {...p} /><path d="M32 16 V55 M21 25 H43 M11 38 Q15 55 32 55 Q49 55 53 38" {...ln} strokeWidth={3.6} /><path d="M7 41 L11 35 L15 41 M49 41 L53 35 L57 41" {...ln} strokeWidth={2.6} /></>),

  // ---------------------------------------------------------------- Wetter (v1.6)
  wind: (<path d="M6 22 H40 Q50 22 50 14 Q50 7 43 8 M6 33 H52 Q60 33 60 41 Q60 48 53 47 M6 44 H30 Q37 44 37 50 Q37 56 31 55" {...ln} strokeWidth={3} />),
  sonne: (<><circle cx="32" cy="32" r="12" {...h} /><path d="M32 6 V13 M32 51 V58 M6 32 H13 M51 32 H58 M14 14 L19 19 M45 45 L50 50 M50 14 L45 19 M19 45 L14 50" {...ln} strokeWidth={2.6} /></>),
  wolke: (<path d="M15 47 Q4 47 6 38 Q8 30 17 32 Q19 19 32 20 Q45 21 46 31 Q58 30 59 39 Q59 47 49 47 Z" {...h} />),
  nebel: (<path d="M6 20 H40 M46 20 H58 M6 30 H22 M28 30 H58 M6 40 H48 M54 40 H58 M12 50 H34 M40 50 H52" {...ln} strokeWidth={2.8} strokeDasharray="0" />),
  sturm: (<><path d="M15 38 Q4 38 6 29 Q8 21 17 23 Q19 10 32 11 Q45 12 46 22 Q58 21 59 30 Q59 38 49 38 Z" {...h} /><path d="M33 34 L24 48 H31 L27 60 L40 44 H33 Z" {...red} /></>),

  // ---------------------------------------------------------------- Navigation (Linie in Textfarbe)
  "nav-basis": nav("M32 17 V56 M22 26 H42 M10 38 Q14 56 32 56 Q50 56 54 38", <circle cx="32" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth={3.4} />),
  "nav-karte": nav("M6 14 L22 8 L42 14 L58 8 V50 L42 56 L22 50 L6 56 Z M22 8 V50 M42 14 V56"),
  "nav-truppen": nav("M6 44 H58 L52 52 H12 Z M18 44 V36 H40 V44 M24 36 V29 H34 V36 M30 29 V12 M26 16 H34"),
  "nav-bericht": nav("M14 6 H42 L52 16 V58 H14 Z M42 6 V16 H52 M22 28 H44 M22 37 H44 M22 46 H36"),
  "nav-boerse": nav("M6 56 H58 M10 46 L24 30 L34 38 L54 14 M44 14 H54 V24"),
};
