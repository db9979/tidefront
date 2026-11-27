// Reiter „Verträge“: Angebote der KI-Spieler (Reederei Albers, Bastion Falkenberg, Kapitän Rotbart …) mit Kontingent,
// Laufzeit, Menge, Preis im Vergleich zur Börse, Anzahlung bzw. Pfand und Fälligkeit; Rotbart liefert per Konvoi.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { errorText, fmtNum, label } from "../../lib/names.ts";
import { fmtDuration, useNow } from "../../lib/time.ts";
import { Button, Card, ErrorLine } from "../../ui.tsx";
import { Icon } from "../../icons.tsx";
import { EscortPicker } from "../Naval.tsx";
import { ContractEscortAdvice } from "../EscortAdvice.tsx"; // See: Empfohlenes Geleit je Frachtwert
import { when } from "./calc.ts";
import { contractsInvalidate, kr, type ContractsData } from "./Contracts.tsx";

type Ki = ContractsData["kis"][number];
type Offer = Ki["offers"][number];
type Res = { ok: boolean; code?: string };

const CHARACTER: Record<string, string> = {
  haendler: "Vollsortiment, auch Abos.",
  festung: "Kauft Rüstungsgüter (Stahl, Elektronik) – Abschlag 2 Punkte kleiner.",
  freibeuter: "Verkauft Prisen (Treibstoff, Elektronik) 2 Punkte billiger, nur 1–2 Tage, per Konvoi.",
};

