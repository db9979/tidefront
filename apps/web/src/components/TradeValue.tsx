// Börsenwert als Orientierung im Spielerhandel und Handelsstatistik der letzten 7 Tage.
// Reine Anzeige: Spielerhandel verändert die Börsenkurse nicht.
import { useQuery } from "@tanstack/react-query";
import { market } from "@tidefront/game-core";
import { trpc } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { Card, Loading } from "../ui.tsx";
import { Icon } from "../icons.tsx";

export type Prices = Record<string, number>;

/** Aktuelle Börsenkurse (geteilt mit der Kursliste der Börse). */
export function usePrices(): Prices | null {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 30000 });
  if (!m.data) return null;
  return Object.fromEntries(m.data.resources.map((r) => [r.id, r.price]));
}

/** Tauschwert aus Sicht des Lesers (er gibt, er bekommt). */
export function readerValue(prices: Prices | null, giveAsset: string, giveQty: number, getAsset: string, getQty: number) {
  return prices ? market.tradeValue(giveAsset, giveQty, getAsset, getQty, prices) : null;
}

/** „du gibst 1.240 Kr, bekommst 1.180 Kr – 5 % unter Börse“, bei über 20 % Abweichung mit deutlichem Hinweis. */
export function ValueLine({ v, you = "du" }: { v: market.TradeValue | null; you?: string }) {
  if (!v) return null;
  const pct = Math.round(Math.abs(v.pct));
  const dir = v.pct < 0 ? "unter" : "über";
  const rel = pct === 0 ? "etwa Börsenwert" : `${fmtNum(pct)} % ${dir} Börse (${v.diff >= 0 ? "+" : "−"}${fmtNum(Math.abs(v.diff))} Kr)`;
  return (
    <div className="text-xs mt-1">
      <span className="text-ink2">Börsenwert: {you} gibst <span className="mono">{fmtNum(v.give)} Kr</span>, bekommst <span className="mono">{fmtNum(v.get)} Kr</span> – {rel}</span>
      {v.strong && (
        <div className={`font-semibold ${v.pct < 0 ? "text-siegel" : "text-messing"}`} role="note">
          {v.pct < 0 ? "Deutlich unter Börsenwert: du bekommst viel weniger, als du gibst." : "Deutlich über Börsenwert: du bekommst viel mehr, als du gibst."}
        </div>
      )}
    </div>
  );
}

/** Kurzes Zeichen „▲ +5 % ggü. Börse“ aus Sicht des Lesers: Moos = du bekommst mehr, Siegelrot = weniger. */
export function DevTag({ v }: { v: market.TradeValue | null }) {
  if (!v) return null;
  const pct = Math.round(v.pct);
  const tone = pct > 0 ? "border-moos text-moos" : pct < 0 ? "border-siegel text-siegel" : "border-rule text-ink2";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "■";
  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 mono text-[11.5px] whitespace-nowrap bg-card ${tone} ${v.strong ? "font-semibold border-2" : ""}`}
      aria-label={pct === 0 ? "etwa Börsenwert" : `${Math.abs(pct)} Prozent ${pct > 0 ? "über" : "unter"} Börsenwert`}>
      <span aria-hidden="true">{arrow} {pct > 0 ? "+" : pct < 0 ? "−" : "±"}{fmtNum(Math.abs(pct))} %</span>
    </span>
  );
}

/** Abschnitt „Spielerhandel (7 Tage)“: mittleres Tauschverhältnis je Paar in Krediten je Einheit neben dem Börsenkurs. */
export function PlayerTradeStats() {
  const s = useQuery({ ...trpc.playerTrade.stats.queryOptions(), refetchInterval: 120000 });
  const prices = usePrices();
  return (
    <Card title={<><Icon id="credits" size={18} /> Spielerhandel (7 Tage)</>}>
      {s.isError ? <p className="text-sm text-ink2">Die Handelsstatistik ist gerade nicht abrufbar.</p> : !s.data || !prices ? <Loading /> : s.data.pairs.length === 0 ? (
        <p className="text-sm text-ink2">Noch keine Geschäfte zwischen Spielern in den letzten 7 Tagen. Sobald Angebote angenommen werden, siehst du hier die gezahlten Kurse.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10.5px] font-display uppercase text-ink2 border-b-[3px] border-double border-ink pb-1" aria-hidden="true">
            <span>Paar</span><span className="text-right">Spieler</span><span className="text-right w-[4.5rem]">Börse</span>
          </div>
          <ul>
            {s.data.pairs.map((p) => {
              const kr = market.creditsPerUnit(p.qtyA, p.b, p.qtyB, prices);
              const boerse = prices[p.a];
              const dev = kr !== null && boerse ? (kr / boerse - 1) * 100 : null;
              const r = dev === null ? 0 : Math.round(dev);
              const tone = r > 0 ? "text-moos" : r < 0 ? "text-siegel" : "text-ink2";
              return (
                <li key={`${p.a}|${p.b}`} className="py-2 text-sm dotted-row">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center">
                    <span className="flex items-center gap-1.5 min-w-0"><Icon id={p.a} size={22} /><span className="truncate">{label(p.a)} <span className="text-ink2 text-xs">gegen {label(p.b)}</span></span></span>
                    <span className="mono text-right">{kr === null ? "–" : fmtNum(kr, 3)}</span>
                    <span className="mono text-right w-[4.5rem] text-ink2">{boerse !== undefined ? fmtNum(boerse, 3) : "–"}</span>
                  </div>
                  <div className="text-xs text-ink2 flex flex-wrap justify-between gap-x-2 mt-0.5">
                    <span>
                      {p.count} {p.count === 1 ? "Geschäft" : "Geschäfte"} · {fmtNum(p.qtyA)} {label(p.a)}
                      {p.b !== "credits" && <> · 1 {label(p.a)} = {fmtNum(p.qtyB / p.qtyA, 3)} {label(p.b)}</>}
                    </span>
                    {dev !== null && <span className={`mono ${tone}`}>{r > 0 ? "▲ +" : r < 0 ? "▼ −" : "■ ±"}{fmtNum(Math.abs(r))} % ggü. Börse</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink2 mt-2">
            Kredite je Einheit aus dem mittleren Tauschverhältnis; die Gegenseite zählt zum aktuellen Börsenkurs. Spielerhandel verändert die Börsenkurse nicht.
          </p>
        </>
      )}
    </Card>
  );
}
