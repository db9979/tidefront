// See: Empfohlenes Geleit je Frachtwert (ENTSCHEIDUNGEN-5.md). Kasten „Geleitschutz“ in Börsen-Order, Spielerhandel
// (Geleit des Anbieters) und Lieferverträgen: erwartete Kartellgruppe, günstigste Schiffsmischung aus dem Bestand
// daheim mit Siegchance im Probekampf (game-core recommendEscort, gleiche Siegregel wie der Server), Abwägung
// erwarteter Verlust gegen Kosten des Geleits und „Empfehlung übernehmen“ (setzt die Mengen im Geleit-Wähler).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { recommendEscort, type Balance as CoreBalance, type EscortAdvice as Advice, type Modifiers } from "@tidefront/game-core";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { countLabel, fmtNum } from "../lib/names.ts";
import { CountsLine, SmallButton } from "../ui.tsx";

type Counts = Record<string, number>;

const pct = (x: number) => `${fmtNum(Math.round(x * 1000) / 10, 1)} %`;
const taler = (x: number) => `${fmtNum(Math.round(x))} T`;
const same = (a: Counts, b: Counts) => {
  const ka = Object.entries(a).filter(([, n]) => n > 0).sort().join();
  const kb = Object.entries(b).filter(([, n]) => n > 0).sort().join();
  return ka === kb;
};

export interface EscortAdviceProps {
  base: BaseData;
  /** Warenwert der Ladung zum Richtpreis. */
  cargoValue: number;
  /** Strecke fürs Kartellrisiko (wie der Server würfelt). */
  riskKm: number;
  /** Börse/Vertrag: geringere Kartellchance. */
  market: boolean;
  /** Einfache Strecke der Geleitfahrt und Stunden, die die Schiffe fehlen. */
  trip: { km: number; awayHours: number };
  /** Gewähltes Geleit und Übernahme der Empfehlung. */
  escort: Counts;
  onApply: (units: Counts) => void;
  /** Zusatz unter der Abwägung (z. B. „Käufer noch unbekannt: gerechnet mit 400 km“). */
  note?: string;
}

/** Empfehlung berechnen (rein, im Browser; wenige Millisekunden). */
export function useEscortAdvice(base: BaseData, value: number, riskKm: number, market: boolean, trip: { km: number; awayHours: number }): Advice | null {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const b = meta.data?.balance as unknown as CoreBalance | undefined;
  const homeKey = base.units.map((u) => `${u.id}:${u.home}`).join(",");
  return useMemo(() => {
    if (!b || !(value > 0) || !Number.isFinite(riskKm)) return null;
    const home: Counts = Object.fromEntries(base.units.filter((u) => u.home > 0).map((u) => [u.id, u.home]));
    return recommendEscort({
      value, riskKm, market, trip, home, modifiers: base.modifiers as unknown as Modifiers,
      commandPoints: base.commandPoints, fuelAvailable: base.resources.treibstoff,
    }, b);
  }, [b, value, riskKm, market, trip.km, trip.awayHours, homeKey, base.commandPoints, base.modifiers, Math.floor(base.resources.treibstoff ?? 0)]);
}

export function EscortAdvice({ base, cargoValue, riskKm, market, trip, escort, onApply, note }: EscortAdviceProps) {
  const a = useEscortAdvice(base, cargoValue, riskKm, market, trip);
  if (!a) return null;
  const t = a.threat;
  const boats = t.force.schnellboot ?? 0;
  return (
    <div className="mt-2 rounded-[3px] border border-rule bg-inset p-2 text-sm" data-escort-advice={a.status} role="group" aria-label="Geleitschutz">
      <div className="text-[11px] font-display uppercase text-ink2">Geleitschutz</div>
      {a.status === "none" ? (
        <p className="text-xs text-ink2">Kurze Strecke: Das Kartell fängt hier nicht ab – Geleit nur gegen Kriegsgegner nötig.</p>
      ) : <>
        <p className="text-xs text-ink2">
          Erwartete Kartellgruppe: {boats > 0 ? `${fmtNum(boats)} ${countLabel("schnellboot", boats)}` : <CountsLine counts={t.force} />} · Überfallchance {pct(t.chance)}.
        </p>
        {a.status === "ok" && (
          <p className="mt-1">
            Empfehlung: <strong><CountsLine counts={a.units} /></strong> – hält im Probekampf in <strong>{pct(a.winRate ?? 0)}</strong> der Überfälle.
          </p>
        )}
        {a.status === "short" && (
          <p className="mt-1 text-siegel">
            {a.commandPointsShort
              ? <>Deine Schiffe daheim würden halten, aber die Kommandopunkte reichen nicht für so ein Geleit.</>
              : <>Dein Bestand reicht nicht: alle Kriegsschiffe daheim (<CountsLine counts={a.units} />) halten nur in {pct(a.winRate ?? 0)}.</>}
            {a.missing.length > 0 && <> Es fehlen etwa {a.missing.map((m) => `${fmtNum(m.extra)} ${countLabel(m.unit, m.extra)}`).join(" oder ")}.</>}
          </p>
        )}
        {a.status === "no_ships" && (
          <p className="mt-1 text-siegel">
            Keine Kriegsschiffe daheim – kein Geleit möglich.
            {a.missing.length > 0 && <> Gegen diese Gruppe bräuchte es etwa {a.missing.map((m) => `${fmtNum(m.extra)} ${countLabel(m.unit, m.extra)}`).join(" oder ")}.</>}
          </p>
        )}
        <Tradeoff a={a} />
        {note && <p className="text-[11px] text-ink2 mt-0.5">{note}</p>}
        {a.fuelShort && <p className="text-xs text-siegel mt-0.5">Der Treibstoff reicht nicht für diese Geleitfahrt.</p>}
        {(a.status === "ok" || (a.status === "short" && !a.commandPointsShort)) && (
          <div className="mt-1.5 flex justify-end">
            <SmallButton disabled={same(escort, a.units)} onClick={() => onApply(a.units)}>{same(escort, a.units) ? "Empfehlung übernommen" : "Empfehlung übernehmen"}</SmallButton>
          </div>
        )}
      </>}
    </div>
  );
}