export function KiOffers({ base, data }: { base: BaseData; data: ContractsData }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title={<><Icon id="transport" size={18} /> Angebote der KI-Spieler</>}>
      {data.kis.length === 0 ? (
        <p className="text-sm text-ink2">In dieser Runde gibt es keine KI-Spieler – also keine KI-Verträge. Verträge mit Spielern gehen trotzdem.</p>
      ) : data.kis.map((k) => (
        <section key={k.id} className="mb-3 last:mb-0 rounded-lg border border-rule p-2" aria-label={k.name}>
          <div className="flex items-baseline gap-2">
            <strong className="font-serif text-[16px]">{k.name}</strong>
            <span className="text-[11px] text-ink2 uppercase font-display">{k.profileText}</span>
          </div>
          <p className="text-xs text-ink2">{CHARACTER[k.profile] ?? ""}</p>
          {k.refused && <p className="text-xs text-siegel mt-1">Nach deinem Überfall schließt {k.name} 24 Stunden lang nichts mit dir ab.</p>}
          <ul className="mt-1">
            {k.offers.map((o) => {
              const id = `${k.id}-${o.side}-${o.resource}`;
              return (
                <li key={id} className="dotted-row py-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Icon id={o.resource} size={18} />
                    <span className="flex-1 min-w-0">{o.side === "buy" ? "Du kaufst" : "Du lieferst"} {label(o.resource)}
                      <span className="text-ink2 text-xs"> · Kontingent {o.quota > 0 ? `bis ${fmtNum(o.quota)}` : "erschöpft"}</span></span>
                    <Button kind="secondary" disabled={o.quota < data.cfg.minQty || !base.market.unlocked} onClick={() => setOpen(open === id ? null : id)}>
                      {open === id ? "Schließen" : "Angebot"}
                    </Button>
                  </div>
                  {open === id && <DealForm base={base} ki={k} offer={o} minQty={data.cfg.minQty} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Card>
  );
}

function DealForm({ base, ki, offer, minQty }: { base: BaseData; ki: Ki; offer: Offer; minQty: number }) {
  const now = useNow(30000);
  const [qtyText, setQtyText] = useState(String(Math.min(offer.quota, Math.max(minQty, 1000))));
  const [abo, setAbo] = useState(false);
  const daysList = abo ? ki.aboDays : ki.days;
  const [daysPick, setDays] = useState<number | null>(null);
  const days = daysPick !== null && daysList.includes(daysPick) ? daysPick : daysList[0] ?? null;
  const [escort, setEscort] = useState<Record<string, number>>({});
  const [done, setDone] = useState<string | null>(null);
  const qty = Math.floor(Number(qtyText) || 0);
  const input = { kiId: ki.id, side: offer.side, resource: offer.resource, qty, days: days ?? 1, abo };
  const quote = useQuery({ ...trpc.contracts.quote.queryOptions(input), enabled: qty >= minQty && days !== null, refetchInterval: 30000 });
  const sign = useCommand((i: typeof input & { key: string; expectedPrice: number; escort?: Record<string, number> }) => trpcClient.contracts.signKi.mutate(i) as Promise<Res>, contractsInvalidate);
  const q = quote.data && quote.data.ok ? quote.data : null;
  const buy = offer.side === "buy";
  return (
    <div className="mt-2 rounded-lg bg-inset border border-rule p-2" role="group" aria-label={`Vertrag ${ki.name} ${label(offer.resource)}`}>
      {days === null ? (
        <p className="text-sm text-ink2">Keine Laufzeit mehr möglich: Fälligkeit spätestens 24 Stunden vor Saisonende.</p>
      ) : <>
        <div className="grid grid-cols-[auto_1fr] gap-2 items-center text-sm">
          <label htmlFor={`qty-${ki.id}`} className="text-[11px] font-display uppercase text-ink2">{abo ? "Menge je Tag" : "Menge"}</label>
          <input id={`qty-${ki.id}`} aria-label="Vertragsmenge" inputMode="numeric" className="h-11 rounded-lg field px-2 mono text-right"
            value={qtyText} onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))} />
          <span className="text-[11px] font-display uppercase text-ink2">{abo ? "Tage" : "Laufzeit"}</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Laufzeit">
            {daysList.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={d === days} onClick={() => setDays(d)}
                className={`tap rounded-md px-2.5 text-sm ${d === days ? "bg-ink text-paper" : "border border-ink/50"}`}>{d} {d === 1 ? "Tag" : "Tage"}</button>
            ))}
          </div>
        </div>
        {ki.aboDays.length > 0 && (
          <label className="flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={abo} onChange={(e) => setAbo(e.target.checked)} /> Abo: täglich liefern, erste Tranche nach 24 h
          </label>
        )}
        {qty > 0 && qty < minQty && <p className="text-xs text-messing mt-1">Mindestens {fmtNum(minQty)} je Vertrag bzw. Tranche.</p>}
        {quote.data && !quote.data.ok && <ErrorLine text={errorText(quote.data.code)} code={quote.data.code} />}
        {q && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm mt-2" data-testid="contract-quote">
            <dt className="text-ink2">Preis je Einheit</dt><dd className="mono text-right">{fmtNum(q.avgPrice, 3)}{abo ? " (Durchschnitt)" : ""}</dd>
            <dt className="text-ink2">an der Börse jetzt</dt><dd className="mono text-right">{q.instantPrice !== null ? fmtNum(q.instantPrice, 3) : "–"}</dd>
            <dt className="text-ink2">{buy ? "Gesamtpreis" : "Erlös"}</dt><dd className="mono text-right">{kr(q.totalCredits)}</dd>
            <dt className="text-ink2">{buy ? "Anzahlung jetzt" : "Pfand jetzt"}</dt><dd className="mono text-right">{kr(q.securityCredits)}</dd>
            <dt className="text-ink2">Fällig</dt>
            <dd className="text-right">{q.tranches.length > 1 ? `${q.tranches.length} Tranchen, erste ${when(q.tranches[0].dueMs, now)} Uhr` : `${when(q.tranches[0].dueMs, now)} Uhr`}</dd>
          </dl>
        )}
        {q && !q.fits && <p className="text-xs text-siegel mt-1">Das Kontingent reicht dafür nicht (bis {fmtNum(q.quota)}).</p>}
        {q && q.delivery === "konvoi" && <>
          <p className="text-xs text-ink2 mt-1">
            Lieferung per Konvoi über die Seewege (Fahrzeit {fmtDuration(q.travelMs)}): das Kartell fängt gelegentlich ab, Kriegsgegner gezielt. Den Verlust trägst du – dafür ist der Preis 2 Punkte billiger.
          </p>
          {buy && <EscortPicker base={base} value={escort} onChange={setEscort} hint="Die Schiffe laufen bei Abfahrt des Konvois aus, wenn sie dann im Hafen sind (Treibstoff, ein Missionsplatz)." />}
          {buy && <ContractEscortAdvice base={base} resource={offer.resource} qty={qty} travelMs={q.travelMs} escort={escort} onApply={setEscort} />}
        </>}
        <p className="text-xs text-ink2 mt-1">{buy ? "Der Rest wird bei Fälligkeit automatisch abgebucht." : "Die Ware bleibt bis zur Fälligkeit in deinem Hafen und wird dann abgebucht."}</p>
        {done && <p className="text-moos text-sm mt-1 font-semibold" role="status">{done}</p>}
        <div className="flex justify-end mt-2">
          <Button disabled={!q || !q.fits || sign.busy || q.halted} onClick={async () => {
            if (!q) return;
            setDone(null);
            const e = Object.fromEntries(Object.entries(escort).filter(([, n]) => n > 0));
            const r = await sign.run({ ...input, expectedPrice: q.avgPrice, ...(Object.keys(e).length > 0 ? { escort: e } : {}) });
            if (r?.ok) setDone("Vertrag abgeschlossen – siehe „Meine Verträge“.");
          }}>Vertrag abschließen</Button>
        </div>
        <ErrorLine text={sign.error} code={sign.code} />
      </>}
    </div>
  );
}
