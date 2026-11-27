// Ordermaske: Kauf/Verkauf, Menge mit Schnellwahl, Kurszettel als Vorschau, Tageslimit und Sperrgründe vorab.
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { errorText, fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { Icon } from "../../icons.tsx";
import { ActionBar, ErrorLine } from "../../ui.tsx";
import { ActionRemedy, ReasonLine, hasRemedy } from "../Remedy.tsx";
import type { RemedyDetail } from "../../lib/remedies/index.ts";

/** Sperrgrund mit Ablehnungscode (für „Was hilft?“). */
type Why = { text: string; code?: string };
import { allowedRange, dailyFreeAt, dailyWindow, limits, maxSensible, when, type Limits, type MarketCfg, type MarketRes } from "./calc.ts";
import { Slip } from "./Slip.tsx";
import { OrderEscort } from "./OrderEscort.tsx"; // See: Börsenkonvoi, Geleit optional
import { noFundsText } from "../../lib/remedies/surplus.ts";

/** Höchstmenge je Handel (wie im Server). */
const MAX_QTY = 10_000_000;

const LIMIT_WHY: Record<keyof Limits, string> = {
  impact: "Kurswirkung",
  daily: "Tageslimit",
  funds: "Taler",
  credit: "Kasse",
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

/** initial: vorbelegte Richtung und Menge (Sprung aus „Was hilft?“); die Menge wird auf „Max“ der Richtung begrenzt. */
export function OrderTicket({ r, cfg, nowMs, ctx, base, initial }: { r: MarketRes; cfg: MarketCfg; nowMs: number; ctx: OrderCtx; base?: BaseData; initial?: { side: "buy" | "sell"; qty?: number } }) {
  const [side, setSide] = useState<"buy" | "sell">(initial?.side ?? "buy");
  const [startQty] = useState(() => (initial?.qty ? Math.max(1, Math.min(initial.qty, maxSensible(limits(initial.side, r, nowMs, cfg, ctx)))) : 100));
  const [escort, setEscort] = useState<Record<string, number>>({}); // See: Geleit für den Börsenkonvoi
  const [qtyText, setQtyText] = useState(String(startQty));
  const [qty, setQty] = useState(startQty);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => setDone(null), [qtyText, side, r.id]);
  const [whyOpen, setWhyOpen] = useState(false); // „Was hilft?“ über dem gesperrten Order-Knopf
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
    (i: { key: string; side: "buy" | "sell"; resource: string; qty: number; expectedPrice: number; escort?: Record<string, number> }) => trpcClient.market.trade.mutate(i),
    () => [trpc.market.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.naval.pathFilter().queryKey], // See: neuer Börsenkonvoi
  );

  const typed = Number(qtyText) || 0;
  const valid = typed > 0 && typed <= MAX_QTY;
  const fresh = valid && typed === qty;
  const q = fresh && quote.data && quote.data.ok && quote.data.resource === r.id && quote.data.side === side ? quote.data : null;
  const lim = limits(side, r, nowMs, cfg, ctx);
  const max = maxSensible(lim);
  const maxWhy = (Object.keys(lim) as (keyof Limits)[]).find((k) => lim[k] === max);
  const range = allowedRange(r, nowMs, cfg);
  const daily = dailyWindow(r, nowMs); // Tageslimit: gleitendes 24-h-Fenster
  const dailyLeft = daily.left;
  const nextFree = daily.releases[0];
  const halted = r.haltedUntilMs > nowMs;
  const buy = side === "buy";

  // Sperrgründe, die schon vor jeder Eingabe feststehen.
  // Je Grund der Ablehnungscode des Servers, damit „Was hilft?“ passt.
  const hard: Why[] = [];
  if (halted) hard.push({ text: `Handelspause für ${label(r.id)}: noch ${fmtDuration(r.haltedUntilMs - nowMs)} (Kursband verletzt).`, code: "halted" });
  if (buy && ctx.siege) hard.push({ text: "Belagerungsring vor deinem Hafen: keine Käufe, bis er endet oder gebrochen ist.", code: "siege" });
  if (!buy && ctx.attack) hard.push({ text: "Angriff erkannt: Verkäufe gesperrt, bis er vorbei ist.", code: "under_attack" });
  if (dailyLeft <= 0) hard.push({ text: `Tageslimit für ${label(r.id)} erreicht${nextFree ? ` – ${fmtNum(nextFree.qty)} wieder frei ab ${when(nextFree.atMs, nowMs)} Uhr` : ""}.`, code: "daily_limit" });
  if (!buy && ctx.credits >= ctx.creditLimit) hard.push({ text: `Kasse voll: höchstens ${fmtNum(ctx.creditLimit)} Taler. Verkäufe erst nach Käufen wieder möglich.`, code: "credit_limit" });
  if (!buy && ctx.stock < 1) hard.push({ text: `Kein Bestand an ${label(r.id)} zum Verkaufen.` });
  if (buy && lim.funds < 1 && !ctx.siege) hard.push({ text: noFundsText(ctx.credits, base, r.id), code: "funds" });

  // Sperrgründe zur eingegebenen Menge.
  const soft: Why[] = [];
  if (valid && hard.length === 0) {
    if (typed > lim.impact) soft.push({ text: `Kurswirkung zu groß: höchstens ${fmtNum(lim.impact)} je Handel.`, code: "impact" });
    if (typed > dailyLeft) {
      const at = dailyFreeAt(r, nowMs, typed);
      soft.push({
        text: `Über dem Tageslimit: jetzt noch ${fmtNum(dailyLeft)}${at !== null ? `, ${fmtNum(typed)} frei ab ${when(at, nowMs)} Uhr` : ` (höchstens ${fmtNum(r.dailyLimit)} in 24 h)`}.`,
        code: "daily_limit",
      });
    }
    if (q && buy && q.totalCredits > ctx.credits) soft.push({ text: `Taler reichen nicht: ${fmtNum(q.totalCredits, 2)} Taler nötig.`, code: "funds" });
    if (!buy && typed > ctx.stock) soft.push({ text: `Nur ${fmtNum(ctx.stock)} im Lager.` });
    if (q && !buy && ctx.credits + q.totalCredits > ctx.creditLimit) soft.push({ text: `Kasse fast voll: höchstens ${fmtNum(ctx.creditLimit - ctx.credits, 2)} Taler Erlös möglich.`, code: "credit_limit" });
    if (q && (q.priceAfter > range.hi || q.priceAfter < range.lo)) soft.push({ text: "Der Kurs verließe das Kursband – der Handel würde abgelehnt und eine Pause ausgelöst.", code: "band" });
  }
  const firstWhy = [...hard, ...soft].find((w) => hasRemedy(w.code));
  const blocked = hard.length > 0 || soft.length > 0;
  const why: RemedyDetail = { resource: r.id, qty: valid ? typed : undefined };

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
              <span className={`mono text-[11px] ${on ? "text-paper/80" : "text-ink2"}`}>{c.sub}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-ink2 mb-3">
        Max = größte Menge ohne Ablehnung{maxWhy ? `, hier begrenzt durch ${LIMIT_WHY[maxWhy]}` : ""}.
      </p>
      {!valid && <p className="text-sm text-messing mb-2">{typed > MAX_QTY ? `Menge zu groß (höchstens ${fmtNum(MAX_QTY)}).` : "Menge eingeben (ganze Zahl ab 1)."}</p>}

      <DailyBar used={daily.used} add={valid ? typed : 0} limit={r.dailyLimit} next={nextFree} nowMs={nowMs} reserved={daily.reserved} />

      {q && hard.length === 0 && <Slip q={q} cfg={cfg} nowMs={nowMs} ctx={ctx} label={label(r.id)} />}
      {buy && base && hard.length === 0 && <OrderEscort base={base} resource={r.id} qty={valid ? typed : 0} value={escort} onChange={setEscort} />}
      {fresh && quote.data && !quote.data.ok && <ErrorLine text={errorText(quote.data.code)} code={quote.data.code} detail={why} />}

      {(hard.length > 0 || soft.length > 0) && (
        <ul className="rounded-lg border border-siegel bg-red-950 p-2.5 mb-3 text-sm space-y-1" aria-live="polite">
          {[...hard, ...soft].map((t) => (
            <li key={t.text} className="flex gap-2 text-ink"><span className="diamond bg-siegel mt-1.5 shrink-0" aria-hidden="true" /><ReasonLine code={t.code} text={t.text} detail={why} className="min-w-0 flex-1" /></li>
          ))}
        </ul>
      )}

      {/* Fixierte Aktionsleiste: Order-Knopf bleibt über der Navigation sichtbar. */}
      <ActionBar>
      <ActionRemedy code={firstWhy?.code} detail={why} open={whyOpen} onClose={() => setWhyOpen(false)} />
      <button
        type="button"
        className={`tap w-full h-12 rounded-lg font-display uppercase text-[14px] text-white disabled:opacity-45 shadow-[0_2px_0_var(--color-ink)] ${buy ? "bg-moos" : "bg-siegel"} ${blocked && firstWhy ? "opacity-45" : ""}`}
        // Gesperrt mit bekanntem Grund: Antippen klappt „Was hilft?“ auf statt nichts zu tun.
        disabled={(!q || blocked || exec.busy) && !(blocked && firstWhy)}
        aria-disabled={blocked && !!firstWhy}
        onClick={async () => {
          if (blocked && firstWhy) return setWhyOpen(!whyOpen);
          if (!q) return;
          setDone(null);
          const esc = buy && Object.values(escort).some((n) => n > 0) ? escort : undefined;
          const res = await exec.run({ side, resource: r.id, qty, expectedPrice: q.executionPrice, ...(esc ? { escort: esc } : {}) });
          if (res?.ok && esc) setEscort({});
          if (res?.ok) setDone(buy ? `Gekauft: ${fmtNum(qty)} ${label(r.id)} – der Konvoi ist unterwegs${esc ? " (mit Geleit)" : ""}.` : `Verkauft: ${fmtNum(qty)} ${label(r.id)}.`);
        }}
      >
        {buy ? "Kaufen" : "Verkaufen"}{q ? ` · ${fmtNum(q.totalCredits, 2)} T` : ""}
      </button>
      <ErrorLine text={exec.error} code={exec.code} detail={why} />
      {done && <p className="text-moos text-sm mt-1 font-semibold" role="status">{done}</p>}
      </ActionBar>
    </div>
  );
}

