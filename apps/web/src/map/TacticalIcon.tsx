// SVG-Nachbildungen der Kartenzeichen (für Legende und Info-Blatt), im Stil der Seekarte.
const INK = "#18273a";
const PAPER = "#fbf8f0";
const SIEGEL = "#a8331f";
const SEE = "#2d5b7a";
const ROMAN = ["", "I", "II", "III", "IV", "V"];

export type TacticalKind = "own" | "other" | "nest" | "nestEmpty" | "wreck" | "port" | "ship" | "shipBack";

function Anchor({ color, k = 1 }: { color: string; k?: number }) {
  return (
    <g transform={`scale(${k})`} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <circle cx="0" cy="-5" r="1.8" strokeWidth={1.3} />
      <path d="M0 -3.2 V5.5 M-3.4 -1 H3.4 M-4.4 3 A5 5 0 0 0 4.4 3" />
    </g>
  );
}

export function TacticalIcon({ kind, level = 1, size = 28 }: { kind: TacticalKind; level?: number; size?: number }) {
  const roman = ROMAN[Math.max(1, Math.min(5, level))];
  return (
    <svg viewBox="-17 -17 34 34" width={size} height={size} aria-hidden="true" className="shrink-0">
      {kind === "own" && (<><circle r="14" fill={INK} /><circle r="11" fill="none" stroke={PAPER} strokeWidth="0.8" /><Anchor color={PAPER} k={1.15} /></>)}
      {kind === "other" && (<><circle r="12" fill={PAPER} stroke={SEE} strokeWidth="1.6" /><Anchor color={SEE} /></>)}
      {kind === "nest" && (
        <>
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
