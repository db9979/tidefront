// Verteilung der Probekampf-Ergebnisse (Simulator-Chunk): eigene Restkampfkraft in 10-%-Klassen,
// Siege in Moos, Niederlagen in Siegelrot, im Stil der Seekarte (Tintenachse, feine Raster).
import { useId } from "react";
import type { SimStats } from "../lib/sim.ts";

const BINS = 10;
const W = 300;
const H = 110;
const PAD = { l: 22, r: 6, t: 8, b: 22 };

export function SimHistogram({ stats }: { stats: SimStats }) {
  const hatch = `sim-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const wins = new Array<number>(BINS).fill(0);
  const losses = new Array<number>(BINS).fill(0);
  for (const r of stats.runsDetail) {
    const i = Math.min(BINS - 1, Math.max(0, Math.floor(r.remaining * BINS)));
    if (r.won) wins[i]++;
    else losses[i]++;
  }
  const max = Math.max(1, ...wins.map((w, i) => w + losses[i]));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / BINS;
  const y = (n: number) => PAD.t + ih - (n / max) * ih;
  const avg = stats.runsDetail.reduce((s, r) => s + r.remaining, 0) / Math.max(1, stats.runsDetail.length);
  return (
    <figure className="m-0">
      <figcaption className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">Verteilung über {stats.runs} Durchläufe · eigene Restkampfkraft</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Histogramm: Ø ${Math.round(avg * 100)} % Restkampfkraft`}>
        <defs>
          <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-siegel)" strokeWidth="1.2" />
          </pattern>
        </defs>
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-rule)" strokeDasharray="2 3" />
            <text x={PAD.l - 3} y={y(max * f) + 3} textAnchor="end" fontSize="8" fill="var(--color-ink2)">{Math.round(max * f)}</text>
          </g>
        ))}
        {wins.map((w, i) => {
          const x = PAD.l + i * bw + 1.5;
          const l = losses[i];
          return (
            <g key={i}>
              {l > 0 && <rect x={x} y={y(l)} width={bw - 3} height={PAD.t + ih - y(l)} fill={`url(#${hatch})`} stroke="var(--color-siegel)" strokeWidth="0.8" />}
              {w > 0 && <rect x={x} y={y(l + w)} width={bw - 3} height={y(l) - y(l + w)} fill="var(--color-moos)" fillOpacity="0.8" stroke="var(--color-ink)" strokeWidth="0.6" />}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--color-ink)" strokeWidth="1.2" />
        <line x1={PAD.l + avg * iw} x2={PAD.l + avg * iw} y1={PAD.t} y2={PAD.t + ih} stroke="var(--color-ink)" strokeDasharray="3 2" />
        {[0, 50, 100].map((t) => (
          <text key={t} x={PAD.l + (t / 100) * iw} y={H - 8} textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"} fontSize="8.5" fill="var(--color-ink2)">{t} %</text>
        ))}
      </svg>
      <div className="flex gap-3 text-[11px] text-ink2 mt-0.5">
        <span className="flex items-center gap-1"><i className="inline-block w-3 h-2.5 bg-moos/80 border border-ink" /> Sieg</span>
        <span className="flex items-center gap-1"><svg width="12" height="10" aria-hidden="true"><rect width="12" height="10" fill={`url(#${hatch})`} stroke="var(--color-siegel)" /></svg> Niederlage</span>
        <span>gestrichelt: Ø {Math.round(avg * 100)} %</span>
      </div>
    </figure>
  );
}
