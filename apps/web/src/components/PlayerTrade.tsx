// Handel zwischen Spielern (Abschnitt der Börse): Angebote "gebe X, will Y" mit Treuhand, Annahme, Rückzug.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration } from "../lib/time.ts";
import { ActionBar, Badge, Button, Card, ErrorLine, Loading } from "../ui.tsx";
import { Icon } from "../icons.tsx";
import { DevTag, readerValue, usePrices, ValueLine, type Prices } from "./TradeValue.tsx";
import { EscortPicker } from "./Naval.tsx"; // See: Konvoi – Geleitschutz

type Offer = Outputs["playerTrade"]["list"]["open"][number];
type Res = { ok: boolean; code?: string };

const invalidate = () => [trpc.playerTrade.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.market.pathFilter().queryKey];

function Asset({ id, qty }: { id: string; qty: number }) {
  return <span className="inline-flex items-center gap-1 mono"><Icon id={id} size={18} />{fmtNum(qty)} <span className="font-sans text-ink2 text-xs">{label(id)}</span></span>;
}

export function PlayerTrade({ base }: { base: BaseData }) {
  const list = useQuery({ ...trpc.playerTrade.list.queryOptions(), refetchInterval: 60000 });
  const me = useQuery(trpc.alliance.get.queryOptions());
  const prices = usePrices();
  const [give, setGive] = useState("stahl");
  const [want, setWant] = useState("elektronik");
  const [giveQty, setGiveQty] = useState("1000");
  const [wantQty, setWantQty] = useState("300");
  const [visibility, setVisibility] = useState<"public" | "alliance">("public");
  const [done, setDone] = useState<string | null>(null);
  const create = useCommand((i: { key: string; give: string; giveQty: number; want: string; wantQty: number; visibility: "public" | "alliance" }) => trpcClient.playerTrade.create.mutate(i), invalidate);
  const accept = useCommand((i: { key: string; offerId: number; escort?: Record<string, number> }) => trpcClient.playerTrade.accept.mutate(i) as Promise<Res>, invalidate);
  const withdraw = useCommand((i: { key: string; offerId: number }) => trpcClient.playerTrade.withdraw.mutate(i) as Promise<Res>, invalidate);
  if (!list.data) return <Loading />;
  const { fee, assets, open, maxOpen } = list.data;
  const hasAlliance = !!me.data?.alliance;
  const ownOpen = open.filter((o) => o.own).length;
  const g = Math.floor(Number(giveQty) || 0);
  const w = Math.floor(Number(wantQty) || 0);
  const have = give === "credits" ? base.market.credits : base.resources[give] ?? 0;
  const unlocked = base.market.unlocked;

  return (
    <Card title={<><Icon id="transport" size={18} /> Handel mit Spielern</>} right={<span className="text-[11px] text-ink2">Gebühr {fmtNum(fee * 100, 1)} %</span>}>
      <h3 className="font-display text-[11px] uppercase text-ink2 mb-1.5">Angebot aufgeben</h3>
      <div className="grid grid-cols-[auto_1fr_6.5rem] gap-2 items-center mb-2 rounded-lg bg-inset border border-rule p-2">
        <span className="text-sm text-siegel font-display uppercase text-[11px] w-9">Gebe</span>
        <select aria-label="Gebe" className="h-11 rounded-lg field px-2" value={give} onChange={(e) => { setGive(e.target.value); if (e.target.value === want) setWant(assets.find((a) => a !== e.target.value)!); }}>
          {assets.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <input aria-label="Menge geben" inputMode="numeric" className="h-11 rounded-lg field px-2 mono text-right" value={giveQty} onChange={(e) => setGiveQty(e.target.value.replace(/\D/g, ""))} />
        <span className="text-sm text-moos font-display uppercase text-[11px] w-9">Will</span>
        <select aria-label="Will" className="h-11 rounded-lg field px-2" value={want} onChange={(e) => setWant(e.target.value)}>
          {assets.filter((a) => a !== give).map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <input aria-label="Menge wollen" inputMode="numeric" className="h-11 rounded-lg field px-2 mono text-right" value={wantQty} onChange={(e) => setWantQty(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex rounded-lg bg-navy-950/70 p-0.5 mb-2" role="radiogroup" aria-label="Für wen">
        {(["public", "alliance"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={visibility === v} disabled={v === "alliance" && !hasAlliance} onClick={() => setVisibility(v)}
            className={`tap flex-1 rounded-md text-sm font-semibold disabled:opacity-45 ${visibility === v ? "bg-ink text-paper" : "text-slate-400"}`}>
            {v === "public" ? "Für alle" : "Nur Allianz"}
          </button>
        ))}
      </div>
      {g > 0 && w > 0 && (
        <div className="mb-2 flex items-start gap-2">
          <DevTag v={readerValue(prices, give, g, want, w)} />
          <div className="flex-1 -mt-1"><ValueLine v={readerValue(prices, give, g, want, w)} /></div>
        </div>
      )}
      <p className="text-xs text-ink2 mb-2">
        Bestand {fmtNum(have, give === "credits" ? 2 : 0)} · offene Angebote {ownOpen}/{maxOpen}. Die Ware geht sofort in Treuhand; Rückzug erstattet sie.
        Ressourcen reisen per Konvoi (das Kartell fängt gelegentlich ab, Kriegsgegner gezielt), Kredite werden sofort gutgeschrieben.
      </p>
      {!unlocked && <p className="text-xs text-ink2 mt-2">Handel ab Hafenkommandantur Stufe 3.</p>}
      {/* Fixierte Aktionsleiste: Kurzfassung des Angebots und „Angebot einstellen“. */}
      <ActionBar>
        <ErrorLine text={create.error} />
        {done && <p className="text-moos text-sm mb-1">{done}</p>}
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm leading-tight">
            <span className="block text-[10.5px] font-display uppercase text-ink2">{visibility === "alliance" ? "Nur Allianz" : "Für alle"}</span>
            <span className="block truncate mono">{fmtNum(g)} {label(give)} → {fmtNum(w)} {label(want)}</span>
          </span>
          <Button className="shrink-0 px-3" disabled={!unlocked || create.busy || g < 1 || w < 1 || g > have || ownOpen >= maxOpen}
            onClick={async () => {
              setDone(null);
              const r = await create.run({ give, giveQty: g, want, wantQty: w, visibility });
              if (r?.ok) setDone("Angebot eingestellt.");
            }}>
            Angebot einstellen
          </Button>
        </div>
      </ActionBar>

      <div className="flex items-baseline justify-between mt-5 mb-1 border-b-[3px] border-double border-ink pb-1">
        <h3 className="font-display text-[11px] uppercase text-ink">Angebote ({open.length})</h3>
        <span className="text-[10.5px] text-ink2">Wert ggü. Börse für dich</span>
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-ink2 py-3 text-center font-serif italic">Keine offenen Angebote – stelle das erste ein.</p>
      ) : (
        <ul>
          {open.map((o) => <OfferRow key={o.id} o={o} fee={fee} base={base} prices={prices} busy={accept.busy || withdraw.busy}
            onAccept={(escort) => void accept.run({ offerId: o.id, ...(escort ? { escort } : {}) })} onWithdraw={() => void withdraw.run({ offerId: o.id })} />)}
        </ul>
      )}
      <ErrorLine text={accept.error ?? withdraw.error} />
    </Card>
  );
}

function OfferRow({ o, fee, base, prices, busy, onAccept, onWithdraw }: { o: Offer; fee: number; base: BaseData; prices: Prices | null; busy: boolean; onAccept: (escort?: Record<string, number>) => void; onWithdraw: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [escort, setEscort] = useState<Record<string, number>>({}); // See: Konvoi – Geleitschutz
  // Aus Sicht des Lesers: beim eigenen Angebot gibt er give, sonst gibt er want und bekommt give.
  const v = o.own ? readerValue(prices, o.give, o.giveQty, o.want, o.wantQty) : readerValue(prices, o.want, o.wantQty, o.give, o.giveQty);
  const have = o.want === "credits" ? base.market.credits : base.resources[o.want] ?? 0;
  const net = o.give === "credits" ? Math.floor(o.giveQty * (1 - fee) * 100) / 100 : o.giveQty - Math.floor(o.giveQty * fee);
  return (
    <li className={`py-2.5 pl-2.5 dotted-row border-l-[3px] ${o.own ? "border-l-see" : v?.strong ? (v.pct < 0 ? "border-l-siegel" : "border-l-messing") : "border-l-rule"}`}>
      <div className="flex items-center gap-2 text-sm">
        <strong className="min-w-0 flex-1 truncate">{o.own ? "Dein Angebot" : <>{o.seller.tag && <span className="mono text-ink2 font-normal">[{o.seller.tag}] </span>}{o.seller.name}</>}</strong>
        {o.visibility === "alliance" && <Badge tone="green">Allianz</Badge>}
        <DevTag v={v} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-sm mt-1.5 rounded bg-[#fffdf8] border border-rule px-2 py-1.5">
        <span className="min-w-0"><span className="block text-ink2 text-[10.5px] font-display uppercase">{o.own ? "du gibst" : "du bekommst"}</span><Asset id={o.give} qty={o.giveQty} /></span>
        <span className="text-ink2" aria-hidden="true">⇄</span>
        <span className="min-w-0 text-right"><span className="block text-ink2 text-[10.5px] font-display uppercase">{o.own ? "du willst" : "du zahlst"}</span><Asset id={o.want} qty={o.wantQty} /></span>
      </div>
      {!confirm && <ValueLine v={v} />}
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-xs text-ink2">
          {o.own ? "Wartet auf Annahme." : `Du erhältst ${fmtNum(net, o.give === "credits" ? 2 : 0)}${o.give === "credits" ? " sofort" : o.travelMs ? ` in ${fmtDuration(o.travelMs)}` : ""}.`}
        </span>
        {o.own ? (
          <Button kind="secondary" disabled={busy} onClick={onWithdraw}>Zurückziehen</Button>
        ) : (
          !confirm && <Button disabled={busy || !base.market.unlocked || have < o.wantQty} onClick={() => setConfirm(true)}>Annehmen</Button>
        )}
      </div>
      {confirm && !o.own && (
        <div className={`mt-2 rounded-lg border p-2 ${v?.strong ? "border-siegel" : "border-rule"}`} role="group" aria-label="Annahme bestätigen">
          <div className="text-sm">Du zahlst sofort <strong className="mono">{fmtNum(o.wantQty, o.want === "credits" ? 2 : 0)}</strong> {label(o.want)} und erhältst <strong className="mono">{fmtNum(net, o.give === "credits" ? 2 : 0)}</strong> {label(o.give)} (nach Gebühr).</div>
          <ValueLine v={v} />
          {o.give !== "credits" && <EscortPicker base={base} value={escort} onChange={setEscort} />}
          {v?.strong && <p className="text-sm text-siegel font-semibold mt-1">Dieses Angebot weicht um mehr als 20 % vom Börsenwert ab. Wirklich annehmen?</p>}
          <div className="flex gap-2 mt-2">
            <Button kind="secondary" className="flex-1" onClick={() => setConfirm(false)}>Abbrechen</Button>
            <Button kind={v?.strong ? "danger" : "primary"} className="flex-1" disabled={busy || !base.market.unlocked || have < o.wantQty}
              onClick={() => { setConfirm(false); const e = Object.fromEntries(Object.entries(escort).filter(([, n]) => n > 0)); onAccept(Object.keys(e).length > 0 ? e : undefined); }}>
              {v?.strong ? "Trotzdem annehmen" : "Annehmen bestätigen"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
