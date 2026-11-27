// See: Empfohlenes Geleit je Frachtwert (ENTSCHEIDUNGEN-5.md). Konvoi-Blatt: „Probekampf gegen das Kartell“ für einen
// eigenen Konvoi – sein Geleit gegen die Kartellgruppe, die der Server für diese Ladung zusammenstellt (game-core
// expectedCartelGroup/probeEscort, gleiche Siegregel wie der Server), mit den Modifikatoren des aktiven Hafens.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cargoValue, convoysOf, ESCORT_TARGET, ESCORT_VERIFY_OFFSET, ESCORT_VERIFY_RUNS, expectedCartelGroup, probeEscort, type Balance as CoreBalance, type Modifiers } from "@tidefront/game-core";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { countLabel, fmtNum } from "../lib/names.ts";
import { CountsLine, SmallButton } from "../ui.tsx";

type Counts = Record<string, number>;

const pct = (x: number) => `${fmtNum(Math.round(x * 1000) / 10, 1)} %`;

export function ConvoyProbe({ cargo, escort, base }: { cargo: Counts; escort: Counts; base?: BaseData }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [open, setOpen] = useState(false);
  const b = meta.data?.balance as unknown as CoreBalance | undefined;
  const result = useMemo(() => {
    if (!open || !b) return null;
    const value = cargoValue(cargo, b);
    // Die Zusammensetzung hängt nur am Warenwert; die Strecke zählt hier nicht (nur für die Chance).
    const threat = expectedCartelGroup(value, Infinity, b);
    const probe = probeEscort(escort, threat.force, b, { modifiers: base?.modifiers as unknown as Modifiers | undefined, runs: ESCORT_VERIFY_RUNS, seedOffset: ESCORT_VERIFY_OFFSET });
    return { threat, probe };
  }, [open, b, cargo, escort, base?.modifiers]);
  const escorted = Object.values(escort).some((n) => n > 0);
  return (
    <div className="mt-1" data-convoy-probe>
      <SmallButton expanded={open} onClick={() => setOpen(!open)}>{open ? "Probekampf schließen" : "Probekampf gegen das Kartell"}</SmallButton>
      {open && result && (
        <div className="mt-1 rounded-[3px] border border-rule bg-inset p-2 text-xs" data-convoy-probe-result>
          <span className="block">
            Kartellgruppe für diese Ladung: {fmtNum(result.threat.force.schnellboot ?? 0)} {countLabel("schnellboot", result.threat.force.schnellboot ?? 0)}.
          </span>
          {!escorted ? (
            <span className="block text-siegel">Ohne Geleit: Ein Überfall kostet sicher {pct(lossShare(b!, false))} der Ladung.</span>
          ) : result.probe ? (
            <span className={`block ${result.probe.winRate >= ESCORT_TARGET ? "text-moos" : "text-siegel"}`}>
              Geleit (<CountsLine counts={escort} />) hält in <strong>{pct(result.probe.winRate)}</strong> der Probekämpfe
              {result.probe.winRate < 1 ? <>; unterliegt es, gehen {pct(lossShare(b!, true))} der Ladung verloren</> : null}.
              {result.probe.avgLostValue >= 0.5 ? <> Erwartete Schiffsverluste je Überfall ~{fmtNum(Math.round(result.probe.avgLostValue))} T.</> : null}
            </span>
          ) : <span className="block text-ink2">Unbekannte Einheit – kein Probekampf.</span>}
          <span className="block text-ink2">Probekampf ohne Wetter, {fmtNum(ESCORT_VERIFY_RUNS)} Läufe; Kriegsgegner sind nicht eingerechnet.</span>
        </div>
      )}
    </div>
  );
}

function lossShare(b: CoreBalance, beaten: boolean): number {
  const c = convoysOf(b);
  return (beaten ? c?.lossShareEscortBeaten : c?.lossShareUnescorted) ?? 0;
}
