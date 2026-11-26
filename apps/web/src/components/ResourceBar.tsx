import type { BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { RES_ORDER, liveAmount } from "../lib/live.res.ts";
import { Icon } from "../icons.tsx";

function short(n: number): string {
  if (n >= 100000) return `${fmtNum(n / 1000)}k`;
  if (n >= 10000) return `${fmtNum(n / 1000, 1)}k`;
  return fmtNum(n);
}

/** Kopfleiste: vier Ressourcen mit Füllstand, Rate und Hilfe-Knopf. */
export function ResourceBar({ base, asOf, now, onHelp }: { base: BaseData; asOf: number; now: number; onHelp: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-navy-950/90 backdrop-blur border-b border-white/10" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-stretch gap-1 px-2 py-1.5">
        {RES_ORDER.map((r) => {
          const v = liveAmount(base, asOf, now, r);
          const rate = base.rates[r] ?? 0;
          const fill = Math.min(1, v / base.capacity);
          const full = fill >= 0.999;
          return (
            <div key={r} className="flex-1 min-w-0 rounded-lg bg-navy-800/80 border border-white/5 px-1.5 py-1" aria-label={`${label(r)} ${fmtNum(v)}`}>
              <div className="flex items-center gap-1">
                <Icon id={r} size={18} />
                <span className={`text-sm font-bold tabular-nums truncate ${full ? "text-brass-400" : ""}`}>{short(v)}</span>
              </div>
              <div className="h-1 rounded-full bg-navy-950 mt-0.5 overflow-hidden">
                <div className={`h-full ${full ? "bg-brass-400" : r === "proviant" && rate < 0 ? "bg-red-500" : "bg-sea-400"}`} style={{ width: `${fill * 100}%` }} />
              </div>
              <div className={`text-[10px] leading-tight tabular-nums ${rate < 0 ? "text-red-300" : "text-emerald-300"}`}>
                {rate >= 0 ? "+" : ""}{short(rate)}/h
              </div>
            </div>
          );
        })}
        <button type="button" onClick={onHelp} className="tap rounded-lg bg-navy-800/80 border border-brass-500/40 text-brass-300 font-display font-bold text-lg" aria-label="Handbuch">?</button>
      </div>
    </header>
  );
}
