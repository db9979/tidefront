// Truppen → Einsatz: kleine Kupferstich-Zeichnungen im Stil der Hafen-Vignette (components/Vignette.tsx).
import type { ReactNode } from "react";
import { INK, PAPER, SEE, SIEGEL } from "../../icons-art.tsx";

const ln = { fill: "none", stroke: INK, strokeWidth: 0.8, strokeLinejoin: "round", strokeLinecap: "round" } as const;
const pp = { fill: PAPER, stroke: INK, strokeWidth: 0.8, strokeLinejoin: "round" } as const;

/** Schiff im Seitenriss an der Mole (x: Bug links, w: Länge). */
function Moored({ x, y, w, mast = true }: { x: number; y: number; w: number; mast?: boolean }) {
  return (
    <g>
      <path d={`M${x} ${y} H${x + w} L${x + w - 3} ${y + 5} H${x + 3} Z`} fill="url(#tf-h)" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" />
      <path d={`M${x + w * 0.35} ${y} V${y - 4} H${x + w * 0.65} V${y}`} {...pp} />
      {mast && <path d={`M${x + w * 0.5} ${y - 4} V${y - 13} M${x + w * 0.5} ${y - 11} L${x + w * 0.9} ${y - 0.5} M${x + w * 0.5} ${y - 11} L${x + w * 0.1} ${y - 0.5}`} {...ln} strokeWidth={0.5} />}
      <path d={`M${x + 2} ${y + 7.5} q2 -1 4 0 t4 0 M${x + w - 10} ${y + 7.5} q2 -1 4 0 t4 0`} fill="none" stroke={SEE} strokeWidth="0.6" />
    </g>
  );
}

/** Ruhiger Hafen: Mole mit Leuchtturm, zwei vertäute Schiffe, glatte See – für „keine laufende Mission“. */
export function CalmHarborArt({ width = 132 }: { width?: number }) {
  return (
    <div className="shrink-0 border border-ink p-[3px] bg-card" aria-hidden="true">
      <svg viewBox="0 0 132 64" width={width} height={(width * 64) / 132} className="block">
        <defs>
          <pattern id="ez-sky" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={PAPER} /><path d="M0 2 H4" stroke={INK} strokeWidth="0.3" opacity="0.5" /></pattern>
        </defs>
        <rect width="132" height="64" fill="url(#ez-sky)" />
        {/* Wasser */}
        <rect y="44" width="132" height="20" fill={PAPER} />
        <path d="M0 44 H132" stroke={INK} strokeWidth="0.8" />
        <path d="M10 52 H30 M44 57 H70 M84 51 H100 M108 58 H126 M20 61 H36" stroke={SEE} strokeWidth="0.6" />
        {/* Mole mit Pollern */}
        <path d="M0 44 V39 H58 L62 44 Z" fill="url(#tf-hd)" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M14 39 V36.5 M30 39 V36.5 M46 39 V36.5" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        {/* Leuchtturm */}
        <path d="M5 39 L7 16 H13 L15 39 Z" {...pp} />
        <path d="M6.3 26 H13.7 M5.8 33 H14.2" stroke={SIEGEL} strokeWidth="2.2" />
        <path d="M4.5 16 H15.5 L14 12 H6 Z" fill={INK} />
        <path d="M10 12 V9" stroke={INK} strokeWidth="0.8" />
        {/* Schiffe an der Mole */}
        <Moored x={66} y={41} w={30} />
        <Moored x={100} y={42} w={24} mast={false} />
        {/* Möwen */}
        <path d="M78 14 q2 -2 4 0 q2 -2 4 0 M96 20 q1.5 -1.5 3 0 q1.5 -1.5 3 0" {...ln} strokeWidth={0.6} />
        {/* Wolke */}
        <path d="M36 16 q2 -5 7 -3 q3 -4 8 -1 q5 0 4 4 H36 Z" fill={PAPER} stroke={INK} strokeWidth="0.6" />
      </svg>
    </div>
  );
}

/** Rahmen für ein Kachelsymbol (Papierfeld mit Tintenrand wie die Gebäudebilder). */
export function TileFrame({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center w-[64px] h-[56px] border border-rule bg-[#f6f1e5] rounded-[3px]" aria-hidden="true">{children}</div>;
}
