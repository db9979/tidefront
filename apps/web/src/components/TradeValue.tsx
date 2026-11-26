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

/** Abschnitt „Spielerhandel (7 Tage)“: mittleres Tauschverhältnis je Paar in Krediten je Einheit neben dem Börsenkurs. */
export function PlayerTradeStats() {
  const s = useQuery({ ...trpc.playerTrade.stats.queryOptions(), refetchInterval: 120000 });
  const prices = usePrices();
  return (
    <Card title={<><Icon id="credits" size={18} /> Spielerhandel (7 Tage)</>}>
      {!s.data || !prices ? <Loading /> : s.data.pairs.length === 0 ? (
        <p className="text-sm text-ink2">Noch keine Geschäfte zwischen Spielern in den letzten 7 Tagen. Sobald Angebote angenommen werden, siehst du hier die gezahlten Kurse.</p>
      ) : (
        <>
          <ul className="divide-y divide-navy-700">
            {s.data.pairs.map((p) => {
              const kr = market.creditsPerUnit(p.qtyA, p.b, p.qtyB, prices);
              const boerse = prices[p.a];
              const dev = kr !== null && boerse ? (kr / boerse - 1) * 100 : null;
              return (
                <li key={`${p.a}|${p.b}`} className="py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Icon id={p.a} size={20} /><span className="min-w-0 flex-1 truncate">{label(p.a)} gegen {label(p.b)}</span>
                    <span className="mono">{kr === null ? "–" : `${fmtNum(kr, 3)} Kr`}</span>
                  </div>
                  <div className="text-xs text-ink2 flex flex-wrap justify-between gap-x-2">
                    <span>
                      {p.count} {p.count === 1 ? "Geschäft" : "Geschäfte"} · {fmtNum(p.qtyA)} {label(p.a)}
                      {p.b !== "credits" && <> · 1 {label(p.a)} = {fmtNum(p.qtyB / p.qtyA, 3)} {label(p.b)}</>}
                    </span>
                    <span>
                      Börse {boerse !== undefined ? fmtNum(boerse, 3) : "–"}
                      {dev !== null && Math.round(dev) !== 0 && ` (${dev > 0 ? "+" : "−"}${fmtNum(Math.abs(dev))} %)`}
                    </span>
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
