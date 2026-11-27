// Truppen → Einsatz, Kopf „Flotte daheim“: Einheiten je Gattung, Kommandopunkte, Missionsplätze, „Mission planen“.
import type { Balance, BaseData } from "../../lib/trpc.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { BRANCHES, commandPointsOf, homeByBranch } from "../../lib/strike.ts";
import { Icon } from "../../icons.tsx";
import { Bar, Button } from "../../ui.tsx";
import { ReasonLine } from "../Remedy.tsx"; // „Was hilft?“

export function FleetHead({ base, balance, onPlan }: { base: BaseData; balance: Balance; onPlan: () => void }) {
  const groups = homeByBranch(base, balance);
  const all = { ...groups.see, ...groups.land, ...groups.luft };
  const cpHome = commandPointsOf(all, balance);
  const cpMax = base.commandPoints;
  const slots = base.missionSlots;
  const used = base.activeMissions;
  const full = used >= slots;
  return (
    <section className="panel rounded-xl p-3.5 mb-3" aria-label="Flotte daheim">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em]">Flotte daheim</h2>
        <span className="flex items-center gap-1.5 text-xs text-ink2" aria-label={`Missionsplätze ${used} von ${slots} belegt`} title="Missionsplätze">
          <span aria-hidden="true" className="tracking-[0.15em] text-[13px] leading-none">
            {Array.from({ length: slots }, (_, i) => <span key={i} className={i < used ? "text-siegel" : "text-ink2"}>{i < used ? "●" : "○"}</span>)}
          </span>
          <span className="mono">{used}/{slots}</span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {BRANCHES.map((b) => {
          const g = groups[b.id];
          const total = Object.values(g).reduce((s, n) => s + n, 0);
          return (
            <div key={b.id} className={`rounded-[3px] border px-1.5 py-1.5 min-w-0 ${total > 0 ? "border-rule bg-card" : "border-dashed border-rule"}`} aria-label={`${b.text}: ${fmtNum(total)} daheim`}>
              <div className="flex items-center gap-1">
                <Icon id={b.icon} size={26} className={total > 0 ? "" : "opacity-40"} />
                <div className="min-w-0 leading-none">
                  <div className="font-display text-[10px] uppercase tracking-[0.12em] text-ink2">{b.text}</div>
                  <div className={`font-serif text-[20px] leading-tight ${total > 0 ? "" : "text-ink2"}`}>{fmtNum(total)}</div>
                </div>
              </div>
              {total > 0 && (
                <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-1">
                  {Object.entries(g).map(([id, n]) => (
                    <span key={id} className="inline-flex items-center gap-0.5 text-[11px] mono" title={label(id)}><Icon id={id} size={16} />{fmtNum(n)}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2.5">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink2">Kommandopunkte je Verband</span>
          <span className="mono"><span className={cpHome > cpMax ? "text-messing" : ""}>{fmtNum(Math.round(cpHome * 10) / 10)}</span> / {fmtNum(cpMax)}</span>
        </div>
        <Bar value={cpMax > 0 ? cpHome / cpMax : 0} tone={cpHome > cpMax ? "brass" : "sea"} />
        {cpHome > cpMax && <p className="text-[11px] text-ink2 mt-0.5">Mehr daheim, als ein Verband führen kann – auf mehrere Missionen verteilen.</p>}
      </div>

      <Button className="w-full mt-3" onClick={onPlan}>Mission planen</Button>
      {full && <ReasonLine code="no_mission_slot" className="text-sm text-brass-300 mt-2" />}
    </section>
  );
}
