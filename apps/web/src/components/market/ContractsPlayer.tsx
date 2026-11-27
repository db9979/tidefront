// Reiter „Verträge“: Verträge zwischen Spielern – offene Angebote annehmen und selbst einen Vertrag anbieten (an alle
// oder an einen Spieler). Preisband um Kurs und erwarteten Kurs, Lieferung per Konvoi, Paarbremse.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { useNow } from "../../lib/time.ts";
import { Badge, Button, Card, ErrorLine } from "../../ui.tsx";
import { Icon } from "../../icons.tsx";
import { EscortPicker } from "../Naval.tsx";
import { ContractEscortAdvice } from "../EscortAdvice.tsx"; // See: Empfohlenes Geleit je Frachtwert
import { when } from "./calc.ts";
import { contractsInvalidate, kr, type ContractsData } from "./Contracts.tsx";

type Proposal = ContractsData["proposals"][number];
type Res = { ok: boolean; code?: string };

export function PlayerContracts({ base, data }: { base: BaseData; data: ContractsData }) {
  const now = useNow(30000);
  const accept = useCommand((i: { key: string; contractId: number; escort?: Record<string, number> }) => trpcClient.contracts.accept.mutate(i) as Promise<Res>, contractsInvalidate);
  return (
    <Card title={<><Icon id="transport" size={18} /> Verträge mit Spielern</>}>
      <p className="text-xs text-ink2 mb-2">
        Preis höchstens {fmtNum(data.cfg.band * 100)} % neben Kurs bzw. erwartetem Kurs. Die Ware fährt per Konvoi über die Seewege (abfangbar,
        Geleit möglich). {fmtNum(data.cfg.baseFee * 100)} % des Preises und alle Strafen gehen in den Gebührentopf, nie an den Partner.
        Je Spielerpaar höchstens {fmtNum(data.cfg.pairWeekValue)} Taler Börsenwert in 7 Tagen. Verbundene Spieler (Allianz, Pakt, Handel in den
        letzten 7 Tagen) dürfen, der Vertrag zählt dann aber nicht für Erfolge und Tagesbefehle.
      </p>
      <h3 className="font-display text-[11px] uppercase text-ink2 mb-1">Angebote ({data.proposals.length})</h3>
      {data.proposals.length === 0 ? (
        <p className="text-sm text-ink2 py-2 text-center font-serif italic">Keine offenen Vertragsangebote.</p>
      ) : (
        <ul aria-label="Vertragsangebote von Spielern">
          {data.proposals.map((p) => <ProposalRow key={p.id} p={p} base={base} now={now} busy={accept.busy}
            onAccept={(escort) => void accept.run({ contractId: p.id, ...(escort ? { escort } : {}) })} />)}
        </ul>
      )}
      <ErrorLine text={accept.error} code={accept.code} />
      <ProposeForm base={base} data={data} />
    </Card>
  );
}

