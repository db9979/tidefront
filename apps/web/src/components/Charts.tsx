// Einfache Diagramme im Stil „Seekarte“ (reines SVG, keine Pakete): Tintenlinien auf Papier, Schraffur,
// punktierte Hilfslinien, Zahlen in Monospace. Alles ohne Hover lesbar; Werte stehen zusätzlich als Text daneben.
import type { ReactNode } from "react";
import { INK, MESSING, MOOS, PAPER, SEE, SIEGEL } from "../icons-art.tsx";
import { fmtNum } from "../lib/names.ts";

const RULE = "#d5cab2";
const INK2 = "#4f5b69";
export const TONES = { ink: INK, see: SEE, siegel: SIEGEL, moos: MOOS, messing: MESSING } as const;
export type Tone = keyof typeof TONES;

const shortDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Runde Achsenobergrenze (1, 2, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function compact(n: number): string {
  if (Math.abs(n) >= 1e6) return `${fmtNum(n / 1e6, 1)} Mio.`;
  if (Math.abs(n) >= 1e4) return `${fmtNum(n / 1e3, 0)} Tsd.`;
  return fmtNum(n, n % 1 ? 1 : 0);
}

export interface Series { key: string; label: string; tone: Tone; hatch?: boolean }

/** Säulen je Tag, eine oder mehrere Reihen übereinander gestapelt. */
export function DayBars({ days, series, values, height = 110, label }: {
  days: string[];
  series: Series[];
  /** values[i][key] für Tag i. */
  values: Record<string, number>[];
  height?: number;
  label: string;
}) {
  const W = 320;
  const H = height;
  const totals = values.map((v) => series.reduce((a, s) => a + (v[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  // Platz für die längste Achsenbeschriftung (z. B. „100 Tsd.“), damit die Zahl nicht abgeschnitten wird.
  const left = Math.max(30, 8 + Math.max(compact(max).length, compact(max / 2).length) * 5.3);
  const top = 8;
  const bottom = 18;
  const plotH = H - top - bottom;
  const plotW = W - left - 4;
  const step = plotW / Math.max(1, days.length);
  const bw = Math.max(2, step * 0.62);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const sum = totals.reduce((a, b) => a + b, 0);
  const ticks = days.length <= 7 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${label}: insgesamt ${fmtNum(sum)}`}>
        {[max, max / 2].map((v) => (
          <g key={v}>
            <line x1={left} x2={W - 2} y1={y(v)} y2={y(v)} stroke={RULE} strokeDasharray="1 3" />
            <text x={left - 4} y={y(v) + 3} textAnchor="end" fontSize="8.5" fill={INK2} className="mono">{compact(v)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          let acc = 0;
          return (
            <g key={days[i]}>
              <title>{`${shortDay(days[i])}: ${series.map((s) => `${s.label} ${fmtNum(v[s.key] ?? 0)}`).join(", ")}`}</title>
              {series.map((s) => {
                const val = v[s.key] ?? 0;
                if (val <= 0) return null;
                const y0 = y(acc);
                acc += val;
                const y1 = y(acc);
                return (
                  <rect key={s.key} x={left + i * step + (step - bw) / 2} y={y1} width={bw} height={Math.max(0.8, y0 - y1)}
                    fill={s.hatch ? "url(#tf-h)" : TONES[s.tone]} stroke={TONES[s.tone]} strokeWidth={s.hatch ? 0.9 : 0} />
                );
              })}
            </g>
          );
        })}
        <line x1={left} x2={W - 2} y1={top + plotH} y2={top + plotH} stroke={INK} strokeWidth="1.2" />
        {ticks.map((i) => (
          <text key={i} x={left + i * step + step / 2} y={H - 5} textAnchor="middle" fontSize="8.5" fill={INK2} className="mono">{shortDay(days[i])}</text>
        ))}
      </svg>
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, tone: s.tone, hatch: s.hatch }))} />}
    </figure>
  );
}

export function Legend({ items }: { items: { label: string; tone: Tone; hatch?: boolean }[] }) {
  return (
    <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink2 mt-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <svg width="12" height="10" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="9" fill={it.hatch ? "url(#tf-h)" : TONES[it.tone]} stroke={TONES[it.tone]} /></svg>
          {it.label}
        </span>
      ))}
    </figcaption>
  );
}

/** Waagerechte Balken mit Beschriftung und Wert (z. B. Produktion je Ressource). */
export function HBars({ rows, tone = "see", unit = "" }: { rows: { label: ReactNode; value: number; key: string; note?: string }[]; tone?: Tone; unit?: string }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)));
  if (rows.length === 0) return <p className="text-sm text-ink2 italic font-serif">Keine Daten im Zeitraum.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate text-ink2">{r.label}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full h-2.5" aria-hidden="true">
            <rect x="0" y="0" width="100" height="8" fill={PAPER} stroke={RULE} strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            <rect x="0" y="0" width={max > 0 ? (Math.abs(r.value) / max) * 100 : 0} height="8" fill={r.value < 0 ? SIEGEL : TONES[tone]} />
          </svg>
          <span className="mono text-right whitespace-nowrap">{fmtNum(r.value, Math.abs(r.value) < 100 && r.value % 1 ? 1 : 0)}{unit}{r.note ? <span className="text-ink2 text-xs"> {r.note}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Quote als geteilter Balken (z. B. Siege des Angreifers gegen Siege des Verteidigers). */
export function RateBar({ label, wins, total, winLabel, lossLabel, tone = "siegel" }: {
  label: string; wins: number; total: number; winLabel: string; lossLabel: string; tone?: Tone;
}) {
  const share = total > 0 ? wins / total : 0;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-sm mb-0.5">
        <span>{label}</span>
        <span className="mono">{total > 0 ? `${fmtNum(share * 100)} %` : "–"} <span className="text-ink2 text-xs">({wins} von {total})</span></span>
      </div>
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="w-full h-3" role="img" aria-label={`${label}: ${winLabel} ${wins} von ${total}`}>
        <rect x="0" y="0" width="100" height="8" fill={total > 0 ? "url(#tf-h)" : PAPER} stroke={INK} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <rect x="0" y="0" width={share * 100} height="8" fill={TONES[tone]} />
        <line x1="50" x2="50" y1="0" y2="8" stroke={PAPER} strokeWidth="0.6" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-ink2"><span>{winLabel}</span><span>{lossLabel}</span></div>
    </div>
  );
}

/** Verteilung der Gebäudestufen: Zeile je Gebäude, Spalte je Stufe, Tintendichte nach Anzahl Stützpunkte. */
export function LevelGrid({ rows }: { rows: { id: string; label: string; levels: number[]; avg: number }[] }) {
  const maxLevel = Math.max(0, ...rows.map((r) => r.levels.length - 1));
  const maxCount = Math.max(1, ...rows.flatMap((r) => r.levels));
  const cols = maxLevel + 1;
  const cell = 15;
  const labelW = 104;
  const W = labelW + cols * cell + 34;
  const H = 14 + rows.length * cell;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Verteilung der Gebäudestufen" className="max-w-none">
        {Array.from({ length: cols }, (_, l) => (
          <text key={l} x={labelW + l * cell + cell / 2} y={9} textAnchor="middle" fontSize="8" fill={INK2} className="mono">{l}</text>
        ))}
        <text x={W - 2} y={9} textAnchor="end" fontSize="8" fill={INK2}>Ø</text>
        {rows.map((r, i) => {
          const y0 = 12 + i * cell;
          return (
            <g key={r.id}>
              <text x={0} y={y0 + cell * 0.7} fontSize="9.5" fill={INK}>{r.label}</text>
              {Array.from({ length: cols }, (_, l) => {
                const n = r.levels[l] ?? 0;
                return (
                  <g key={l}>
                    <rect x={labelW + l * cell + 0.5} y={y0 + 0.5} width={cell - 1} height={cell - 1} fill={PAPER} stroke={RULE} strokeWidth="0.6" />
                    {n > 0 && <rect x={labelW + l * cell + 0.5} y={y0 + 0.5} width={cell - 1} height={cell - 1} fill={SEE} opacity={0.18 + 0.82 * (n / maxCount)} />}
                    {n > 0 && <text x={labelW + l * cell + cell / 2} y={y0 + cell * 0.7} textAnchor="middle" fontSize="8" fill={n / maxCount > 0.5 ? PAPER : INK} className="mono">{n}</text>}
                    <title>{`${r.label}, Stufe ${l}: ${n} Häfen`}</title>
                  </g>
                );
              })}
              <text x={W - 2} y={y0 + cell * 0.7} textAnchor="end" fontSize="9" fill={INK} className="mono">{fmtNum(r.avg, 1)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
