// Kopf der Börse: Talerkonto, Kasse (creditLimit) als Balken, Status der Börse, Handelshafen und Lieferzeit.
// Einklappbar (gemerkt): zugeklappt nur eine Zeile mit Status und Talerkonto; Sperrgründe bleiben immer sichtbar.
import { fmtNum } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { ReasonLine } from "../Remedy.tsx";
import { useStoredOpen } from "../../ui.tsx";

/** Sperrgrund mit Ablehnungscode für „Was hilft?“. */
export type MarketReason = { text: string; code?: string };
export type MarketStatus = { tone: "open" | "partial" | "closed"; title: string; reasons: MarketReason[] };

export function MarketHeader({ credits, creditLimit, status, port, travelMs }: {
  credits: number;
  creditLimit: number;
  status: MarketStatus;
  port: string;
  travelMs: number | null;
}) {
  const share = creditLimit > 0 ? Math.min(1, credits / creditLimit) : 0;
  const near = share >= 0.9;
  const dot = { open: "bg-moos", partial: "bg-messing", closed: "bg-siegel" }[status.tone];
  const text = { open: "text-moos", partial: "text-messing", closed: "text-siegel" }[status.tone];
  const [open, setOpen] = useStoredOpen("boerse-kopf", true);
  return (
    <header className="panel rounded-xl mb-3 overflow-hidden">
      <div className={`px-3.5 pt-3 pb-2 flex items-start justify-between gap-3 ${open ? "border-b-[3px] border-double border-ink" : ""}`}>
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-none">Börse</h1>
          <div className="text-[11px] text-ink2 font-display uppercase mt-1">
            {open ? "Kurse in Talern je Einheit" : <>Konto <span className="mono normal-case">{fmtNum(credits, 2)} T</span></>}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 font-display uppercase text-[11px] ${text}`} role="status">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} aria-hidden="true" />
          {status.title}
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={open ? "Kopf einklappen" : "Kopf aufklappen"}
            className="tap -my-3 -mr-2 text-ink2 text-[13px] leading-none">{open ? "▴" : "▾"}</button>
        </div>
      </div>
      {open && <>
      <div className="px-3.5 py-3">
        <div className="text-[11px] font-display uppercase text-ink2">Konto</div>
        <div className="flex items-baseline gap-2">
          <Icon id="credits" size={26} className="self-center" />
          <span className="mono text-[32px] leading-tight text-ink">{fmtNum(credits, 2)}</span>
          <span className="mono text-ink2">T</span>
        </div>
        <div className="mt-1.5" role="meter" aria-valuemin={0} aria-valuemax={creditLimit} aria-valuenow={credits} aria-label="Kasse">
          <div className="h-2 w-full bg-inset border border-rule overflow-hidden">
            <div className={`h-full ${near ? "bg-siegel" : "bg-messing"}`} style={{ width: `${share * 100}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-ink2 mt-0.5">
            <span>Kasse <span className="mono">{fmtNum(creditLimit)} T</span></span>
            <span className="mono">{fmtNum(share * 100)} % genutzt</span>
          </div>
        </div>
        {near && <p className="text-xs text-siegel mt-1">Kasse fast voll: Verkäufe sind nur noch bis zur Obergrenze möglich.</p>}
      </div>
      <dl className="grid grid-cols-2 border-t border-rule text-sm">
        <div className="px-3.5 py-2 border-r border-rule">
          <dt className="text-[11px] font-display uppercase text-ink2">Handelshafen</dt>
          <dd className="font-serif text-[16px] truncate flex items-center gap-1"><Icon id="anker" size={16} /> {port || "–"}</dd>
        </div>
        <div className="px-3.5 py-2">
          <dt className="text-[11px] font-display uppercase text-ink2">Lieferzeit Konvoi</dt>
          <dd className="mono flex items-center gap-1"><Icon id="transport" size={16} /> {travelMs === null ? "–" : fmtDuration(travelMs)}</dd>
        </div>
      </dl>
      </>}
      {status.reasons.length > 0 && (
        <ul className={`px-3.5 py-2 border-t border-rule text-xs space-y-0.5 ${status.tone === "closed" ? "bg-red-950" : "bg-inset"}`}>
          {status.reasons.map((r) => (
            <li key={r.text} className="flex gap-2"><span className={`diamond mt-1 shrink-0 ${status.tone === "closed" ? "bg-siegel" : "bg-messing"}`} aria-hidden="true" /><ReasonLine code={r.code} text={r.text} className="min-w-0 flex-1" /></li>
          ))}
        </ul>
      )}
    </header>
  );
}
