// Kleine Kupferstich-Vignette des eigenen Hafens (Leuchtturm, Mole, Speicher) für den Basis-Kopf.
// Der Hafen wächst mit dem Gesamtausbau (Summe aller Gebäudestufen): Häuser, Kran, Schiffe, Schornstein, Licht, Flagge.
// Nachts (Tageslicht am Hafen < 0,2) blinkt das Leuchtfeuer (CSS „tf-blink“, siehe building-art/motion.tsx).
import { INK, PAPER, SIEGEL } from "../icons-art.tsx";

const LIGHT = "#e8b64c";
const ln = { fill: "none", stroke: INK, strokeWidth: 0.8, strokeLinejoin: "round" } as const;
const pp = { fill: PAPER, stroke: INK, strokeWidth: 0.8, strokeLinejoin: "round" } as const;

export function HarborVignette({ size = 96, levels = 0, daylight }: { size?: number; levels?: number; daylight?: number }) {
  const at = (n: number) => levels >= n;
  const night = daylight !== undefined && daylight < 0.2;
  return (
    <div className="shrink-0 border border-ink p-[3px] bg-card" aria-hidden="true">
      <svg viewBox="0 0 96 72" width={size} height={(size * 72) / 96} className="block">
        <defs>
          <pattern id="vg-sky" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={PAPER} /><path d="M0 2 H4" stroke={INK} strokeWidth="0.35" opacity="0.6" /></pattern>
        </defs>
        <rect width="96" height="72" fill="url(#vg-sky)" />
        {/* Immer etwas Leben: tagsüber zieht eine Möwe, nachts funkeln Sterne. */}
        {night ? (
          <g fill={INK}>
            <circle cx={14} cy={10} r={0.7} className="tf-mv tf-star" />
            <circle cx={34} cy={6} r={0.6} className="tf-mv tf-star" style={{ animationDelay: "-1.3s" }} />
            <circle cx={47} cy={14} r={0.55} className="tf-mv tf-star" style={{ animationDelay: "-2.4s" }} />
          </g>
        ) : (
          <g className="tf-mv tf-gull"><path d="M0 12 q1.6 -1.6 3.2 0 q1.6 -1.6 3.2 0" fill="none" stroke={INK} strokeWidth={0.7} strokeLinecap="round" /></g>
        )}
        <path d="M0 52 C20 49 40 54 60 51 C75 49 86 52 96 50 V72 H0 Z" fill={PAPER} stroke={INK} strokeWidth="0.8" />
        {/* Wellenstriche ziehen langsam */}
        <g className="tf-mv tf-wave"><path d="M8 58 H28 M40 62 H66 M70 57 H88" stroke={INK} strokeWidth="0.6" /></g>
        {at(120) && <><path d="M4 51 L5 28 H9 L10 51 Z" {...pp} /><g className="tf-mv tf-puff"><path d="M7 26 c-1 -3 2 -4 1 -7 c-1 -2 2 -3 4 -4" {...ln} strokeWidth={0.6} strokeDasharray="1.2 1.6" /></g></>}
        {at(15) && <path d="M2 51 V44 L7 40 L12 44 V51 Z" {...pp} />}
        {at(40) && <path d="M40 51 V22 M36 22 H54 M40 18 L54 22 M40 18 L36 22 M52 22 V30" {...ln} />}
        <path d="M58 51 L60 22 H66 L68 51 Z" fill={PAPER} stroke={INK} />
        <path d="M59.3 32 H66.7 M58.8 40 H67.2" stroke={SIEGEL} strokeWidth="2.4" />
        <path d="M57 22 H69 L67 17 H59 Z" fill={INK} />
        <path d="M63 17 V13" stroke={INK} />
        {night && (
          <g className="tf-mv tf-blink" style={{ animationDuration: "3.2s" }} data-testid="leuchtfeuer">
            <path d="M68 19.5 L94 12 V27 Z" fill={LIGHT} opacity={0.35} />
            <circle cx={63} cy={19.6} r={2.3} fill={LIGHT} stroke={INK} strokeWidth={0.4} />
          </g>
        )}
        <g className={night ? undefined : "tf-mv tf-beam"}><path d="M69 19 L92 13 M69 20 L92 26" stroke={INK} strokeWidth="0.5" strokeDasharray="2 2" /></g>
        <path d="M12 51 L14 40 H44 L46 51" fill={PAPER} stroke={INK} />
        <path d="M20 40 V32 H30 V40" fill={PAPER} stroke={INK} />
        <path d="M25 32 V24" stroke={INK} />
        {at(180) && <path d="M18 44 h2.4 v2.4 h-2.4 Z M28 44 h2.4 v2.4 h-2.4 Z M38 44 h2.4 v2.4 h-2.4 Z M23.5 35 h3 v2.4 h-3 Z" fill={LIGHT} stroke={INK} strokeWidth="0.4" />}
        {at(240) && <g className="tf-mv tf-vflag"><path d="M25 24 L31 25.5 L25 27 Z" fill={SIEGEL} stroke={INK} strokeWidth="0.4" /></g>}
        {at(80) && <g className="tf-mv tf-float"><path d="M70 60 H92 L89 65 H73 Z" fill="url(#tf-h)" stroke={INK} strokeWidth="0.8" /><path d="M78 60 V56 H85 V60 M81 56 V50" {...ln} /></g>}
        {at(180) && <g className="tf-mv tf-float" style={{ animationDelay: "-1.7s" }}><path d="M18 66 H32 L30 69 H20 Z M23 66 V61" {...ln} fill={PAPER} /></g>}
      </svg>
    </div>
  );
}

/** Grad und Minuten, z. B. 48° 23′ N. */
export function fmtDeg(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.round((a - d) * 60);
  return `${d}° ${String(m).padStart(2, "0")}′ ${v >= 0 ? pos : neg}`;
}
