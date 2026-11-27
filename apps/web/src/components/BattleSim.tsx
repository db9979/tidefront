// Kampfsimulator (eigener, nachgeladener Chunk): Probekampf in der Missionsplanung; der freie Simulator liegt in
// FreeSim.tsx (hier weitergereicht). Rechnet mit simulateBattle aus dem Regelkern (Siegregel und Beute je Kampfart
// wie der Server, Sicht der eigenen Seite); Einheiten kommen generisch aus der Balance.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AttackerInput, CombatWeather, DefenderInput } from "@tidefront/game-core";
import { trpc, type Balance, type BaseData } from "../lib/trpc.ts";
import { fmtTime } from "../lib/time.ts";
import { nestDefenderOf, nestRangeRates } from "../lib/sim-nest.ts"; // Lebendige Nester
import { nestProbeDefenders, type MapNestLagebild } from "../lib/nest-intel.ts";
import { positive, type Counts } from "../lib/sim.ts";
import type { Target } from "../App.tsx";
import { Button, SmallButton } from "../ui.tsx";
import { Outcome, SimNote, pct, weatherText } from "./SimResult.tsx";
import { WinSearch } from "./WinSearch.tsx";

export { FreeSim, type FreeSimPreset } from "./FreeSim.tsx";
export { SimResult, Outcome } from "./SimResult.tsx";

export type ProbeTarget =
  | { kind: "nest"; level: number; empty: boolean; lagebild?: MapNestLagebild | null } // Lebendige Nester
  | { kind: "base"; col: number; row: number; name: string };

/**
 * Probekampf in der Missionsplanung: gewählter Verband gegen Nest-Besatzung oder letztes Lagebild, mit dem
 * vorhergesagten Wetter am Ziel zur Ankunft (`weather`). „Was fehlt zum Sieg?“ sucht den günstigsten Verband.
 */
export function ProbeKampf({ balance, base, units, versorgungsmangel, modifiers, target, onScout, weather, planAt }: {
  balance: Balance; base: BaseData; units: Counts; versorgungsmangel: boolean; modifiers?: BaseData["modifiers"]; target: ProbeTarget; onScout: () => void; weather?: CombatWeather; planAt?: Target | null;
}) {
  const scout = useQuery({ ...trpc.comfort.scout.queryOptions(target.kind === "base" ? { col: target.col, row: target.row } : { col: 0, row: 0 }), enabled: target.kind === "base" });
  const [win, setWin] = useState(false);
  // Eigene Modifikatoren (Forschung, Veteranen, Admiral) rechnen mit; das Ziel ohne (sein Stand ist unbekannt).
  const attacker = useMemo<AttackerInput>(() => ({ units: positive(units), versorgungsmangel, ...(modifiers ? { modifiers } : {}) }), [units, versorgungsmangel, modifiers]);
  const defenders = useMemo<DefenderInput[] | null>(() => {
    if (target.kind === "nest") return nestProbeDefenders(target.level, target.lagebild, Date.now(), balance);
    const s = scout.data;
    return s ? [{ units: s.units, defenses: s.defenses, resources: s.resources, protectedPerResource: s.protectedPerResource }] : null;
  }, [target, scout.data, balance]);
  // Ohne Lagebild gegen die Mitte (wie im Handbuch), mit Lagebild genau; „Was fehlt“ rechnet über die ganze Spanne.
  const defender = useMemo<DefenderInput | null>(() => (target.kind === "nest" && !target.lagebild ? nestDefenderOf(target.level, "mid", balance) : defenders?.[0] ?? null), [target, defenders, balance]);

  if (target.kind === "nest" && target.empty) return <p className="text-sm text-ink2">Das Nest ist verlassen – kein Kampf.</p>;
  if (target.kind === "base") {
    if (scout.isLoading) return <p className="text-sm text-ink2">Lade Lagebild …</p>;
    if (!scout.data) {
      return (
        <div className="text-sm space-y-2">
          <p className="font-semibold text-messing">Erst aufklären.</p>
          <p className="text-ink2">Über {target.name} liegt kein eigenes Lagebild vor. Der Probekampf rechnet nur mit den Daten deiner letzten Aufklärung.</p>
          <Button kind="secondary" onClick={onScout}>Aufklärung planen</Button>
        </div>
      );
    }
  }
  if (!defender || !defenders) return <p className="text-sm text-siegel">Unbekanntes Ziel.</p>;
  const { units: _u, ...conditions } = attacker;
  return (
    <div>
      {target.kind === "base" && scout.data && (
        <p className="text-xs text-ink2 mb-2">Lagebild mit Stand {fmtTime(scout.data.atMs)}. Der Hafen kann sich seither verändert haben.</p>
      )}
      {target.kind === "nest" && target.lagebild && <p className="text-xs text-ink2 mb-2">Genau gegen das Lagebild mit Stand {fmtTime(target.lagebild.atMs)} (Erholung und Beute hochgerechnet).</p>}
      {target.kind === "nest" && !target.lagebild && <NestRangeLine level={target.level} attacker={attacker} balance={balance} weather={weather} onScout={onScout} />}
      {weather && <p className="text-xs text-ink2 mb-2" data-testid="probe-wetter">Wetter am Ziel zur Ankunft (Vorhersage, Mitte der Spanne): {weatherText(weather)}.</p>}
      <Outcome attacker={attacker} defender={defender} balance={balance} weather={weather} />
      <SimNote attacker={attacker} defender={defender} weather={weather} extra={versorgungsmangel ? "Dein Versorgungsmangel ist eingerechnet." : undefined} />
      <div className="mt-3">
        {win
          ? <WinSearch target={{ attacker: conditions, defenders, ...(weather ? { weather } : {}) }} base={base} balance={balance} planAt={planAt} autoStart />
          : <SmallButton onClick={() => setWin(true)}>Was fehlt zum Sieg?</SmallButton>}
      </div>
    </div>
  );
}

/** Probekampf ohne Lagebild: Siegchance über die Spanne (ungünstigster Wurf … günstigster, im Mittel). */
function NestRangeLine({ level, attacker, balance, weather, onScout }: { level: number; attacker: AttackerInput; balance: Balance; weather?: CombatWeather; onScout: () => void }) {
  const r = useMemo(() => nestRangeRates(attacker, level, balance, weather), [attacker, level, balance, weather]);
  if (!r || r.min === r.max) return <p className="text-xs text-ink2 mb-2">Besatzung von Nest Stufe {level} (fest).</p>;
  return (
    <div className="text-sm mb-2" data-testid="probe-spanne">
      <p>Siegchance <strong>{pct(r.min)}–{pct(r.max)}</strong>, im Mittel <strong>{pct(r.mean)}</strong> <span className="text-xs text-ink2">(unterer Wert: ungünstigster Wurf)</span></p>
      <p className="text-xs text-ink2">Ohne Lagebild ist nur die Spanne der Besatzung bekannt; unten die Rechnung gegen die Mitte. Mit Lagebild genauer –</p>
      <Button kind="secondary" className="mt-1" onClick={onScout}>Aufklärung schicken</Button>
    </div>
  );
}