/** Tageslimit als gleitendes 24-h-Fenster: Verbrauch, diese Order und die nächste Freigabe. */
function DailyBar({ used, add, limit, next, nowMs, reserved = 0 }: { used: number; add: number; limit: number; next?: { atMs: number; qty: number }; nowMs: number; reserved?: number }) {
  const u = limit > 0 ? Math.min(1, used / limit) : 1;
  const a = limit > 0 ? Math.min(1 - u, add / limit) : 0;
  const over = used + add > limit;
  return (
    <div className="mb-3" role="meter" aria-label="Tageslimit" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
      <div className="flex justify-between text-[11px] text-ink2 mb-0.5">
        <span className="font-display uppercase">Tageslimit <span className="normal-case font-sans">(24 h)</span></span>
        <span className="mono">{fmtNum(used)}{add > 0 ? ` + ${fmtNum(add)}` : ""} / {fmtNum(limit)}</span>
      </div>
      <div className="h-2 bg-inset border border-rule flex overflow-hidden">
        <div className="h-full bg-ink" style={{ width: `${u * 100}%` }} />
        <div className={`h-full ${over ? "bg-siegel" : "bg-see/60"} stripes`} style={{ width: `${a * 100}%` }} />
      </div>
      {next && <p className="text-[11px] text-ink2 mt-0.5">Gleitend: {fmtNum(next.qty)} wieder frei ab <span className="mono">{when(next.atMs, nowMs)}</span> Uhr.</p>}
      {reserved > 0 && <p className="text-[11px] text-ink2 mt-0.5">davon für Verträge vorgemerkt: <span className="mono">{fmtNum(reserved)}</span> (Lieferungen der nächsten 24 h).</p>}
    </div>
  );
}
