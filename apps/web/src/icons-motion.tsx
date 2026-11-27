// Bewegte Teile der Symbole (Einheiten, Forschungen): Klassen und Drehpunkt für eine SVG-Gruppe im Raster 64×64.
// Die Keyframes stehen in styles.css („Bewegte Symbole“). Jede Gruppe trägt „tf-mv“ (pausiert offscreen, im verborgenen
// Tab und bei prefers-reduced-motion) und „tf-mi“ (steht in kleinen Darstellungen still, siehe Icon in icons.tsx).
import type { CSSProperties } from "react";

/**
 * Props für einen bewegten Teil: `<g {...mv("rock", 32, 46)}>`.
 * kind = Bewegungsart (tf-i-…), ox/oy = Drehpunkt in Rasterpunkten, phase = Versatz in Sekunden (negativ: sofort mittendrin).
 */
export function mv(kind: string, ox = 32, oy = 32, phase = 0): { className: string; style: CSSProperties } {
  const style: CSSProperties = { transformOrigin: `${ox}px ${oy}px` };
  if (phase) style.animationDelay = `${phase}s`;
  return { className: `tf-mv tf-mi tf-i-${kind}`, style };
}
