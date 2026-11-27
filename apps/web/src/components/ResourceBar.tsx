import type { BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { RES_ORDER, liveAmount } from "../lib/live.res.ts";
import { useState } from "react";
import { Icon } from "../icons.tsx";
import { ResourceSheet } from "./ResourceSheet.tsx";
import { HarborSwitcher } from "./HarborSwitcher.tsx";
import { MenuSheet, type MenuItem } from "./MenuSheet.tsx";
import { CatchUpStrip } from "./CatchUp.tsx";
export type { MenuItem } from "./MenuSheet.tsx";

function short(n: number): string {
  if (n >= 100000) return `${fmtNum(n / 1000)}k`;
  if (n >= 10000) return `${fmtNum(n / 1000, 1)}k`;
  return fmtNum(n);
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/**
 * Stromfeld: groß die Bilanz Angebot − Bedarf (grün +, rot −), darunter der Speicher-Füllstand (Prozent und Balken
 * wie die Lagerbalken), roter Punkt, wenn laut Vorhersage (base.grid.warning) Mangel droht oder schon herrscht.
 * Ausgeglichen (Kraftwerk regelt nach, Bilanz 0) steht „gedeckt“; ohne Speicher zeigt die zweite Zeile die
 * Kraftwerk-Auslastung statt eines Strichs.
 */
function PowerField({ base, onOpen }: { base: BaseData; onOpen: () => void }) {
  const g = base.grid;
  const bal = Math.round(sum(g.now.supply) - sum(g.now.demand));
  const fill = g.now.capacity > 0 ? Math.min(1, g.now.stored / g.now.capacity) : 0;
  const warn = g.warning;
  const sign = bal > 0 ? "+" : bal < 0 ? "−" : "±";
  const demand = Math.round(sum(g.now.demand));
  const covered = bal === 0 && demand > 0;
  const plant = g.now.supply.kraftwerk > 0 || g.now.throttle < 1;
  const load = Math.round(g.now.throttle * 100);
  const second = g.now.capacity > 0 ? `${Math.round(fill * 100)} %` : plant ? `KW ${load} %` : demand > 0 ? `Last ${short(demand)}` : "–";
  const desc = covered ? `gedeckt (Bedarf ${fmtNum(demand)})` : `Bilanz ${sign}${fmtNum(Math.abs(bal))}`;
  const store = g.now.capacity > 0 ? `Speicher ${Math.round(fill * 100)} %` : plant ? `Kraftwerk ausgelastet zu ${load} %` : "kein Speicher";
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="strom-feld"
      className="relative shrink-0 w-[50px] flex flex-col justify-center text-left pl-1 border-l border-rule"
      aria-label={`Strom: ${desc}, ${store}${warn ? ", Mangel droht" : ""} – Versorgung öffnen`}
      title={`${desc} · ${store}`}
    >
      <div className={`text-[13.5px] leading-tight font-semibold truncate flex items-center ${covered ? "font-sans text-[12px]" : "mono"} ${bal < 0 ? "text-siegel" : "text-moos"}`}>
        <Icon id="strom" size={12} className="shrink-0 -ml-0.5" />{covered ? "gedeckt" : `${sign}${short(Math.abs(bal))}`}
      </div>
      <div className="text-[11px] leading-tight mono text-ink2 truncate">{second}</div>
      <div className="h-[2px] mt-0.5 bg-rule/80 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-moos" style={{ width: `${fill * 100}%` }} />
      </div>
      {warn && <span className="absolute top-0 right-0 w-[7px] h-[7px] rounded-full bg-siegel border border-paper" data-testid="strom-warnung" title={warn.text} />}
    </button>
  );
}

/** Kopfleiste: Hafenwahl (ab zwei Häfen), Papierstreifen mit vier Ressourcen (Stich, Bestand, Rate, Füllstand), Stromfeld und Menü. */
export function ResourceBar({ base, asOf, now, onMenu, onSwitchBase, onPlanFounding, onPower }: { base: BaseData; asOf: number; now: number; onMenu: (item: MenuItem) => void; onSwitchBase: (id: number) => void; onPlanFounding: () => void; onPower: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-30 bg-paper border-b-[3px] border-double border-ink" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <HarborSwitcher base={base} now={now} onSwitch={onSwitchBase} onPlanFounding={onPlanFounding} />
      <div className="flex items-stretch gap-1 pl-2 pr-1.5 py-1.5">
        {RES_ORDER.map((r) => {
          const v = liveAmount(base, asOf, now, r);
          const rate = base.rates[r] ?? 0;
          const fill = Math.min(1, v / base.capacity);
          const full = fill >= 0.999;
          return (
            <button type="button" key={r} onClick={() => setOpen(r)} className="flex-1 min-w-0 flex items-center gap-0.5 text-left" aria-label={`${label(r)} ${fmtNum(v)}, ${fmtNum(rate)} pro Stunde – Details`}>
              <Icon id={r} size={18} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={`text-[13.5px] leading-tight mono font-semibold truncate ${full ? "text-messing" : ""}`}>{short(v)}</div>
                <div className={`text-[11px] leading-tight mono ${rate < 0 ? "text-siegel" : "text-moos"}`}>
                  {rate >= 0 ? "+" : ""}{short(rate)}/h
                </div>
                <div className="h-[2px] mt-0.5 bg-rule/80 overflow-hidden" aria-hidden="true">
                  <div className={`h-full ${full ? "bg-messing" : r === "proviant" && rate < 0 ? "bg-siegel" : "bg-ink"}`} style={{ width: `${fill * 100}%` }} />
                </div>
              </div>
            </button>
          );
        })}
        <PowerField base={base} onOpen={onPower} />
        <button type="button" onClick={() => setMenu(true)} aria-haspopup="dialog" aria-expanded={menu}
          className="tap shrink-0 rounded-lg border border-ink text-ink flex flex-col items-center justify-center gap-[3px] px-1">
          <span aria-hidden className="flex flex-col gap-[3px] w-4">{[0, 1, 2].map((i) => <span key={i} className="block h-[2px] bg-ink rounded-full" />)}</span>
          <span className="text-[11px] leading-none font-display tracking-[0.04em]">Menü</span>
        </button>
      </div>
      <CatchUpStrip base={base} />{/* Aufholhilfe: Baugutschrift */}
      {open && <ResourceSheet base={base} res={open} amount={liveAmount(base, asOf, now, open)} onClose={() => setOpen(null)} />}
      <MenuSheet open={menu} onClose={() => setMenu(false)} onPick={(i) => { setMenu(false); onMenu(i); }} />
    </header>
  );
}
