// SVG-Nachbildungen der Kartenzeichen (für Legende und Info-Blatt), im Stil der Seekarte.
const INK = "#18273a";
const PAPER = "#fbf8f0";
const SIEGEL = "#a8331f";
const SEE = "#2d5b7a";
const ALLY = "#3d6b4f";
const PAKT = "#9a7424";
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

/** Farben der Verhältnisse (wie map/symbols.ts). */
export const RELATION_HEX = { own: INK, allianz: ALLY, pakt: PAKT, krieg: SIEGEL, neutral: SEE } as const;

export type TacticalKind =
  | "own" | "other" | "ally" | "pact" | "war" | "nest" | "nestEmpty" | "wreck" | "port" | "ship" | "shipBack"
  // Übersichtspunkte (rausgezoomte Karte)
  | "dotAlly" | "dotPact" | "dotWar" | "dotOther" | "dotNest" | "dotPort";

/** Zeichen eines fremden Hafens nach Verhältnis. */
export function relationKind(relation: string | undefined): TacticalKind {
  return relation === "allianz" ? "ally" : relation === "pakt" ? "pact" : relation === "krieg" ? "war" : "other";
}

function Dot({ color, r = 7, hollow = false }: { color: string; r?: number; hollow?: boolean }) {
  return hollow
    ? <circle r={r} fill={PAPER} stroke={color} strokeWidth="1.6" />
    : <><circle r={r + 1.6} fill={PAPER} stroke="#c9c2b0" strokeWidth="0.6" /><circle r={r} fill={color} /></>;
}

function Anchor({ color, k = 1 }: { color: string; k?: number }) {
  return (
    <g transform={`scale(${k})`} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <circle cx="0" cy="-5" r="1.8" strokeWidth={1.3} />
      <path d="M0 -3.2 V5.5 M-3.4 -1 H3.4 M-4.4 3 A5 5 0 0 0 4.4 3" />
    </g>
  );
}

export function TacticalIcon({ kind, level = 1, size = 28 }: { kind: TacticalKind; level?: number; size?: number }) {
  const roman = ROMAN[Math.max(1, Math.min(ROMAN.length - 1, level))];
  return (
    <svg viewBox="-17 -17 34 34" width={size} height={size} aria-hidden="true" className="shrink-0">
      {kind === "own" && (<><circle r="14" fill={INK} /><circle r="11" fill="none" stroke={PAPER} strokeWidth="0.8" /><Anchor color={PAPER} k={1.15} /></>)}
      {kind === "other" && (<><circle r="12" fill={PAPER} stroke={SEE} strokeWidth="1.6" /><Anchor color={SEE} /></>)}
      {kind === "ally" && (<><circle r="12" fill={PAPER} stroke={ALLY} strokeWidth="2" /><circle r="9.6" fill="none" stroke={ALLY} strokeWidth="0.7" /><Anchor color={ALLY} k={0.85} /></>)}
      {kind === "pact" && (<><circle r="12" fill={PAPER} stroke={PAKT} strokeWidth="2" /><Anchor color={PAKT} /></>)}
      {kind === "war" && (
        <>
          <circle r="12" fill={PAPER} stroke={SIEGEL} strokeWidth="2" /><Anchor color={SIEGEL} />
          <path d="M0 -13 V-17 M0 13 V17 M-13 0 H-17 M13 0 H17" stroke={SIEGEL} strokeWidth="1.6" />
        </>
      )}
      {kind === "dotAlly" && <Dot color={ALLY} />}
      {kind === "dotPact" && <Dot color={PAKT} />}
      {kind === "dotWar" && <Dot color={SIEGEL} r={8.5} />}
      {kind === "dotOther" && <Dot color={SEE} />}
      {kind === "dotPort" && <Dot color={INK} r={6} hollow />}
      {kind === "dotNest" && (<><polygon points="0,-11 11,0 0,11 -11,0" fill={PAPER} /><polygon points="0,-9 9,0 0,9 -9,0" fill={SIEGEL} /></>)}
      {kind === "nest" && (
        <>
          {level >= 6 && <polygon points="0,-16 16,0 0,16 -16,0" fill="none" stroke={SIEGEL} strokeWidth="1.2" />}
          <polygon points="0,-13 13,0 0,13 -13,0" fill={SIEGEL} />
          <polygon points="0,-9 9,0 0,9 -9,0" fill="none" stroke={PAPER} strokeWidth="0.8" />
          <text x="0" y="3.5" textAnchor="middle" fontSize={roman.length > 2 ? 7.5 : 9.5} fontFamily="Fraunces, Georgia, serif" fontWeight="600" fill={PAPER}>{roman}</text>
        </>
      )}
      {kind === "nestEmpty" && (
        <>
          <polygon points="0,-13 13,0 0,13 -13,0" fill="none" stroke="#59636f" strokeWidth="1.4" strokeDasharray="3 3" />
          <text x="0" y="3.5" textAnchor="middle" fontSize="9" fontFamily="Fraunces, Georgia, serif" fontWeight="600" fill="#59636f">{roman}</text>
        </>
      )}
      {kind === "wreck" && (
        <>
          <circle r="10" fill="none" stroke={INK} strokeWidth="1" strokeDasharray="3 3" />
          <path d="M-6 0 H6 M-3 -3 V3 M0 -4 V4 M3 -3 V3" stroke={INK} strokeWidth="1.4" />
        </>
      )}
      {kind === "port" && (<><circle r="8" fill={PAPER} stroke={INK} strokeWidth="1.2" /><Anchor color={INK} k={0.75} /></>)}
      {(kind === "ship" || kind === "shipBack") && (
        <>
          <circle r="10" fill={PAPER} stroke={kind === "ship" ? SIEGEL : INK} strokeWidth="1.4" />
          <polygon points="-6.5,0.5 6.5,0.5 4.5,4 -4.5,4" fill={INK} />
          <rect x="-2.5" y="-2.5" width="5" height="3" fill={INK} />
          <path d="M0.5 -2.5 V-6" stroke={INK} strokeWidth="1.1" />
        </>
      )}
    </svg>
  );
}
