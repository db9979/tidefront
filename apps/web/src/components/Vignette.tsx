// Kleine Kupferstich-Vignette des eigenen Hafens (Leuchtturm, Mole, Speicher) für den Basis-Kopf.
import { INK, PAPER, SIEGEL } from "../icons-art.tsx";

export function HarborVignette({ size = 96 }: { size?: number }) {
  return (
    <div className="shrink-0 border border-ink p-[3px] bg-card" aria-hidden="true">
      <svg viewBox="0 0 96 72" width={size} height={(size * 72) / 96} className="block">
        <defs>
          <pattern id="vg-sky" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={PAPER} /><path d="M0 2 H4" stroke={INK} strokeWidth="0.35" opacity="0.6" /></pattern>
        </defs>
        <rect width="96" height="72" fill="url(#vg-sky)" />
        <path d="M0 52 C20 49 40 54 60 51 C75 49 86 52 96 50 V72 H0 Z" fill={PAPER} stroke={INK} strokeWidth="0.8" />
        <path d="M8 58 H28 M40 62 H66 M70 57 H88" stroke={INK} strokeWidth="0.6" />
        <path d="M58 51 L60 22 H66 L68 51 Z" fill={PAPER} stroke={INK} />
        <path d="M59.3 32 H66.7 M58.8 40 H67.2" stroke={SIEGEL} strokeWidth="2.4" />
        <path d="M57 22 H69 L67 17 H59 Z" fill={INK} />
        <path d="M63 17 V13" stroke={INK} />
        <path d="M69 19 L92 13 M69 20 L92 26" stroke={INK} strokeWidth="0.5" strokeDasharray="2 2" />
        <path d="M12 51 L14 40 H44 L46 51" fill={PAPER} stroke={INK} />
        <path d="M20 40 V32 H30 V40" fill={PAPER} stroke={INK} />
        <path d="M25 32 V24" stroke={INK} />
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
