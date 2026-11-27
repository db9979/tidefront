// See: Börsenkauf als Konvoi – Geleitschutz optional in der Order (wie beim Spielerhandel), ohne Geleit ein Hinweis
// aufs Risiko mit der Rechnung des Servers (game-core cartelExpectedLoss: Chance × Verlustanteil für Börsenkonvois).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cartelChance, cartelExpectedLoss, convoysOf, market, type Balance as CoreBalance } from "@tidefront/game-core";
import { trpc, type BaseData } from "../../lib/trpc.ts";
import { fmtNum } from "../../lib/names.ts";
import { SmallButton } from "../../ui.tsx";
import { EscortPicker } from "../Naval.tsx";
import { EscortAdvice } from "../EscortAdvice.tsx"; // See: Empfohlenes Geleit je Frachtwert

type Counts = Record<string, number>;

const pct = (x: number) => `${fmtNum(Math.round(x * 1000) / 10, 1)} %`;

export function OrderEscort({ base, resource, qty, value, onChange }: { base: BaseData; resource: string; qty: number; value: Counts; onChange: (v: Counts) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [open, setOpen] = useState(false);
  const b = meta.data?.balance as unknown as CoreBalance | undefined;
  const cv = b ? convoysOf(b) : null;
  if (!b || !cv) return null;
  const km = market.deliveryRiskKm(b.market as unknown as market.MarketBalance["market"], base.market.port.distanceKm); // feste Lieferzeit: Risiko für alle gleich
  const worth = qty * (b.market.refPrice[resource] ?? 0);
  const chance = Number.isFinite(km) ? cartelChance(km, worth, b, true) : 0;
  const loss = Number.isFinite(km) ? cartelExpectedLoss(km, worth, b, true) : 0;
  const escorted = Object.values(value).some((n) => n > 0);
  // Geleitfahrt: zum Handelshafen und mit dem Konvoi heim; die Schiffe fehlen bis zur Ankunft (feste Lieferzeit).
  const awayHours = market.deliveryTravelMs(b.market as unknown as market.MarketBalance["market"], base.market.port.distanceKm) / 3_600_000;
  return (
    <div className="mb-3 text-sm" data-order-escort>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-display uppercase text-ink2">Konvoi ab {base.market.port.name}</span>
        <SmallButton expanded={open} onClick={() => setOpen(!open)}>{open ? "Geleit schließen" : escorted ? "Geleit ändern" : "Geleit wählen"}</SmallButton>
      </div>
      {!escorted && (
        <p className="text-xs text-ink2 mt-1" role="note">
          {chance > 0
            ? <>Ohne Geleit: Das Kartell fängt diesen Konvoi mit etwa {pct(chance)} ab und nimmt dann {pct(cv.lossShareUnescorted)} der Ladung – im Mittel {pct(loss)} Verlust. Kriegsgegner können ihn abfangen.</>
            : <>Kurze Strecke: Das Kartell fängt hier nicht ab. Kriegsgegner können den Konvoi abfangen.</>}
        </p>
      )}
      {worth > 0 && Number.isFinite(km) && (
        <EscortAdvice base={base} cargoValue={worth} riskKm={km} market trip={{ km: base.market.port.distanceKm, awayHours }} escort={value}
          onApply={(u) => { onChange(u); setOpen(true); }} />
      )}
      {open && <EscortPicker base={base} value={value} onChange={onChange} hint="Die Schiffe fahren dem Konvoi zum Handelshafen entgegen und kommen mit ihm heim (Treibstoff, ein Missionsplatz). Sie kämpfen, wenn das Kartell oder ein Kriegsgegner abfängt." />}
    </div>
  );
}
