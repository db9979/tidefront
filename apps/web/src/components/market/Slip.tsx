// Kurszettel: Vorschau einer Order (Ausführungskurs, Kurswirkung, Gebühr, Gesamt, Lieferung).
import { fmtNum } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import type { Outputs } from "../../lib/trpc.ts";
import { signed, when, type MarketCfg } from "./calc.ts";
import type { OrderCtx } from "./OrderTicket.tsx";

type Quote = Extract<Outputs["market"]["quote"], { ok: true }>;

export function Slip({ q, cfg, nowMs, ctx, label }: { q: Quote; cfg: MarketCfg; nowMs: number; ctx: OrderCtx; label: string }) {
  const buy = q.side === "buy";
  const share = Math.min(1, q.impact / cfg.maxImpactPerTrade);
  const tooMuch = q.impact > cfg.maxImpactPerTrade;
  const after = buy ? ctx.credits - q.totalCredits : ctx.credits + q.totalCredits;
  const move = (q.priceAfter / q.priceBefore - 1) * 100;
  return (
    <section className="slip px-3 pt-2.5 pb-3 my-4 shadow-[0_2px_6px_rgba(24,39,58,0.08)]" aria-label="Kurszettel">
      <div className="flex items-center justify-between border-b-[3px] border-double border-ink pb-1 mb-1.5">
        <span className="font-display uppercase text-[11px]">Kurszettel</span>
        <span className={`font-display uppercase text-[11px] ${buy ? "text-moos" : "text-siegel"}`}>{buy ? "Kauf" : "Verkauf"} · {fmtNum(q.qty)} {label}</span>
      </div>
      <dl className="text-sm">
        <Row k="Kurs jetzt" v={fmtNum(q.priceBefore, 2)} />
        <Row k="Ausführungskurs" v={fmtNum(q.executionPrice, 2)} strong />
        <Row k="Kurs danach" v={`${fmtNum(q.priceAfter, 2)} (${buy ? "▲" : "▼"} ${signed(move, 2)})`} />
        <div className="py-1.5 dotted-row">
          <div className="flex justify-between">
            <dt className="text-ink2">Kurswirkung</dt>
            <dd className={`mono ${tooMuch ? "text-siegel font-semibold" : ""}`}>{fmtNum(q.impact * 100, 2)} % <span className="text-ink2">/ max {fmtNum(cfg.maxImpactPerTrade * 100, 1)} %</span></dd>
          </div>
          <div className="h-1.5 mt-1 bg-inset border border-rule overflow-hidden" aria-hidden="true">
            <div className={`h-full ${tooMuch ? "bg-siegel" : share > 0.75 ? "bg-messing" : "bg-see"}`} style={{ width: `${share * 100}%` }} />
          </div>
        </div>
        <Row k="Warenwert" v={`${fmtNum(q.baseCredits, 2)} T`} />
        <Row k={`Gebühr ${fmtNum(cfg.fee * 100)} %`} v={`${buy ? "+" : "−"} ${fmtNum(q.feeCredits, 2)} T`} />
      </dl>
      <div className="flex items-baseline justify-between border-t-2 border-ink mt-1 pt-1.5">
        <span className="font-display uppercase text-[12px]">{buy ? "Kosten" : "Erlös"}</span>
        <span className="mono text-[22px]">{fmtNum(q.totalCredits, 2)} <span className="text-sm text-ink2">T</span></span>
      </div>
      <div className="flex justify-between text-xs text-ink2 mt-0.5">
        <span>Konto danach</span>
        <span className={`mono ${after < 0 || after > ctx.creditLimit ? "text-siegel font-semibold" : ""}`}>{fmtNum(after, 2)} T</span>
      </div>
      <div className="mt-2 pt-2 border-t border-dashed border-rule text-xs flex items-start gap-2">
        {buy ? (
          <span>
            Lieferung{ctx.travelMs !== null && <> in <span className="mono font-semibold" data-delivery-in>{fmtDuration(ctx.travelMs).replace(" 00 min", "")}</span></>} per Konvoi aus <strong>{ctx.port}</strong>
            {ctx.travelMs !== null && <> – Ankunft <span className="mono font-semibold">{when(nowMs + ctx.travelMs, nowMs)}</span></>}.
          </span>
        ) : (
          <span>Ware wird sofort abgezogen, Taler sofort gutgeschrieben.</span>
        )}
      </div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-1 dotted-row">
      <dt className="text-ink2">{k}</dt>
      <dd className={`mono ${strong ? "font-semibold" : ""}`}>{v}</dd>
    </div>
  );
}
