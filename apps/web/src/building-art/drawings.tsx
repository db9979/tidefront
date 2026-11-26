// Nachgeladener Teil der Stufenbilder: Zeichnungen aller Gebäude (eigener Chunk, siehe index.tsx).
import { G, Ground, hd, red, ln, type Draw } from "./parts.tsx";
import { WIRTSCHAFT } from "./draw-wirtschaft.tsx";
import { MILITAER } from "./draw-militaer.tsx";
import { ENERGIE } from "./draw-energie.tsx";
import { ART, INK } from "../icons-art.tsx";

/** Zeichnungen je Gebäude; neue Gebäude ergänzen hier ihre Funktion, sonst gilt das normale Symbol. */
export const DRAWINGS: Record<string, Draw> = { ...WIRTSCHAFT, ...MILITAER, ...ENERGIE };

/** Stufe 0: Bauplan (Umriss von Abschnitt 1 als Blaupause), Baugrube und Absteckpfähle. */
function Plan({ draw }: { draw: Draw }) {
  return (
    <>
      <g className="tf-plan">{draw(1)}</g>
      <path d={`M30 ${G} L33 ${G + 5} H63 L66 ${G}`} {...hd} strokeWidth={1.1} />
      {[24, 72].map((x) => (
        <g key={x}>
          <path d={`M${x} ${G} V${G - 9}`} {...ln} strokeWidth={1.1} />
          <path d={`M${x} ${G - 9} L${x + 4} ${G - 8} L${x} ${G - 7} Z`} {...red} strokeWidth={0.6} />
        </g>
      ))}
      <Ground x1={8} x2={88} />
    </>
  );
}

export default function Drawing({ id, stage, animate }: { id: string; stage: number; animate: boolean }) {
  const draw = DRAWINGS[id];
  if (!draw) return <svg x={20} y={10} width={56} height={56} viewBox="0 0 64 64" overflow="visible">{ART[id] ?? <circle cx="32" cy="32" r="12" fill="url(#tf-h)" stroke={INK} strokeWidth={2.4} />}</svg>;
  return (
    <g key={stage} className={animate ? "tf-grow" : undefined}>
      {stage === 0 ? <Plan draw={draw} /> : draw(stage)}
    </g>
  );
}
