// Symbole im Stil „Seekarte“ (Kupferstich). Die Zeichnungen liegen in icons-art.tsx.
import { ART, INK, PAPER, SIEGEL, SEE, MOOS, MESSING } from "./icons-art.tsx";

export function hasIcon(id: string): boolean {
  return id in ART;
}

/** Gemeinsame Schraffuren; einmal im Dokument eingebunden (main.tsx). */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="tf-h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill={PAPER} />
          <path d="M0 0 V4" stroke={INK} strokeWidth="1.1" />
        </pattern>
        <pattern id="tf-hd" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill={PAPER} />
          <path d="M0 0 V3" stroke={INK} strokeWidth="1.5" />
        </pattern>
        <pattern id="tf-hr" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill={PAPER} />
          <path d="M0 0 V4" stroke={SIEGEL} strokeWidth="1.2" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Unter dieser Größe stehen die bewegten Teile von Einheiten und Forschungen still (.tf-still, styles.css). */
const MOTION_MIN = 28;

/** Symbol ohne Hintergrund. */
export function Icon({ id, size = 24, className }: { id: string; size?: number; className?: string }) {
  const cls = size < MOTION_MIN ? (className ? `${className} tf-still` : "tf-still") : className;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cls} aria-hidden="true" style={{ overflow: "visible" }}>
      {ART[id] ?? <circle cx="32" cy="32" r="12" fill="url(#tf-h)" stroke={INK} strokeWidth={2.4} />}
    </svg>
  );
}

/** Kennfarbe nach Zugehörigkeit – als feine Linie links an der Kachel. */
const TONE: Record<string, string> = {
  see: SEE,
  land: MOOS,
  luft: "#4f5b69",
  gebaeude: MESSING,
  anlage: "#6b5a3a",
  feind: SIEGEL,
};

/** Symbol auf einem Papierfeld mit Tintenrahmen und Kennlinie (wie eine Vignette im Kartenrand). */
export function IconTile({ id, size = 48, tone = "gebaeude" }: { id: string; size?: number; tone?: keyof typeof TONE }) {
  return (
    <div
      className="shrink-0 relative grid place-items-center bg-[#f6f1e5] border border-rule"
      style={{ width: size, height: size, borderRadius: 3, boxShadow: `inset 3px 0 0 ${TONE[tone]}` }}
    >
      <Icon id={id} size={Math.round(size * 0.8)} />
    </div>
  );
}
