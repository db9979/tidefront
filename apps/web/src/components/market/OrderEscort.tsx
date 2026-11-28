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
import { EffectHint } from "../politik/EffectHint.tsx"; // Weltpolitik: Geleitschutz

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
  // v1.35: Die Chance rechnet mit dem Warenwert aller eigenen Börsenkonvois der letzten Stunden samt dieser Order.
  const recent = (base.market as { recentConvoyValue?: number }).recentConvoyValue ?? 0;
  const riskValue = worth > 0 ? worth + recent : 0;
  const chance = Number.isFinite(km) ? cartelChance(km, riskValue, b, true) : 0;
  const loss = Number.isFinite(km) ? cartelExpectedLoss(km, riskValue, b, true) : 0;
  const escorted = Object.values(value).some((n) => n > 0);
  // Geleitfahrt: zum Handelshafen und mit dem Konvoi heim; die Schiffe fehlen bis zur Ankunft (feste Lieferzeit).
  // Strecke der Geleitfahrt: escortKm = Seeweg Hafen → Handelshafen wie gebucht (TST-02; distanceKm ist die Gegenrichtung).
  const awayHours = market.deliveryTravelMs(b.market as unknown as market.MarketBalance["market"], base.market.port.distanceKm) / 3_600_000;
  return (
    <div className="mb-3 text-sm" data-order-escort>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-display uppercase text-ink2">Konvoi ab {base.market.port.name}</span>
        <SmallButton expanded={open} onClick={() => setOpen(!open)}>{open ? "Geleit schließen" : escorted ? "Geleit ändern" : "Geleit wählen"}</SmallButton>
      </div>
      <EffectHint keys={["convoyCartelChance"]} className="mt-1" />
      {!escorted && (
        <p className="text-xs text-ink2 mt-1" role="note">
          {chance > 0
            ? <>Ohne Geleit: Das Kartell fängt diesen Konvoi mit etwa {pct(chance)} ab und nimmt dann {pct(cv.lossShareUnescorted)} der Ladung – im Mittel {pct(loss)} Verlust.{recent > 0 ? ` Deine Börsenkäufe der letzten ${cv.marketValueWindowHours ?? 4} Stunden (${fmtNum(Math.round(recent))} Warenwert) zählen dabei mit.` : ""} Kriegsgegner können ihn abfangen.</>
            : <>Kurze Strecke: Das Kartell fängt hier nicht ab. Kriegsgegner können den Konvoi abfangen.</>}
        </p>
      )}
      {worth > 0 && Number.isFinite(km) && (
        <EscortAdvice base={base} cargoValue={worth} riskValue={riskValue} riskKm={km} market trip={{ km: base.market.port.escortKm, awayHours }} escort={value}
          onApply={(u) => { onChange(u); setOpen(true); }} />
      )}
      {open && <EscortPicker base={base} value={value} onChange={onChange} hint="Die Schiffe fahren dem Konvoi zum Handelshafen entgegen und kommen mit ihm heim (Treibstoff, ein Missionsplatz). Sie kämpfen, wenn das Kartell oder ein Kriegsgegner abfängt." />}
    </div>
  );
}
