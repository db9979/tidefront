// Ordermaske: Kauf/Verkauf, Menge mit Schnellwahl, Kurszettel als Vorschau, Tageslimit und Sperrgründe vorab.
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { errorText, fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { ActionBar, ErrorLine } from "../../ui.tsx";
import { allowedRange, limits, maxSensible, when, DAY, type Limits, type MarketCfg, type MarketRes } from "./calc.ts";
import { Slip } from "./Slip.tsx";

/** Höchstmenge je Handel (wie im Server). */
const MAX_QTY = 10_000_000;

const LIMIT_WHY: Record<keyof Limits, string> = {
  impact: "Kurswirkung",
  daily: "Tageslimit",
  funds: "Kredite",
  credit: "Kreditlimit",
  band: "Kursband",
};

export type OrderCtx = {
  credits: number;
  creditLimit: number;
  stock: number;
  port: string;
  travelMs: number | null;
  siege: boolean;
  attack: boolean;
};

export function OrderTicket({ r, cfg, nowMs, ctx }: { r: MarketRes; cfg: MarketCfg; nowMs: number; ctx: OrderCtx }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qtyText, setQtyText] = useState("100");
  const [qty, setQty] = useState(100);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => setDone(null), [qtyText, side, r.id]);
  useEffect(() => {
    const t = setTimeout(() => setQty(Math.max(0, Math.floor(Number(qtyText) || 0))), 300);
    return () => clearTimeout(t);
  }, [qtyText]);
  const quote = useQuery({
    ...trpc.market.quote.queryOptions({ side, resource: r.id, qty: Math.max(1, qty) }),
    enabled: qty > 0 && qty <= MAX_QTY,
    placeholderData: keepPreviousData,
  });
  const exec = useCommand(
    (i: { key: string; side: "buy" | "sell"; resource: string; qty: number; expectedPrice: number }) => trpcClient.market.trade.mutate(i),
    () => [trpc.market.pathFilter().queryKey, trpc.base.pathFilter().queryKey],
  );

  const typed = Number(qtyText) || 0;
  const valid = typed > 0 && typed <= MAX_QTY;
  const fresh = valid && typed === qty;
  const q = fresh && quote.data && quote.data.ok && quote.data.resource === r.id && quote.data.side === side ? quote.data : null;
  const lim = limits(side, r, nowMs, cfg, ctx);
  const max = maxSensible(lim);
  const maxWhy = (Object.keys(lim) as (keyof Limits)[]).find((k) => lim[k] === max);
  const range = allowedRange(r, nowMs, cfg);
  const dailyLeft = Math.max(0, r.dailyLimit - r.dailyUsed);
  const halted = r.haltedUntilMs > nowMs;
  const buy = side === "buy";

  // Sperrgründe, die schon vor jeder Eingabe feststehen.
  const hard: string[] = [];
  if (halted) hard.push(`Handelspause für ${label(r.id)}: noch ${fmtDuration(r.haltedUntilMs - nowMs)} (Kursband verletzt).`);
  if (buy && ctx.siege) hard.push("Belagerungsring vor deinem Hafen: keine Käufe, bis er endet oder gebrochen ist.");
  if (!buy && ctx.attack) hard.push("Angriff erkannt: Verkäufe gesperrt, bis er vorbei ist.");
  if (dailyLeft <= 0) hard.push(`Tageslimit für ${label(r.id)} erreicht – neu ab ${when(Math.floor(nowMs / DAY) * DAY + DAY, nowMs)} Uhr.`);
  if (!buy && ctx.credits >= ctx.creditLimit) hard.push("Kreditkonto am Kreditlimit: Verkäufe erst nach Käufen wieder möglich.");
  if (!buy && ctx.stock < 1) hard.push(`Kein Bestand an ${label(r.id)} zum Verkaufen.`);
  if (buy && lim.funds < 1 && !ctx.siege) hard.push("Zu wenig Kredite für einen Kauf. Erst etwas verkaufen.");

  // Sperrgründe zur eingegebenen Menge.
  const soft: string[] = [];
  if (valid && hard.length === 0) {
    if (typed > lim.impact) soft.push(`Kurswirkung zu groß: höchstens ${fmtNum(lim.impact)} je Handel.`);
    if (typed > dailyLeft) soft.push(`Über dem Tageslimit: heute noch ${fmtNum(dailyLeft)}.`);
    if (q && buy && q.totalCredits > ctx.credits) soft.push(`Kredite reichen nicht: ${fmtNum(q.totalCredits, 2)} Kr nötig.`);
    if (!buy && typed > ctx.stock) soft.push(`Nur ${fmtNum(ctx.stock)} im Lager.`);
    if (q && !buy && ctx.credits + q.totalCredits > ctx.creditLimit) soft.push(`Kreditlimit: höchstens ${fmtNum(ctx.creditLimit - ctx.credits, 2)} Kr Erlös möglich.`);
    if (q && (q.priceAfter > range.hi || q.priceAfter < range.lo)) soft.push("Der Kurs verließe das Kursband – der Handel würde abgelehnt und eine Pause ausgelöst.");
  }
  const blocked = hard.length > 0 || soft.length > 0;

  const tenth = Math.floor(ctx.stock * 0.1);
  const chips: { top: string; sub: string; v: number; aria: string }[] = [
    { top: "100", sub: "Stück", v: 100, aria: "100" },
    { top: "1.000", sub: "Stück", v: 1000, aria: "1.000" },
    { top: "10 %", sub: fmtNum(tenth), v: tenth, aria: `10 % Bestand, ${fmtNum(tenth)}` },
    { top: "Max", sub: fmtNum(max), v: max, aria: `Maximum ohne Ablehnung, ${fmtNum(max)}` },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Richtung">
        {(["buy", "sell"] as const).map((s) => {
          const on = side === s;
          const tone = s === "buy" ? "bg-moos border-moos" : "bg-siegel border-siegel";
          const ring = s === "buy" ? "border-moos text-moos" : "border-siegel text-siegel";
          return (
            <button key={s} type="button" role="radio" aria-checked={on} onClick={() => setSide(s)}
              className={`tap h-14 rounded-lg border-2 font-display uppercase text-[15px] flex items-center justify-center gap-2 ${on ? `${tone} text-white shadow-[0_2px_0_var(--color-ink)]` : `bg-card ${ring}`}`}>
              <span aria-hidden="true">{s === "buy" ? "▲" : "▼"}</span>{s === "buy" ? "Kaufen" : "Verkaufen"}
            </button>
          );
        })}
      </div>

      <label className="flex justify-between text-[11px] font-display uppercase text-ink2 mb-1" htmlFor="tf-qty">
        <span>Menge {label(r.id)}</span>
        <span className="normal-case tracking-normal font-sans">Bestand <span className="mono">{fmtNum(ctx.stock)}</span></span>
      </label>
      <div className="relative mb-2">
        <input
          id="tf-qty"
          inputMode="numeric"
          maxLength={8}
          className="w-full h-14 rounded-lg field pl-3 pr-14 mono text-[22px] text-right"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value.split(/[.,]/)[0].replace(/\D/g, ""))}
        />
        <Icon id={r.id} size={28} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      <div className="grid grid-cols-4 gap-1.5 mb-1">
        {chips.map((c) => {
          const on = String(c.v) === qtyText && c.v > 0;
          return (
            <button key={c.top} type="button" disabled={c.v < 1} onClick={() => setQtyText(String(c.v))} aria-label={c.aria}
              className={`tap rounded-lg border leading-tight px-1 py-1 flex flex-col items-center justify-center disabled:opacity-45 ${on ? "bg-ink text-paper border-ink" : "border-ink/60 text-ink bg-card"}`}>
              <span className="font-display uppercase text-[12px]">{c.top}</span>
              <span className={`mono text-[10.5px] ${on ? "text-paper/80" : "text-ink2"}`}>{c.sub}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink2 mb-3">
        Max = größte Menge ohne Ablehnung{maxWhy ? `, hier begrenzt durch ${LIMIT_WHY[maxWhy]}` : ""}.
      </p>
      {!valid && <p className="text-sm text-messing mb-2">{typed > MAX_QTY ? `Menge zu groß (höchstens ${fmtNum(MAX_QTY)}).` : "Menge eingeben (ganze Zahl ab 1)."}</p>}

      <DailyBar used={r.dailyUsed} add={valid ? typed : 0} limit={r.dailyLimit} />

      {q && hard.length === 0 && <Slip q={q} cfg={cfg} nowMs={nowMs} ctx={ctx} label={label(r.id)} />}
      {fresh && quote.data && !quote.data.ok && <ErrorLine text={errorText(quote.data.code)} />}

      {(hard.length > 0 || soft.length > 0) && (
        <ul className="rounded-lg border border-siegel bg-red-950 p-2.5 mb-3 text-sm space-y-1" aria-live="polite">
          {[...hard, ...soft].map((t) => (
            <li key={t} className="flex gap-2 text-ink"><span className="diamond bg-siegel mt-1.5" aria-hidden="true" />{t}</li>
          ))}
        </ul>
      )}

      {/* Fixierte Aktionsleiste: Order-Knopf bleibt über der Navigation sichtbar. */}
      <ActionBar>
      <button
        type="button"
        className={`tap w-full h-12 rounded-lg font-display uppercase text-[14px] text-white disabled:opacity-45 shadow-[0_2px_0_var(--color-ink)] ${buy ? "bg-moos" : "bg-siegel"}`}
        disabled={!q || blocked || exec.busy}
        onClick={async () => {
          if (!q) return;
          setDone(null);
          const res = await exec.run({ side, resource: r.id, qty, expectedPrice: q.executionPrice });
          if (res?.ok) setDone(buy ? `Gekauft: ${fmtNum(qty)} ${label(r.id)} – der Konvoi ist unterwegs.` : `Verkauft: ${fmtNum(qty)} ${label(r.id)}.`);
        }}
      >
        {buy ? "Kaufen" : "Verkaufen"}{q ? ` · ${fmtNum(q.totalCredits, 2)} Kr` : ""}
      </button>
      <ErrorLine text={exec.error} />
      {done && <p className="text-moos text-sm mt-1 font-semibold" role="status">{done}</p>}
      </ActionBar>
    </div>
  );
}

function DailyBar({ used, add, limit }: { used: number; add: number; limit: number }) {
  const u = limit > 0 ? Math.min(1, used / limit) : 1;
  const a = limit > 0 ? Math.min(1 - u, add / limit) : 0;
  const over = used + add > limit;
  return (
    <div className="mb-3" role="meter" aria-label="Tageslimit" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <div className="flex justify-between text-[11px] text-ink2 mb-0.5">
        <span className="font-display uppercase">Tageslimit</span>
        <span className="mono">{fmtNum(used)}{add > 0 ? ` + ${fmtNum(add)}` : ""} / {fmtNum(limit)}</span>
      </div>
      <div className="h-2 bg-inset border border-rule flex overflow-hidden">
        <div className="h-full bg-ink" style={{ width: `${u * 100}%` }} />
        <div className={`h-full ${over ? "bg-siegel" : "bg-see/60"} stripes`} style={{ width: `${a * 100}%` }} />
      </div>
    </div>
  );
}
