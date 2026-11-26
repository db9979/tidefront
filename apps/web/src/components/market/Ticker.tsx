// Tickerband: laufende Kurszeile aller Ressourcen. Bei prefers-reduced-motion steht es still (styles.css).
import { fmtNum, label } from "../../lib/names.ts";
import { Icon } from "../../icons.tsx";
import { changePct, refPct, signed, trend, DAY, type MarketRes } from "./calc.ts";

export function Ticker({ resources, nowMs, halfLife }: { resources: MarketRes[]; nowMs: number; halfLife: number }) {
  const items = resources.map((r) => {
    const hasDay = r.history.length > 0;
    const pct = hasDay ? changePct(r, nowMs, DAY, halfLife) : refPct(r);
    return { r, pct, basis: hasDay ? "24 h" : "Richtwert", halted: r.haltedUntilMs > nowMs };
  });
  const summary = items.map((i) => `${label(i.r.id)} ${fmtNum(i.r.price, 3)} Kredite, ${trend(i.pct).word} ${signed(i.pct)} gegen ${i.basis}${i.halted ? ", Handelspause" : ""}`).join("; ");
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0" aria-hidden={hidden || undefined}>
      {items.map(({ r, pct, basis, halted }) => {
        const t = trend(pct);
        return (
          <li key={r.id} className="flex items-center gap-1.5 px-3 h-9 border-r border-white/15 whitespace-nowrap text-[13px]">
            <Icon id={r.id} size={18} className="rounded-full bg-paper p-px" />
            <span className="font-display uppercase text-[11px] text-paper/85">{label(r.id)}</span>
            <span className="mono">{fmtNum(r.price, 3)}</span>
            <span className={`mono ${t.tone === "up" ? "ticker-up" : t.tone === "down" ? "ticker-down" : "text-paper/80"}`}>{t.arrow} {signed(pct)}</span>
            <span className="text-[10px] text-paper/70">{basis}</span>
            {halted && <span className="font-display text-[10px] uppercase border border-[#f3a99a] text-[#f3a99a] px-1">Pause</span>}
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className="ticker rounded-xl mb-3 overflow-hidden ticker-scroll border border-ink" aria-label="Kurszeile">
      <p className="sr-only">{summary}</p>
      <div className="ticker-track" aria-hidden="true">
        {row(true)}
        {row(true)}
      </div>
    </section>
  );
}
