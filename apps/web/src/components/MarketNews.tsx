// Marktnachrichten der Börse: Liste im Seekarte-Stil (Pfeil, Prozent, Grund, Restdauer) und kompakte Variante für ein
// Tickerband. Eigenständig: Daten über useMarketNews (tRPC market.news), wird von der Börse eingebunden.
import { useQuery } from "@tanstack/react-query";
import { trpc, type Outputs } from "../lib/trpc.ts";
import { label } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Icon } from "../icons.tsx";
import { useWorldEvents } from "./WorldEvents.tsx";

export type MarketNewsData = Outputs["market"]["news"];
export type MarketNewsItem = MarketNewsData["news"][number];

/**
 * Marktnachrichten; aktualisiert sich mit jeder Börsenmeldung (WebSocket „market“) und spätestens jede Minute.
 * TST-17: Solange die Kartell-Armada (Saisonfinale) vor der Küste liegt, entfällt „Marktwetter ruhig – kaum Kämpfe“ (bis 0.43 „Ruhige See – …“; E-5: Marktwetter ≠ Weltpolitik-Gezeit).
 */
export function useMarketNews(enabled = true) {
  const we = useWorldEvents();
  const finale = !!we.data?.events.some((e) => e.finale && e.status === "active");
  return useQuery({
    ...trpc.market.news.queryOptions(), enabled, refetchInterval: 60000,
    select: (d) => (finale ? { ...d, news: d.news.filter((n) => !/^(Marktwetter ruhig|Ruhige See)/.test(n.reason)) } : d),
  });
}

const SOURCE: Record<string, string> = { weltereignis: "Weltereignis", kriegslage: "Kriegslage", knappheit: "Knappheit", saison: "Saison", handelsbilanz: "Handelsbilanz" };

/** „+12 %“ / „−4 %“ mit einer Nachkommastelle, wenn nötig. */
export function fmtPct(pct: number): string {
  const p = Math.round(Math.abs(pct) * 1000) / 10;
  return `${pct < 0 ? "−" : "+"}${Number.isInteger(p) ? p : p.toLocaleString("de-DE")} %`;
}

/** Restdauer: volle Wirkung bis …, danach abklingend bis …; beendet: vor wie langer Zeit. */
function timeLine(n: MarketNewsItem, now: number): string {
  if (now < n.startsAtMs) return `ab in ${fmtDuration(n.startsAtMs - now)}`;
  if (now < n.endsAtMs) return `noch ${fmtDuration(n.endsAtMs - now)}`;
  if (now < n.fadeEndsAtMs) return `klingt ab, ${fmtDuration(n.fadeEndsAtMs - now)}`;
  return `vorbei seit ${fmtDuration(now - n.fadeEndsAtMs)}`;
}

function Arrow({ up, faded }: { up: boolean; faded?: boolean }) {
  return (
    <span aria-hidden className={`inline-block w-4 text-center font-display ${up ? "text-siegel" : "text-moos"} ${faded ? "opacity-50" : ""}`}>
      {up ? "▲" : "▼"}
    </span>
  );
}

/**
 * Liste der Nachrichten: wirkende zuerst, dann die beendeten der letzten 24 Stunden (blasser).
 * Pfeil hoch (rot) = Richtwert steigt, Pfeil runter (grün) = sinkt. Prozent = volle Wirkung, beim Abklingen dazu die
 * aktuelle. `limit` kürzt die Liste.
 */
export function MarketNewsList({ data, limit, showRefs = false }: { data: MarketNewsData | undefined; limit?: number; showRefs?: boolean }) {
  const now = useNow(30000);
  if (!data) return null;
  const items = [...data.news].sort((a, b) => Number(b.active) - Number(a.active) || b.startsAtMs - a.startsAtMs).slice(0, limit);
  return (
    <div>
      {items.length === 0 && <p className="text-xs text-ink2 italic">Ruhige Märkte – keine Nachrichten in den letzten 24 Stunden.</p>}
      <ul className="divide-y divide-ink2/20">
        {items.map((n) => {
          const fading = n.active && now >= n.endsAtMs;
          return (
            <li key={n.id} className={`py-1.5 flex items-start gap-2 ${n.active ? "" : "opacity-60"}`}>
              <Icon id={n.resource} size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-serif text-[15px] leading-tight">
                  <Arrow up={n.pct > 0} faded={!n.active} />
                  {label(n.resource)} <span className={n.pct > 0 ? "text-siegel" : "text-moos"}>{fmtPct(n.pct)}</span>
                  {fading && <span className="text-ink2 text-xs"> (jetzt {fmtPct(n.current)})</span>}
                </div>
                <div className="text-xs text-ink2 truncate">{n.reason}</div>
              </div>
              <div className="text-[11px] text-ink2 text-right shrink-0">
                <div className="uppercase tracking-[0.08em]">{SOURCE[n.source] ?? n.source}</div>
                <div>{timeLine(n, now)}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {showRefs && (
        <div className="mt-2 text-xs text-ink2 grid grid-cols-2 gap-x-3">
          {data.refs.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span>Richtwert {label(r.id)}</span>
              <span className={r.offset > 0 ? "text-siegel" : r.offset < 0 ? "text-moos" : ""}>
                {r.effective.toLocaleString("de-DE", { maximumFractionDigits: 3 })}{r.offset !== 0 ? ` (${fmtPct(r.offset)})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kompakte Variante für ein Tickerband: nur wirkende Nachrichten, eine Zeile, horizontal scrollbar. */
export function MarketNewsTicker({ data }: { data: MarketNewsData | undefined }) {
  const active = (data?.news ?? []).filter((n) => n.active);
  if (active.length === 0) return null;
  return (
    <div className="overflow-x-auto whitespace-nowrap text-xs py-1" role="marquee" aria-label="Marktwetter">
      <span className="font-display uppercase tracking-[0.12em] text-[10px] text-ink2 mr-2">Marktwetter</span>
      {active.map((n, i) => (
        <span key={n.id} className="inline-flex items-center gap-1 mr-4">
          {i > 0 && <span aria-hidden className="text-ink2 mr-3">·</span>}
          <Arrow up={n.pct > 0} />
          <span className="font-serif">{n.reason}</span>
          <span className="text-ink2">–</span>
          <span>{label(n.resource)}</span>
          <span className={n.pct > 0 ? "text-siegel" : "text-moos"}>{fmtPct(n.pct)}</span>
        </span>
      ))}
    </div>
  );
}

/** Fertiger Block: Ticker oder Liste mit eigenem Abruf (für die einfache Einbindung). */
export function MarketNews({ compact = false, limit, showRefs }: { compact?: boolean; limit?: number; showRefs?: boolean }) {
  const q = useMarketNews();
  return compact ? <MarketNewsTicker data={q.data} /> : <MarketNewsList data={q.data} limit={limit} showRefs={showRefs} />;
}
