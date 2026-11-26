// Abzeichen der Erfolge im Kupferstich-Stil „Seekarte“: Medaille an zwei Bändern, Rand in der Farbe der Stufe
// (Bronze, Silber, Gold), Kerben für die Stufe, in der Mitte ein Sinnbild. Gesperrt: grau und gestrichelt.
import type { ReactNode } from "react";
import { ART, INK, PAPER, SIEGEL, MESSING, SEE } from "../icons-art.tsx";

/** Farbe der Stufe: 0 gesperrt, 1 Bronze, 2 Silber, 3 Gold. */
export const TIER_COLOR = ["#9aa0a6", "#9a5b2e", "#7d8790", MESSING] as const;
export const TIER_LABEL = ["gesperrt", "Bronze", "Silber", "Gold"] as const;

const K = { stroke: INK, strokeWidth: 2.4, strokeLinejoin: "round", strokeLinecap: "round" } as const;

/** Eigene Sinnbilder (Raster 64×64), sonst ein Symbol aus dem Symbolsatz. */
const EMBLEM: Record<string, ReactNode> = {
  // Prisenmeister: Schatztruhe mit Beschlägen.
  truhe: (<><path d="M10 30 H54 V54 H10 Z" fill="url(#tf-h)" {...K} /><path d="M10 30 Q10 14 32 14 Q54 14 54 30 Z" fill={PAPER} {...K} /><path d="M10 38 H54 M22 15 V54 M42 15 V54" fill="none" {...K} strokeWidth={1.8} /><rect x="28" y="33" width="8" height="10" fill={MESSING} {...K} strokeWidth={1.6} /></>),
  // Ruhmreich: Lorbeerkranz mit Stern.
  kranz: (<><path d="M20 52 Q6 40 12 20 M44 52 Q58 40 52 20" fill="none" {...K} /><path d="M13 44 q-6 -2 -6 -8 q6 0 6 8 Z M10 34 q-6 -3 -4 -9 q5 2 4 9 Z M11 25 q-4 -4 0 -9 q3 4 0 9 Z M51 44 q6 -2 6 -8 q-6 0 -6 8 Z M54 34 q6 -3 4 -9 q-5 2 -4 9 Z M53 25 q4 -4 0 -9 q-3 4 0 9 Z" fill="url(#tf-hd)" {...K} strokeWidth={1.4} /><path d="M32 18 L36 28 L47 28 L38 34 L41 45 L32 38 L23 45 L26 34 L17 28 L28 28 Z" fill={SIEGEL} {...K} strokeWidth={1.8} /></>),
  // Wochenwerk: Kalenderblatt mit sieben Feldern und Haken.
  woche: (<><path d="M10 14 H54 V56 H10 Z" fill={PAPER} {...K} /><path d="M10 14 H54 V24 H10 Z" fill="url(#tf-h)" {...K} /><path d="M20 8 V18 M44 8 V18" fill="none" {...K} /><path d="M16 32 H22 M27 32 H33 M38 32 H44 M16 40 H22 M27 40 H33 M38 40 H44 M16 48 H22" fill="none" {...K} strokeWidth={1.6} /><path d="M30 48 L36 53 L48 38" fill="none" stroke={SEE} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" /></>),
};

/** Sinnbild je Erfolg. */
const EMBLEM_OF: Record<string, string> = {
  nestjaeger: "kartell",
  freibeuter: "ueberfall",
  bollwerk: "schild",
  prisenmeister: "truhe",
  kaufmann: "credits",
  baumeister: "kommandozentrale",
  gelehrter: "forschungsamt",
  meisterspion: "spionage",
  flottenbrecher: "zerstoerer",
  pflichttreu: "uhr",
  ruhmreich: "kranz",
  wochenwerk: "woche",
};

function emblem(id: string): ReactNode {
  const key = EMBLEM_OF[id] ?? "anker";
  return EMBLEM[key] ?? ART[key] ?? ART.anker;
}

/** Medaille eines Erfolgs. tier 0 = gesperrt (grau), 1 Bronze, 2 Silber, 3 Gold. */
export function AchievementBadge({ id, tier, size = 56, title }: { id: string; tier: number; size?: number; title?: string }) {
  const c = TIER_COLOR[Math.max(0, Math.min(3, tier))];
  const locked = tier <= 0;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title ? `${title}: ${TIER_LABEL[Math.min(3, Math.max(0, tier))]}` : undefined}
      style={{ overflow: "visible", filter: locked ? "grayscale(1)" : undefined, opacity: locked ? 0.5 : 1 }}>
      {title && <title>{`${title} (${TIER_LABEL[Math.min(3, Math.max(0, tier))]})`}</title>}
      {/* Bänder */}
      <path d="M22 44 L16 62 L22 58 L26 63 L30 47 Z M42 44 L48 62 L42 58 L38 63 L34 47 Z" fill={locked ? PAPER : c} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      {/* Medaille: Rand in Stufenfarbe, Schraffur als Prägung */}
      <circle cx="32" cy="28" r="25" fill={locked ? PAPER : c} stroke={INK} strokeWidth={2.2} strokeDasharray={locked ? "4 3" : undefined} />
      <circle cx="32" cy="28" r="25" fill="url(#tf-h)" opacity={locked ? 0 : 0.35} />
      <circle cx="32" cy="28" r="19" fill={PAPER} stroke={INK} strokeWidth={1.6} />
      {/* Kerben je Stufe am oberen Rand */}
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={24 + i * 8} cy={6.5} r={2.2} fill={i < tier ? PAPER : "none"} stroke={i < tier ? INK : "none"} strokeWidth={1.2} />
      ))}
      <g transform="translate(17 13) scale(0.47)">{emblem(id)}</g>
    </svg>
  );
}
