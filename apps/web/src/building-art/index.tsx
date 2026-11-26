// Stufenbilder der Gebäude: dasselbe Gebäude wächst mit der Ausbaustufe sichtbar mit.
// Die Zeichnungen liegen in einem nachgeladenen Chunk (drawings.tsx); bis dahin steht das normale Symbol da.
import { lazy, Suspense, useRef } from "react";
import { ART, INK, MESSING } from "../icons-art.tsx";

const Drawing = lazy(() => import("./drawings.tsx"));

/** Erste Stufe je Ausbauabschnitt: 0 Bauplan, 1–3 klein, 4–7 mittel, 8–12 groß, 13–17 sehr groß, 18–20 Prachtbau. */
export const STAGE_FROM = [0, 1, 4, 8, 13, 18] as const;
export const STAGE_NAMES = ["Bauplan", "klein", "mittel", "groß", "sehr groß", "Prachtbau"] as const;

export function stageOf(level: number): number {
  let s = 0;
  STAGE_FROM.forEach((from, i) => { if (level >= from) s = i; });
  return s;
}

/** Stufe, ab der das nächste Ausbaubild gilt (null: schon Prachtbau). */
export function nextStageLevel(level: number): number | null {
  return STAGE_FROM.find((l) => l > level) ?? null;
}

/** Normales Symbol als Platzhalter, mittig auf der Bildfläche 96×80. */
function Placeholder({ id }: { id: string }) {
  return <svg x={20} y={10} width={56} height={56} viewBox="0 0 64 64" overflow="visible">{ART[id] ?? <circle cx="32" cy="32" r="12" fill="url(#tf-h)" stroke={INK} strokeWidth={2.4} />}</svg>;
}

/** Stufenbild eines Gebäudes; size = Breite in px (Höhe 5/6 davon). */
export function BuildingArt({ id, level, size = 72, className }: { id: string; level: number; size?: number; className?: string }) {
  const stage = stageOf(level);
  const first = useRef(stage);
  return (
    <svg viewBox="0 0 96 80" width={size} height={(size * 80) / 96} className={className} aria-hidden="true" style={{ overflow: "visible" }}>
      <Suspense fallback={<Placeholder id={id} />}>
        <Drawing id={id} stage={stage} animate={stage !== first.current} />
      </Suspense>
    </svg>
  );
}

/** Stufenbild auf Papierfeld mit Tintenrahmen und Messing-Kennlinie (wie IconTile). */
export function BuildingArtTile({ id, level, size = 56 }: { id: string; level: number; size?: number }) {
  return (
    <div
      className="shrink-0 grid place-items-center bg-[#f6f1e5] border border-rule"
      style={{ width: size, height: Math.round((size * 80) / 96) + 4, borderRadius: 3, boxShadow: `inset 3px 0 0 ${MESSING}` }}
    >
      <BuildingArt id={id} level={level} size={size - 6} />
    </div>
  );
}
