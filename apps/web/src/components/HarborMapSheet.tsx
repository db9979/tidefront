// Mehrere Häfen auf der Karte: Infoblatt „Außenposten gründen“ für ein freies Küstenfeld und Aktionen für einen
// eigenen, nicht aktiven Hafen (wechseln, Transport, Verlegen).
import { useQuery } from "@tanstack/react-query";
import { hexDistanceKm } from "@tidefront/world";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { FOUNDING, TRANSFER, expansionRules, foundingState } from "../lib/expansion.ts";
import type { Target } from "../App.tsx";
import { Icon } from "../icons.tsx";
import { Button } from "../ui.tsx";

/** Abschnitt im Scrollbereich des Infopanels: freies Küstenfeld. */
export function FoundingInfo({ base, sel }: { base: BaseData; sel: { col: number; row: number } }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const rules = expansionRules(meta.data?.balance);
  const f = foundingState(base, rules);
  const km = hexDistanceKm(base, sel);
  const inRange = km <= rules.maxRangeKm;
  return (
    <div className="mt-1">
      <div className="font-serif text-[19px] leading-tight flex items-center gap-2 mt-0.5"><Icon id="gruendung" size={26} /> Freies Küstenfeld</div>
      <div className="text-xs text-ink2">Hier ließe sich ein Außenposten gründen: ein weiterer Hafen mit eigenen Gebäuden, Lager und Truppen.</div>
      <ul className="text-xs mt-1 space-y-0.5">
        <li className={inRange ? "text-moos" : "text-siegel"}>{inRange ? "✓" : "✗"} {fmtNum(km)} km von {base.name} (Reichweite {fmtNum(rules.maxRangeKm)} km)</li>
        {f.need === null ? (
          <li className="text-siegel">✗ Höchstzahl von {rules.maxBases} Häfen erreicht</li>
        ) : (
          <li className={f.unlocked ? "text-moos" : ""}>{f.unlocked ? "✓" : "·"} Kommandozentrale im Heimathafen Stufe {f.need}{f.level !== null ? ` (jetzt ${f.level})` : ""}</li>
        )}
        <li className={f.ships > 0 ? "text-moos" : ""}>{f.ships > 0 ? `✓ ${f.ships} ${label("kolonieschiff")} in ${base.name}` : `· ${label("kolonieschiff")} aus der Werft nötig (wird verbraucht)`}</li>
      </ul>
      {!rules.live && <div className="text-xs text-messing mt-1">Die Gründung ist in dieser Saison noch nicht freigeschaltet.</div>}
    </div>
  );
}

/** Knopf in der Aktionsleiste des Infopanels: Gründung planen. */
export function FoundingButton({ base, sel, onPlan }: { base: BaseData; sel: { col: number; row: number }; onPlan: (t: Target) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const f = foundingState(base, expansionRules(meta.data?.balance));
  if (f.need === null) return null;
  return <Button className="flex-1" onClick={() => onPlan({ ...sel, expansion: FOUNDING })}>Außenposten gründen</Button>;
}

/** Eigener, nicht aktiver Hafen: wechseln, Ladung hinschicken, Einheiten dauerhaft verlegen. */
export function OwnHarborActions({ sel, onSwitch, onPlan }: { sel: { col: number; row: number; id: number }; onSwitch: (id: number) => void; onPlan: (t: Target) => void }) {
  const t = { col: sel.col, row: sel.row };
  return (
    <>
      <Button className="basis-full" onClick={() => onSwitch(sel.id)}>Hierhin wechseln</Button>
      <Button kind="secondary" className="flex-1" onClick={() => onPlan({ ...t, expansion: "transport" })}>Transport</Button>
      <Button kind="secondary" className="flex-1" onClick={() => onPlan({ ...t, expansion: TRANSFER })}>Verlegen</Button>
    </>
  );
}