/** Abwägung: erwarteter Verlust ohne Geleit gegen Kosten des Geleits. */
function Tradeoff({ a }: { a: Advice }) {
  const o = a.tradeoff;
  if (!o) {
    return <p className="text-xs text-ink2 mt-1">Ohne Geleit erwarteter Verlust ~{taler(a.threat.lossUnescorted)}.</p>;
  }
  const c = o.cost;
  return (
    <div className="text-xs mt-1" data-escort-tradeoff={o.worth ? "lohnt" : "lohnt-nicht"}>
      <p className="text-ink2">
        Ohne Geleit erwarteter Verlust ~{taler(o.lossUnescorted)}{o.lossEscorted >= 0.5 ? <>, mit Geleit ~{taler(o.lossEscorted)}</> : null}.
        {" "}Geleit kostet ~{taler(c.total)}: Treibstoff {fmtNum(c.fuel)} ({taler(c.fuelValue)}), Unterhalt {fmtNum(Math.round(c.upkeep))} Proviant ({taler(c.upkeepValue)})
        {c.shipLossValue >= 0.5 ? <>, erwartete Schiffsverluste {taler(c.shipLossValue)}</> : null}; die Schiffe sind etwa {fmtNum(Math.round(c.awayHours * 10) / 10, 1)} h nicht daheim.
      </p>
      <p className={`font-semibold ${o.worth ? "text-moos" : "text-ink2"}`}>
        {o.worth ? "Lohnt sich." : `Lohnt sich nicht (erwarteter Verlust nur ~${taler(o.lossUnescorted)}).`}
      </p>
    </div>
  );
}

/** Richtstrecke für das Geleit des Anbieters (der Käufer ist beim Einstellen noch unbekannt). */
export const SELLER_ASSUMED_KM = 500;

/**
 * Spielerhandel, Geleit des Anbieters: Der Käufer steht beim Einstellen noch nicht fest. Die Kartellgruppe hängt nur am
 * Warenwert (Empfehlung und Siegchance gelten), Chance und Kosten rechnen mit einer Richtstrecke von SELLER_ASSUMED_KM
 * (hin mit dem Konvoi, zurück gleich lang).
 */
export function SellerEscortAdvice({ base, resource, qty, escort, onApply }: { base: BaseData; resource: string; qty: number; escort: Counts; onApply: (u: Counts) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const b = meta.data?.balance;
  if (!b) return null;
  const km = SELLER_ASSUMED_KM;
  const hours = (2 * km) / (b.market.convoySpeedKmh || 45);
  return (
    <EscortAdvice base={base} cargoValue={qty * (b.market.refPrice[resource] ?? 0)} riskKm={km} market={false} trip={{ km, awayHours: hours }} escort={escort} onApply={onApply}
      note={`Käufer noch unbekannt: Überfallchance und Kosten gerechnet mit etwa ${fmtNum(km)} km Seeweg; die Kartellgruppe richtet sich nur nach dem Warenwert.`} />
  );
}

/**
 * Liefervertrag (Kauf per Konvoi): Je Lieferung ein Konvoi mit `qty` (Abo: je Tranche). Mit bekannter Fahrzeit
 * (KI-Vertrag) Strecke = Fahrzeit × Konvoigeschwindigkeit (der Seeweg, etwas länger als die Luftlinie, mit der der
 * Server würfelt – die Chance ist eher zu hoch); die Schiffe fehlen so lange, wie der Konvoi fährt. Ohne Fahrzeit
 * (Spielervertrag, Hafen des Partners hier unbekannt) mit der Richtstrecke wie beim Spielerhandel.
 */
export function ContractEscortAdvice({ base, resource, qty, travelMs, escort, onApply }: { base: BaseData; resource: string; qty: number; travelMs?: number; escort: Counts; onApply: (u: Counts) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const b = meta.data?.balance;
  if (!b || !(qty > 0)) return null;
  const speed = b.market.convoySpeedKmh || 45;
  const known = travelMs !== undefined && travelMs > 0;
  const km = known ? (travelMs / 3_600_000) * speed : SELLER_ASSUMED_KM;
  const hours = known ? travelMs / 3_600_000 : km / speed;
  return (
    <EscortAdvice base={base} cargoValue={qty * (b.market.refPrice[resource] ?? 0)} riskKm={km} market trip={{ km, awayHours: hours }} escort={escort} onApply={onApply}
      note={known ? undefined : `Hafen des Partners hier unbekannt: Überfallchance und Kosten gerechnet mit etwa ${fmtNum(km)} km Seeweg.`} />
  );
}
