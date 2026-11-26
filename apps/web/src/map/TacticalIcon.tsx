// SVG-Nachbildungen der Taktikzeichen der Karte (für Legende und Info-Blatt).
const INK = "#0a1420";
const ROMAN = ["", "I", "II", "III", "IV", "V"];

export type TacticalKind = "own" | "other" | "nest" | "nestEmpty" | "wreck" | "port" | "ship" | "shipBack";

function Installation({ fill }: { fill: string }) {
  return (
    <>
      <rect x="-13" y="-9" width="26" height="18" fill={fill} stroke={INK} strokeWidth="1.6" />
      <rect x="-5" y="-12.5" width="10" height="3.5" fill={INK} />
      <circle cx="0" cy="-4.2" r="1.6" fill="none" stroke={INK} strokeWidth="1.2" />
      <path d="M0 -2.6 V5 M-3 -0.8 H3 M-4.1 3.2 A4.6 4.6 0 0 0 4.1 3.2" fill="none" stroke={INK} strokeWidth="1.4" />
    </>
  );
}

export function TacticalIcon({ kind, level = 1, size = 28 }: { kind: TacticalKind; level?: number; size?: number }) {
  return (
    <svg viewBox="-17 -17 34 34" width={size} height={size} aria-hidden="true" className="shrink-0">
      {kind === "own" && <Installation fill="#80c0ff" />}
      {kind === "other" && <Installation fill="#aaffaa" />}
      {(kind === "nest" || kind === "nestEmpty") && (
        <>
          {kind === "nest" ? (
            <>
              <polygon points="0,-11 11,0 0,11 -11,0" fill="#ff8080" stroke={INK} strokeWidth="1.6" transform="translate(0 3)" />
              <path d="M-4.5 -1.5 L4.5 7.5 M4.5 -1.5 L-4.5 7.5" stroke={INK} strokeWidth="1.4" />
            </>
          ) : (
            <polygon points="0,-11 11,0 0,11 -11,0" fill="none" stroke="#9aa4ad" strokeWidth="1.6" strokeDasharray="3 3" transform="translate(0 3)" />
          )}
          <text x="0" y="-9.5" textAnchor="middle" fontSize="8" fontFamily="ui-monospace, Menlo, monospace" fontWeight="700" fill={kind === "nest" ? "#ffd0d0" : "#9aa4ad"}>{ROMAN[Math.max(1, Math.min(5, level))]}</text>
        </>
      )}
      {kind === "wreck" && (
        <>
          <circle r="7" fill="none" stroke="#b8c2ca" strokeWidth="1.4" strokeDasharray="2.6 2.9" />
          <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="#b8c2ca" strokeWidth="1.4" />
        </>
      )}
      {kind === "port" && (
        <>
          <circle r="7" fill={INK} fillOpacity="0.7" stroke="#9fd3e6" strokeWidth="1" />
          <path d="M0 -3.5 V4 M-2.5 -1.5 H2.5 M-3.4 1.6 A3.6 3.6 0 0 0 3.4 1.6" fill="none" stroke="#d8ecf2" strokeWidth="1.1" />
        </>
      )}
      {(kind === "ship" || kind === "shipBack") && (
        <>
          <circle r="8" fill={kind === "ship" ? "#80c0ff" : "#cfe6ff"} stroke={INK} strokeWidth="1.4" />
          <polygon points="-5,-1 5,-1 3,3 -3,3" fill={INK} />
          <path d="M0 -1 V-5" stroke={INK} strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}
