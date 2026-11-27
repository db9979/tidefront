// Großes Kursdiagramm der gewählten Ressource: Verlauf (1 h / 24 h), Richtwert gestrichelt,
// erlaubter Kursbereich (Stunden- und Tagesband, Grenzen) schattiert, Handelspause schraffiert.
import { useId, useState } from "react";
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { allowedRange, changePct, clock, series, signed, trend, DAY, HOUR, TONE_TEXT, type MarketCfg, type MarketRes } from "./calc.ts";

const W = 360;
const H = 190;
const L = 6;
const R = 46;
const T = 10;
const B = 22;

export function PriceChart({ r, nowMs, cfg }: { r: MarketRes; nowMs: number; cfg: MarketCfg }) {
  const [span, setSpan] = useState<"1h" | "24h">("24h");
  const uid = useId();
  const spanMs = span === "1h" ? HOUR : DAY;
  const hl = cfg.reversionHalfLifeHours;
  const pts = series(r, nowMs, spanMs, hl, span === "1h" ? 60 : 144);
  const range = allowedRange(r, nowMs, cfg);
  const vals = pts.map((p) => p.p);
  const dataLo = Math.min(r.ref, ...vals);
  const dataHi = Math.max(r.ref, ...vals);
  const pad = Math.max((dataHi - dataLo) * 0.25, r.ref * 0.03);
  const lo = dataLo - pad;
  const hi = dataHi + pad;
  const from = nowMs - spanMs;
  const x = (t: number) => L + ((t - from) / spanMs) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const clampY = (v: number) => Math.max(T, Math.min(H - B, y(v)));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const pct = changePct(r, nowMs, spanMs, hl);
  const t = trend(pct);
  const color = t.tone === "up" ? "#2f6b47" : t.tone === "down" ? "#a8331f" : "#18273a";
  const trades = r.history.filter((h) => h.tMs > from && h.tMs <= nowMs);
  const haltEnd = r.haltedUntilMs;
  const haltStart = haltEnd - cfg.haltMinutes * 60_000;
  const halted = haltEnd > nowMs;
  const showHalt = haltEnd > from && haltStart < nowMs;

  // Achsen: Zeitmarken alle 15 min bzw. 6 h, Kursmarken in vier Stufen.
  const step = span === "1h" ? 15 * 60_000 : 6 * HOUR;
  const xt: number[] = [];
  for (let k = Math.ceil(from / step) * step; k <= nowMs; k += step) xt.push(k);
  const yt = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4);

  const bandTop = clampY(range.hi);
  const bandBot = clampY(range.lo);
  const desc = `${label(r.id)}, ${span === "1h" ? "letzte Stunde" : "letzte 24 Stunden"}: Kurs ${t.word} von ${fmtNum(vals[0], 2)} auf ${fmtNum(r.price, 2)} Kredite (${signed(pct)}), `
    + `Tief ${fmtNum(Math.min(...vals), 2)}, Hoch ${fmtNum(Math.max(...vals), 2)}, Richtwert ${fmtNum(r.ref, 2)}. `
    + `${trades.length} ${trades.length === 1 ? "Geschäft" : "Geschäfte"} im Zeitraum. Erlaubter Kurs nach dem nächsten Handel ${fmtNum(range.lo, 2)} bis ${fmtNum(range.hi, 2)}.`
    + (halted ? ` Handelspause bis ${clock(haltEnd)}.` : "");

  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-1">
        <div>
          <div className="mono text-[28px] leading-none">{fmtNum(r.price, 2)} <span className="text-sm text-ink2">Kr</span></div>
          <div className={`mono text-sm font-semibold ${TONE_TEXT[t.tone]}`}>{t.arrow} {signed(pct, 2)} <span className="font-sans font-normal text-ink2 text-xs">in {span === "1h" ? "1 h" : "24 h"}</span></div>
        </div>
        <div className="flex border border-ink rounded-lg overflow-hidden" role="radiogroup" aria-label="Zeitraum">
          {(["1h", "24h"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={span === s} onClick={() => setSpan(s)}
              className={`tap px-3 mono text-sm ${span === s ? "bg-ink text-paper" : "text-ink"}`}>
              {s === "1h" ? "1 h" : "24 h"}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#fffdf8] border border-rule" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
        <title id={`${uid}-t`}>Kursdiagramm {label(r.id)}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <defs>
          <pattern id={`${uid}-halt`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0 V5" stroke="#a8331f" strokeWidth="1.3" opacity="0.55" />
          </pattern>
          <clipPath id={`${uid}-above`}><rect x={L} y={T} width={W - L - R} height={Math.max(0, y(r.ref) - T)} /></clipPath>
          <clipPath id={`${uid}-below`}><rect x={L} y={y(r.ref)} width={W - L - R} height={Math.max(0, H - B - y(r.ref))} /></clipPath>
        </defs>
        {/* Raster */}
        {yt.map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#d5cab2" strokeWidth="0.6" />)}
        {xt.map((k) => <line key={k} x1={x(k)} x2={x(k)} y1={T} y2={H - B} stroke="#d5cab2" strokeWidth="0.6" strokeDasharray="2 3" />)}
        {/* Erlaubter Bereich für den nächsten Handel */}
        {bandBot > bandTop && <rect x={L} width={W - L - R} y={bandTop} height={bandBot - bandTop} fill="#2d5b7a" opacity="0.07" />}
        {range.hi < hi ? <BandEdge y={y(range.hi)} text={range.hi >= range.ceil ? "Obergrenze" : "Band oben"} />
          : <text x={W - R - 3} y={T + 9} fontSize="8.5" fill="#2d5b7a" textAnchor="end" fontFamily="IBM Plex Sans">▲ {range.hi >= range.ceil ? "Obergrenze" : "Band"} {fmtNum(range.hi, 2)}</text>}
        {range.lo > lo ? <BandEdge y={y(range.lo)} text={range.lo <= range.floor ? "Untergrenze" : "Band unten"} />
          : <text x={W - R - 3} y={H - B - 4} fontSize="8.5" fill="#2d5b7a" textAnchor="end" fontFamily="IBM Plex Sans">▼ {range.lo <= range.floor ? "Untergrenze" : "Band"} {fmtNum(range.lo, 2)}</text>}
        {/* Handelspause */}
        {showHalt && (
          <g>
            <rect x={x(Math.max(from, haltStart))} width={Math.max(2, x(Math.min(nowMs, haltEnd)) - x(Math.max(from, haltStart)))} y={T} height={H - T - B} fill={`url(#${uid}-halt)`} />
            <text x={x(Math.max(from, haltStart)) + 3} y={T + 10} fontSize="9" fill="#a8331f" fontFamily="IBM Plex Sans" fontWeight="600">PAUSE</text>
          </g>
        )}
        {/* Verlauf: Fläche über dem Richtwert moosgrün, darunter siegelrot */}
        <path d={`${d} L${x(nowMs)},${y(r.ref)} L${L},${y(r.ref)} Z`} fill="#2f6b47" opacity="0.16" clipPath={`url(#${uid}-above)`} />
        <path d={`${d} L${x(nowMs)},${y(r.ref)} L${L},${y(r.ref)} Z`} fill="#a8331f" opacity="0.16" clipPath={`url(#${uid}-below)`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {/* Richtwert über dem Verlauf, damit er sichtbar bleibt */}
        <line x1={L} x2={W - R} y1={y(r.ref)} y2={y(r.ref)} stroke="#18273a" strokeDasharray="5 4" strokeWidth="1" />
        <text x={L + 3} y={y(r.ref) + (r.price < r.ref ? -4 : 11)} fontSize="9" fill="#18273a" fontFamily="IBM Plex Sans" fontWeight="600">Richtwert {fmtNum(r.ref, 2)}</text>
        {trades.map((h) => <line key={h.tMs} x1={x(h.tMs)} x2={x(h.tMs)} y1={H - B} y2={H - B - 5} stroke="#18273a" strokeWidth="1" />)}
        <circle cx={x(nowMs)} cy={y(r.price)} r="3.5" fill={color} stroke="#fffdf8" strokeWidth="1.5" />
        {/* Kursachse rechts mit aktuellem Kurs */}
        {yt.filter((v) => Math.abs(y(v) - y(r.price)) > 12).map((v) => <text key={v} x={W - R + 4} y={y(v) + 3} fontSize="9" fill="#4f5b69" fontFamily="IBM Plex Mono">{fmtNum(v, hi - lo < 0.04 ? 3 : 2)}</text>)}
        <rect x={W - R + 1} y={y(r.price) - 8} width={R - 2} height="16" fill={color} />
        <text x={W - R + 4} y={y(r.price) + 3.5} fontSize="10" fill="#fffdf8" fontFamily="IBM Plex Mono" fontWeight="600">{fmtNum(r.price, 2)}</text>
        {/* Zeitachse */}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#18273a" strokeWidth="1" />
        {xt.map((k) => <text key={k} x={x(k)} y={H - 8} fontSize="9" fill="#4f5b69" textAnchor="middle" fontFamily="IBM Plex Mono">{clock(k)}</text>)}
      </svg>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink2 mt-1.5" aria-hidden="true">
        <li className="flex items-center gap-1"><i className="inline-block w-4 border-t border-dashed border-ink2" /> Richtwert</li>
        <li className="flex items-center gap-1"><i className="inline-block w-3 h-3 bg-see/15 border border-see/40" /> erlaubt <span className="mono">{fmtNum(range.lo, 2)}–{fmtNum(range.hi, 2)}</span></li>
        <li className="flex items-center gap-1"><i className="inline-block w-px h-2.5 bg-ink" /> Handel</li>
        {showHalt && <li className="flex items-center gap-1 text-siegel"><i className="inline-block w-3 h-3 hatch border border-siegel" /> Pause{halted ? ` noch ${fmtDuration(haltEnd - nowMs)}` : ""}</li>}
      </ul>
      <p className="text-[11px] text-ink2 mt-1">
        Kursband: höchstens ±{fmtNum(cfg.hourBand * 100)} % in 1 h und ±{fmtNum(cfg.dayBand * 100)} % in 24 h, sonst {fmtNum(cfg.haltMinutes)} min Pause.
        Grenzen <span className="mono">{fmtNum(range.floor, 2)}–{fmtNum(range.ceil, 2)}</span>.
      </p>
    </div>
  );
}

function BandEdge({ y, text }: { y: number; text: string }) {
  return (
    <g>
      <line x1={L} x2={W - R} y1={y} y2={y} stroke="#2d5b7a" strokeWidth="0.8" strokeDasharray="1 2" />
      <text x={W - R - 3} y={y - 3} fontSize="8.5" fill="#2d5b7a" textAnchor="end" fontFamily="IBM Plex Sans">{text}</text>
    </g>
  );
}
