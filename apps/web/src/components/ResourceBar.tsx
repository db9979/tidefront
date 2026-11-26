import type { BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { RES_ORDER, liveAmount } from "../lib/live.res.ts";
import { useState } from "react";
import { Icon } from "../icons.tsx";
import { ResourceSheet } from "./ResourceSheet.tsx";

function short(n: number): string {
  if (n >= 100000) return `${fmtNum(n / 1000)}k`;
  if (n >= 10000) return `${fmtNum(n / 1000, 1)}k`;
  return fmtNum(n);
}

/** Kopfleiste: Papierstreifen mit vier Ressourcen (Stich, Bestand, Rate, Füllstand) und Handbuch-Knopf. */
export function ResourceBar({ base, asOf, now, onHelp }: { base: BaseData; asOf: number; now: number; onHelp: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <header className="sticky top-0 z-30 bg-paper border-b-[3px] border-double border-ink" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-stretch gap-1 pl-2 pr-1.5 py-1.5">
        {RES_ORDER.map((r) => {
          const v = liveAmount(base, asOf, now, r);
          const rate = base.rates[r] ?? 0;
          const fill = Math.min(1, v / base.capacity);
          const full = fill >= 0.999;
          return (
            <button type="button" key={r} onClick={() => setOpen(r)} className="flex-1 min-w-0 flex items-center gap-1 text-left" aria-label={`${label(r)} ${fmtNum(v)}, ${fmtNum(rate)} pro Stunde – Details`}>
              <Icon id={r} size={20} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={`text-[13.5px] leading-tight mono font-semibold truncate ${full ? "text-messing" : ""}`}>{short(v)}</div>
                <div className={`text-[10.5px] leading-tight mono ${rate < 0 ? "text-siegel" : "text-moos"}`}>
                  {rate >= 0 ? "+" : ""}{short(rate)}/h
                </div>
                <div className="h-[2px] mt-0.5 bg-rule/80 overflow-hidden" aria-hidden="true">
                  <div className={`h-full ${full ? "bg-messing" : r === "proviant" && rate < 0 ? "bg-siegel" : "bg-ink"}`} style={{ width: `${fill * 100}%` }} />
                </div>
              </div>
            </button>
          );
        })}
        <button type="button" onClick={onHelp} className="tap rounded-lg border border-ink text-ink font-serif text-lg" aria-label="Handbuch und Einstellungen">?</button>
      </div>
      {open && <ResourceSheet base={base} res={open} amount={liveAmount(base, asOf, now, open)} onClose={() => setOpen(null)} />}
    </header>
  );
}
