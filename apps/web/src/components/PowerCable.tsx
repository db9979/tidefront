// Seekabel verwalten (v1.21), unter Basis → Versorgung: bestehendes Kabel (Summen, Puffer, Preis, trennen),
// Anfrage annehmen oder ablehnen, neues Kabel zu einem eigenen Hafen oder einem Allianzmitglied in Reichweite legen.
// Nur Knöpfe, keine unterstrichenen Aktionslinks; schmal genug für 390 px.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Button, ErrorLine } from "../ui.tsx";

type View = NonNullable<ReturnType<typeof useCables>["data"]>;
type Cable = View["cables"][number];

function useCables() {
  return useQuery({ ...trpc.power.cables.queryOptions(), refetchInterval: 60000 });
}

const invalidate = () => [trpc.power.cables.pathFilter().queryKey, trpc.base.pathFilter().queryKey];
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Preis-Eingabe (Taler je Strom-Stunde, Komma oder Punkt). */
function parsePrice(text: string): number {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function PowerCable({ baseId }: { baseId: number }) {
  const q = useCables();
  const v = q.data;
  const [price, setPrice] = useState("0");
  const offer = useCommand((i: { key: string; fromBaseId: number; toBaseId: number; price: number }) => trpcClient.power.offer.mutate(i), invalidate);
  if (!v || !v.enabled) return null;
  if (v.station < 1 && v.cables.length === 0) {
    return (
      <p className="text-xs text-ink2" data-testid="seekabel-hinweis">
        Seekabel: Mit dem Gebäude Seekabel gibst du Ökostrom-Überschuss an einen eigenen Hafen oder ein Allianzmitglied ab
        (bis {fmtNum(v.maxKm)} km, {pct(v.lossPer100Km)} Verlust je 100 km).
      </p>
    );
  }
  const p = parsePrice(price);
  const priceOk = Number.isFinite(p) && p >= 0 && p <= v.maxPrice;
  return (
    <section className="space-y-2" data-testid="seekabel">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-ink2 font-display"><Icon id="seekabel" size={18} /> Seekabel</div>
      {v.cables.map((c) => <CableCard key={c.id} c={c} maxPrice={v.maxPrice} tickMinutes={v.tickMinutes} />)}
      {v.cables.length === 0 && (
        <div className="space-y-1">
          {v.candidates.length === 0 ? (
            <p className="text-xs text-ink2">Kein eigener Hafen und kein Allianzmitglied in {fmtNum(v.maxKm)} km Reichweite.</p>
          ) : (
            <>
              <p className="text-xs text-ink2">
                Dieser Hafen gibt seinen Ökostrom-Überschuss ab (nach der Elektrolyse, bis {fmtNum(v.capacity)} Strom/h). Die Gegenseite braucht eine eigene Station.
              </p>
              {v.candidates.some((c) => !c.own) && (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-ink2">Preis für Allianzmitglieder (Taler je Strom-Stunde, 0 = Allianzhilfe)</span>
                  <input aria-label="Preis je Strom-Stunde" inputMode="decimal" className="h-11 w-20 rounded-lg field px-2 mono text-right" value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              )}
              <ul className="space-y-1">
                {v.candidates.map((c) => (
                  <li key={c.baseId} className="flex items-center gap-2 rounded-lg border border-rule bg-paper px-2 py-1">
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="truncate font-semibold">{c.name}{c.own ? "" : ` · ${c.player}`}</div>
                      <div className="text-ink2 mono">{fmtNum(c.distanceKm)} km · kommt an {pct(Math.max(0, 1 - (v.lossPer100Km * c.distanceKm) / 100))}{c.station < 1 ? " · ohne Station" : ""}{c.busy ? " · belegt" : ""}</div>
                    </div>
                    <Button kind="secondary" disabled={offer.busy || c.busy || c.station < 1 || (!c.own && !priceOk)}
                      onClick={() => void offer.run({ fromBaseId: baseId, toBaseId: c.baseId, price: c.own ? 0 : p })}>
                      {c.own ? "Kabel legen" : "Anbieten"}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <ErrorLine text={offer.error} code={offer.code} />
        </div>
      )}
    </section>
  );
}

function CableCard({ c, maxPrice, tickMinutes }: { c: Cable; maxPrice: number; tickMinutes: number }) {
  const [price, setPrice] = useState(String(c.price).replace(".", ","));
  const cut = useCommand((i: { key: string; cableId: number }) => trpcClient.power.cut.mutate(i), invalidate);
  const accept = useCommand((i: { key: string; cableId: number }) => trpcClient.power.accept.mutate(i), invalidate);
  const setP = useCommand((i: { key: string; cableId: number; price: number }) => trpcClient.power.price.mutate(i), invalidate);
  const partner = c.partner ? `${c.partner.name}${c.partner.own ? "" : ` (${c.partner.player})`}` : "unbekannter Hafen";
  const p = parsePrice(price);
  const priceText = c.ownPair ? "eigene Häfen" : c.price > 0 ? `${fmtNum(c.price, 2)} Taler je Strom-Stunde` : "Allianzhilfe (kostenlos)";
  return (
    <div className="rounded-lg border border-rule bg-paper p-2 text-xs space-y-1" data-testid="seekabel-kabel">
      <div className="font-semibold">{c.role === "out" ? "Gibt Strom ab an" : "Bezieht Strom von"} {partner}</div>
      <div className="text-ink2 mono">{fmtNum(c.distanceKm)} km · kommt an {pct(c.arrives)} · {priceText}</div>
      {c.status === "angefragt" ? (
        <>
          <p>{c.offeredByMe ? "Wartet auf Zustimmung der Gegenseite." : "Angebot: Dieser Hafen würde Strom über das Kabel beziehen."}</p>
          <div className="flex gap-2">
            {!c.offeredByMe && <Button disabled={accept.busy} onClick={() => void accept.run({ cableId: c.id })}>Annehmen</Button>}
            <Button kind="secondary" disabled={cut.busy} onClick={() => void cut.run({ cableId: c.id })}>{c.offeredByMe ? "Zurückziehen" : "Ablehnen"}</Button>
          </div>
        </>
      ) : (
        <>
          {c.sabotaged && <p className="text-siegel font-semibold">Sabotage: Das Kabel ist unterbrochen – gesendeter Strom geht verloren.</p>}
          <div className="grid grid-cols-[1fr_auto] gap-x-3">
            <span className="text-ink2">Angekommen</span><span className="mono text-right">{fmtNum(c.delivered)}</span>
            <span className="text-ink2">Verloren oder verfallen</span><span className="mono text-right">{fmtNum(c.lost)}</span>
            {!c.ownPair && <><span className="text-ink2">Bezahlt</span><span className="mono text-right">{fmtNum(c.paid, 2)} Taler</span></>}
            {c.role === "in" && <><span className="text-ink2">Kabelpuffer</span><span className="mono text-right">{fmtNum(c.buffer ?? 0)} / {fmtNum(c.bufferCap ?? 0)}</span></>}
            {c.role === "out" && <><span className="text-ink2">Gesendet seit Abrechnung</span><span className="mono text-right">{fmtNum(c.sent ?? 0)}</span></>}
          </div>
          <p className="text-ink2">Abrechnung alle {tickMinutes} Minuten. {c.role === "in" ? "Der Puffer deckt Mangel vor dem Speicher." : "Nur Ökostrom-Überschuss fließt, Kraftwerksstrom nie."}</p>
          {c.role === "out" && !c.ownPair && (
            <div className="flex items-center gap-2">
              <input aria-label="Neuer Preis je Strom-Stunde" inputMode="decimal" className="h-11 w-20 rounded-lg field px-2 mono text-right" value={price} onChange={(e) => setPrice(e.target.value)} />
              <Button kind="secondary" disabled={setP.busy || !(Number.isFinite(p) && p >= 0 && p <= maxPrice) || p === c.price} onClick={() => void setP.run({ cableId: c.id, price: p })}>Preis ändern</Button>
            </div>
          )}
          <Button kind="danger" disabled={cut.busy} onClick={() => {
            if (window.confirm(`Seekabel zu ${partner} trennen? Der Kabelpuffer verfällt; ein neues Kabel muss neu angeboten werden.`)) void cut.run({ cableId: c.id });
          }}>Kabel trennen</Button>
        </>
      )}
      <ErrorLine text={cut.error ?? accept.error ?? setP.error} code={cut.code ?? accept.code ?? setP.code} />
    </div>
  );
}