function ProposalRow({ p, base, now, busy, onAccept }: { p: Proposal; base: BaseData; now: number; busy: boolean; onAccept: (escort?: Record<string, number>) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [escort, setEscort] = useState<Record<string, number>>({});
  return (
    <li className="py-2 dotted-row">
      <div className="flex items-center gap-2 text-sm">
        <Icon id={p.resource} size={18} />
        <strong className="flex-1 min-w-0 truncate">{p.from}: {p.side === "buy" ? "liefert dir" : "kauft von dir"} {fmtNum(p.qty)} {label(p.resource)}</strong>
        {p.personal && <Badge tone="sea">an dich</Badge>}
      </div>
      <div className="text-xs text-ink2 mt-0.5 flex flex-wrap gap-x-3">
        <span className="mono">{fmtNum(p.unitPrice, 3)} je Einheit · {kr(p.totalCredits)}</span>
        <span>fällig {when(p.dueAtMs, now)} Uhr</span>
        <span>{p.side === "buy" ? "Anzahlung" : "Pfand"} {kr(p.securityCredits)}</span>
        {!p.inBand && <span className="text-siegel">Preis außerhalb des Bands – nicht mehr annehmbar</span>}
      </div>
      {!confirm ? (
        <div className="flex justify-end mt-1">
          <Button disabled={busy || !p.inBand || !base.market.unlocked} onClick={() => setConfirm(true)}>Annehmen</Button>
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-rule p-2" role="group" aria-label="Vertrag annehmen">
          <p className="text-sm">Du {p.side === "buy" ? "zahlst" : "hinterlegst als Pfand"} jetzt <strong className="mono">{kr(p.securityCredits)}</strong>;
            {p.side === "buy" ? " der Rest wird bei Fälligkeit abgebucht." : " die Ware wird bei Abfahrt des Konvois aus deinem Hafen abgebucht."}</p>
          {p.side === "buy" && <EscortPicker base={base} value={escort} onChange={setEscort} hint="Die Schiffe laufen bei Abfahrt des Konvois aus, wenn sie dann im Hafen sind." />}
          {p.side === "buy" && <ContractEscortAdvice base={base} resource={p.resource} qty={p.qty} escort={escort} onApply={setEscort} />}
          <div className="flex gap-2 mt-2">
            <Button kind="secondary" className="flex-1" onClick={() => setConfirm(false)}>Abbrechen</Button>
            <Button className="flex-1" disabled={busy} onClick={() => {
              setConfirm(false);
              const e = Object.fromEntries(Object.entries(escort).filter(([, n]) => n > 0));
              onAccept(Object.keys(e).length > 0 ? e : undefined);
            }}>Annahme bestätigen</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function ProposeForm({ base, data }: { base: BaseData; data: ContractsData }) {
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [resource, setResource] = useState(data.resources[0] ?? "stahl");
  const [qtyText, setQtyText] = useState(String(Math.max(data.cfg.minQty, 1000)));
  const [days, setDays] = useState<number | null>(null);
  const [priceText, setPriceText] = useState("");
  const [target, setTarget] = useState("");
  const [escort, setEscort] = useState<Record<string, number>>({});
  const [done, setDone] = useState<string | null>(null);
  const d = days !== null && data.cfg.days.includes(days) ? days : data.cfg.days[0] ?? null;
  const band = useQuery({ ...trpc.contracts.band.queryOptions({ resource, days: d ?? 1 }), enabled: d !== null });
  const b = band.data && band.data.ok ? band.data : null;
  const propose = useCommand((i: { key: string; side: "buy" | "sell"; resource: string; qty: number; days: number; price: number; target?: string | null; escort?: Record<string, number> }) =>
    trpcClient.contracts.propose.mutate(i) as Promise<Res>, contractsInvalidate);
  const qty = Math.floor(Number(qtyText) || 0);
  const price = priceText.trim() === "" ? (b?.course ?? 0) : Number(priceText.replace(",", "."));
  const okPrice = b !== null && price >= b.min - 1e-9 && price <= b.max + 1e-9;
  if (d === null) return <p className="text-xs text-ink2 mt-3">Neue Verträge sind erst wieder in der nächsten Saison möglich (Fälligkeit spätestens 24 h vor Saisonende).</p>;
  return (
    <div className="mt-4 rounded-lg bg-inset border border-rule p-2" role="group" aria-label="Vertrag anbieten">
      <h3 className="font-display text-[11px] uppercase text-ink2 mb-1.5">Vertrag anbieten</h3>
      <div className="flex rounded-lg bg-navy-950/70 p-0.5 mb-2" role="radiogroup" aria-label="Richtung">
        {(["sell", "buy"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={side === v} onClick={() => setSide(v)}
            className={`tap flex-1 rounded-md text-sm font-semibold ${side === v ? "bg-ink text-paper" : "text-slate-400"}`}>{v === "sell" ? "Ich liefere" : "Ich kaufe"}</button>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 items-center text-sm">
        <span className="text-[11px] font-display uppercase text-ink2">Ressource</span>
        <select aria-label="Vertragsressource" className="h-11 rounded-lg field px-2" value={resource} onChange={(e) => { setResource(e.target.value); setPriceText(""); }}>
          {data.resources.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
        <span className="text-[11px] font-display uppercase text-ink2">Menge</span>
        <input aria-label="Angebotsmenge" inputMode="numeric" className="h-11 rounded-lg field px-2 mono text-right" value={qtyText} onChange={(e) => setQtyText(e.target.value.replace(/\D/g, ""))} />
        <span className="text-[11px] font-display uppercase text-ink2">Laufzeit</span>
        <select aria-label="Angebotslaufzeit" className="h-11 rounded-lg field px-2" value={d} onChange={(e) => setDays(Number(e.target.value))}>
          {data.cfg.days.map((x) => <option key={x} value={x}>{x} {x === 1 ? "Tag" : "Tage"}</option>)}
        </select>
        <span className="text-[11px] font-display uppercase text-ink2">Preis</span>
        <input aria-label="Preis je Einheit" inputMode="decimal" className="h-11 rounded-lg field px-2 mono text-right" placeholder={b ? fmtNum(b.course, 3) : ""}
          value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/[^\d.,]/g, ""))} />
        <span className="text-[11px] font-display uppercase text-ink2">An</span>
        <input aria-label="An Spieler (leer: alle)" className="h-11 rounded-lg field px-2" placeholder="alle" value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      {b && <p className={`text-xs mt-1 ${okPrice ? "text-ink2" : "text-siegel"}`}>Erlaubt: {fmtNum(b.min, 3)} bis {fmtNum(b.max, 3)} je Einheit (Kurs {fmtNum(b.course, 3)}).
        {side === "sell" ? ` Du bekommst ${fmtNum(price * (1 - b.fee), 3)} nach ${fmtNum(b.fee * 100)} % Grundaufschlag.` : ""}</p>}
      {side === "buy" && <EscortPicker base={base} value={escort} onChange={setEscort} hint="Die Schiffe laufen bei Abfahrt des Konvois aus, wenn sie dann im Hafen sind." />}
      {side === "buy" && qty > 0 && <ContractEscortAdvice base={base} resource={resource} qty={qty} escort={escort} onApply={setEscort} />}
      <p className="text-xs text-ink2 mt-1">Deine {side === "buy" ? "Anzahlung" : "Pfand"} ({fmtNum(data.cfg.depositShare * 100)} %) geht sofort in Treuhand; das Angebot gilt {data.cfg.offerHours} Stunden.</p>
      {done && <p className="text-moos text-sm mt-1 font-semibold" role="status">{done}</p>}
      <div className="flex justify-end mt-2">
        <Button disabled={!okPrice || qty < data.cfg.minQty || propose.busy || !base.market.unlocked} onClick={async () => {
          setDone(null);
          const e = Object.fromEntries(Object.entries(escort).filter(([, n]) => n > 0));
          const r = await propose.run({ side, resource, qty, days: d, price, target: target.trim() || null, ...(side === "buy" && Object.keys(e).length > 0 ? { escort: e } : {}) });
          if (r?.ok) setDone("Vertrag angeboten.");
        }}>Vertrag anbieten</Button>
      </div>
      <ErrorLine text={propose.error} code={propose.code} />
    </div>
  );
}
