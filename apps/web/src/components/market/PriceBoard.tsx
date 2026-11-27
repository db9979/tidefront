// Kurstafel: je Ressource eine Karte mit Symbol, Kurs, Veränderung (Pfeil und Farbe), Richtwert und Sparkline.
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { changePct, refPct, series, signed, trend, DAY, TONE_TEXT, type MarketRes } from "./calc.ts";

const STROKE = { up: "#2f6b47", down: "#a8331f", flat: "#4f5b69" } as const;

export function PriceBoard({ resources, selected, onSelect, nowMs, halfLife }: {
  resources: MarketRes[];
  selected: string;
  onSelect: (id: string) => void;
  nowMs: number;
  halfLife: number;
}) {
  return (
    <section className="mb-3" aria-label="Kurstafel">
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <h2 className="font-display text-[11px] uppercase text-ink2">Kurstafel</h2>
        <span className="text-[11px] text-ink2">Veränderung in 24 h · Richtwert</span>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Ressource wählen">
        {resources.map((r) => {
          const pct = r.history.length ? changePct(r, nowMs, DAY, halfLife) : refPct(r);
          const t = trend(pct);
          const dev = refPct(r);
          const on = r.id === selected;
          const halted = r.haltedUntilMs > nowMs;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onSelect(r.id)}
              aria-label={`${label(r.id)}: ${fmtNum(r.price, 2)} Taler, ${t.word} ${signed(pct)} in 24 Stunden, Richtwert ${fmtNum(r.ref, 2)}${halted ? ", Handelspause" : ""}`}
              className={`tap text-left panel rounded-xl p-2.5 relative transition-shadow ${on ? "!border-ink shadow-[inset_0_0_0_1px_var(--color-ink),0_2px_0_var(--color-ink)]" : ""}`}
            >
              {on && <span className="absolute top-0 left-2.5 right-2.5 h-[3px] bg-siegel" aria-hidden="true" />}
              <div className="flex items-center gap-1.5">
                <Icon id={r.id} size={26} />
                <span className="font-display uppercase text-[11px] text-ink truncate flex-1">{label(r.id)}</span>
                {halted && <span className="font-display text-[11px] uppercase border border-siegel text-siegel px-1" title={`Pause noch ${fmtDuration(r.haltedUntilMs - nowMs)}`}>Pause</span>}
              </div>
              <div className="flex items-end justify-between gap-1 mt-1">
                <span className="mono text-[22px] leading-none text-ink whitespace-nowrap">{fmtNum(r.price, 2)}<span className="text-[12px] text-ink2"> T</span></span>
                <span className={`mono text-[12.5px] font-semibold ${TONE_TEXT[t.tone]}`} aria-hidden="true">{t.arrow}&#8239;{signed(pct)}</span>
              </div>
              <Spark r={r} nowMs={nowMs} halfLife={halfLife} tone={t.tone} />
              <div className="flex justify-between text-[11px] text-ink2 mt-0.5" aria-hidden="true">
                <span>Richtwert <span className="mono">{fmtNum(r.ref, 2)}</span></span>
                <span className="mono">{signed(dev)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Kleiner 24-h-Verlauf mit gestricheltem Richtwert (auch in der Zusammenfassung des Kursverlaufs). */
export function Spark({ r, nowMs, halfLife, tone }: { r: MarketRes; nowMs: number; halfLife: number; tone: "up" | "down" | "flat" }) {
  const pts = series(r, nowMs, DAY, halfLife, 40);
  // Bereich symmetrisch um den Richtwert, damit „über/unter Richtwert“ auf einen Blick lesbar ist.
  const dev = Math.max(...pts.map((p) => Math.abs(p.p - r.ref)), r.ref * 0.01) * 1.3;
  const y = (v: number) => 16 - ((v - r.ref) / dev) * 14;
  const x = (t: number) => ((t - (nowMs - DAY)) / DAY) * 120;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 120 32" className="w-full h-8 mt-1.5" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L120,16 L0,16 Z`} fill={STROKE[tone]} opacity="0.14" />
      <line x1="0" x2="120" y1="16" y2="16" stroke="#4f5b69" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={STROKE[tone]} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
