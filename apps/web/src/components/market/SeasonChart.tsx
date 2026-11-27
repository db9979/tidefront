// Langer Kursverlauf (7 Tage / ganze Saison) aus den Stundenschlusskursen (market.chart): Kurs, effektiver Richtwert
// (mit Marktnachrichten, gepunktet) und Grundrichtwert (gestrichelt). Der letzte Punkt ist der aktuelle Kurs.
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../../lib/trpc.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { signed, trend, DAY, HOUR, TONE_TEXT, type MarketRes } from "./calc.ts";

const W = 360;
const H = 190;
const L = 6;
const R = 46;
const T = 10;
const B = 22;

export type LongSpan = "7d" | "season";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
}

export function SeasonChart({ r, nowMs, span }: { r: MarketRes; nowMs: number; span: LongSpan }) {
  const uid = useId();
  const q = useQuery({ ...trpc.market.chart.queryOptions({ resource: r.id }), refetchInterval: 10 * 60_000 });
  const name = span === "7d" ? "letzte 7 Tage" : "ganze Saison";
  if (!q.data) return <div className="h-[190px] border border-rule bg-[#fffdf8] grid place-items-center text-sm text-ink2" role="status">Kursverlauf wird geladen …</div>;

  const baseRef = r.baseRef ?? q.data.baseRef;
  const since = span === "7d" ? nowMs - 7 * DAY : -Infinity;
  const pts = [...q.data.points.filter((p) => p.t > since && p.t < nowMs), { t: nowMs, p: r.price, ref: r.ref }];
  if (pts.length < 3) {
    return (
      <p className="rounded-lg border border-dashed border-ink/50 bg-inset p-3 text-sm text-ink2" role="status">
        Noch zu wenig Verlauf für {name}: Der Saisonchart sammelt zu jeder vollen Stunde einen Schlusskurs.
      </p>
    );
  }

  const from = pts[0].t;
  const spanMs = Math.max(HOUR, nowMs - from);
  const vals = pts.flatMap((p) => [p.p, p.ref]).concat(baseRef);
  const dataLo = Math.min(...vals);
  const dataHi = Math.max(...vals);
  const pad = Math.max((dataHi - dataLo) * 0.15, baseRef * 0.03);
  const lo = dataLo - pad;
  const hi = dataHi + pad;
  const x = (t: number) => L + ((t - from) / spanMs) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = (get: (p: (typeof pts)[number]) => number) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");
  // Effektiver Richtwert als Treppe (er gilt bis zur nächsten Stunde).
  const refStep = pts.map((p, i) => (i ? `H${x(p.t).toFixed(1)}V${y(p.ref).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.ref).toFixed(1)}`)).join(" ");
  const pct = pts[0].p > 0 ? (r.price / pts[0].p - 1) * 100 : 0;
  const t = trend(pct);
  const color = t.tone === "up" ? "#2f6b47" : t.tone === "down" ? "#a8331f" : "#18273a";
  const prices = pts.map((p) => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const refMoved = pts.some((p) => Math.abs(p.ref - baseRef) > baseRef * 0.001);

  // Zeitmarken: je Tag (7 Tage) bzw. je Woche (Saison), an Mitternacht Ortszeit.
  const stepDays = span === "7d" || spanMs <= 8 * DAY ? 1 : spanMs <= 21 * DAY ? 3 : 7;
  const xt: number[] = [];
  const d0 = new Date(from);
  d0.setHours(0, 0, 0, 0);
  for (let d = new Date(d0); d.getTime() <= nowMs; d.setDate(d.getDate() + stepDays)) if (d.getTime() >= from) xt.push(d.getTime());
  const yt = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4);
  const desc = `${label(r.id)}, ${name}: Kurs ${t.word} von ${fmtNum(pts[0].p, 2)} auf ${fmtNum(r.price, 2)} Kredite (${signed(pct)}), `
    + `Tief ${fmtNum(min, 2)}, Hoch ${fmtNum(max, 2)}, Richtwert jetzt ${fmtNum(r.ref, 2)}, Grundrichtwert ${fmtNum(baseRef, 2)}. `
    + `${pts.length - 1} Stundenschlusskurse.`;

  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-1">
        <div>
          <div className="mono text-[28px] leading-none">{fmtNum(r.price, 2)} <span className="text-sm text-ink2">Kr</span></div>
          <div className={`mono text-sm font-semibold ${TONE_TEXT[t.tone]}`}>{t.arrow} {signed(pct, 2)} <span className="font-sans font-normal text-ink2 text-xs">seit {day(from)}</span></div>
        </div>
        <div className="text-right text-[11px] text-ink2 leading-tight">
          <div>Hoch <span className="mono text-ink">{fmtNum(max, 2)}</span></div>
          <div>Tief <span className="mono text-ink">{fmtNum(min, 2)}</span></div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#fffdf8] border border-rule" role="img" aria-labelledby={`${uid}-t ${uid}-d`} data-testid="saisonchart">
        <title id={`${uid}-t`}>Saisonchart {label(r.id)}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        {yt.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#d5cab2" strokeWidth="0.6" />)}
        {xt.map((k) => <line key={k} x1={x(k)} x2={x(k)} y1={T} y2={H - B} stroke="#d5cab2" strokeWidth="0.6" strokeDasharray="2 3" />)}
        {/* Grundrichtwert (balance.json) und effektiver Richtwert (Marktnachrichten) */}
        <line x1={L} x2={W - R} y1={y(baseRef)} y2={y(baseRef)} stroke="#18273a" strokeDasharray="5 4" strokeWidth="1" />
        {refMoved && <path d={refStep} fill="none" stroke="#7e5a1e" strokeWidth="1.4" strokeDasharray="1.5 2.5" strokeLinecap="round" />}
        <path d={`${line((p) => p.p)} L${x(nowMs)},${H - B} L${x(from)},${H - B} Z`} fill={color} opacity="0.08" />
        <path d={line((p) => p.p)} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={x(nowMs)} cy={y(r.price)} r="3.5" fill={color} stroke="#fffdf8" strokeWidth="1.5" />
        {yt.filter((v) => Math.abs(y(v) - y(r.price)) > 12).map((v) => <text key={v} x={W - R + 4} y={y(v) + 3} fontSize="9" fill="#4f5b69" fontFamily="IBM Plex Mono">{fmtNum(v, hi - lo < 0.04 ? 3 : 2)}</text>)}
        <rect x={W - R + 1} y={y(r.price) - 8} width={R - 2} height="16" fill={color} />
        <text x={W - R + 4} y={y(r.price) + 3.5} fontSize="10" fill="#fffdf8" fontFamily="IBM Plex Mono" fontWeight="600">{fmtNum(r.price, 2)}</text>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#18273a" strokeWidth="1" />
        {xt.map((k) => <text key={k} x={x(k)} y={H - 8} fontSize="9" fill="#4f5b69" textAnchor="middle" fontFamily="IBM Plex Mono">{day(k)}</text>)}
      </svg>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink2 mt-1.5" aria-hidden="true">
        <li className="flex items-center gap-1"><i className="inline-block w-4 border-t-2" style={{ borderColor: color }} /> Kurs (Stundenschluss)</li>
        <li className="flex items-center gap-1"><i className="inline-block w-4 border-t border-dashed border-ink2" /> Grundrichtwert <span className="mono">{fmtNum(baseRef, 2)}</span></li>
        <li className="flex items-center gap-1"><i className="inline-block w-4 border-t-2 border-dotted border-messing" /> Richtwert mit Nachrichten <span className="mono">{fmtNum(r.ref, 2)}</span></li>
      </ul>
    </div>
  );
}
