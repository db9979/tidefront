// Handel zwischen Spielern (Abschnitt der Börse): Angebote "gebe X, will Y" mit Treuhand, Annahme, Rückzug.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Outputs } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration } from "../lib/time.ts";
import { Badge, Button, Card, ErrorLine, Loading } from "../ui.tsx";
import { Icon } from "../icons.tsx";

type Offer = Outputs["playerTrade"]["list"]["open"][number];
type Res = { ok: boolean; code?: string };

const invalidate = () => [trpc.playerTrade.pathFilter().queryKey, trpc.base.pathFilter().queryKey, trpc.market.pathFilter().queryKey];

function Asset({ id, qty }: { id: string; qty: number }) {
  return <span className="inline-flex items-center gap-1 mono"><Icon id={id} size={18} />{fmtNum(qty)} <span className="font-sans text-ink2 text-xs">{label(id)}</span></span>;
}

export function PlayerTrade({ base }: { base: BaseData }) {
  const list = useQuery({ ...trpc.playerTrade.list.queryOptions(), refetchInterval: 60000 });
  const me = useQuery(trpc.alliance.get.queryOptions());
  const [give, setGive] = useState("stahl");
  const [want, setWant] = useState("elektronik");
  const [giveQty, setGiveQty] = useState("1000");
  const [wantQty, setWantQty] = useState("300");
  const [visibility, setVisibility] = useState<"public" | "alliance">("public");
  const [done, setDone] = useState<string | null>(null);
  const create = useCommand((i: { key: string; give: string; giveQty: number; want: string; wantQty: number; visibility: "public" | "alliance" }) => trpcClient.playerTrade.create.mutate(i), invalidate);
  const accept = useCommand((i: { key: string; offerId: number }) => trpcClient.playerTrade.accept.mutate(i) as Promise<Res>, invalidate);
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
      <div className="grid grid-cols-[auto_1fr_6.5rem] gap-2 items-center mb-2">
        <span className="text-sm text-ink2">Gebe</span>
        <select aria-label="Gebe" className="h-11 rounded-lg field px-2" value={give} onChange={(e) => { setGive(e.target.value); if (e.target.value === want) setWant(assets.find((a) => a !== e.target.value)!); }}>
          {assets.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
        <input aria-label="Menge geben" inputMode="numeric" className="h-11 rounded-lg field px-2 mono text-right" value={giveQty} onChange={(e) => setGiveQty(e.target.value.replace(/\D/g, ""))} />
        <span className="text-sm text-ink2">Will</span>
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
      <p className="text-xs text-ink2 mb-2">
        Bestand {fmtNum(have, give === "credits" ? 2 : 0)} · offene Angebote {ownOpen}/{maxOpen}. Die Ware geht sofort in Treuhand; Rückzug erstattet sie.
        Ressourcen reisen per Konvoi, Kredite werden sofort gutgeschrieben.
      </p>
      <Button className="w-full" disabled={!unlocked || create.busy || g < 1 || w < 1 || g > have || ownOpen >= maxOpen}
        onClick={async () => {
          setDone(null);
          const r = await create.run({ give, giveQty: g, want, wantQty: w, visibility });
          if (r?.ok) setDone("Angebot eingestellt.");
        }}>
        Angebot einstellen
      </Button>
      {!unlocked && <p className="text-xs text-ink2 mt-2">Handel ab Hafenkommandantur Stufe 3.</p>}
      <ErrorLine text={create.error} />
      {done && <p className="text-moos text-sm mt-2">{done}</p>}

      <h3 className="font-display text-[11px] uppercase text-ink2 tracking-[0.16em] mt-4 mb-1">Angebote ({open.length})</h3>
      {open.length === 0 ? <p className="text-sm text-ink2">Keine offenen Angebote.</p> : (
        <ul className="divide-y divide-navy-700">
          {open.map((o) => <OfferRow key={o.id} o={o} fee={fee} base={base} busy={accept.busy || withdraw.busy}
            onAccept={() => void accept.run({ offerId: o.id })} onWithdraw={() => void withdraw.run({ offerId: o.id })} />)}
        </ul>
      )}
      <ErrorLine text={accept.error ?? withdraw.error} />
    </Card>
  );
}

function OfferRow({ o, fee, base, busy, onAccept, onWithdraw }: { o: Offer; fee: number; base: BaseData; busy: boolean; onAccept: () => void; onWithdraw: () => void }) {
  const have = o.want === "credits" ? base.market.credits : base.resources[o.want] ?? 0;
  const net = o.give === "credits" ? Math.floor(o.giveQty * (1 - fee) * 100) / 100 : o.giveQty - Math.floor(o.giveQty * fee);
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 text-sm">
        <strong className="min-w-0 flex-1 truncate">{o.own ? "Dein Angebot" : <>{o.seller.tag && <span className="mono text-ink2 font-normal">[{o.seller.tag}] </span>}{o.seller.name}</>}</strong>
        {o.visibility === "alliance" && <Badge tone="green">Allianz</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mt-1">
        <span className="text-ink2 text-xs">gibt</span><Asset id={o.give} qty={o.giveQty} />
        <span className="text-ink2 text-xs">für</span><Asset id={o.want} qty={o.wantQty} />
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-xs text-ink2">
          {o.own ? "Wartet auf Annahme." : `Du erhältst ${fmtNum(net, o.give === "credits" ? 2 : 0)}${o.give === "credits" ? " sofort" : o.travelMs ? ` in ${fmtDuration(o.travelMs)}` : ""}.`}
        </span>
        {o.own ? (
          <Button kind="secondary" disabled={busy} onClick={onWithdraw}>Zurückziehen</Button>
        ) : (
          <Button disabled={busy || !base.market.unlocked || have < o.wantQty} onClick={onAccept}>Annehmen</Button>
        )}
      </div>
    </li>
  );
}
