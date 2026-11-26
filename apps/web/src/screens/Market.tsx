import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { RES_ICON, errorText, fmtNum, label } from "../lib/names.ts";
import { fmtDuration, useNow } from "../lib/time.ts";
import { Button, Card, ErrorLine, Loading } from "../ui.tsx";

export function MarketScreen({ base }: { base: BaseData }) {
  const m = useQuery({ ...trpc.market.get.queryOptions(), refetchInterval: 30000 });
  const now = useNow();
  const [resource, setResource] = useState("stahl");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qtyText, setQtyText] = useState("100");
  const [qty, setQty] = useState(100);
  const [done, setDone] = useState<string | null>(null);
  // Menge erst nach kurzer Pause anfragen
  useEffect(() => {
    const t = setTimeout(() => setQty(Math.max(0, Math.floor(Number(qtyText) || 0))), 300);
    return () => clearTimeout(t);
  }, [qtyText]);
  const quote = useQuery({
    ...trpc.market.quote.queryOptions({ side, resource, qty: Math.max(1, qty) }),
    enabled: qty > 0 && base.market.unlocked,
    placeholderData: keepPreviousData,
  });
  const exec = useCommand(
    (i: { key: string; side: "buy" | "sell"; resource: string; qty: number; expectedPrice: number }) => trpcClient.market.trade.mutate(i),
    () => [trpc.market.pathFilter().queryKey, trpc.base.pathFilter().queryKey],
  );
  if (!m.data) return <Loading />;
  const q = quote.data && quote.data.ok ? quote.data : null;
  const sel = m.data.resources.find((r) => r.id === resource)!;
  const halted = sel.haltedUntilMs > now;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Börse</h1>
        <div className="text-right">
          <div className="text-lg font-semibold text-brass-400">{fmtNum(m.data.credits, 2)} Kr</div>
          <div className="text-xs text-slate-400">Limit {fmtNum(base.market.creditLimit)} Kr</div>
        </div>
      </div>
      {!base.market.unlocked && (
        <div className="rounded-xl bg-navy-800 border border-brass-400 p-3 mb-3 text-sm" role="status">
          {errorText("locked")} Deine Hafenkommandantur hat Stufe {base.buildings.find((b) => b.id === "hafenkommandantur")?.level ?? 0}.
        </div>
      )}

      <Card title="Kurse">
        <ul className="divide-y divide-navy-700">
          {m.data.resources.map((r) => {
            const dev = (r.price / r.ref - 1) * 100;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setResource(r.id)} className={`tap w-full flex items-center justify-between py-2 px-1 rounded ${r.id === resource ? "bg-navy-700" : ""}`}>
                  <span>{RES_ICON[r.id]} {label(r.id)}</span>
                  <span className="text-right">
                    <span className="font-semibold">{fmtNum(r.price, 3)}</span>
                    <span className={`text-xs ml-2 ${dev > 0 ? "text-red-300" : dev < 0 ? "text-emerald-300" : "text-slate-400"}`}>{dev >= 0 ? "+" : ""}{fmtNum(dev, 1)} %</span>
                    <div className="text-xs text-slate-400">Richtwert {fmtNum(r.ref, 2)}{r.haltedUntilMs > now ? ` · Pause ${fmtDuration(r.haltedUntilMs - now)}` : ""}</div>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={`Handel: ${label(resource)}`}>
        <div className="grid grid-cols-2 gap-2 mb-2">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} className={`tap rounded-lg ${side === s ? "bg-sea-400 text-navy-950 font-semibold" : "bg-navy-700"}`}>
              {s === "buy" ? "Kaufen" : "Verkaufen"}
            </button>
          ))}
        </div>
        <label className="text-sm text-slate-300">Menge</label>
        <input
          inputMode="numeric"
          className="w-full h-12 rounded-lg bg-navy-950 border border-navy-600 px-3 mb-2"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))}
        />
        <div className="text-xs text-slate-400 mb-2">
          Bestand {fmtNum(base.resources[resource] ?? 0)} · Tageslimit {fmtNum(sel.dailyUsed)}/{fmtNum(sel.dailyLimit)} · Gebühr {fmtNum(m.data.fee * 100)} %
        </div>
        {q && (
          <div className="text-sm rounded-lg bg-navy-900 p-2 mb-2">
            <div>Ausführungskurs {fmtNum(q.executionPrice, 4)} (Kurs danach {fmtNum(q.priceAfter, 4)})</div>
            <div>Kurswirkung {fmtNum(q.impact * 100, 2)} % · Gebühr {fmtNum(q.feeCredits, 2)} Kr</div>
            <div className="font-semibold">{side === "buy" ? "Kosten" : "Erlös"}: {fmtNum(q.totalCredits, 2)} Kr</div>
            {side === "buy" && <div className="text-xs text-slate-400">Lieferung per Konvoi aus {base.market.port.name}</div>}
          </div>
        )}
        {quote.data && !quote.data.ok && <ErrorLine text={errorText(quote.data.code)} />}
        <Button
          className="w-full"
          disabled={!q || exec.busy || halted || !base.market.unlocked}
          onClick={async () => {
            if (!q) return;
            setDone(null);
            const r = await exec.run({ side, resource, qty, expectedPrice: q.executionPrice });
            if (r?.ok) setDone(side === "buy" ? "Gekauft – die Ware ist unterwegs." : "Verkauft.");
          }}
        >
          {side === "buy" ? "Kaufen" : "Verkaufen"}
        </Button>
        {halted && <p className="text-sm text-brass-400 mt-2">{errorText("halted")}</p>}
        <ErrorLine text={exec.error} />
        {done && <p className="text-emerald-300 text-sm mt-2">{done}</p>}
      </Card>
    </div>
  );
}
